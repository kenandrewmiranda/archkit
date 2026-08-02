// src/lib/format.mjs
// The archkit MCP OUTPUT CONTRACT (ADR 0026): one shared renderer for board and
// lane state, so every MCP surface emits the same terse graph instead of
// reinventing numbered prose.
//
// Three rules, in force for everything exported here:
//
//   1. GRAPH, NOT PROSE. Board state is a tree: lanes are branches, goals are
//      leaves, barriers are marked distinctly. A reader scans the shape; they do
//      not parse sentences. Repeated per-lane boilerplate is factored into ONE
//      template line with named substitutions, so the rendering cost is O(1) in
//      the number of lanes instead of O(lanes) — that is where the bulk of the
//      character saving comes from, and it is why the saving grows with the board
//      rather than shrinking.
//   2. FOUR SYMBOLS, DEFINED ONCE. `action | attention | error | ok` (SYM). Every
//      surface reuses them; nothing invents a fifth severity. A legend line ships
//      with any output that uses them, so terseness never costs legibility.
//   3. MARKDOWN EMPHASIS ONLY — never ANSI. MCP tool results and prompt messages
//      are transported as plain text into an agent's context; an escape sequence
//      surfaces there as literal garbage (`←[32m`), burning tokens and breaking
//      the very scannability the emphasis was for. `strong()`/`code()` are the
//      only emphasis primitives, and `hasAnsi()` is the guard tests assert with.
//
// Pure string building: no IO, no state, no board/goal imports. Callers pass in
// already-folded plan objects (src/lib/board.mjs `conductorPlan`) — this module
// only decides how they LOOK.

// ── 1. The severity vocabulary ────────────────────────────────────────────────

// The four — and only four — severities any archkit surface may express.
export const SEVERITIES = Object.freeze(["action", "attention", "error", "ok"]);

// The symbol per severity. Chosen to be visually distinct at a glance, single
// display-width, and free of any character a terminal or markdown renderer would
// try to interpret.
export const SYM = Object.freeze({
  action: "▸",     // do this now
  attention: "!",  // look at this before proceeding
  error: "✗",      // failed / blocked / unresolvable
  ok: "✓",         // done, green, nothing owed
});

// Structural glyphs — the tree/graph grammar (NOT severities; they carry shape,
// not urgency, which is why they are a separate table).
export const GLYPH = Object.freeze({
  branch: "├─",    // a lane
  last: "└─",      // the final lane
  pipe: "│",       // continuation under a non-final lane
  barrier: "⊘",    // exclusive / run-solo CGR
  flow: "→",       // ordered sequence within a lane
  after: "⇠",      // this lane lands after another
  sep: "·",        // stat separator
});

// Resolve a severity name to its symbol. Unknown names fall back to `action`
// rather than throwing — a rendering bug must never take down a prompt.
export function sym(severity) {
  return SYM[severity] || SYM.action;
}

// The legend that ships with any graph output. One line, so the vocabulary is
// always recoverable from the message itself without external documentation.
export const LEGEND = `legend ${SYM.action}do ${SYM.attention}look ${SYM.error}fail ${SYM.ok}ok ${GLYPH.barrier}solo ${GLYPH.flow}then ${GLYPH.after}after`;

// ── 2. Emphasis — markdown only ───────────────────────────────────────────────

export const ESC = "\u001b";

// True when a string carries an ANSI escape. The output contract forbids it in
// every MCP tool result and prompt message; tests assert on this.
export function hasAnsi(text) {
  return String(text ?? "").includes(ESC);
}

// Defensive scrub for text that came from somewhere else (a verify command a
// user pasted, a handoff note). Removes the escape byte and any CSI/OSC tail.
export function stripAnsi(text) {
  return String(text ?? "").replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "").split(ESC).join("");
}

// The only two emphasis primitives. `strong` for a value that changes what the
// reader does; `code` for anything meant to be run or typed verbatim.
export function strong(value) {
  return `**${value}**`;
}
export function code(value) {
  return `\`${value}\``;
}

// ── 3. The graph grammar ──────────────────────────────────────────────────────

// Render a stat strip: `frontier **4** · lanes **2** · blocked 0`.
// Each entry is [label, n] or [label, n, severity]. A ZERO stays plain and
// unmarked (nothing owed → nothing to look at); a NON-ZERO is bolded, and
// prefixed with its severity symbol when one is given. That is the whole
// "emphasis for the values that matter" rule: emphasis tracks actionability.
export function stats(entries) {
  return entries
    .filter(Boolean)
    .map(([label, n, severity]) => {
      const value = Number(n) > 0
        ? `${severity ? sym(severity) : ""}${strong(n)}`
        : String(n);
      return `${label} ${value}`;
    })
    .join(` ${GLYPH.sep} `);
}

