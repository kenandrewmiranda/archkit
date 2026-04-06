import fs from "fs";
import path from "path";
import * as log from "../../lib/logger.mjs";
import { getConfig, downloadConfig } from "../../lib/marketplace.mjs";
import { findArchDir } from "../../lib/shared.mjs";
import { commandBanner } from "../../lib/banner.mjs";

function banner() {
  commandBanner("arch-market", "Install config from marketplace");
}

function mergeSkillContent(existing, incoming) {
  // Preserve user-added gotchas while merging marketplace content.
  // Strategy: marketplace sections replace matching sections,
  // but user gotchas (not present in marketplace version) are kept.

  const existingGotchas = extractGotchas(existing);
  const incomingGotchas = extractGotchas(incoming);

  // Find user-added gotchas (in existing but not in incoming)
  const userGotchas = existingGotchas.filter(eg =>
    !incomingGotchas.some(ig => ig.wrong === eg.wrong)
  );

  // Start with incoming content (marketplace version)
  let merged = incoming;

  // Append user gotchas if any
  if (userGotchas.length > 0) {
    const gotchaSection = merged.indexOf("## Gotchas");
    if (gotchaSection !== -1) {
      const nextSection = merged.indexOf("\n## ", gotchaSection + 10);
      const insertAt = nextSection !== -1 ? nextSection : merged.length;
      const userEntries = userGotchas.map(g =>
        `\n# User-added:\nWRONG: ${g.wrong}\nRIGHT: ${g.right}\nWHY: ${g.why}\n`
      ).join("");
      merged = merged.slice(0, insertAt) + userEntries + merged.slice(insertAt);
    }
  }

  return merged;
}

function extractGotchas(content) {
  const gotchas = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("WRONG:")) {
      const wrong = lines[i].replace("WRONG:", "").trim();
      const right = (lines[i + 1] || "").replace("RIGHT:", "").trim();
      const why = (lines[i + 2] || "").replace("WHY:", "").trim();
      if (wrong && !wrong.startsWith("[")) gotchas.push({ wrong, right, why });
    }
  }
  return gotchas;
}

export async function cmdInstall(args) {
  const jsonMode = args.includes("--json");
  const slugArg = args.find(a => !a.startsWith("-"));

  if (!slugArg) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: { code: "MISSING_SLUG", message: "Usage: archkit install <slug>[@version]" } }));
    } else {
      banner();
      log.error("Usage: archkit install <slug>[@version]");
      console.error("  Example: archkit install postgres-rls-gotchas");
      console.error("  Example: archkit install postgres-rls-gotchas@1.0.0");
    }
    process.exit(1);
  }

  // Parse slug@version
  const [slug, version] = slugArg.split("@");

  if (!jsonMode) banner();

  // Check .arch/ exists
  const archDir = findArchDir({ requireFile: "SYSTEM.md" });
  if (!archDir) {
    if (jsonMode) console.log(JSON.stringify({ error: { code: "NO_ARCH", message: "No .arch/ directory. Run archkit first." } }));
    else log.error("No .arch/ directory found. Run archkit or archkit init first.");
    process.exit(1);
  }

  // Get config info
  log.agent(`Fetching: ${slug}${version ? `@${version}` : ""}...`);
  const info = await getConfig(slug);

  if (info.error) {
    if (jsonMode) console.log(JSON.stringify(info));
    else log.error(info.error.message);
    process.exit(1);
  }

  log.agent(`${info.name} (${info.type}) by ${info.author} — v${info.latestVersion}`);

  // Download content
  log.agent("Downloading...");
  const download = await downloadConfig(slug, version);

  if (download.error) {
    if (jsonMode) console.log(JSON.stringify(download));
    else log.error(download.error.message);
    process.exit(1);
  }

  // Determine target path
  const targetDir = path.join(archDir, download.install.targetDir);
  const targetFile = path.join(targetDir, download.install.filename);
  fs.mkdirSync(targetDir, { recursive: true });

  // Merge or write
  let action = "created";
  if (fs.existsSync(targetFile)) {
    if (info.type === "skill") {
      // Merge: preserve user gotchas
      const existing = fs.readFileSync(targetFile, "utf8");
      const merged = mergeSkillContent(existing, download.version.content);
      fs.writeFileSync(targetFile, merged);
      action = "merged";
      log.ok(`Merged with existing (user gotchas preserved).`);
    } else {
      // Graph/preset: replace with backup
      const backupPath = targetFile + ".backup";
      fs.copyFileSync(targetFile, backupPath);
      fs.writeFileSync(targetFile, download.version.content);
      action = "replaced";
      log.warn(`Replaced (backup saved at ${path.basename(backupPath)}).`);
    }
  } else {
    fs.writeFileSync(targetFile, download.version.content);
    log.ok(`Created ${download.install.filename}`);
  }

  // Track installation
  const installedPath = path.join(archDir, "installed.json");
  let installed = [];
  try { installed = JSON.parse(fs.readFileSync(installedPath, "utf8")); } catch {}
  const existing = installed.findIndex(i => i.slug === slug);
  const entry = {
    slug,
    name: info.name,
    type: info.type,
    version: download.version.version,
    installedAt: new Date().toISOString(),
    file: path.relative(archDir, targetFile),
  };
  if (existing !== -1) installed[existing] = entry;
  else installed.push(entry);
  fs.writeFileSync(installedPath, JSON.stringify(installed, null, 2));

  if (jsonMode) {
    console.log(JSON.stringify({
      success: true,
      action,
      slug,
      version: download.version.version,
      file: path.relative(archDir, targetFile),
    }));
  } else {
    console.error("");
    log.ok(`Installed ${info.name} v${download.version.version} → .arch/${download.install.targetDir}/${download.install.filename}`);
    if (download.version.changelog) {
      console.error(`  ${download.version.changelog}`);
    }
    console.error("");
  }
}
