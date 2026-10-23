export function getPublishableKey(): string {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ""
  );
}

export function getSecretKey(): string {
  return process.env.SUPABASE_SECRET_KEY || "";
}

export function requirePublishableKey(): string {
  const key = getPublishableKey();
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  return key;
}

export function requireSecretKey(): string {
  const key = getSecretKey();
  if (!key) throw new Error("SUPABASE_SECRET_KEY is required");
  return key;
}

export function isLegacyJwtKey(key: string): boolean {
  return key.startsWith("eyJ");
}
