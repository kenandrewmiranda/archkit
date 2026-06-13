#!/usr/bin/env node
// archkit worklog — render a copy-pasteable day-by-day worklog of COMPLETED CGR
// goals (title, outcome, time, completion notes) over a date or date range, for
// posting to Jira / standups.
//
//   archkit worklog                          — today
//   archkit worklog --from 2026-06-01        — that day through today
//   archkit worklog --from 2026-06-01 --to 2026-06-09
//
// A pure REPORT over completed-goal data already on disk (done/ root +
// done/archive/ + done/digest/ fallback) — it writes nothing. The worklog
// rendering itself lives in lib (renderWorklog); this is the CLI surface, the
// MCP tool (archkit_worklog) calls runWorklog directly.

import { isMainModule, C, findArchDir as _findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import { renderWorklog } from "../lib/goals.mjs";
import { archkitError } from "../lib/errors.mjs";

function findArchDir() {
  return _findArchDir({ requireFile: "SYSTEM.md" });
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function runWorklog({ archDir, from = "", to = "", today } = {}) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  for (const [flag, val] of [["from", from], ["to", to]]) {
    const v = String(val || "").trim();
    if (v && !ISO_DATE_RE.test(v)) {
      throw archkitError("invalid_input", `--${flag} must be an ISO date (YYYY-MM-DD), got "${val}"`, {
        suggestion: "e.g. archkit worklog --from 2026-06-01 --to 2026-06-09",
      });
    }
  }
  const r = renderWorklog(archDir, { from, to, today });
  const rangeLabel = r.from === r.to ? r.from : `${r.from || "start"}–${r.to}`;
  return {
    ...r,
    nextStep: r.count > 0
      ? `Rendered ${r.count} completed goal(s)${r.totalDisplay ? ` (~${r.totalDisplay} logged)` : ""} for ${rangeLabel}. Copy the markdown above into Jira/standup.`
      : `No completed goals in ${rangeLabel}. Widen the range with --from/--to, or complete a goal first.`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");

  if (args.includes("--help") || args.includes("-h")) {
    commandBanner("archkit worklog", "copy-pasteable day-by-day log of completed goals");
    console.log(`${C.yellow}  Usage:${C.reset}`);
    console.log(`${C.gray}    archkit worklog                                  Today${C.reset}`);
    console.log(`${C.gray}    archkit worklog --from <YYYY-MM-DD>              From that day through today${C.reset}`);
    console.log(`${C.gray}    archkit worklog --from <date> --to <date>       Explicit range (inclusive)${C.reset}`);
    console.log(`${C.gray}    archkit worklog --to <date>                     Everything up to that day${C.reset}`);
    console.log("");
    console.log(`${C.dim}  Reports over completed-goal data on disk — writes nothing. Time is the${C.reset}`);
    console.log(`${C.dim}  explicit logged effort when set, else derived wall-clock tagged (elapsed).${C.reset}`);
    process.exit(0);
  }

  const fromIdx = args.indexOf("--from");
  const from = fromIdx >= 0 ? (args[fromIdx + 1] || "") : "";
  const toIdx = args.indexOf("--to");
  const to = toIdx >= 0 ? (args[toIdx + 1] || "") : "";

  const archDir = findArchDir();
  if (!archDir) {
    const msg = { error: "no_arch_dir", message: "No .arch/ directory found." };
    console.log(isJson ? JSON.stringify(msg) : `${C.red}  ${msg.message}${C.reset}`);
    process.exit(1);
  }

  try {
    const out = runWorklog({ archDir, from, to });
    if (isJson) { console.log(JSON.stringify(out)); return; }
    commandBanner("archkit worklog", out.from === out.to ? out.from : `${out.from || "start"} → ${out.to}`);
    console.log("");
    console.log(out.markdown);
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({ error: err.code || "internal_error", message: err.message, suggestion: err.suggestion }));
    } else {
      console.error(`${C.red}  ${err.message}${C.reset}`);
      if (err.suggestion) console.error(`  ${C.dim}${err.suggestion}${C.reset}`);
    }
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
