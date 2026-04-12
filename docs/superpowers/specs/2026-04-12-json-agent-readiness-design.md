# Agent-Readiness Backfill: --json for remaining commands

**Date:** 2026-04-12
**Status:** Draft
**Source issue:** kenandrewmiranda/archkit#15 (closed — audit found no broken output; this covers the remaining gaps)

---

## 1. Overview

Three commands lack full agent-readiness. All other archkit commands already support `--json` or have non-interactive equivalents. This work closes the remaining gaps so the entire CLI is usable by AI agents.

| # | Command | Gap | Fix | Effort |
|---|---------|-----|-----|--------|
| 1 | `stats` | No `--json` flag | Serialize existing analysis objects | Small |
| 2 | `review` | Uses `--agent` not `--json` | Alias `--json` alongside `--agent` | Trivial |
| 3 | `init` | Can't override auto-detection | Add `--app-type` and `--skills` flags | Small |

**Out of scope:**
- `market install` — already fully agent-ready with `--json` (no prompts, auto-merges conflicts)
- `gotcha --interactive` / `--debrief` / `--review` — intentionally human-only; non-interactive equivalents exist
- Scaffold wizard (`archkit` with no args) — agents use `init` or `init --agent-scaffold`

---

## 2. `stats --json`

### Current state

`stats.mjs` computes structured data via `analyzeSystem()`, `analyzeIndex()`, `analyzeSkills()`, `analyzeGraphs()`, `analyzeApis()`, and `calculateHealthScore()`. All return plain objects. The display functions (`displaySkillsHealth()`, etc.) are human-only renderers. No `--json` path exists.

### Change

Add `const jsonMode = args.includes("--json");` at the top of `main()`.

After analysis (line ~336), before display:

```javascript
if (jsonMode) {
  // Build recommendations list (same logic as displayOverallScore)
  const recommendations = buildRecommendations(sys, idx, skills, graphs, apis);
  console.log(JSON.stringify({
    health: calculateHealthScore(sys, idx, skills, graphs, apis),
    system: sys,
    index: idx,
    skills,
    graphs,
    apis,
    recommendations,
  }));
  return;
}
```

Extract the recommendations logic from `displayOverallScore()` (lines 291-311) into a `buildRecommendations()` helper so it can be reused by both the display and JSON paths.

Handle missing `.arch/` in JSON mode: `console.log(JSON.stringify({ error: "no_arch_dir" })); process.exit(1);`

### JSON output shape

```json
{
  "health": {
    "score": 58,
    "pct": 72,
    "checks": [
      { "name": "SYSTEM.md", "score": 10, "max": 10 },
      { "name": "INDEX.md", "score": 7, "max": 10 },
      { "name": "Skills", "score": 21, "max": 30 },
      { "name": "Graphs", "score": 15, "max": 20 },
      { "name": "APIs", "score": 5, "max": 10 }
    ]
  },
  "system": { "exists": true, "rules": 5, "reserved": 3, "hasNaming": true, "hasOnGenerate": false, "size": 2048 },
  "index": { "exists": true, "nodeRoutes": 8, "skillRoutes": 4, "crossRefs": 2, "hasTODO": false, "size": 1024 },
  "skills": [
    { "id": "postgres", "gotchas": 3, "hasUse": true, "hasPatterns": true, "hasSnippets": false, "hasBoundaries": true, "hasMeta": true, "completeness": 5, "maxCompleteness": 6, "size": 890 }
  ],
  "graphs": [
    { "id": "auth", "nodes": 6, "hasSubscribers": true, "size": 340 }
  ],
  "apis": [
    { "id": "stripe", "endpoints": 12, "types": 5, "isStub": false, "size": 1200 }
  ],
  "recommendations": [
    "Fill in 2 skeleton skills: docker, jwt",
    "Add cross-references to INDEX.md"
  ]
}
```

---

## 3. `review --json`

### Current state

`review.mjs` line 420: `const agentMode = args.includes("--agent");`

When `agentMode` is true, the output is structured JSON (lines 488-497) with findings, gotcha suggestions, pass/fail, error counts. This is exactly the right shape — it just requires the `--agent` flag name.

### Change

One-line change:

```javascript
const agentMode = args.includes("--agent") || args.includes("--json");
```

`--agent` remains for backwards compatibility. `--json` is the standard flag name agents expect. The JSON output shape does not change.

---

## 4. `init --app-type` + `--skills`

### Current state

`init.mjs` auto-detects app type (line ~264 `detectAppType()`) and skills (line ~273 `detectSkills()`). When detection is wrong, there's no way to override — the agent has to accept the auto-detected values.

### Change

After detection, check for override flags:

```javascript
// Override app type if specified
const appTypeFlag = args[args.indexOf("--app-type") + 1];
if (appTypeFlag) {
  if (!APP_TYPES[appTypeFlag]) {
    if (jsonMode) {
      console.log(JSON.stringify({
        error: "invalid_app_type",
        value: appTypeFlag,
        valid: Object.keys(APP_TYPES),
      }));
    } else {
      log.error(`Unknown app type: ${appTypeFlag}. Valid: ${Object.keys(APP_TYPES).join(", ")}`);
    }
    process.exit(2);
  }
  appType = appTypeFlag;
  log.resolve(`App type override: ${APP_TYPES[appType].name}`);
}

// Override skills if specified
const skillsFlag = args[args.indexOf("--skills") + 1];
if (skillsFlag) {
  const requestedSkills = skillsFlag.split(",").map(s => s.trim());
  const invalid = requestedSkills.filter(s => !SKILL_CATALOG.find(sc => sc.id === s));
  if (invalid.length > 0) {
    if (jsonMode) {
      console.log(JSON.stringify({
        error: "invalid_skills",
        invalid,
        valid: SKILL_CATALOG.map(s => s.id),
      }));
    } else {
      log.error(`Unknown skill(s): ${invalid.join(", ")}`);
    }
    process.exit(2);
  }
  skills = requestedSkills;
  log.resolve(`Skills override: ${skills.join(", ")}`);
}
```

These overrides apply to the detection-based `init` path only (not `--agent-scaffold` or `--install-hooks`, which short-circuit before detection runs).

---

## 5. Error handling

All three changes follow the existing convention:

- `--json` mode: `console.log(JSON.stringify({ error: "<code>", ... }))` + `process.exit(N)`
- Human mode: `log.error()` / `log.warn()` to stderr + `process.exit(N)`
- Logger already writes to stderr — no changes to `logger.mjs`

---

## 6. Testing

### `stats --json`
- Test: run `stats --json` against a project with `.arch/`, parse output, verify JSON has `health`, `system`, `skills`, `graphs` keys
- Test: run `stats --json` without `.arch/`, verify error JSON
- Test: `--json --compact` — `--json` takes precedence (JSON output, not compact human line)

### `review --json`
- Test: run `review --json <file>` against a fixture file, verify JSON output has `files`, `errors`, `pass`, `findings` keys
- Test: `--json` and `--agent` produce identical output shape

### `init --app-type` + `--skills`
- Test: `init --json --app-type saas` overrides detected type
- Test: `init --json --app-type invalid` returns error with valid types list
- Test: `init --json --skills postgres,stripe` overrides detected skills
- Test: `init --json --skills invalid_pkg` returns error with valid skills list

---

## 7. README updates

Add to the command tables:
- `archkit stats --json` in Health & Maintenance section
- Note that `archkit review --json` is equivalent to `archkit review --agent`
- Document `--app-type` and `--skills` flags in Scaffold & Setup section

---

## 8. Version

Bump `1.2.0` → `1.2.1` (patch — additive flags, no breaking changes).
