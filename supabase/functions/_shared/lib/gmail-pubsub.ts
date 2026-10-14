import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "npm:jose@6.2.3";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const googleIssuers = ["https://accounts.google.com", "accounts.google.com"];
const maxPushBodyBytes = 16 * 1024;

export interface GmailPubSubOidcConfig {
  audience: string;
  serviceAccountEmail: string;
  serviceAccountSubject: string;
}

export interface GmailPubSubNotification {
  gmailEmail: string;
  historyId: string;
}

export class GmailPubSubAuthenticationError extends Error {
  constructor() {
    super("Invalid Pub/Sub authentication");
    this.name = "GmailPubSubAuthenticationError";
  }
}

export class GmailPubSubPayloadError extends Error {
  readonly status: 400 | 403 | 413;

  constructor(status: 400 | 403 | 413, message: string) {
    super(message);
    this.name = "GmailPubSubPayloadError";
    this.status = status;
  }
}

export async function verifyGmailPubSubOidcToken(
  authorizationHeader: string | null,
  config: GmailPubSubOidcConfig,
  getKey: JWTVerifyGetKey = googleJwks
): Promise<void> {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];

  if (!token) {
    throw new GmailPubSubAuthenticationError();
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(token, getKey, {
      algorithms: ["RS256"],
      audience: config.audience,
      clockTolerance: 60,
      issuer: googleIssuers,
      requiredClaims: ["email", "email_verified", "exp", "iat", "sub"],
    });

    const now = Math.floor(Date.now() / 1000);
    const audience = payload.aud;
    const audienceMatches =
      audience === config.audience ||
      (Array.isArray(audience) &&
        audience.length === 1 &&
        audience[0] === config.audience);

    if (
      protectedHeader.alg !== "RS256" ||
      !protectedHeader.kid ||
      !audienceMatches ||
      typeof payload.iat !== "number" ||
      payload.iat > now + 60 ||
      payload.email !== config.serviceAccountEmail ||
      payload.email_verified !== true ||
      payload.sub !== config.serviceAccountSubject
    ) {
      throw new GmailPubSubAuthenticationError();
    }
  } catch {
    throw new GmailPubSubAuthenticationError();
  }
}

export function parseGmailPubSubPush(
  rawBody: string,
  expectedSubscription: string
): GmailPubSubNotification {
  if (new TextEncoder().encode(rawBody).byteLength > maxPushBodyBytes) {
    throw new GmailPubSubPayloadError(413, "Push payload is too large");
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    throw new GmailPubSubPayloadError(400, "Invalid push payload");
  }

  if (!isRecord(envelope) || envelope.subscription !== expectedSubscription) {
    throw new GmailPubSubPayloadError(403, "Unexpected Pub/Sub subscription");
  }

  if (
    !isRecord(envelope.message) ||
    typeof envelope.message.data !== "string"
  ) {
    throw new GmailPubSubPayloadError(400, "Invalid Pub/Sub message");
  }

  let decodedMessage: string;
  try {
    decodedMessage = new TextDecoder().decode(
      Uint8Array.from(atob(envelope.message.data), character =>
        character.charCodeAt(0)
      )
    );
  } catch {
    throw new GmailPubSubPayloadError(400, "Invalid Pub/Sub message data");
  }

  let notification: unknown;
  try {
    notification = JSON.parse(decodedMessage);
  } catch {
    throw new GmailPubSubPayloadError(400, "Invalid Gmail notification");
  }

  if (!isRecord(notification)) {
    throw new GmailPubSubPayloadError(400, "Invalid Gmail notification");
  }

  const gmailEmail =
    typeof notification.emailAddress === "string"
      ? notification.emailAddress.trim().toLowerCase()
      : "";
  const historyId = normalizeHistoryId(notification.historyId);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailEmail) || !historyId) {
    throw new GmailPubSubPayloadError(400, "Invalid Gmail notification fields");
  }

  return { gmailEmail, historyId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHistoryId(value: unknown): string | null {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value.toString();
  }

  return null;
}
