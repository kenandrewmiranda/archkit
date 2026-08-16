#!/usr/bin/env node
// The writer half of the torn-write test: hammers one file with alternating
// whole payloads while a separate process reads it.
//
// Waits for the reader's ready marker first, so the reads provably overlap the
// writes rather than all landing after the last one.
//
// argv: <targetFile> <iterations> <readyFile> <doneFile>

import fs from "node:fs";
import { atomicWriteFileSync } from "../../src/lib/fslock.mjs";
import { PAYLOAD_SIZE, VARIANTS, variantBuffer } from "./payload.mjs";

const [targetFile, iterationsRaw, readyFile, doneFile] = process.argv.slice(2);
const iterations = Number(iterationsRaw);

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

const buffers = VARIANTS.map(variantBuffer);

const readyDeadline = Date.now() + 30_000;
while (!fs.existsSync(readyFile)) {
  if (Date.now() > readyDeadline) { process.stderr.write("writer: reader never signalled ready\n"); process.exit(1); }
  sleep(2);
}

for (let i = 0; i < iterations; i++) {
  atomicWriteFileSync(targetFile, buffers[i % buffers.length]);
}

fs.writeFileSync(doneFile, String(PAYLOAD_SIZE));
