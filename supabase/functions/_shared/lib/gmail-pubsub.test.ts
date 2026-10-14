import { assert, assertRejects, assertEquals } from "jsr:@std/assert";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "npm:jose@6.2.3";
import {
  GmailPubSubAuthenticationError,
  GmailPubSubPayloadError,
  parseGmailPubSubPush,
  verifyGmailPubSubOidcToken,
  type GmailPubSubOidcConfig,
} from "./gmail-pubsub.ts";

const config: GmailPubSubOidcConfig = {
  audience: "https://receiptle.example/functions/v1/gmail-webhook",
  serviceAccountEmail:
    "gmail-pubsub-push@gen-lang-client-0320504047.iam.gserviceaccount.com",
  serviceAccountSubject: "123456789012345678901",
};
const subscription =
  "projects/gen-lang-client-0320504047/subscriptions/gmail-notifications-push";
const keyId = "test-key";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
const jwks = createLocalJWKSet({
  keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }],
});

async function createToken(
  overrides: {
    audience?: string | string[];
    email?: string;
    emailVerified?: boolean;
    issuer?: string;
    subject?: string;
    issuedAt?: number;
  } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    email: overrides.email ?? config.serviceAccountEmail,
    email_verified: overrides.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "JWT" })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? config.audience)
    .setSubject(overrides.subject ?? config.serviceAccountSubject)
    .setIssuedAt(overrides.issuedAt ?? now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

Deno.test("accepts a valid Pub/Sub OIDC token", async () => {
  const token = await createToken();

  await verifyGmailPubSubOidcToken(`Bearer ${token}`, config, jwks);
});

Deno.test("rejects a missing or malformed bearer token", async () => {
  await assertRejects(
    () => verifyGmailPubSubOidcToken(null, config, jwks),
    GmailPubSubAuthenticationError
  );
  await assertRejects(
    () => verifyGmailPubSubOidcToken("Basic token", config, jwks),
    GmailPubSubAuthenticationError
  );
});

Deno.test("rejects tokens with unexpected identity claims", async () => {
  const invalidTokens = [
    await createToken({ audience: "https://attacker.example" }),
    await createToken({ email: "other@example.com" }),
    await createToken({ emailVerified: false }),
    await createToken({ subject: "987654321098765432109" }),
    await createToken({ issuer: "https://attacker.example" }),
    await createToken({ issuedAt: Math.floor(Date.now() / 1000) + 300 }),
  ];

  for (const token of invalidTokens) {
    await assertRejects(
      () => verifyGmailPubSubOidcToken(`Bearer ${token}`, config, jwks),
      GmailPubSubAuthenticationError
    );
  }
});

Deno.test("rejects a token with a tampered signature", async () => {
  const token = await createToken();
  const lastCharacter = token.at(-1);
  assert(lastCharacter);
  const tamperedToken = `${token.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;

  await assertRejects(
    () => verifyGmailPubSubOidcToken(`Bearer ${tamperedToken}`, config, jwks),
    GmailPubSubAuthenticationError
  );
});

Deno.test("parses a valid Gmail notification from the expected subscription", () => {
  const message = btoa(
    JSON.stringify({
      emailAddress: "Federico@Example.com",
      historyId: "2613305",
    })
  );
  const body = JSON.stringify({ subscription, message: { data: message } });

  assertEquals(parseGmailPubSubPush(body, subscription), {
    gmailEmail: "federico@example.com",
    historyId: "2613305",
  });
});

Deno.test("rejects malformed or unexpected Pub/Sub payloads", () => {
  const validMessage = btoa(
    JSON.stringify({
      emailAddress: "federico@example.com",
      historyId: "2613305",
    })
  );
  const body = JSON.stringify({
    subscription,
    message: { data: validMessage },
  });

  try {
    parseGmailPubSubPush(body, "projects/other/subscriptions/other");
    throw new Error("Expected a subscription mismatch");
  } catch (error) {
    assert(error instanceof GmailPubSubPayloadError);
    assertEquals(error.status, 403);
  }

  for (const invalidBody of ["not-json", JSON.stringify({ subscription })]) {
    try {
      parseGmailPubSubPush(invalidBody, subscription);
      throw new Error("Expected an invalid payload");
    } catch (error) {
      assert(error instanceof GmailPubSubPayloadError);
      assertEquals(error.status, 400);
    }
  }

  const invalidHistoryId = btoa(
    JSON.stringify({ emailAddress: "federico@example.com", historyId: "0" })
  );
  try {
    parseGmailPubSubPush(
      JSON.stringify({ subscription, message: { data: invalidHistoryId } }),
      subscription
    );
    throw new Error("Expected an invalid history ID");
  } catch (error) {
    assert(error instanceof GmailPubSubPayloadError);
    assertEquals(error.status, 400);
  }
});
