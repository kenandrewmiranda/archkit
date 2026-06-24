#!/usr/bin/env node

// PreCompact hook for Claude Code. Fires just BEFORE Claude Code compacts the
// context (auto, near the limit; or manual /compact).
//
// CGR 2.0 job (conductor-loop-hooks, ADR 0013/0014): flush in-context state to
// disk before it is summarized away. The board (events.ndjson) and handoff
// artifacts already live on disk and survive compaction by construction; what
// this hook adds is (1) a deterministic on-disk FLUSH MARKER snapshotting which
// CGRs are mid-flight (so the post-compaction SessionStart rehydration knows a
// compaction happened and what was in flight), and (2) a reminder nudging the
// conductor to author handoffs for any in-flight CGR that has none — the
// degraded tail is for writing down, not novel work (ADR 0015). archkit cannot
// author the handoff itself (only the model holds the in-context state); it
// records the derivable state and instructs the model to flush the rest.
//
// Safety:
// - Walks up looking for .arch/SYSTEM.md; exits 0 silent on non-archkit projects.
// - Always exits 0; never blocks compaction.
// - Best-effort: any failure degrades to a silent exit, never a thrown error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const importPath = (p) => import(pathToFileURL(p).href);

function findArchDir(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, ".arch");
    if (fs.existsSync(path.join(candidate, "SYSTEM.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let event = {};
  try { event = JSON.parse(raw); } catch { /* fall through to cwd */ }

  const cwd = event.cwd || process.cwd();
  const archDir = findArchDir(cwd);
  if (!archDir) process.exit(0); // silent on non-archkit projects

  const LIB = path.resolve(__dirname, "..", "src", "lib");
  let board;
  try { board = await importPath(path.join(LIB, "board.mjs")); }
  catch { process.exit(0); }

  const { sessionState, writeFlushMarker } = board;

  let state;
  try { state = sessionState(archDir); } catch { process.exit(0); }

  // Nothing in flight and nothing to merge → no flush needed.
  const inFlight = state.in_flight.map((f) => f.slug);
  const needFlush = inFlight.length > 0 || state.merge_queue.length > 0;
  if (!needFlush) process.exit(0);

  // (1) Deterministic on-disk flush marker — the rehydration breadcrumb.
  let marker = null;
  try {
    marker = writeFlushMarker(archDir, {
      trigger: event.trigger || null,
      sessionId: event.session_id || null,
      board: state,
    });
  } catch { /* best-effort */ }

  // (2) Reminder to author handoffs for in-flight CGRs lacking one.
  const pending = marker && Array.isArray(marker.handoffsPending) ? marker.handoffsPending : inFlight;
  const lines = [
    `[archkit CGR] Compaction imminent — flush in-context state to disk before it is summarized away.`,
    `In flight: ${inFlight.join(", ") || "(none)"}.`,
  ];
  if (pending.length) {
    lines.push(
      `These in-flight CGRs have NO handoff yet — author one NOW (the degraded tail is for writing down, not novel work): ${pending.join(", ")}.`,
      `For each: archkit_goal_handoff <slug> (done+evidence, decisions, remaining, continuation-notes, verification-status).`,
    );
  } else {
    lines.push(`All in-flight CGRs already have a handoff — the board + handoffs survive compaction; SessionStart will rehydrate.`);
  }
  lines.push(`The board (.arch/board/events.ndjson) and handoff artifacts survive compaction; a flush marker was written so SessionStart can rehydrate what was in flight.`);
  const message = lines.join("\n");

  const out = {
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "PreCompact",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
