// GitHub issue reporter — opt-in feedback loop from archkit sessions
// to the archkit repo. Only activates when gh CLI is available and
// the user has opted in via .archkit-config.json.

import { execFileSync } from "child_process";
import fs from "fs";
import * as log from "./logger.mjs";

const ARCHKIT_REPO = "kenandrewmiranda/archkit";
const CONFIG_FILE = ".archkit-config.json";

// ── Config ──────────────────────────────────────────────────────────

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function isReportingEnabled() {
  const config = loadConfig();
  return config.reportIssues === true;
}

// ── gh CLI detection ────────────────────────────────────────────────

export function isGhAvailable() {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Issue creation ──────────────────────────────────────────────────

function ghCreateIssue(title, body, label) {
  try {
    log.agent(`Creating issue on ${ARCHKIT_REPO}...`);
    const result = execFileSync("gh", [
      "issue", "create",
      "--repo", ARCHKIT_REPO,
      "--title", title,
      "--label", label,
      "--body", body,
    ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const url = result.trim();
    log.ok(`Issue created: ${url}`);
    return url;
  } catch (err) {
    log.warn(`Could not create issue: ${err.message}`);
    return null;
  }
}

export function createGotchaIssue({ skillId, wrong, right, why, appType }) {
  if (!isReportingEnabled() || !isGhAvailable()) return null;

  const title = `[gotcha] ${skillId}: ${wrong.substring(0, 60)}`;
  const body = `## Gotcha Report

**Skill:** ${skillId}
**App Type:** ${appType || "unknown"}

### Pattern

**WRONG:**
\`\`\`
${wrong}
\`\`\`

**RIGHT:**
\`\`\`
${right}
\`\`\`

**WHY:** ${why}

---
Reported via \`archkit gotcha\``;

  return ghCreateIssue(title, body, "gotcha");
}

export function createDebriefIssue({ appType, findings }) {
  if (!isReportingEnabled() || !isGhAvailable()) return null;
  if (findings.length === 0) return null;

  const title = `[debrief] Session findings (${findings.length} items)`;
  const items = findings.map((f, i) => `### ${i + 1}. ${f.type}\n${f.detail || ""}`).join("\n\n");
  const body = `## Session Debrief Report

**App Type:** ${appType || "unknown"}
**Items:** ${findings.length}

${items}

---
Reported via \`archkit gotcha --debrief\``;

  return ghCreateIssue(title, body, "debrief");
}
