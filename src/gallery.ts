import { loadAccessCerts, verifyAccessJwt } from "./access.ts";
import { ArchiveRejection, validateGalleryZip, validateSnapshotZip } from "./archive.ts";
import { galleryDocumentHtml } from "./gallery-page.ts";
import {
  CURRENT_ARCHIVE_KEY,
  LEGACY_ARCHIVE_KEY,
  LIMITS,
  SNAPSHOT_ID,
  snapshotArchiveKey,
  snapshotManifestKey,
  type RejectionCode,
} from "./limits.ts";
import { listMerges, mergeSummaryBytes, pruneMerges, type MergeBucket } from "./merges.ts";

/** Private R2: get/put for archives, list/delete for merge history. */
export type ArchiveBucket = MergeBucket;

export type GalleryBindings = {
  SCREENSHOTS?: ArchiveBucket;
  PUBLISH_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

export type GalleryDependencies = {
  verifyAccess?: (jwt: string, env: GalleryBindings) => Promise<boolean>;
};

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

function text(status: number, body: string, extra?: Record<string, string>): Response {
  return new Response(`${body}\n`, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      ...extra,
    },
  });
}

function json(
  status: number,
  body: {
    ok?: boolean;
    archive?: string;
    snapshot?: string;
    error?: RejectionCode;
    generatedAt?: string;
    images?: string[];
    pruned?: string[];
    retention?: "complete" | "incomplete";
  },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([!-~]+)$/.exec(header);
  return match?.[1] ?? "";
}

async function readBody(request: Request, max: number): Promise<Uint8Array | ArchiveRejection> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    return new ArchiveRejection("too_large");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return new ArchiveRejection("too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function viewerAllowed(
  request: Request,
  env: GalleryBindings,
  deps: GalleryDependencies,
): Promise<boolean> {
  const jwt = request.headers.get("cf-access-jwt-assertion") ?? "";
  if (!jwt) return false;
  const verify =
    deps.verifyAccess ??
    ((token: string, bindings: GalleryBindings) =>
      verifyAccessJwt(token, {
        teamDomain: bindings.ACCESS_TEAM_DOMAIN,
        audience: bindings.ACCESS_AUD,
        loadCerts: loadAccessCerts,
      }));
  return verify(jwt, env);
}

function publisherAllowed(request: Request, env: GalleryBindings): boolean {
  const configured = env.PUBLISH_SECRET ?? "";
  const presented = bearer(request);
  return configured.length > 0 && presented.length > 0 && safeEqual(presented, configured);
}

async function publish(request: Request, env: GalleryBindings): Promise<Response> {
  if (!publisherAllowed(request, env)) return text(401, "Unauthorized");
  const bucket = env.SCREENSHOTS;
  if (!bucket) return text(503, "Gallery storage is not configured.");
  const body = await readBody(request, LIMITS.maxZipBytes);
  if (body instanceof ArchiveRejection) return json(400, { error: body.code });
  let validated;
  try {
    validated = await validateGalleryZip(body);
  } catch (error) {
    const code = error instanceof ArchiveRejection ? error.code : "malformed";
    return json(400, { error: code });
  }
  try {
    await bucket.put(CURRENT_ARCHIVE_KEY, body, {
      httpMetadata: { contentType: "application/zip" },
    });
  } catch {
    return text(503, "The archive was not replaced.");
  }
  return json(200, {
    ok: true,
    archive: CURRENT_ARCHIVE_KEY,
    generatedAt: validated.generatedAt,
    images: validated.images.map((image) => image.file),
  });
}

/**
 * Store one merge snapshot in its own folder: `merges/<id>/archive.zip`, then
 * `merges/<id>/manifest.json` (the summary the merge list reads). The id in
 * the path must match the manifest, so a retry of the same merge replaces its
 * own folder and never touches `develop/` or another merge. Only after both
 * are stored are merges past the newest ten pruned; a pruning error leaves
 * extra history for the next publish to remove and does not fail this one.
 */
