import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { RefgetStore } from "@databio/gtars-node";

const storeUrl = process.env.REFGET_STORE_URL;
const storePath = process.env.REFGET_STORE_PATH;

if (!storeUrl && !storePath) {
  console.error("REFGET_STORE_URL or REFGET_STORE_PATH environment variable is required");
  process.exit(1);
}

const cachePath = process.env.REFGET_CACHE_PATH || "/tmp/refgetstore_cache";
const store = storeUrl
  ? RefgetStore.openRemote(cachePath, storeUrl)
  : RefgetStore.openLocal(storePath!);
const app = new Hono();

app.use("*", cors());

// --- Root / Index ---

app.get("/", (c) => {
  const s = store.stats();
  const baseUrl = new URL(c.req.url).origin;
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
    <span>${s.nSequences.toLocaleString()}</span> sequences &middot;
    <span>${s.nCollections.toLocaleString()}</span> collections &middot;
    Storage: <span>${s.storageMode}</span>
  </div>

  <h2>API Endpoints</h2>
  <table>
    <tr><th>Endpoint</th><th>Description</th></tr>
    <tr><td><a href="/service-info">/service-info</a></td><td>Server metadata</td></tr>
    <tr><td><a href="/collection">/collection</a></td><td>List all sequence collections</td></tr>
    <tr><td><code>/collection/:digest</code></td><td>Get a collection by digest</td></tr>
    <tr><td><code>/collection/:digest/metadata</code></td><td>Collection metadata</td></tr>
    <tr><td><a href="/sequence?limit=10">/sequence?limit=10</a></td><td>List sequences (paginated)</td></tr>
    <tr><td><code>/sequence/:digest</code></td><td>Get sequence bases by digest</td></tr>
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
    },
  });
});

// --- Refget Sequences API ---

app.get("/sequence/:digest", (c) => {
  const { digest } = c.req.param();
  const startParam = c.req.query("start");
  const endParam = c.req.query("end");

  // Check Range header as alternative to query params
  const rangeHeader = c.req.header("Range");
  let start: number | undefined;
  let end: number | undefined;

  if (startParam !== undefined || endParam !== undefined) {
    start = startParam !== undefined ? parseInt(startParam, 10) : undefined;
    end = endParam !== undefined ? parseInt(endParam, 10) : undefined;
  } else if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      start = parseInt(match[1], 10);
      end = match[2] ? parseInt(match[2], 10) + 1 : undefined; // Range is inclusive, API is exclusive
    }
  }

  try {
    let sequence: string;
    let statusCode = 200;

    if (start !== undefined || end !== undefined) {
      // Partial sequence - need metadata for defaults
      const meta = store.getSequenceMetadata(digest);
      if (!meta) {
        return c.json({ error: "Not Found" }, 404);
      }
      const s = start ?? 0;
      const e = end ?? meta.length;
      if (s >= e || s < 0 || e > meta.length) {
        return c.json({ error: "Range Not Satisfiable" }, 416);
      }
      sequence = store.getSubstring(digest, s, e);
      statusCode = 206;
    } else {
      sequence = store.getSequence(digest);
    }

    return new Response(sequence, {
      status: statusCode,
      headers: {
        "Content-Type": "text/vnd.ga4gh.refget.v2.0.0+plain",
        "Content-Length": String(sequence.length),
      },
    });
  } catch {
    return c.json({ error: "Not Found" }, 404);
  }
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
    }))
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

// --- List sequences (paginated) ---

app.get("/sequence", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 1000);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const sequences = store.listSequences();
  const page = sequences.slice(offset, offset + limit);
  return c.json({
    items: page.map((seq: any) => ({
      name: seq.name,
      length: seq.length,
      sha512t24u: seq.sha512T24U,
      md5: seq.md5,
    })),
    total: sequences.length,
    limit,
    offset,
  });
});

// --- Start server ---

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`RefgetStore server listening on http://localhost:${info.port}`);
  console.log(`Store: ${storeUrl || storePath}`);
  const s = store.stats();
  console.log(
    `  ${s.nSequences} sequences, ${s.nCollections} collections`
  );
});
