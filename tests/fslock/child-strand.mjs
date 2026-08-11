#!/usr/bin/env node
// Strands a real lock and dies. This is the corpse the stale-break test steps
// over: the lockfile is created by a process that then exits WITHOUT releasing,
// which is exactly the failure mode the TTL exists for (process death, not an
// ordinary throw — that is release-on-throw's job).
//
// argv: <lockPath>

import { acquireLock } from "../../src/lib/fslock.mjs";

const [lockPath] = process.argv.slice(2);
const handle = acquireLock(lockPath, { waitMs: 5_000, ttlMs: 60_000, meta: { test: "strand" } });
process.stdout.write(JSON.stringify({ pid: process.pid, held: handle.held }));
// No release, no finally — just leave.
process.exit(handle.held ? 0 : 1);
