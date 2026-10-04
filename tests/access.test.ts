import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyAccessJwt, type AccessCert } from "../src/access.ts";

const DOMAIN = "team.cloudflareaccess.com";
const AUDIENCE = "gallery-audience";

async function signToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test-key", typ: "JWT" },
): Promise<{ token: string; jwk: AccessCert }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk = { ...exported, kid: "test-key", alg: "RS256" };
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode(header)}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(data),
  );
  return { token: `${data}.${Buffer.from(signature).toString("base64url")}`, jwk };
}

describe("Cloudflare Access JWT", () => {
  it("accepts a signed account token and fails closed otherwise", async () => {
    const now = 1_800_000_000;
    const { token, jwk } = await signToken({
      iss: `https://${DOMAIN}`,
      aud: AUDIENCE,
      exp: now + 600,
    });
    const loadCerts = async () => [jwk];
    assert.equal(
      await verifyAccessJwt(token, {
        teamDomain: DOMAIN,
        audience: AUDIENCE,
        loadCerts,
        now,
      }),
      true,
    );

    let called = false;
    assert.equal(
      await verifyAccessJwt(token, {
        teamDomain: "",
        audience: AUDIENCE,
        loadCerts: async () => {
          called = true;
          return [jwk];
        },
        now,
      }),
      false,
    );
    assert.equal(called, false);

    assert.equal(
      await verifyAccessJwt(token, {
        teamDomain: DOMAIN,
        audience: "other-audience",
        loadCerts,
        now,
      }),
      false,
    );
    assert.equal(
      await verifyAccessJwt(token, {
        teamDomain: DOMAIN,
        audience: AUDIENCE,
        loadCerts,
        now: now + 10_000,
      }),
      false,
    );
    assert.equal(
      await verifyAccessJwt(token, {
        teamDomain: DOMAIN,
        audience: AUDIENCE,
        loadCerts: async () => {
          throw new Error("network");
        },
        now,
      }),
      false,
    );

    const none = await signToken(
      { iss: `https://${DOMAIN}`, aud: AUDIENCE, exp: now + 600 },
      { alg: "none", kid: "test-key" },
    );
    assert.equal(
      await verifyAccessJwt(none.token, {
        teamDomain: DOMAIN,
        audience: AUDIENCE,
        loadCerts: async () => [none.jwk],
        now,
      }),
      false,
    );
  });
});
