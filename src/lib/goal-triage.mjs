// src/lib/goal-triage.mjs
// Staleness triage (goal-staleness-triage) — an ADVISORY scanner that surfaces a
// correctly-PLACED but wrong-CONTEXT goal: a genuinely-pending CGR from ANOTHER
// project sitting in the queue. The placement reconcile (reconcileGoalsLayout)
// can't catch this — the goal's status matches its folder, so by placement it is
// exactly where it belongs. What betrays it is context drift: nobody has TOUCHED
// it (no board event), nobody has TALKED about it (no chat mention), it has SAT
// there (old `created:` date), and it belongs to a DIFFERENT feature branch than
// the one currently checked out.
//
// This module is a PURE READ/SCAN. It NEVER writes, moves, or deletes anything —
// its whole contract is to hand the conductor a list of advisory findings so a
// human (or the conductor) decides. Auto-moving a genuinely-pending goal would be
// destructive; staleness is a heuristic, not a fact, so the output is advice:
//   [{ slug, reasons:[...], suggestion:'hold'|'dismiss'|'keep', ... }]
//
// Reuses the shared readers rather than re-parsing: listGoals/statusOf/slugify
// from goals.mjs (the goal model) and readEvents/foldEvents from board.mjs (the
// append-only board log). Tolerant by construction — a missing board log, missing
// chat.md, or unparseable `created:` never throws; the corresponding signal just
// reads as "absent" (which, being a staleness signal, is the safe default).

import fs from "node:fs";
import path from "node:path";
import {
  listGoals,
  statusOf,
  slugify,
  goalsDir,
  STATUS_PENDING,
  STATUS_TESTING,
} from "./goals.mjs";
import { readEvents, foldEvents } from "./board.mjs";

// ── Config (exit-criterion 3: age threshold + branch-match are configurable) ──
//
// Read from .arch/config.json under `cgr.staleness`, mirroring readCgrConfig's
// tolerant pattern (a missing/invalid config falls back to the defaults, never
// throws). Two knobs:
//   ageDays     — a goal older than this many days trips the `stale-created`
//                 signal. Default 14.
//   branchMatch — when true (default), a project-tagged goal whose project differs
//                 from the current project branch trips `branch-mismatch`. Set
//                 false to disable the branch dimension entirely.
export const DEFAULT_STALENESS = Object.freeze({ ageDays: 14, branchMatch: true });

function readStalenessConfig(archDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(archDir, "config.json"), "utf8"));
    const s = cfg && typeof cfg === "object" && cfg.cgr && typeof cfg.cgr === "object" ? cfg.cgr.staleness : null;
    if (s && typeof s === "object") {
      const ageDays = Number(s.ageDays);
      return {
        ageDays: Number.isFinite(ageDays) && ageDays >= 0 ? ageDays : DEFAULT_STALENESS.ageDays,
        branchMatch: typeof s.branchMatch === "boolean" ? s.branchMatch : DEFAULT_STALENESS.branchMatch,
      };
    }
  } catch { /* no/invalid config → defaults */ }
  return { ...DEFAULT_STALENESS };
}

// The coordination board (cgr-agent-chat-coordination-board) lives in goals/ root.
function chatPath(archDir) {
  return path.join(goalsDir(archDir), "chat.md");
}

// The project a git branch is DEDICATED to, or null for a generic branch. Project
// goals live on `feat/<project>` (ADR 0007); on `main`/generic branches there is
// no single project context, so no goal counts as cross-project (null → no
// branch-mismatch signal fires, avoiding false positives off a feature branch).
function branchProject(branch) {
  const b = String(branch || "").trim();
  const m = b.match(/^(?:feat|feature|project)\/(.+)$/i);
  return m ? slugify(m[1]) : null;
}

