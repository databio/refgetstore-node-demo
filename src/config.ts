export type ProxyMode = "auto" | "redirect-only" | "stream-only";

export interface Config {
  storeUrl?: string;
  storePath?: string;
  cachePath: string;
  port: number;
  proxyMode: ProxyMode;
  allowQueryParamPartials: boolean;
}

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function fail(msg: string): never {
  console.error(`Configuration error: ${msg}`);
  process.exit(1);
}

export function loadConfig(): Config {
  const storeUrl = process.env.REFGET_STORE_URL || undefined;
  const storePath = process.env.REFGET_STORE_PATH || undefined;
  const cachePath = process.env.REFGET_CACHE_PATH || "/tmp/refgetstore_cache";
  const port = parseInt(process.env.PORT || "3000", 10);
  const allowQueryParamPartials = parseBool(
    process.env.REFGET_ALLOW_QUERY_PARAM_PARTIALS,
  );

  const rawMode = (process.env.REFGET_PROXY_MODE || "auto").trim();
  if (!["auto", "redirect-only", "stream-only"].includes(rawMode)) {
    fail(
      `Invalid REFGET_PROXY_MODE="${rawMode}". ` +
        `Valid options: auto, redirect-only, stream-only`,
    );
  }
  const proxyMode = rawMode as ProxyMode;

  if (!storeUrl && !storePath) {
    fail(
      "One of REFGET_STORE_URL or REFGET_STORE_PATH environment variables is required",
    );
  }
  if (storeUrl && storePath) {
    fail(
      "Only one of REFGET_STORE_URL or REFGET_STORE_PATH may be set (not both)",
    );
  }

  if (storePath && (proxyMode === "auto" || proxyMode === "redirect-only")) {
    fail(
      `REFGET_STORE_PATH is set (local store) which has no public URL for redirects. ` +
        `Set REFGET_PROXY_MODE=stream-only.`,
    );
  }

  if (proxyMode === "redirect-only" && !storeUrl) {
    fail("REFGET_PROXY_MODE=redirect-only requires REFGET_STORE_URL to be set");
  }

  return {
    storeUrl,
    storePath,
    cachePath,
    port,
    proxyMode,
    allowQueryParamPartials,
  };
}
