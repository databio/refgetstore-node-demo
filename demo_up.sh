#!/bin/bash
# Build a demo store from test FASTAs and start the server.
#
# By default, builds an Encoded-mode store and runs the server in stream-only
# proxy mode (since there is no public URL for redirects to a local fixture).
#
# Set REFGET_DEMO_MODE=raw to build a Raw-mode store and exercise the redirect
# path (requires a separate static file server; see note below).
set -e

STORE_DIR=".demo_store"
DEMO_MODE="${REFGET_DEMO_MODE:-encoded}"

cleanup() {
    echo "Cleaning up demo store at $STORE_DIR..."
    rm -rf "$STORE_DIR"
    exit 0
}
trap cleanup SIGINT EXIT

# Build store from test data
echo "Building demo store (mode=$DEMO_MODE) from test FASTA files..."
if [ "$DEMO_MODE" = "raw" ]; then
    # NOTE: Requires scripts/build_store.mjs to accept --mode; if not yet
    # available, this will fail - defer Raw demo until upstream support lands.
    node scripts/build_store.mjs --fasta test_data/base.fa --output "$STORE_DIR" --mode raw
else
    node scripts/build_store.mjs --fasta test_data/base.fa --output "$STORE_DIR"
fi

# Start server
echo ""
echo "Starting RefgetStore server on http://localhost:${PORT:-3000}"
echo "  Service info:  http://localhost:${PORT:-3000}/service-info"
echo "  Collections:   http://localhost:${PORT:-3000}/collection"
echo "  Sequences:     http://localhost:${PORT:-3000}/sequence"
echo ""

if [ "$DEMO_MODE" = "raw" ]; then
    # Need a public URL pointing at the raw store for redirect mode.
    # Example: in another terminal, run `npx http-server $STORE_DIR -p 8081`,
    # then set REFGET_STORE_URL=http://localhost:8081 to exercise redirects.
    echo "Raw demo: start a static file server for $STORE_DIR (e.g. npx http-server $STORE_DIR -p 8081)"
    echo "Then set REFGET_STORE_URL=http://localhost:8081 and REFGET_PROXY_MODE=redirect-only"
    REFGET_STORE_PATH="$STORE_DIR" REFGET_PROXY_MODE=stream-only npm start
else
    # Encoded-mode store: streaming decode path. No public URL needed.
    REFGET_STORE_PATH="$STORE_DIR" REFGET_PROXY_MODE=stream-only npm start
fi
