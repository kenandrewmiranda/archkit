# archkit v1.2.0 Enhancement Design

**Date:** 2026-04-11
**Status:** Draft
**Source issues:** kenandrewmiranda/archkit#11, #12, #13

---

## 1. Overview

Six additive changes landing in a single PR, bumping archkit from v1.1.0 to v1.2.0. No breaking changes to existing commands. Every new command surface has a fully non-interactive invocation path with `--json` support and stderr-routed logging, following the convention recommended in issue #5.

| # | Feature | Surface | Type |
|---|---------|---------|------|
| 1 | Gotcha proposal queue | `gotcha --propose`, `--review`, `--list-proposals` + `.arch/gotcha-proposals/` | New feature (#13) |
| 2 | Agent-scaffold init | `init --agent-scaffold` | New feature (#11) |
| 3 | Persona README | `README.md` inline section | Docs (#11) |
| 4 | Pre-commit hook preset | `init --install-hooks` + native `.git/hooks/pre-commit` | New feature (#11) |
| 5 | Cherry-picked gotcha-db entries | `src/data/gotcha-db.mjs` — `sqlite` + `numerics` keys | Data (#12) |
| 6 | Dangling `--from-diff` cleanup | Delete unused usage line in `gotcha.mjs:9` | Cleanup |

**Out of scope (tracked deferrals):**
- `init --from-source` reverse-scaffolder — file a new archkit GH issue with design-question framing
- 3 non-universal #12 entries (aiosqlite, resilience-patterns, git rebase) — handed off to `arch-market/todo/archkit-issue-12-skill-content-handoff.md`
- Backfill `--json` + stderr logging on existing commands — file a new archkit GH issue

---

## 2. Architectural requirement: agent access

Every new command must have a fully non-interactive invocation form. Interactive (inquirer) is a convenience layer for humans, never the only path.

| Feature | Human invocation | Agent invocation |
|---------|-----------------|-----------------|
| `gotcha --propose` | Interactive prompts | File-drop (write JSON to `.arch/gotcha-proposals/<hash>.json`) OR flag form (all required flags present = skip inquirer) |
| `gotcha --review` | Interactive accept/edit/reject/skip | Human-only by design. Agents use `--list-proposals --json` for status only. |
| `gotcha --list-proposals` | Same as agent | `--json` returns structured array on stdout |
| `init --agent-scaffold` | One-shot, no prompts | Same command. Idempotent. |
| `init --install-hooks` | One-shot, no prompts | Same command. |

`--json` mode on all new commands:
- Stdout contains ONLY valid JSON
- All `log.*()` calls route to stderr when `--json` is set
- Non-zero exit codes pair with JSON error objects: `{"error":"<code>","detail":"<message>"}`

---

## 3. Gotcha proposal queue (#13)

### 3.1 Storage layout

```
.arch/
  gotcha-proposals/
    <hash>.json             # active proposals
    rejected/
      <hash>.json           # archived rejections (dedup source)
```

### 3.2 Hashing

`sha1(skill + "\x1f" + wrong + "\x1f" + right)` truncated to 12 hex chars.

- `\x1f` (ASCII unit separator) as field delimiter — avoids collisions from values containing common separators
- `why` field deliberately excluded from hash — editing the explanation shouldn't create a new proposal
- Truncation to 12 chars gives ~48 bits of collision space, sufficient for proposal queues that will never hold more than hundreds of entries

### 3.3 Proposal file schema

```json
{
  "skill": "aiosqlite",
  "wrong": "await db.execute('BEGIN') after ALTER TABLE",
  "right": "await db.commit(); await db.execute('BEGIN')",
  "why": "aiosqlite wraps stdlib sqlite3 whose implicit txn semantics...",
  "source": "code-reviewer-agent",
  "created_at": "2026-04-11T14:22:00Z"
}
```

Six fields, flat. `source` is free-form. No schema version field in v1.

Required fields: `skill`, `wrong`, `right`, `why`.
Optional fields: `source`, `created_at` (default to `"unknown"` and current ISO timestamp if omitted).

### 3.4 `--propose` flow

1. Validate required fields. Missing field → exit 2 with `{"error":"missing_field","field":"<name>"}`.
2. Compute hash.
3. Check `.arch/gotcha-proposals/<hash>.json` → if exists → `{"status":"duplicate","hash":"..."}`, exit 0.
4. Check `.arch/gotcha-proposals/rejected/<hash>.json` → if exists → `{"status":"previously-rejected","hash":"..."}`, exit 0.
5. Auto-create `.arch/gotcha-proposals/` directory if `.arch/` exists. If `.arch/` does not exist → exit 2 with `{"error":"no_arch_dir"}`. Do NOT scaffold `.arch/` during a propose call.
6. Write proposal file → `{"status":"queued","hash":"...","path":"..."}`, exit 0.

Interactive mode (no flags / `--interactive`): use inquirer to prompt for each field, then follow the same flow.

Flag form: `archkit gotcha --propose --skill X --wrong "..." --right "..." --why "..."`. When `--propose` is present AND all four required data flags (`--skill`, `--wrong`, `--right`, `--why`) are provided, skip inquirer entirely. If `--propose` is present but any data flag is missing, exit 2 with a missing-field error — do NOT fall back to interactive prompting (agents invoking `--propose` with partial flags should get a clear error, not a hung prompt).

### 3.5 `--review` flow (interactive, human-only)

Walks each `.json` file in `.arch/gotcha-proposals/` (excluding `rejected/`).

Per proposal, displays formatted output:

```
Proposal 1 of 3
───────────────
Skill:  aiosqlite
Source: code-reviewer-agent  (2026-04-11)

WRONG: await db.execute('BEGIN') after ALTER TABLE
RIGHT: await db.commit(); await db.execute('BEGIN')
WHY:   aiosqlite wraps stdlib sqlite3...

? What do you want to do?
  > Accept  (append to aiosqlite.skill)
    Edit    (open $EDITOR, re-validate, then accept)
    Reject  (move to rejected/)
    Skip    (leave in queue, decide later)
    Quit
```

**Accept:** Call existing `appendGotcha(archDir, skill, wrong, right, why)`. If skill file missing, prompt "Create `<skill>.skill`? [Y/n]" → if yes, write minimal stub with `## Gotchas` section, then append. Delete the proposal file.

**Edit:** Write proposal JSON to temp file, open `$EDITOR` (via inquirer editor prompt), parse on close, re-validate. If validation fails, show error and offer retry/cancel. On success, loop back to same proposal with updated content.

**Reject:** Move file to `rejected/<hash>.json`. No confirmation prompt.

**Skip:** No file change, advance to next proposal.

**Quit:** Exit cleanly, remaining proposals stay in queue.

Empty queue: print friendly message with usage instructions, exit 0.

### 3.6 `--list-proposals --json` flow

Read `.arch/gotcha-proposals/*.json` (excluding `rejected/`), emit as JSON array on stdout. Logs to stderr. Exit 0 even if empty (returns `[]`).

### 3.7 Cleanup: remove `--from-diff`

Delete the usage line at `gotcha.mjs:9` that advertises the unimplemented `--from-diff` mode. The proposal queue replaces this intent.

---

## 4. Agent-scaffold init (#11)

### 4.1 Invocation

`archkit init --agent-scaffold`

### 4.2 Files written

```
.arch/
  BOUNDARIES.md             # stub with AGENT-INSTRUCTIONS
  SYSTEM.md                 # stub with AGENT-INSTRUCTIONS
  skills/
    README.md               # WRONG/RIGHT/WHY format guide
CLAUDE.md                   # stub at project root if missing; SKIP if exists
```

**Not written:** `INDEX.md` (agent creates on demand when it has real modules to enter), cluster graph files.

### 4.3 Idempotency

Per-file behavior:
- File doesn't exist → write it, report as `created`
- File exists with exact stub content → no-op, report as `skipped` (already scaffolded)
- File exists with different content → skip, report as `skipped` (user-modified)

JSON output: `{"created":["<path>", ...], "skipped":["<path>", ...]}`

### 4.4 Stub content pattern

Every stub follows a consistent shape:
1. Human-readable title
2. `<!-- AGENT-INSTRUCTIONS: START ... AGENT-INSTRUCTIONS: END -->` block with imperative numbered instructions
3. Section stubs with inline `<!-- AGENT: populate ... -->` comments

Example for BOUNDARIES.md:

```markdown
# Architectural Boundaries

<!-- AGENT-INSTRUCTIONS: START
This file captures hard architectural rules for this project. Rules should be
written in NEVER form and be enforceable by code review or automated checks.

To populate this file:
1. Read the top of src/ (or the project's main source directory).
2. Identify real boundaries: data layer vs I/O, pure functions vs side effects,
   public API vs internal modules, etc.
3. For each boundary, write a NEVER rule. Be specific — include example module
   names from THIS project, not generic advice.
4. Delete this AGENT-INSTRUCTIONS block when the file is populated.

Format for each rule:

    ### NEVER <short rule>
    **Why:** <one sentence>
    **Example violation:** `path/to/module.py` imports `other/module.py`
    **Enforced by:** <test, lint, review, or "convention">

See archkit docs for the full BOUNDARIES.md reference format.
AGENT-INSTRUCTIONS: END -->

## Data Layer Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->

## I/O Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->

## Error Handling Boundaries

<!-- AGENT: populate with NEVER rules specific to this project -->
```

Other stubs follow the same pattern:
- **SYSTEM.md** — instructions to describe system at cluster granularity (pure domain / I/O / transport / UI)
- **skills/README.md** — WRONG/RIGHT/WHY format reference, instruction that each package gets its own `.skill` file, pointer to `archkit gotcha --propose` for capture flow
- **CLAUDE.md** (only if missing at project root / cwd) — stub with:
  - "Reserved Words" section (empty, agent-fillable)
  - "Session Protocol" section listing non-interactive commands (`archkit resolve warmup --json`, `archkit review --staged`, `archkit gotcha --propose`, etc.)
  - Pointer: "Check `.arch/skills/<package>.skill` before writing code touching `<package>`."

### 4.5 Template storage

Templates live in `src/data/agent-scaffold-templates.mjs` as exported template strings. No runtime file reads — just `writeFileSync` per template. Keeps install surface small.

---

## 5. Persona README section (#11)

Inline in `README.md`, positioned after the tagline/banner and before the full command reference. Three personas:

### Solo dev, small project
- Set up `.arch/` once with agent help: `archkit init --agent-scaffold`
- Wire drift detection into pre-commit: `archkit init --install-hooks`
- Capture gotchas as you find them: `archkit gotcha --propose --skill <package> ...`

### Team or multi-feature project
- Initialize full scaffolded `.arch/`: `archkit init` (interactive wizard)
- Per-feature gating: `archkit resolve preflight <feature> <layer>`, `archkit review --staged` before every commit
- Close the feedback loop: `archkit gotcha --review` to approve proposed gotchas

### Greenfield project
- Start with boundaries, not code: `archkit init --agent-scaffold` → fill in `.arch/BOUNDARIES.md` first
- Build outward from the cluster graph as clusters emerge
- `archkit drift` catches the moment code diverges from the stated design

---

## 6. Pre-commit hook preset (#11)

### 6.1 `init --install-hooks`

Writes `.git/hooks/pre-commit`:

```bash
#!/bin/sh
# Installed by archkit init --install-hooks
# Runs archkit drift against staged files. Exits non-zero if drift detected.
exec archkit drift --staged --json > /dev/null
```

Preflight checks:
1. `.git/` exists → else exit 2 with `{"error":"not_a_git_repo"}`
2. `.git/hooks/pre-commit` already exists → exit 0 with `{"status":"existing-hook","path":"...","suggested_append":"exec archkit drift --staged --json > /dev/null"}`
3. `archkit` on PATH → warn to stderr if missing, but proceed (hook will fail at commit time)

Then `chmod +x` and emit `{"status":"installed","path":".git/hooks/pre-commit"}`.

### 6.2 Implementation gate

Verify that `archkit drift` supports a `--staged` flag. If not, either add `--staged` support as part of this work (preferred — the hook should only check staged changes, not the full working tree) or fall back to plain `archkit drift`. Check `src/commands/drift.mjs` during implementation.

### 6.3 Husky documentation

README snippet showing how to wire the same command into `.husky/pre-commit`. Documentation only, not a code artifact.

---

## 7. Cherry-picked gotcha-db entries (#12)

Two new top-level keys in `src/data/gotcha-db.mjs`:

```javascript
sqlite: [
  {
    wrong: "ALTER TABLE t ADD CHECK (col IN ('a','b'))",
    right: "BEGIN; CREATE TABLE t_new (...); INSERT INTO t_new SELECT col1, col2, ... FROM t; DROP TABLE t; ALTER TABLE t_new RENAME TO t; COMMIT;",
    why: "SQLite's ALTER TABLE cannot add or modify CHECK constraints, foreign keys, or column types in place. Full 12-step rebuild required. Always list columns explicitly in INSERT...SELECT. Ref: sqlite.org/lang_altertable.html #7.",
  },
],
numerics: [
  {
    wrong: "return (current - entry) / entry < threshold  // IEEE 754 noise produces wrong side of exact decimal boundaries",
    right: "return round((current - entry) / entry, 10) < threshold  // or compare in cents (integer), or use Decimal",
    why: "IEEE 754 subtract-then-divide produces values like 0.14999999999999991 at what should be exactly 0.15. Rounding to 10 decimals preserves all meaningful precision while normalizing the noise. Write explicit boundary test cases.",
  },
],
```

### 7.1 Implementation gate

Before committing, verify that `GOTCHA_DB` keys actually flow through to scaffolded `.arch/skills/*.skill` files. Trace `GOTCHA_DB` through `src/commands/init.mjs` and `src/lib/generators.mjs`. If the data doesn't surface in the scaffold output, these entries are dead content and need a different delivery mechanism.

---

## 8. Error handling

### Proposal queue
- `--propose` missing required field → exit 2 + `{"error":"missing_field","field":"<name>"}`
- `--propose` without `.arch/` → exit 2 + `{"error":"no_arch_dir"}`
- `--review` empty queue → friendly message with usage instructions, exit 0
- `--review` edit validation failure → show parse error, offer retry/cancel
- Corrupt proposal file (invalid JSON) → warn to stderr, skip the file, continue batch

### Agent-scaffold init
- Not in a git repo → warn but proceed (scaffold isn't git-specific)
- `.arch/` already populated → per-file idempotency handles it, report skipped files, exit 0
- Write permission denied → exit 2 with structured error

### Hook installer
- Not a git repo → exit 2 + `{"error":"not_a_git_repo"}`
- Existing hook → exit 0 + `{"status":"existing-hook","suggested_append":"..."}`
- `chmod +x` failure → warn to stderr, continue

---

## 9. Testing

### Unit tests (file-system mocked)
- Hash stability: same inputs → same hash
- Hash sensitivity: changing skill/wrong/right → different hash; changing why → same hash
- Proposal validation: required fields, JSON parseability
- `appendGotcha` with missing skill file fallback
- Stub template idempotency: write, re-write, verify unchanged

### Integration tests (real filesystem in temp dir)
- Full propose → list → review-accept cycle → correct skill file content
- Propose → reject → re-propose same hash → `previously-rejected` status
- `init --agent-scaffold` in empty dir → expected file tree
- `init --agent-scaffold` with existing `CLAUDE.md` → CLAUDE.md untouched, other files written
- `init --install-hooks` with no existing hook → file created, executable, correct content
- `init --install-hooks` with existing hook → `existing-hook` status, file unchanged

### Non-interactive contract tests
- All new commands with `--json` produce ONLY valid JSON on stdout
- All new commands without a TTY (`{stdio:'pipe'}`) do not hang waiting for input
- `gotcha --propose` with all flags present does not invoke inquirer

---

## 10. Rollout

- Bump `package.json` version: `1.1.0` → `1.2.0` (minor — additive features, no breaking changes)
- Single PR: README, commands, data, and tests land atomically (the pieces reference each other)
- No migration: `.arch/gotcha-proposals/` created on first propose; existing users see no change until opt-in
- No changes to existing command behavior

---

## 11. Tracked deferrals (GH issues to file)

1. **`init --from-source` reverse-scaffolder** — new archkit issue with design-question framing (languages, output fidelity, confidence, write-vs-propose)
2. **Backfill `--json` + stderr logging on existing commands** — new archkit issue referencing issue #5 recommendations
3. **Marketplace pack format for community gotcha contributions** — new archkit issue linking to `arch-market/todo/` handoff file
