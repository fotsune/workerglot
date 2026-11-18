/** Environment bindings shared by the Node server and the Cloudflare Worker. */
export interface Env {
  // Runtime
  PORT?: string;
  ACCESS_TOKEN?: string;
  MAX_TEXT_LENGTH?: string;
  REQUEST_TIMEOUT_MS?: string;
  // Put configured paid providers ahead of the free ones, for selection and fallback alike.
  PREFER_PAID?: string;

  // DeepLX servers
  DEEPLX_CLOUDFLARE_URL?: string;
  DEEPLX_VERCEL_URL?: string;

  // Paid / official APIs
  DEEPL_API_KEY?: string;
  AZURE_TRANSLATOR_KEY?: string;
  AZURE_TRANSLATOR_REGION?: string;
  AZURE_TRANSLATOR_ENDPOINT?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  LIBRETRANSLATE_URL?: string;
  LIBRETRANSLATE_API_KEY?: string;
}

/** The variables the Worker actually reads, for docs and `wrangler secret put`. */
export const ENV_KEYS: (keyof Env)[] = [
  "ACCESS_TOKEN",
  "MAX_TEXT_LENGTH",
  "REQUEST_TIMEOUT_MS",
  "PREFER_PAID",
  "DEEPLX_CLOUDFLARE_URL",
  "DEEPLX_VERCEL_URL",
  "DEEPL_API_KEY",
  "AZURE_TRANSLATOR_KEY",
  "AZURE_TRANSLATOR_REGION",
  "AZURE_TRANSLATOR_ENDPOINT",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "LIBRETRANSLATE_URL",
  "LIBRETRANSLATE_API_KEY",
];

/**
 * Reads config the Bun/Node way, without importing node types.
 * In a Worker the bindings object is passed to `fetch` instead.
 */
export function envFromProcess(): Env {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return (proc?.env ?? {}) as Env;
}
