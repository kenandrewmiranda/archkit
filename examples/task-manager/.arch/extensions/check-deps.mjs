#!/usr/bin/env node

/**
 * arch-ext: check-deps
 * Check if any .skill or .api files are outdated vs installed package versions
 *
 * Category: maintenance
 * Trigger: After running npm update, or periodically to catch stale skills
 * Created: 2026-04-03
 *
 * Usage:
 *   archkit extend run check-deps [args...]
 */

export const meta = {
  name: "check-deps",
  description: "Check if any .skill or .api files are outdated vs installed package versions",
  category: "maintenance",
  trigger: "After running npm update, or periodically to catch stale skills",
  args: [],
  created: "2026-04-03",
  version: "1.0.0",
};

export async function run(args, context) {
  // context contains:
  //   context.archDir   - path to .arch/ directory
  //   context.cwd       - current working directory
  //   context.args      - parsed arguments
  //   context.system    - SYSTEM.md content
  //   context.index     - INDEX.md content

  const fs = await import("fs");
  const path = await import("path");

  // Read package.json
  const pkgJsonPath = path.join(context.cwd, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    console.log("  ⚠ No package.json found in current directory.");
    return;
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };

  // Read all skill files and extract Meta pkg line
  const skillsDir = path.join(context.archDir, "skills");
  if (!fs.existsSync(skillsDir)) return;

  const skills = fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"));

  console.log(`  Checking ${skills.length} skills against ${Object.keys(allDeps).length} installed packages...\n`);

  let staleCount = 0;
  let matchCount = 0;
  let unknownCount = 0;

  for (const file of skills) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const pkgMatch = content.match(/^pkg:\s*(.+)$/m);
    const updatedMatch = content.match(/^updated:\s*(.+)$/m);

    const skillName = file.replace(".skill", "");

    if (!pkgMatch || pkgMatch[1].includes("[")) {
      console.log(`  ○ ${skillName.padEnd(18)} — not configured (meta has placeholders)`);
      unknownCount++;
      continue;
    }

    const skillPkg = pkgMatch[1].trim();
    const updated = updatedMatch ? updatedMatch[1].trim() : "unknown";

    // Check age
    if (updated !== "unknown" && !updated.includes("[")) {
      const updatedDate = new Date(updated);
      const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 90) {
        console.log(`  ⚠ ${skillName.padEnd(18)} — last updated ${daysSince} days ago (pkg: ${skillPkg})`);
        staleCount++;
        continue;
      }
    }

    console.log(`  ✓ ${skillName.padEnd(18)} — ${skillPkg} (updated: ${updated})`);
    matchCount++;
  }

  console.log(`\n  Summary: ${matchCount} current | ${staleCount} stale | ${unknownCount} unconfigured`);
  if (staleCount > 0) {
    console.log(`\n  Stale skills may have outdated gotchas. Review and update the pkg: and updated: fields.`);
  }
}
