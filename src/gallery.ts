import { loadAccessCerts, verifyAccessJwt } from "./access.ts";
import { ArchiveRejection, validateGalleryZip } from "./archive.ts";
import { galleryDocumentHtml } from "./gallery-page.ts";
import { CURRENT_ARCHIVE_KEY, LIMITS, type RejectionCode } from "./limits.ts";

export interface ArchiveBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

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

function json(status: number, body: { ok?: boolean; archive?: string; error?: RejectionCode; generatedAt?: string; images?: string[] }): Response {
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

async function publish(request: Request, env: GalleryBindings): Promise<Response> {
  const configured = env.PUBLISH_SECRET ?? "";
  const presented = bearer(request);
  if (configured.length === 0 || presented.length === 0 || !safeEqual(presented, configured)) {
    return text(401, "Unauthorized");
  }
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

function html(): Response {
  return new Response(galleryDocumentHtml(), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
  if (!(await viewerAllowed(request, env, deps))) {
    return text(403, "Forbidden");
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    return html();
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/archive") {
    const bucket = env.SCREENSHOTS;
    if (!bucket) return text(503, "Gallery storage is not configured.");
    const object = await bucket.get(CURRENT_ARCHIVE_KEY);
    if (!object) return text(404, "No screenshots have been published.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    return new Response(bytes, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${CURRENT_ARCHIVE_KEY}"`,
      },
    });
  }
  return text(404, "Not found");
}
