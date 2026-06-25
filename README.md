# Demo: a Refget Sequences API service backed by RefgetStore

> ⚠️ **Beta software / demo.** This is a reference example, not a production service. It exists to show how to stand up a [GA4GH Refget Sequences](https://ga4gh.github.io/refget/) API in Node.js backed by a RefgetStore, using the [`@databio/gtars-node`](https://www.npmjs.com/package/@databio/gtars-node) bindings. Expect rough edges and breaking changes.

## What is this?

This implements the [**GA4GH Refget Sequences API**](https://ga4gh.github.io/refget/), the standard for retrieving reference sequences by digest. The point of the demo is that it serves data **from a [RefgetStore](https://refgenie.org/refget/refgetstore-explained/) instead of a conventional database**: a standards-compliant refget server running directly on a content-addressable, file-based store, with no SQL database, no ORM, and no bulk-loading step.

A [**RefgetStore**](https://refgenie.org/refget/refgetstore-explained/) is a content-addressable, file-based database for biological sequences and sequence collections. Sequences are looked up by GA4GH digest and stored with deduplication and compact encoding, and the store can live on local disk or on static object storage like S3 without a database server. It is written in Rust in the [`gtars`](https://github.com/databio/gtars) project (the [`gtars-refget`](https://github.com/databio/gtars/tree/master/gtars-refget) crate) and exposed to JavaScript through the [`@databio/gtars-node`](https://www.npmjs.com/package/@databio/gtars-node) bindings, which is what this server uses to read sequences.

The server is a lightweight **proxy** that never holds sequence bytes in memory. It either redirects raw-store bytes to the backing store or stream-decodes packed bytes directly to the HTTP response (see [How it works](#how-it-works)). It also exposes read-only [sequence collection](https://ga4gh.github.io/refget/seqcols/) endpoints (listing and metadata) as a convenience, but serving sequences is the point; the seqcol *comparison* endpoint is not implemented.

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

- **Redirect (Raw-mode stores).** The server returns `302` with a `Location` header pointing at `<REFGET_STORE_URL>/sequences/<digest[0:2]>/<digest>.seq`. Clients follow the redirect and hit the backing store (typically S3) directly. Range headers on the original request flow through to the backing store, which responds with `206 Partial Content`. The server never loads bytes. Query-param partials (`?start=&end=`) are rejected by default; use the `Range` header.
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

[**seqcolapi**](https://github.com/refgenie/refget/tree/master/seqcolapi) is the companion
server in the refget ecosystem: a Python/FastAPI implementation of the
[GA4GH Sequence Collections API](https://ga4gh.github.io/refget/seqcols/) (collection
metadata and comparison). It ships as part of the [`refget`](https://github.com/refgenie/refget)
Python package and runs in production at [seqcolapi.databio.org](https://seqcolapi.databio.org).

Both speak the GA4GH refget and seqcol APIs, and both can be backed by a RefgetStore. The difference is **what they serve**, not where they store it:

| | seqcolapi | refgetstore-server (this repo) |
|---|---|---|
| Runtime | Python + FastAPI | Node.js + Hono |
| Storage | PostgreSQL **or** RefgetStore (local/S3) | RefgetStore only (local/S3) |
| Collection metadata (`/collection`) | ✅ | ✅ |
| Collection comparison (`/comparison`) | ✅ | ❌ (pending napi binding) |
| FASTA DRS / pangenome endpoints | ✅ | ❌ |
| Raw sequence residues (`GET /sequence/:digest` → bases) | ❌ not served | ✅ primary purpose |
| Sequence delivery | n/a | 302-redirect to the backing store, or stream-decode; never buffers bytes |

In short: **seqcolapi serves sequence-collection metadata and comparisons**, not sequence bases. **This server serves the sequence bases themselves**, streaming or redirecting them out of a (possibly S3-backed) RefgetStore with no database and no Python.

## Known Limitations

- No comparison endpoint (`/comparison/:digest1/:digest2`), pending napi binding support
- Read-only: store must be pre-built from FASTA files
