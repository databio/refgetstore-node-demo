import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { RefgetStore } from "@databio/gtars-node";
import { Readable } from "node:stream";
import { loadConfig } from "./config.js";
import { parseRangeRequest } from "./range.js";

const config = loadConfig();

const store = config.storeUrl
  ? RefgetStore.openRemote(config.cachePath, config.storeUrl)
  : RefgetStore.openLocal(config.storePath!);

const stats = store.stats();
const storageMode = stats.storageMode; // "Raw" | "Encoded"

// Resolve effective per-request behavior once at startup
let effectiveBehavior: "redirect" | "stream";
switch (config.proxyMode) {
  case "stream-only":
    effectiveBehavior = "stream";
    break;
  case "redirect-only":
    if (storageMode !== "Raw") {
      console.error(
        `Configuration error: REFGET_PROXY_MODE=redirect-only requires a Raw-mode store, ` +
          `but the store is ${storageMode}`,
      );
      process.exit(1);
    }
    effectiveBehavior = "redirect";
    break;
  case "auto":
    effectiveBehavior = storageMode === "Raw" ? "redirect" : "stream";
    break;
}

const app = new Hono();

app.use("*", cors());

// --- Root / Index ---

app.get("/", (c) => {
  const s = store.stats();
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>RefgetStore Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { color: #1a1a2e; }
    .stats { background: #f4f4f8; padding: 16px; border-radius: 8px; margin: 16px 0; }
    .stats span { font-weight: bold; color: #16213e; }
    .stats .row { display: block; }
    a { color: #0f3460; }
    code { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; }
    th { background: #f4f4f8; }
  </style>
</head>
<body>
  <h1>RefgetStore Server</h1>
  <div class="stats">
    <span class="row"><span>${s.nSequences.toLocaleString()}</span> sequences &middot;
    <span>${s.nCollections.toLocaleString()}</span> collections</span>
    <span class="row">Storage: <span>${s.storageMode}</span> &middot;
    Proxy: <span>${effectiveBehavior}</span></span>
  </div>

  <h2>API Endpoints</h2>
  <table>
    <tr><th>Endpoint</th><th>Description</th></tr>
    <tr><td><a href="/service-info">/service-info</a></td><td>Server metadata</td></tr>
    <tr><td><a href="/collection">/collection</a></td><td>List all sequence collections</td></tr>
    <tr><td><code>/collection/:digest</code></td><td>Get a collection by digest</td></tr>
    <tr><td><code>/collection/:digest/metadata</code></td><td>Collection metadata</td></tr>
    <tr><td><a href="/sequence">/sequence</a></td><td>List sequences (skipped for large stores)</td></tr>
    <tr><td><code>/sequence/:digest</code></td><td>Get sequence bases by digest (${effectiveBehavior})</td></tr>
    <tr><td><code>/sequence/:digest/metadata</code></td><td>Sequence metadata</td></tr>
  </table>

  <h2>GA4GH Standards</h2>
  <p>
    This server implements the <a href="https://samtools.github.io/hts-specs/refget.html">GA4GH Refget v2</a>
    and <a href="https://ga4gh.github.io/seqcol-spec/">Sequence Collections</a> specifications,
    backed by a <a href="https://refgenie.org/refget/refgetstore/">RefgetStore</a>.
  </p>
</body>
</html>`);
});

// --- Service Info ---

app.get("/service-info", (c) => {
  const s = store.stats();
  return c.json({
    id: "org.databio.refgetstore",
    name: "RefgetStore Node Server",
    type: { group: "org.ga4gh", artifact: "refget", version: "2.0.0" },
    organization: { name: "databio", url: "https://databio.org" },
    version: "0.1.0",
    store: {
      nSequences: s.nSequences,
      nCollections: s.nCollections,
      storageMode: s.storageMode,
      proxyBehavior: effectiveBehavior,
    },
  });
});

// --- Refget Sequences API ---

app.get("/sequence/:digest", (c) => {
  const { digest } = c.req.param();
  const parsed = parseRangeRequest(c);

  // Redirect branch
  if (effectiveBehavior === "redirect") {
    if (parsed.source === "query" && !config.allowQueryParamPartials) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "This server proxies raw sequence bytes by redirect. Use the HTTP Range header " +
            "(e.g. `Range: bytes=0-999`) for partial content. Query-param partials (?start=&end=) " +
            "are not supported in redirect mode. Set REFGET_ALLOW_QUERY_PARAM_PARTIALS=true to " +
            "enable streaming fallback for these requests.",
        },
        400,
      );
    }

    if (parsed.source !== "query") {
      // Full request or Range header: redirect
      const meta = store.getSequenceMetadata(digest);
      if (!meta) return c.json({ error: "Not Found" }, 404);

      const storeBase = config.storeUrl!.replace(/\/+$/, "");
      const target = `${storeBase}/sequences/${digest.slice(0, 2)}/${digest}.seq`;
      return c.redirect(target, 302);
    }
    // Fall through to streaming branch for query-param partials
  }

  // Streaming branch
  const meta = store.getSequenceMetadata(digest);
  if (!meta) return c.json({ error: "Not Found" }, 404);

  const fullLen = Number(meta.length);
  const isPartial = parsed.source !== "none";
  const s = parsed.start ?? 0;
  const e = parsed.end ?? fullLen;

  if (isPartial && (s >= e || s < 0 || e > fullLen)) {
    return c.json({ error: "Range Not Satisfiable" }, 416);
  }

  const nodeStream: Readable = store.streamSequence(
    digest,
    isPartial ? s : undefined,
    isPartial ? e : undefined,
  );
  nodeStream.on("error", (err) => {
    console.error(`streamSequence error for ${digest}:`, err);
  });

  const contentLength = e - s;
  const headers: Record<string, string> = {
    "Content-Type": "text/vnd.ga4gh.refget.v2.0.0+plain",
    "Content-Length": String(contentLength),
  };
  if (isPartial) {
    headers["Content-Range"] = `bytes ${s}-${e - 1}/${fullLen}`;
  }

  return new Response(
    Readable.toWeb(nodeStream) as unknown as ReadableStream,
    { status: isPartial ? 206 : 200, headers },
  );
});

app.get("/sequence/:digest/metadata", (c) => {
  const { digest } = c.req.param();
  const meta = store.getSequenceMetadata(digest);
  if (!meta) {
    return c.json({ error: "Not Found" }, 404);
  }
  return c.json({
    metadata: {
      md5: meta.md5,
      ga4gh: `SQ.${meta.sha512T24U}`,
      length: meta.length,
      aliases: [],
    },
  });
});

app.get("/sequence/service-info", (c) => {
  return c.json({
    service: {
      circular_supported: false,
      algorithms: ["md5", "ga4gh"],
      subsequence_limit: null,
      supported_api_versions: ["2.0.0"],
    },
  });
});

// --- Sequence Collections API ---

app.get("/collection", (c) => {
  const collections = store.listCollections();
  return c.json(
    collections.map((col: any) => ({
      digest: col.digest,
      nSequences: col.nSequences,
      namesDigest: col.namesDigest,
      sequencesDigest: col.sequencesDigest,
      lengthsDigest: col.lengthsDigest,
    })),
  );
});

app.get("/collection/:digest", (c) => {
  const { digest } = c.req.param();
  const meta = store.getCollectionMetadata(digest);
  if (!meta) {
    return c.json({ error: "Not Found" }, 404);
  }
  return c.json({
    digest: meta.digest,
    nSequences: meta.nSequences,
    namesDigest: meta.namesDigest,
    sequencesDigest: meta.sequencesDigest,
    lengthsDigest: meta.lengthsDigest,
  });
});

app.get("/collection/:digest/metadata", (c) => {
  const { digest } = c.req.param();
  const meta = store.getCollectionMetadata(digest);
  if (!meta) {
    return c.json({ error: "Not Found" }, 404);
  }
  return c.json({
    digest: meta.digest,
    nSequences: meta.nSequences,
    namesDigest: meta.namesDigest,
    sequencesDigest: meta.sequencesDigest,
    lengthsDigest: meta.lengthsDigest,
  });
});

// --- List sequences (large-store guard) ---

const SEQUENCE_LIST_LIMIT = 10000;

app.get("/sequence", (c) => {
  const s = store.stats();
  if (s.nSequences > SEQUENCE_LIST_LIMIT) {
    return c.json({
      message:
        `Store contains ${s.nSequences} sequences; listing is disabled for large stores ` +
        `(> ${SEQUENCE_LIST_LIMIT}). Fetch sequences by digest via /sequence/:digest.`,
      nSequences: s.nSequences,
    });
  }
  const sequences = store.listSequences();
  return c.json({
    items: sequences.map((seq: any) => ({
      name: seq.name,
      length: seq.length,
      sha512t24u: seq.sha512T24U,
      md5: seq.md5,
    })),
    total: sequences.length,
  });
});

// --- Start server ---

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`RefgetStore proxy started`);
  console.log(`  listening: http://localhost:${info.port}`);
  console.log(`  store: ${config.storeUrl || config.storePath}`);
  console.log(`  storage mode: ${storageMode}`);
  console.log(`  proxy behavior: ${effectiveBehavior}`);
  console.log(
    `  query-param partials: ${config.allowQueryParamPartials ? "honored (stream fallback)" : "rejected in redirect mode"}`,
  );
  console.log(
    `  ${stats.nSequences} sequences, ${stats.nCollections} collections`,
  );
});
