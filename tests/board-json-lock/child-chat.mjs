#!/usr/bin/env node
// One announcer on the shared coordination board: a REAL process appending its
// entries behind a barrier. Every entry carries a slug unique to (pid, round), so
// a dropped announcement is countable rather than merely suspected.
//
//   append — the shipped appendChatEntry (one O_APPEND write per entry).
//   rmw    — `naiveAppendChatEntry` below: the pre-fix mutation verbatim in
//            shape — read the WHOLE board, concatenate, write the WHOLE board
//            back. Two announcers overlapping there erase each other's entry,
//            which is precisely the failure the board exists to prevent (an agent
//            that never learns someone else is already in its file).
//
// The block layout is reproduced literally, because readChatBoard's parse is what
// counts the survivors and it must count the control's entries the same way it
// counts the shipped one's.
//
// argv: <mode append|rmw> <archDir> <rounds> <logFile> <readyDir> <goFile>

import fs from "node:fs";
import path from "node:path";

import { appendChatEntry } from "../../src/lib/goals.mjs";

const [mode, archDir, roundsRaw, logFile, readyDir, goFile] = process.argv.slice(2);
const rounds = Number(roundsRaw);
const boardPath = path.join(archDir, "goals", "chat.md");

const HEADER = [
  "# CGR agent coordination board",
  "",
  "Shared, GITIGNORED scratchpad for parallel agents. BEFORE editing, READ what",
  "others have posted and APPEND an announce-entry (your goal, branch, and the",
  "files you're about to touch). If someone is already in a file you need,",
  "coordinate here instead of colliding. Not committed, not a goal — safe to prune.",
  "",
  "",
].join("\n");

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(SLEEP, 0, 0, ms); };

function naiveAppendChatEntry(slug) {
  const at = new Date().toISOString();
  const entry = { at, slug, project: null, branch: null, files: [`${slug}.mjs`], note: "" };
  const block = [
    `<!-- cgr-chat ${JSON.stringify(entry)} -->`,
    `**${at}** · \`${slug}\``,
    `- Files: ${slug}.mjs`,
  ].join("\n");
  const existing = fs.existsSync(boardPath) ? fs.readFileSync(boardPath, "utf8") : "";
  const content = existing.trim()
    ? existing.trimEnd() + "\n\n" + block + "\n"
    : HEADER + block + "\n";
  fs.writeFileSync(boardPath, content);
}

fs.writeFileSync(path.join(readyDir, `${process.pid}`), "ready");

const barrierDeadline = Date.now() + 60_000;
while (!fs.existsSync(goFile)) {
  if (Date.now() > barrierDeadline) {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, error: "barrier timeout" })}\n`);
    process.exit(1);
  }
  sleep(2);
}

const startedAt = Date.now();
let error = null;
const announced = [];
try {
  for (let r = 0; r < rounds; r++) {
    const slug = `p${process.pid}-r${r}`;
    announced.push(slug);
    if (mode === "append") appendChatEntry(archDir, { slug, files: [`${slug}.mjs`] });
    else naiveAppendChatEntry(slug);
  }
} catch (err) {
  error = err.message;
}

fs.appendFileSync(logFile, `${JSON.stringify({
  pid: process.pid,
  mode,
  announced,
  startedAt,
  endedAt: Date.now(),
  error,
})}\n`);
