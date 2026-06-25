# RefgetStore Node Server

> ⚠️ **Beta software / demo.** This is an example project, not a production service. It exists to show how to build a refget server in Node.js on top of the [`@databio/gtars-node`](https://www.npmjs.com/package/@databio/gtars-node) bindings. Expect rough edges and breaking changes.

## What is this?

A small, self-contained example server that serves [GA4GH refget](https://ga4gh.github.io/refget/) sequences and sequence collections over HTTP, backed by a **RefgetStore**.

A [**RefgetStore**](https://refgenie.org/refget/refgetstore-explained/) is a content-addressable, file-based database for biological sequences and sequence collections (genome assemblies, transcriptomes, etc.). Sequences are looked up by their GA4GH digest, stored with deduplication and compact encoding, and the whole store can live on local disk or on static object storage like S3 — no database server required. It's implemented in Rust in the [`gtars`](https://github.com/databio/gtars) project (the [`gtars-refget`](https://github.com/databio/gtars/tree/master/gtars-refget) crate) and exposed to JavaScript through the [`@databio/gtars-node`](https://www.npmjs.com/package/@databio/gtars-node) bindings.

**This repo demonstrates those Node bindings**: how to open a RefgetStore (local or remote/S3) from Node and serve its sequences and collections through a standard refget API. It's a reference example to learn from and adapt, not something to deploy as-is.

Under the hood it's a lightweight **proxy** that never materializes sequence bytes in memory — it either redirects raw-store bytes to the backing store or stream-decodes encoded-store bytes directly to the HTTP response (see [How it works](#how-it-works)).

**Learn more about RefgetStore:**

- [What is RefgetStore?](https://refgenie.org/refget/refgetstore-explained/) — overview, concepts, and the full list of components
- [`@databio/gtars-node`](https://www.npmjs.com/package/@databio/gtars-node) — the Node.js bindings this server is built on ([source](https://github.com/databio/gtars/tree/master/gtars-node))
- [`gtars`](https://github.com/databio/gtars) — the Rust engine behind it all

## Quick Start

```bash
npm install
npm run build

# Run the demo (builds a store from test FASTAs and starts the server)
bash demo_up.sh
```

## How it works

The server proxies sequence bytes in one of two ways, depending on how the backing RefgetStore is stored:

- **Redirect (Raw-mode stores).** The server returns `302` with a `Location` header pointing at `<REFGET_STORE_URL>/sequences/<digest[0:2]>/<digest>.seq`. Clients follow the redirect and hit the backing store (typically S3) directly. Range headers on the original request flow through to the backing store, which responds with `206 Partial Content`. The server never loads bytes. Query-param partials (`?start=&end=`) are rejected by default — use the `Range` header.
- **Stream-decode (Encoded-mode stores).** Stored bytes are 2-bit/3-bit packed; they cannot be redirected verbatim. The server calls `RefgetStore.streamSequence(digest, start, end)` which returns a `Readable` of decoded ASCII bases, piped directly to the HTTP response. Memory use is bounded by the stream's internal buffer regardless of sequence size.

### Proxy mode matrix

| Store mode | `REFGET_PROXY_MODE=auto` | `redirect-only` | `stream-only` |
|---|---|---|---|
| Raw | redirect (302) | redirect (302) | stream (decode is a no-op) |
| Encoded | stream | startup error | stream |

## Configuration

| Env var | Default | Description |
|---|---|---|
| `REFGET_STORE_URL` | — | URL to a remote RefgetStore (S3 / HTTP). Required for redirect mode. |
| `REFGET_STORE_PATH` | — | Path to a local RefgetStore dir. Forces `stream-only` mode. |
| `REFGET_CACHE_PATH` | `/tmp/refgetstore_cache` | Metadata cache for remote stores. |
| `REFGET_PROXY_MODE` | `auto` | `auto` (redirect Raw, stream Encoded), `redirect-only`, `stream-only`. |
| `REFGET_ALLOW_QUERY_PARAM_PARTIALS` | `false` | When true, `?start=&end=` in redirect mode fall through to streaming instead of 400. |
| `PORT` | `3000` | HTTP port. |

Exactly one of `REFGET_STORE_URL` or `REFGET_STORE_PATH` must be set.

## API Endpoints

### Service Info

| Endpoint | Description |
|---|---|
| `GET /service-info` | GA4GH service-info with store statistics |

### Refget Sequences (GA4GH refget v2)

| Endpoint | Description |
|---|---|
| `GET /sequence` | List all sequences (disabled for stores with > 10,000 sequences) |
| `GET /sequence/:digest` | Retrieve sequence bases (302 redirect or streaming, depending on proxy mode). Supports `Range` header; `?start=&end=` accepted in stream mode. |
| `GET /sequence/:digest/metadata` | Sequence metadata (length, md5, ga4gh digest) |
| `GET /sequence/service-info` | Refget service capabilities |

### Sequence Collections (GA4GH seqcol)

| Endpoint | Description |
|---|---|
| `GET /collection` | List all collections |
| `GET /collection/:digest` | Collection metadata |
| `GET /collection/:digest/metadata` | Collection metadata (explicit) |

## Building a Store from FASTA Files

```bash
node scripts/build_store.mjs --fasta path/to/genome.fa --output my_store
REFGET_STORE_PATH=my_store REFGET_PROXY_MODE=stream-only npm start
```

## Development (local-linked `@databio/gtars-node`)

Until `@databio/gtars-node` is published with `streamSequence`, link to a local build:

```bash
# In the gtars repo
cd repos/gtars/gtars-node
npm run build
npm link

# In this repo
cd repos/refgetstore-node-demo
npm link @databio/gtars-node
npm run dev
```

## Docker

```bash
# Build
docker build -f deployment/dockerhub/Dockerfile -t refgetstore-server .

# Run (redirect-mode example)
docker run -p 80:80 \
  -e REFGET_STORE_URL=https://my-bucket.s3.amazonaws.com/refget/store \
  refgetstore-server
```

## Comparison to seqcolapi

Both `seqcolapi` and this server speak the GA4GH refget + seqcol APIs, and both can be
backed by a RefgetStore. The meaningful difference is **what they serve**, not where they
store it:

| | seqcolapi | refgetstore-server (this repo) |
|---|---|---|
| Runtime | Python + FastAPI | Node.js + Hono |
| Storage | PostgreSQL **or** RefgetStore (local/S3) | RefgetStore only (local/S3) |
| Collection metadata (`/collection`) | ✅ | ✅ |
| Collection comparison (`/comparison`) | ✅ | ❌ (pending napi binding) |
| FASTA DRS / pangenome endpoints | ✅ | ❌ |
| Raw sequence residues (`GET /sequence/:digest` → bases) | ❌ deliberately disabled | ✅ its whole purpose |
| Sequence delivery | n/a — does not serve residues | 302-redirect to the backing store, or stream-decode; never buffers bytes |

In short: **seqcolapi is a sequence-collection metadata and comparison service** — it does
not hand out sequence bases. **This server is a lightweight residue-delivery proxy** — it
streams or redirects the actual bytes of a sequence out of a (possibly S3-backed)
RefgetStore, with no database and no Python.

## Known Limitations

- No comparison endpoint (`/comparison/:digest1/:digest2`) — pending napi binding support
- Read-only: store must be pre-built from FASTA files
