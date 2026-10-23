type KeyMap = Record<string, string>;

const DEFAULT_KEY_NAME = "default";

function parseKeyMap(raw: string | undefined): KeyMap {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

function keyName(envVar: string): string {
  return process.env[envVar] || DEFAULT_KEY_NAME;
}

function pickNamedKey(
  raw: string | undefined,
  envVar: string
): string | undefined {
  const map = parseKeyMap(raw);
  return map[keyName(envVar)];
}

function missingKeyMessage(
  kind: "publishable" | "secret",
  nameEnvVar: string,
  dictEnvVar: string,
  singleEnvVar: string
): string {
  const name = keyName(nameEnvVar);
  const available = Object.keys(parseKeyMap(process.env[dictEnvVar]));

  if (available.length > 0) {
    return (
      `No Supabase ${kind} key named "${name}" in ${dictEnvVar} ` +
      `(available: ${available.join(", ")}). Set ${nameEnvVar} or create a ` +
      `"${DEFAULT_KEY_NAME}" key.`
    );
  }

  return `No Supabase ${kind} key configured. Set ${singleEnvVar} or ${dictEnvVar}.`;
}

export function getPublishableKey(): string {
  return (
    pickNamedKey(
      process.env.SUPABASE_PUBLISHABLE_KEYS,
      "PUBLISHABLE_KEY_NAME"
    ) ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  );
}

export function getSecretKey(): string {
  return (
    pickNamedKey(process.env.SUPABASE_SECRET_KEYS, "SECRET_KEY_NAME") ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  );
}

export function requirePublishableKey(): string {
  const key = getPublishableKey();
  if (key) return key;

  throw new Error(
    missingKeyMessage(
      "publishable",
      "PUBLISHABLE_KEY_NAME",
      "SUPABASE_PUBLISHABLE_KEYS",
      "SUPABASE_PUBLISHABLE_KEY"
    )
  );
}

export function requireSecretKey(): string {
  const key = getSecretKey();
  if (key) return key;

  throw new Error(
    missingKeyMessage(
      "secret",
      "SECRET_KEY_NAME",
      "SUPABASE_SECRET_KEYS",
      "SUPABASE_SECRET_KEY"
    )
  );
}

export function isLegacyJwtKey(key: string): boolean {
  return key.startsWith("eyJ");
}
