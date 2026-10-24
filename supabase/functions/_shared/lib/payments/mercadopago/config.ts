// mercado pago configuration. reads MP_* environment variables.
// throw on missing required vars to fail fast at startup.

export interface MPConfig {
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  environment: "test" | "production";
  backUrl: string;
  siteId: string;
  notificationUrl: string;
  apiBaseUrl: string;
}

let cached: MPConfig | null = null;

export function getMPConfig(): MPConfig {
  if (cached) return cached;

  const env = Deno.env.get("MP_ENVIRONMENT") ?? "test";
  if (env !== "test" && env !== "production") {
    throw new Error(
      `MP_ENVIRONMENT must be 'test' or 'production', got '${env}'`
    );
  }

  cached = {
    accessToken: requireEnv("MP_ACCESS_TOKEN"),
    publicKey: Deno.env.get("MP_PUBLIC_KEY") ?? "",
    webhookSecret: requireEnv("MP_WEBHOOK_SECRET"),
    environment: env,
    backUrl: Deno.env.get("MP_BACK_URL") ?? "http://localhost:3000/billing",
    siteId: Deno.env.get("MP_SITE_ID") ?? "MLA",
    notificationUrl: requireEnv("MP_NOTIFICATION_URL"),
    apiBaseUrl:
      Deno.env.get("MP_API_BASE_URL") ?? "https://api.mercadopago.com",
  };
  return cached;
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}
