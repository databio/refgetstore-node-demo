#!/usr/bin/env node
// Build a RefgetStore from FASTA files
//
// Usage: node scripts/build_store.mjs --fasta <path> [--fasta <path>...] --output <dir>

import { RefgetStore } from "@databio/gtars-node";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    fasta: { type: "string", multiple: true },
    output: { type: "string" },
  },
});

if (!values.fasta?.length || !values.output) {
  console.error("Usage: node scripts/build_store.mjs --fasta <path> [--fasta <path>...] --output <dir>");
  process.exit(1);
}

const store = RefgetStore.inMemory();

for (const fasta of values.fasta) {
  console.log(`Adding FASTA: ${fasta}`);
  store.addFasta(fasta);
}

console.log(`Writing store to: ${values.output}`);
store.write(values.output);

const stats = store.stats();
console.log(`Done. ${stats.nSequences} sequences, ${stats.nCollections} collections.`);
