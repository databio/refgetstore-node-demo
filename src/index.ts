import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { RefgetStore } from "@databio/gtars-node";

const storePath = process.env.REFGET_STORE_PATH;
if (!storePath) {
  console.error("REFGET_STORE_PATH environment variable is required");
  process.exit(1);
}

const store = RefgetStore.openLocal(storePath);
const app = new Hono();

app.use("*", cors());

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
      totalDiskSize: s.totalDiskSize,
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
    collections.map((col) => ({
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

// --- List sequences ---

app.get("/sequence", (c) => {
  const sequences = store.listSequences();
  return c.json(
    sequences.map((seq) => ({
      name: seq.name,
      length: seq.length,
      sha512t24u: seq.sha512T24U,
      md5: seq.md5,
    }))
  );
});

// --- Start server ---

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`RefgetStore server listening on http://localhost:${info.port}`);
  console.log(`Store: ${storePath}`);
  const s = store.stats();
  console.log(
    `  ${s.nSequences} sequences, ${s.nCollections} collections`
  );
});