// Render a list of nodes as a tree. A node is a string, or
// `{ text, children:[string] }` where children are continuation lines drawn
// under the node's own rail. Returns an array of lines (callers join).
export function tree(nodes, { indent = "  " } = {}) {
  const list = (nodes || []).filter(Boolean).map((n) => (typeof n === "string" ? { text: n } : n));
  const out = [];
  list.forEach((node, i) => {
    const last = i === list.length - 1;
    out.push(`${indent}${last ? GLYPH.last : GLYPH.branch} ${node.text}`);
    const rail = `${indent}${last ? "   " : `${GLYPH.pipe}  `}`;
    for (const child of node.children || []) out.push(`${rail}${child}`);
  });
  return out;
}

// Lanes as branches, goals as leaves, barriers marked distinctly.
//   ├─ ▸ output: fmt-a → fmt-b
//   └─ ! ⊘ solo-x SOLO — merge everything before it
// `lanes` is conductorPlan.claimableLanes ({ lane: [slug] }); `barriers` is its
// flat list of exclusive slugs. Returns lines.
export function laneTree(lanes = {}, barriers = []) {
  // Ordinary lanes are unmarked — they are the baseline case. Only a BARRIER
  // gets a symbol, so "run this one solo" is the thing the eye lands on.
  const nodes = Object.entries(lanes).map(([lane, slugs]) => ({
    text: `${lane}: ${(slugs || []).join(` ${GLYPH.flow} `)}`,
  }));
  for (const slug of barriers || []) {
    nodes.push({ text: `${SYM.attention} ${GLYPH.barrier} ${slug} ${strong("SOLO")} — merge everything before it` });
  }
  return tree(nodes);
}

// A numbered loop step: `2 ▸ dispatch …`. Steps carry a severity so the reader
// can triage the loop itself — which step is routine, which one needs a look.
export function step(n, severity, text) {
  return `${n} ${sym(severity)} ${text}`;
}

// ── 4. Board surfaces built on the grammar ────────────────────────────────────

// The one-line board strip. `counts` is conductorPlan.counts.
export function boardLine(counts = {}) {
  const c = counts;
  // Only the stats that can COST you something carry a severity symbol; the
  // throughput counts are bolded when non-zero and otherwise left alone.
  return `board ${stats([
    ["frontier", c.frontier || 0],
    ["lanes", c.claimableLanes || 0],
    [GLYPH.barrier, c.barriers || 0, "attention"],
    ["flight", c.in_flight || 0],
    ["merge", c.merge_queue || 0],
    ["blocked", c.blocked || 0, "attention"],
    ["exc", c.exceptions || 0, "attention"],
    ["leases", c.leases_expired || 0, "attention"],
  ])}`;
}

// The convergence stage (ADR 0023/0024) as a graph instead of a per-lane script.
// The five sub-steps are IDENTICAL for every integration point except for the
// lane token and the paths, so they are emitted ONCE as a substitution template
// (`W` = the point's worktree/branch, `L` = its lane) and each point then needs a
// single line: its order, lane, slugs, verify command, and owned paths. Nothing
// is dropped — the template plus the point line reconstitute exactly the command
// set the prose form spelled out per lane.
export function convergenceGraph(plan = {}, { maxPaths = 6 } = {}) {
  const groups = plan.groups || [];
  const branch = plan.branch || "main";
  if (!groups.length) return [`${SYM.ok} merge queue empty — nothing to converge.`];

  // When every point resolves the SAME verify command (the common case — the
  // project-level fallback), state it once in the template instead of repeating
  // it on every leaf. Divergent commands stay per-point, where they matter.
  const verifyOf = (g) => (g.integration && g.integration.verify) || null;
  const shared = groups.every((g) => verifyOf(g) && verifyOf(g) === verifyOf(groups[0]))
    ? { command: verifyOf(groups[0]), source: groups[0].integration.verifySource }
    : null;

  const lines = [
    `${groups.length} point${groups.length === 1 ? "" : "s"} (1/lane) onto ${strong(branch)} IN ORDER; per point sub W=its worktree/branch, L=its lane:`,
    `   ↻${code(`git -C W fetch && git -C W rebase ${branch}`)} ⊕${code("git merge --no-ff W")} ${SYM.ok}${shared ? `${code(shared.command)}(${shared.source})` : "its own verify"} ⊞${code(`archkit_board_merged slugs=<slugs> lane=L branch=${branch} verifyCommand=<verify> passed=<t|f>`)} ${SYM.error}rebase stuck→${code("git checkout W -- <owns>")}`,
  ];
  if (plan.split) {
    lines.push(`   ${SYM.attention} lanes are mutually dependent (${plan.splitReason}) — split into ordered segments, not one point per lane.`);
  }
  const nodes = groups.map((g) => {
    const shown = (g.paths || []).slice(0, maxPaths).join(" ");
    const more = (g.paths || []).length > maxPaths ? ` +${g.paths.length - maxPaths}` : "";
    const after = (g.dependsOnLanes || []).length ? ` ${GLYPH.after}${g.dependsOnLanes.join(",")}` : "";
    const seg = g.segment ? `/${g.segment}` : "";
    const verify = shared
      ? ""
      : verifyOf(g)
        ? ` ${SYM.ok}${code(verifyOf(g))}(${g.integration.verifySource})`
        : ` ${SYM.error}NO verify resolved — record unverified, never assume green`;
    return {
      text: `${g.order}) ${g.lane}${seg}: ${(g.slugs || []).join(` ${GLYPH.flow} `)}${after}${verify} owns ${shown || "(unpredicted)"}${more}`,
    };
  });
  lines.push(...tree(nodes));
  lines.push(
    `   ${SYM.attention} skip ↻ and a stale-base merge REVERTS earlier merges in this drain; ${SYM.error} is bounded to owns. Worktree-green ≠ ${branch}-green — ${SYM.ok}+⊞ after EACH.`,
  );
  return lines;
}

