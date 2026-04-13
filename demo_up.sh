#!/bin/bash
# Build a demo store from test FASTAs and start the server
set -e

STORE_DIR=".demo_store"

cleanup() {
    echo "Cleaning up demo store at $STORE_DIR..."
    rm -rf "$STORE_DIR"
    exit 0
}
trap cleanup SIGINT EXIT

# Build store from test data
echo "Building demo store from test FASTA files..."
node scripts/build_store.mjs --fasta test_data/base.fa --output "$STORE_DIR"

# Start server
echo ""
echo "Starting RefgetStore server on http://localhost:${PORT:-3000}"
echo "  Service info:  http://localhost:${PORT:-3000}/service-info"
echo "  Collections:   http://localhost:${PORT:-3000}/collection"
echo "  Sequences:     http://localhost:${PORT:-3000}/sequence"
echo ""

REFGET_STORE_PATH="$STORE_DIR" npm start