// Whole-word-ish slug mention: the bare slug appears in the chat text not glued
// to a longer identifier (so "deep" doesn't match "deep-pending"). Cheap and
// tolerant — a missing/empty chat file reads as "no mention".
function mentionsSlug(text, slug) {
  if (!text || !slug) return false;
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|$)`).test(text);
}

// Age in whole days from an ISO/date-only `created:` to `now`. Unparseable →
// null (age unknown), which is treated as NOT-stale (we never invent staleness
// from a garbage date — the other three signals carry the finding).
function ageDaysOf(created, nowMs) {
  const t = Date.parse(String(created || ""));
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

// Map the accumulated reasons to a single advisory verdict. The strong
// cross-project-cruft shape — belongs to another branch's project, has aged, and
// was never claimed on the board — reads as `dismiss` (almost certainly stray
// work from a different track). A pile-up of softer signals is a `hold` (park it
// for a human look). A lone signal is `keep` (surfaced for awareness, but likely
// fine). NEVER an auto-move — the verdict is advice the conductor renders.
function suggestFor({ branchMismatch, stale, noBoardEvent, reasons }) {
  if (branchMismatch && stale && noBoardEvent) return "dismiss";
  if (reasons.length >= 3) return "dismiss";
  if (reasons.length >= 2) return "hold";
  return "keep";
}

// Scan live+pending goals and score staleness across four dimensions:
//   no-board-event  — the slug never appears in .arch/board/events.ndjson (never
//                     claimed/completed/merged — untouched by the orchestration).
//   no-chat-mention — the slug is never named in goals/chat.md (nobody discussed it).
//   stale-created   — `created:` is older than the configured ageDays.
//   branch-mismatch — the goal's `project` differs from the current branch's
//                     project (cross-project cruft), when branchMatch is enabled.
//
// Returns ADVISORY findings ONLY — one entry per goal that tripped at least one
// signal — sorted most-stale first then by slug. Never writes/moves/mutates.
//
// Options:
//   branch      — the current git branch (drives branch-mismatch). Required for
//                 the branch dimension; absent → no branch context (no mismatch).
//   now         — ISO/epoch clock for age (injected for deterministic tests).
//   ageDays     — override the configured/default age threshold.
//   branchMatch — override the configured/default branch-match enable flag.
export function detectStaleGoals(archDir, { branch, now, ageDays, branchMatch } = {}) {
  const cfg = readStalenessConfig(archDir);
  const threshold = Number.isFinite(Number(ageDays)) && Number(ageDays) >= 0 ? Number(ageDays) : cfg.ageDays;
  const branchEnabled = typeof branchMatch === "boolean" ? branchMatch : cfg.branchMatch;
  const nowMs = (() => {
    const t = Date.parse(String(now || ""));
    return Number.isNaN(t) ? Date.now() : t;
  })();

  // Board fold — one read, one fold. A slug with any recorded event is "touched".
  const { bySlug } = foldEvents(readEvents(archDir));

  // chat.md — read once, tolerated absent (staleness scanner must not crash on a
  // greenfield board that never created a coordination file).
  let chatText = "";
  try { chatText = fs.readFileSync(chatPath(archDir), "utf8"); } catch { /* no chat → no mentions */ }

  const currentProject = branchEnabled ? branchProject(branch) : null;

  // Only genuinely-live work is triaged: pending queue goals + in-progress +
  // testing debt. on-hold is DELIBERATELY parked (intentional, not cruft) → skipped.
  const TRIAGED = new Set([STATUS_PENDING, "in-progress", STATUS_TESTING]);

  const findings = [];
  for (const g of listGoals(archDir)) {
    const status = statusOf(g);
    if (!TRIAGED.has(status)) continue;
    const slug = g.slug;

    const noBoardEvent = !(bySlug.get(slug)?.events > 0);
    const noChatMention = !mentionsSlug(chatText, slug);
    const age = ageDaysOf(g?.meta?.created, nowMs);
    const stale = age != null && age > threshold;

    const project = typeof g?.meta?.project === "string" ? slugify(g.meta.project) : "";
    const branchMismatch = Boolean(
      branchEnabled && currentProject && project && project !== currentProject,
    );

    const reasons = [];
    if (noBoardEvent) reasons.push("no-board-event");
    if (noChatMention) reasons.push("no-chat-mention");
    if (stale) reasons.push("stale-created");
    if (branchMismatch) reasons.push("branch-mismatch");

    if (reasons.length === 0) continue; // clean/active goal — not flagged

    findings.push({
      slug,
      status,
      project: project || null,
      ageDays: age,
      reasons,
      suggestion: suggestFor({ branchMismatch, stale, noBoardEvent, reasons }),
    });
  }

  // Most-stale first (more reasons = more suspicious), then oldest, then slug.
  findings.sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
    const aa = a.ageDays == null ? -1 : a.ageDays, ba = b.ageDays == null ? -1 : b.ageDays;
    if (ba !== aa) return ba - aa;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return findings;
}