// The INTEGRATION DEBT ledger (ADR 0024): merges recorded WITHOUT a green
// verify. Returns { severity, text } so a caller can place it as a loop step or
// a standalone line without re-deriving the severity from the string.
export function debt(unverifiedMerges = [], { branch = "main" } = {}) {
  if (!unverifiedMerges.length) {
    return { severity: "ok", text: `INTEGRATION DEBT: none — every recorded merge carries a green verify` };
  }
  const items = unverifiedMerges
    .map((m) => `${m.slug} (lane ${m.lane}): ${m.status}${m.command ? ` ${code(m.command)}` : ""} [${m.reason}]`)
    .join("; ");
  return {
    severity: "attention",
    text: `INTEGRATION DEBT ${strong(unverifiedMerges.length)} merged w/o a green verify → re-verify on ${branch} + archkit_board_merged: ${items}`,
  };
}

// Same ledger as a single rendered line (symbol + text).
export function debtLine(unverifiedMerges = [], opts = {}) {
  const d = debt(unverifiedMerges, opts);
  return `${sym(d.severity)} ${d.text}`;
}

// The whole conductor orchestration pass, as a graph. `plan` is conductorPlan().
// This is the reference implementation of the output contract: header (role +
// instruct-not-act framing), legend, board strip, then the numbered dispatch loop
// with lanes as a tree and the convergence stage as a template + point list.
export function conductorGraph(plan = {}) {
  const c = plan.counts || {};
  const expired = plan.leasesExpired || [];
  const exceptions = plan.exceptions || [];
  const laneCount = Object.keys(plan.claimableLanes || {}).length;

  const lines = [
    `[archkit CGR conductor] ${SYM.action} ${strong("conduct, don't code")} — YOU spawn workers + run all git/verify; archkit only EMITS plans, records what you report.`,
    LEGEND,
    boardLine(c),
    ``,
    expired.length
      ? step(1, "attention", `reclaim ${strong(expired.length)} orphan lease${expired.length === 1 ? "" : "s"} (TTL elapsed, free to re-claim): ${expired.map((l) => l.slug).join(" ")}`)
      : step(1, "ok", `reclaim: no expired leases`),
    laneCount || (plan.barriers || []).length
      ? step(2, "action", `claim + dispatch 1 worker/lane in its OWN git worktree, parallel (lanes own disjoint files):`)
      : step(2, "ok", `claim + dispatch: no claimable lanes`),
  ];
  if (laneCount || (plan.barriers || []).length) {
    lines.push(...laneTree(plan.claimableLanes || {}, plan.barriers || []));
  }
  lines.push(
    step(3, "action", `collect worker handoffs (archkit_goal_handoff at wind-down)`),
    exceptions.length
      ? step(4, "attention", `deep-review ONLY ${exceptions.map((e) => `${e.slug}(${e.reasons.join(",")})`).join(" ")} — rubber-stamp the rest`)
      : step(4, "ok", `deep-review: no exceptions — rubber-stamp the returns`),
  );
  const conv = convergenceGraph(plan.convergence || {});
  lines.push(step(5, "action", `CONVERGE + MERGE — ${conv[0]}`), ...conv.slice(1));
  const d = debt(plan.unverifiedMerges || [], { branch: (plan.convergence && plan.convergence.branch) || "main" });
  lines.push(step(6, d.severity, d.text));
  lines.push(``, `structured plan: archkit_conductor ${GLYPH.sep} archkit_session_state`);
  return lines;
}