async function publishSnapshot(request: Request, env: GalleryBindings, id: string): Promise<Response> {
  if (!publisherAllowed(request, env)) return text(401, "Unauthorized");
  const bucket = env.SCREENSHOTS;
  if (!bucket) return text(503, "Gallery storage is not configured.");
  const body = await readBody(request, LIMITS.maxZipBytes);
  if (body instanceof ArchiveRejection) return json(400, { error: body.code });
  let validated;
  try {
    validated = await validateSnapshotZip(body);
  } catch (error) {
    const code = error instanceof ArchiveRejection ? error.code : "malformed";
    return json(400, { error: code });
  }
  if (validated.snapshot.id !== id) return json(400, { error: "bad_manifest" });
  const key = snapshotArchiveKey(id);
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType: "application/zip" },
    });
    await bucket.put(
      snapshotManifestKey(id),
      mergeSummaryBytes({ ...validated.snapshot, generatedAt: validated.generatedAt, images: validated.images.length }),
      { httpMetadata: { contentType: "application/json" } },
    );
  } catch {
    return text(503, "The snapshot was not stored.");
  }
  let pruned: string[] = [];
  let retention: "complete" | "incomplete" = "complete";
  try {
    pruned = await pruneMerges(bucket, id);
  } catch {
    retention = "incomplete";
  }
  return json(200, {
    ok: true,
    archive: key,
    snapshot: id,
    generatedAt: validated.generatedAt,
    images: validated.images.map((image) => image.file),
    pruned,
    retention,
  });
}

function zip(bytes: Uint8Array<ArrayBuffer>, filename: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

const SNAPSHOT_PUBLISH_PATH = /^\/publish\/snapshots\/([^/]+)$/;
const SNAPSHOT_PATH = /^\/merges\/([^/]+)\/archive$/;

function html(): Response {
  return new Response(galleryDocumentHtml(), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export async function handleRequest(
  request: Request,
  env: GalleryBindings,
  deps: GalleryDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/publish") {
    return publish(request, env);
  }
  const snapshotPublish = SNAPSHOT_PUBLISH_PATH.exec(url.pathname);
  if (request.method === "POST" && snapshotPublish) {
    const id = snapshotPublish[1]!;
    if (!SNAPSHOT_ID.test(id)) return text(404, "Not found");
    return publishSnapshot(request, env, id);
  }
  if (!(await viewerAllowed(request, env, deps))) {
    return text(403, "Forbidden");
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    return html();
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/archive") {
    const bucket = env.SCREENSHOTS;
    if (!bucket) return text(503, "Gallery storage is not configured.");
    // The develop gallery; before its first develop/ publish, the archive at the old key.
    const object = (await bucket.get(CURRENT_ARCHIVE_KEY)) ?? (await bucket.get(LEGACY_ARCHIVE_KEY));
    if (!object) return text(404, "No screenshots have been published.");
    return zip(new Uint8Array(await object.arrayBuffer()), "develop-screenshots.zip");
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/merges") {
    const bucket = env.SCREENSHOTS;
    if (!bucket) return text(503, "Gallery storage is not configured.");
    let merges;
    try {
      merges = await listMerges(bucket);
    } catch {
      return text(503, "The merge list could not be read.");
    }
    return new Response(JSON.stringify({ merges }), {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" },
    });
  }
  const snapshotRead = SNAPSHOT_PATH.exec(url.pathname);
  if ((request.method === "GET" || request.method === "HEAD") && snapshotRead && SNAPSHOT_ID.test(snapshotRead[1]!)) {
    const bucket = env.SCREENSHOTS;
    if (!bucket) return text(503, "Gallery storage is not configured.");
    const key = snapshotArchiveKey(snapshotRead[1]!);
    const object = await bucket.get(key);
    if (!object) return text(404, "No snapshot has been published for this merge.");
    return zip(new Uint8Array(await object.arrayBuffer()), `${snapshotRead[1]!}.zip`);
  }
  return text(404, "Not found");
}
