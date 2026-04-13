# RefgetStore Node Server

A lightweight Node.js server that serves GA4GH refget sequences and sequence collections APIs directly from a RefgetStore on disk. No database, no Python runtime — just a binary store and a fast HTTP server.

## Quick Start

```bash
# Build TypeScript
npm install
npm run build

# Run the demo (builds a store from test FASTAs and starts the server)
bash demo_up.sh
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `REFGET_STORE_PATH` | *(required)* | Path to a RefgetStore directory |
| `PORT` | `3000` | HTTP server port |

## API Endpoints

### Service Info

| Endpoint | Description |
|---|---|
| `GET /service-info` | GA4GH service-info with store statistics |

### Refget Sequences (GA4GH refget v2)

| Endpoint | Description |
|---|---|
| `GET /sequence` | List all sequences |
| `GET /sequence/:digest` | Retrieve full sequence (supports `?start=N&end=M` and `Range` header) |
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
REFGET_STORE_PATH=my_store npm start
```

Multiple FASTA files:

```bash
node scripts/build_store.mjs \
  --fasta genome1.fa \
  --fasta genome2.fa.gz \
  --output my_store
```

## Docker

```bash
# Build
docker build -f deployment/dockerhub/Dockerfile -t refgetstore-server .

# Run (mount your store)
docker run -p 80:80 -v /path/to/store:/data/store \
  -e REFGET_STORE_PATH=/data/store \
  refgetstore-server
```

## Comparison to seqcolapi

| | seqcolapi | refgetstore-server |
|---|---|---|
| Runtime | Python + FastAPI | Node.js + Hono |
| Storage | PostgreSQL | RefgetStore (flat files) |
| Infrastructure | Database server required | Single binary store on disk |
| Memory | ~2GB (DB + app) | ~1GB (app only) |

## Known Limitations

- No comparison endpoint (`/comparison/:digest1/:digest2`) — pending napi binding support
- Read-only: store must be pre-built from FASTA files
