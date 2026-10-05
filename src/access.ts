const TEAM_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type AccessCert = {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
};

export type AccessCertSource = (teamDomain: string) => Promise<readonly AccessCert[]>;

type AccessHeader = {
  alg?: string;
  kid?: string;
};

type AccessPayload = {
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iss?: string;
};

function isTeamDomain(value: string): boolean {
  return TEAM_DOMAIN.test(value);
}

function isAudience(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/\s/.test(value);
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  return Array.isArray(aud) && aud.some((item) => item === expected);
}

export async function verifyAccessJwt(
  jwt: string,
  options: {
    teamDomain: string | undefined;
    audience: string | undefined;
    loadCerts: AccessCertSource;
    now?: number;
  },
): Promise<boolean> {
  const domain = options.teamDomain?.trim().toLowerCase() ?? "";
  const audience = options.audience?.trim() ?? "";
  if (!isTeamDomain(domain) || !isAudience(audience)) return false;
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;

  let header: AccessHeader;
  let payload: AccessPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!))) as AccessHeader;
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]!))) as AccessPayload;
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
    return false;
  }
  if (payload.iss !== `https://${domain}`) return false;
  if (!audienceMatches(payload.aud, audience)) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 60) return false;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return false;

  let keys: readonly AccessCert[];
  try {
    keys = await options.loadCerts(domain);
  } catch {
    return false;
  }
  const match = keys.find(
    (key) => key.kid === header.kid && key.kty === "RSA" && typeof key.n === "string" && typeof key.e === "string",
  );
  if (!match || typeof match.n !== "string" || typeof match.e !== "string") return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: match.n, e: match.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const data = new ArrayBuffer(dataBytes.byteLength);
    new Uint8Array(data).set(dataBytes);
    const signatureBytes = decodeBase64Url(parts[2]!);
    const signature = new ArrayBuffer(signatureBytes.byteLength);
    new Uint8Array(signature).set(signatureBytes);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  } catch {
    return false;
  }
}

const certCache = new Map<string, { expires: number; keys: AccessCert[] }>();

export async function loadAccessCerts(teamDomain: string): Promise<AccessCert[]> {
  const cached = certCache.get(teamDomain);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("access certs unavailable");
  const body = (await response.json()) as { keys?: AccessCert[] };
  if (!Array.isArray(body.keys)) throw new Error("access certs unavailable");
  certCache.set(teamDomain, { expires: Date.now() + 10 * 60 * 1000, keys: body.keys });
  return body.keys;
}
