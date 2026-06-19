# RefgetStore Node Server

A lightweight Node.js **proxy** for GA4GH refget sequences and sequence collections APIs, backed by a [RefgetStore](https://refgenie.org/refget/refgetstore/). The server never materializes sequence bytes in memory — it either redirects raw-store bytes to the backing store or stream-decodes encoded-store bytes directly to the HTTP response.

## Quick Start

```bash
npm install
npm run build

# Run the demo (builds a store from test FASTAs and starts the server)
bash demo_up.sh
```

## Live Demo

A demo server backed by the pangenome jungle RefgetStore runs at:

**http://ecs.databio.org:8150/**

Example links:

- [Service info](http://ecs.databio.org:8150/service-info)
- [List collections](http://ecs.databio.org:8150/collection)
- [Get a collection](http://ecs.databio.org:8150/collection/-Ffl-8v7R0Wh53_pRA4WtKoDQL9GmC-v)

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

| | seqcolapi | refgetstore-server |
|---|---|---|
| Runtime | Python + FastAPI | Node.js + Hono |
| Storage | PostgreSQL | RefgetStore (flat files, local or S3) |
| Infrastructure | Database server required | Single binary store on disk / object store |
| Sequence delivery | Reads DB, builds response in Python | Redirect or stream-decode; no bytes buffered |

## Known Limitations

- No comparison endpoint (`/comparison/:digest1/:digest2`) — pending napi binding support
- Read-only: store must be pre-built from FASTA files
