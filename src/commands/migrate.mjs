// Migrate an existing .arch/ directory from archkit 1.0 to 1.1
// without losing user-authored content (gotchas, learned rules, cross-refs).

import fs from "fs";
import path from "path";
import { findArchDir } from "../lib/shared.mjs";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { loadFile, parseSystem } from "../lib/parsers.mjs";
import { genBoundariesMd, genCompactContext } from "../lib/generators.mjs";
import { GOTCHA_DB } from "../data/gotcha-db.mjs";
import { PACKAGE_DOCS } from "../data/package-docs.mjs";
import { APP_TYPES } from "../data/app-types.mjs";

function banner() {
  commandBanner("arch-migrate", "Upgrade .arch/ from 1.0 to 1.1 without losing content");
}

function detectAppType(systemContent) {
  const match = systemContent.match(/^## Type:\s*(.+)$/m);
  if (!match) return null;
  const line = match[1].toLowerCase();
  if (line.includes("saas") || line.includes("b2b")) return "saas";
  if (line.includes("commerce")) return "ecommerce";
  if (line.includes("real-time") || line.includes("realtime")) return "realtime";
  if (line.includes("data") || line.includes("analytics")) return "data";
  if (line.includes("ai") || line.includes("llm")) return "ai";
  if (line.includes("mobile")) return "mobile";
  if (line.includes("internal")) return "internal";
  if (line.includes("content")) return "content";
  return "saas";
}

function extractAppName(systemContent) {
  const match = systemContent.match(/^## App:\s*(.+)$/m);
  return match ? match[1].trim() : "my-app";
}

function extractStack(systemContent) {
  const match = systemContent.match(/^## Stack:\s*(.+)$/m);
  if (!match) return {};
  const stack = {};
  match[1].split("|").forEach(pair => {
    const [k, ...v] = pair.split(":");
    if (k && v.length) stack[k.trim()] = v.join(":").trim();
  });
  return stack;
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) console.log(JSON.stringify({ error: "No .arch/ directory found" }));
    else { banner(); log.error("No .arch/ found. Nothing to migrate."); }
    process.exit(1);
  }

  if (!jsonMode) banner();

  const systemContent = loadFile(archDir, "SYSTEM.md");
  const appType = detectAppType(systemContent);
  const appName = extractAppName(systemContent);
  const stack = extractStack(systemContent);
  const system = parseSystem(systemContent);

  log.agent(`Migrating .arch/ for: ${appName} (${appType})`);

  const changes = [];

  // 1. Add BOUNDARIES.md if missing
  const boundariesPath = path.join(archDir, "BOUNDARIES.md");
  if (!fs.existsSync(boundariesPath)) {
    changes.push({ file: "BOUNDARIES.md", action: "create", reason: "Hard NEVER rules — new in 1.1" });
    if (!dryRun) {
      fs.writeFileSync(boundariesPath, genBoundariesMd(appType));
      log.generate("Created BOUNDARIES.md");
    }
  }

  // 2. Add CONTEXT.compact.md if missing
  const compactPath = path.join(archDir, "CONTEXT.compact.md");
  if (!fs.existsSync(compactPath)) {
    const at = APP_TYPES[appType] || APP_TYPES.saas;
    const cfg = { appName, appType, stack, features: [], skills: [], crossRefs: [] };
    changes.push({ file: "CONTEXT.compact.md", action: "create", reason: "~500 token injectable for cheap-model calls" });
    if (!dryRun) {
      fs.writeFileSync(compactPath, genCompactContext(cfg));
      log.generate("Created CONTEXT.compact.md");
    }
  }

  // 3. Merge built-in gotchas into existing .skill files (without overwriting user content)
  const skillsDir = path.join(archDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"))) {
      const skillId = file.replace(".skill", "");
      const builtins = GOTCHA_DB[skillId];
      if (!builtins || builtins.length === 0) continue;

      const skillPath = path.join(skillsDir, file);
      const content = fs.readFileSync(skillPath, "utf8");

      // Check if skill still has placeholder gotchas only
      const hasRealGotchas = (content.match(/^WRONG:/gm) || []).length - (content.match(/^WRONG: \[/gm) || []).length;

      // Merge: add built-in gotchas that aren't already present
      let added = 0;
      let updatedContent = content;
      for (const g of builtins) {
        if (!content.includes(g.wrong)) {
          const entry = `WRONG: ${g.wrong}\nRIGHT: ${g.right}\nWHY: ${g.why}\n\n`;
          const gotchaIdx = updatedContent.indexOf("## Gotchas");
          if (gotchaIdx !== -1) {
            const afterGotcha = updatedContent.indexOf("## ", gotchaIdx + 10);
            if (afterGotcha !== -1) {
              updatedContent = updatedContent.slice(0, afterGotcha) + entry + updatedContent.slice(afterGotcha);
            } else {
              updatedContent += "\n" + entry;
            }
            added++;
          }
        }
      }

      if (added > 0) {
        changes.push({ file: `skills/${skillId}.skill`, action: "merge", reason: `${added} built-in gotcha${added > 1 ? "s" : ""} added (user gotchas preserved)` });
        if (!dryRun) {
          fs.writeFileSync(skillPath, updatedContent);
          log.generate(`Merged ${added} gotchas into ${skillId}.skill`);
        }
      }

      // Auto-populate Meta if still has placeholders
      const pkgInfo = PACKAGE_DOCS[skillId];
      if (pkgInfo && content.includes("[PACKAGE_NAME]")) {
        let version = null;
        try {
          const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
          const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
          version = allDeps[pkgInfo.npm] || null;
        } catch {}

        if (!dryRun) {
          let metaContent = updatedContent;
          metaContent = metaContent.replace(/pkg:\s*\[PACKAGE_NAME\]@\[VERSION\]/, `pkg: ${pkgInfo.npm || skillId}@${version || "[VERSION]"}`);
          metaContent = metaContent.replace(/docs:\s*\[OFFICIAL_DOCS_URL\]/, `docs: ${pkgInfo.docs || "[DOCS_URL]"}`);
          metaContent = metaContent.replace(/updated:\s*\[YYYY-MM-DD\]/, `updated: ${new Date().toISOString().split("T")[0]}`);
          if (metaContent !== updatedContent) {
            fs.writeFileSync(skillPath, metaContent);
            changes.push({ file: `skills/${skillId}.skill`, action: "update-meta", reason: "Auto-populated package name, version, docs URL" });
            log.generate(`Updated Meta in ${skillId}.skill`);
          }
        }
      }
    }
  }

  // 4. Update SYSTEM.md — add Session Management if missing, add External Skill Integration
  if (systemContent && !systemContent.includes("## Session Management")) {
    changes.push({ file: "SYSTEM.md", action: "append", reason: "Added Session Management section (replaces rigid protocol)" });
    if (!dryRun) {
      let sys = fs.readFileSync(path.join(archDir, "SYSTEM.md"), "utf8");

      // Remove old NON-NEGOTIABLE protocol if present
      const oldProtocol = sys.indexOf("## Session Protocol (NON-NEGOTIABLE)");
      if (oldProtocol !== -1) {
        const nextSection = sys.indexOf("\n## ", oldProtocol + 10);
        sys = sys.slice(0, oldProtocol) + sys.slice(nextSection !== -1 ? nextSection : sys.length);
      }

      // Add new Session Management
      sys += `\n## Session Management\n`;
      sys += `Maintain a running task list. Before starting work:\n`;
      sys += `1. Run \`archkit resolve warmup\` — check system health\n`;
      sys += `2. Break the task into steps. Write them down.\n`;
      sys += `3. Check off each step as you complete it.\n\n`;
      sys += `Available tools (use when relevant):\n`;
      sys += `| Tool | When to Use |\n`;
      sys += `|------|-------------|\n`;
      sys += `| \`archkit resolve context "<prompt>"\` | Unsure which files/features are involved |\n`;
      sys += `| \`archkit resolve preflight <feature> <layer>\` | Before modifying an existing feature |\n`;
      sys += `| \`archkit resolve scaffold <feature>\` | Creating a new feature from scratch |\n`;
      sys += `| \`archkit resolve plan "<prompt>"\` | Need a structured implementation plan |\n`;
      sys += `| \`archkit review --staged\` | Before committing — final quality gate |\n`;
      sys += `| \`archkit gotcha --debrief\` | End of session — capture what you learned |\n`;
      sys += `\n### External Skill Integration\n`;
      sys += `If using external workflow skills (superpowers, custom skills, etc.):\n`;
      sys += `- External skills do NOT replace archkit commands\n`;
      sys += `- BEFORE any task execution: \`archkit resolve warmup\`\n`;
      sys += `- BEFORE each commit: \`archkit review --staged\`\n`;
      sys += `- AFTER completing a plan: \`archkit resolve verify-wiring src/\`\n`;
      sys += `- AT session end: \`archkit gotcha --debrief\` (or report via --json)\n`;

      fs.writeFileSync(path.join(archDir, "SYSTEM.md"), sys);
      log.generate("Updated SYSTEM.md with Session Management");
    }
  }

  // 5. Generate Claude Code files if .claude/ exists but is missing new files
  const claudeDir = path.join(process.cwd(), ".claude");
  if (fs.existsSync(claudeDir)) {
    // Protocol skill
    const protocolDir = path.join(claudeDir, "skills", "archkit-protocol");
    if (!fs.existsSync(protocolDir)) {
      changes.push({ file: ".claude/skills/archkit-protocol/SKILL.md", action: "create", reason: "Workflow integration skill — auto-discoverable by agents" });
      if (!dryRun) {
        fs.mkdirSync(protocolDir, { recursive: true });
        const protocolSkill = `---
name: archkit-protocol
description: "Architecture-first development workflow using archkit CLI tools"
trigger: "When starting any coding task, implementing a feature, before committing, at session end, or when asked about architecture"
---

# archkit Protocol

All commands return JSON on stdout (logs go to stderr).

## Before Starting Work
\`\`\`bash
archkit resolve warmup
\`\`\`

## Before Implementing
\`\`\`bash
archkit resolve scaffold <featureId> --pretty    # new feature
archkit resolve preflight <feature> <layer> --pretty  # existing
archkit resolve context "<prompt>" --pretty       # unsure
archkit resolve plan "<prompt>" --pretty          # need plan
\`\`\`

## Before Committing
\`\`\`bash
archkit review --staged --agent
archkit resolve verify-wiring src/
\`\`\`

## At Session End
\`\`\`bash
archkit gotcha <skill> "<wrong>" "<right>" "<why>" --json
archkit stats --compact
\`\`\`
`;
        fs.writeFileSync(path.join(protocolDir, "SKILL.md"), protocolSkill);
        log.generate("Created archkit-protocol skill");
      }
    }

    // Settings.json hooks
    const settingsPath = path.join(claudeDir, "settings.json");
    let existingSettings = {};
    if (fs.existsSync(settingsPath)) {
      try { existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
    }
    const hasPreToolHook = (existingSettings.hooks?.PreToolUse || []).some(h => h.hooks?.some(hh => hh.command?.includes("archkit")));
    if (!hasPreToolHook) {
      changes.push({ file: ".claude/settings.json", action: "merge", reason: "Pre-commit review hook + warmup nudge" });
      if (!dryRun) {
        const hooks = {
          hooks: {
            ...(existingSettings.hooks || {}),
            PreToolUse: [
              ...((existingSettings.hooks || {}).PreToolUse || []),
              { matcher: "Bash", hooks: [{ type: "command", command: "if echo \"$TOOL_INPUT\" | grep -q 'git commit'; then archkit review --staged --agent 2>/dev/null | head -5; fi" }] }
            ],
            PostToolUse: [
              ...((existingSettings.hooks || {}).PostToolUse || []),
              { matcher: "Read", hooks: [{ type: "command", command: "if [ ! -f /tmp/.archkit-warmup-done-$$ ]; then echo '[ARCHKIT] Run: archkit resolve warmup'; touch /tmp/.archkit-warmup-done-$$; fi" }] }
            ],
          },
        };
        fs.writeFileSync(settingsPath, JSON.stringify({ ...existingSettings, ...hooks }, null, 2));
        log.generate("Added archkit hooks to settings.json");
      }
    }

    // Architecture mandate
    const archRulePath = path.join(claudeDir, "rules", "architecture.md");
    if (fs.existsSync(archRulePath)) {
      const archRule = fs.readFileSync(archRulePath, "utf8");
      if (!archRule.includes("archkit Protocol")) {
        changes.push({ file: ".claude/rules/architecture.md", action: "prepend", reason: "NON-NEGOTIABLE mandate to invoke archkit-protocol skill" });
        if (!dryRun) {
          const mandate = `## archkit Protocol (NON-NEGOTIABLE)\nBefore ANY code generation, invoke the \`archkit-protocol\` skill.\nThis applies even when using superpowers or other workflow skills.\n\n`;
          const content = archRule.replace(/(---\n\n)/, `$1${mandate}`);
          fs.writeFileSync(archRulePath, content);
          log.generate("Added protocol mandate to architecture.md");
        }
      }
    }
  }

  // Summary
  const result = { version: "1.0 → 1.1", changes, dryRun };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("");
    if (changes.length === 0) {
      log.ok("Already up to date — no migration needed.");
    } else if (dryRun) {
      log.agent(`${changes.length} changes would be made (dry run — no files modified):`);
      changes.forEach(c => log.warn(`${c.action}: ${c.file} — ${c.reason}`));
      console.error("");
      console.error("  Run without --dry-run to apply changes.");
    } else {
      log.ok(`Migration complete: ${changes.length} changes applied`);
      changes.forEach(c => log.ok(`${c.action}: ${c.file} — ${c.reason}`));
      console.error("");
      console.error("  Run: archkit resolve warmup --pretty  to verify the upgraded context.");
    }
    console.error("");
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
