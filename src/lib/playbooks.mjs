// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOKS — package-knowledge units (WRONG/RIGHT/WHY gotchas + patterns)
// ═══════════════════════════════════════════════════════════════════════════
//
// Formerly "skills". Renamed to "playbook" (ADR 0016) because archkit's
// `.arch/skills/` namespace-collided with Claude Code's first-class Agent
// Skills (`.claude/skills/`, SKILL.md). The collision was a *filesystem +
// vocabulary* clash, so the canonical surface is now:
//
//     .arch/playbooks/<id>.playbook
//
// BACK-COMPAT: existing projects store units as `.arch/skills/<id>.skill`.
// Every reader MUST keep seeing those. This module is the single place that
// resolves both layouts — `.playbook` is preferred, legacy `.skill` is a
// transparent alias (a same-id `.playbook` shadows a legacy `.skill`). Run
// `archkit migrate` to consolidate a project onto the new layout.
//
// NOTE: `.claude/skills/` (native Claude Agent Skills) is a DIFFERENT concept
// and is never touched by this module.

import fs from "fs";
import path from "path";

export const PLAYBOOK_DIR = "playbooks";
export const PLAYBOOK_EXT = ".playbook";
export const LEGACY_DIR = "skills";
export const LEGACY_EXT = ".skill";

// (dir, ext) pairs a project may store units under — new layout first so it
// wins on id collisions during a partial migration.
const LAYOUTS = [
  { dir: PLAYBOOK_DIR, ext: PLAYBOOK_EXT },
  { dir: LEGACY_DIR, ext: LEGACY_EXT },
];

/** True if the project still uses the legacy skills/ layout and has no playbooks/ yet. */
export function usesLegacyLayout(archDir) {
  return (
    fs.existsSync(path.join(archDir, LEGACY_DIR)) &&
    !fs.existsSync(path.join(archDir, PLAYBOOK_DIR))
  );
}

/** True if the project has either a playbooks/ or a legacy skills/ directory. */
export function hasPlaybookDir(archDir) {
  return (
    fs.existsSync(path.join(archDir, PLAYBOOK_DIR)) ||
    fs.existsSync(path.join(archDir, LEGACY_DIR))
  );
}

/**
 * Directory new units should be WRITTEN to. Legacy projects keep writing to
 * skills/ (so a project's units stay in one place) until `archkit migrate`
 * consolidates them; everything else writes to the canonical playbooks/.
 * @returns {string} absolute path to the write directory (not guaranteed to exist yet)
 */
export function playbookWriteDir(archDir) {
  return usesLegacyLayout(archDir)
    ? path.join(archDir, LEGACY_DIR)
    : path.join(archDir, PLAYBOOK_DIR);
}

/** Extension that pairs with playbookWriteDir() for this project. */
export function playbookWriteExt(archDir) {
  return usesLegacyLayout(archDir) ? LEGACY_EXT : PLAYBOOK_EXT;
}

/**
 * List every playbook unit across both layouts, new-first, de-duped by id.
 * @returns {Array<{id:string, dir:string, ext:string, file:string, path:string, legacy:boolean}>}
 */
export function listPlaybooks(archDir) {
  if (!archDir) return [];
  const seen = new Set();
  const out = [];
  for (const { dir, ext } of LAYOUTS) {
    const full = path.join(archDir, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith(ext)).sort()) {
      const id = file.slice(0, -ext.length);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, dir, ext, file, path: path.join(full, file), legacy: ext === LEGACY_EXT });
    }
  }
  return out;
}

/** Just the unit ids (new-first, de-duped). */
export function listPlaybookIds(archDir) {
  return listPlaybooks(archDir).map((u) => u.id);
}

/** Resolve a single unit's absolute file path by id (.playbook preferred), or null. */
export function resolvePlaybookPath(archDir, id) {
  if (!archDir) return null;
  for (const { dir, ext } of LAYOUTS) {
    const p = path.join(archDir, dir, `${id}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The spec-relative path (e.g. ".arch/playbooks/foo.playbook") used in
 * required-reading hints and human output. Falls back to the canonical
 * playbooks/.playbook form when the unit doesn't exist on disk yet.
 */
export function playbookSpecPath(archDir, id) {
  const abs = archDir && resolvePlaybookPath(archDir, id);
  if (abs) {
    const layout = LAYOUTS.find((l) => abs.endsWith(`${l.ext}`) && abs.includes(`${path.sep}${l.dir}${path.sep}`));
    const dir = layout ? layout.dir : PLAYBOOK_DIR;
    const ext = layout ? layout.ext : PLAYBOOK_EXT;
    return `.arch/${dir}/${id}${ext}`;
  }
  return `.arch/${PLAYBOOK_DIR}/${id}${PLAYBOOK_EXT}`;
}

/** Read a unit's content by id (.playbook preferred, legacy .skill fallback), or null. */
export function readPlaybook(archDir, id) {
  const p = resolvePlaybookPath(archDir, id);
  return p ? fs.readFileSync(p, "utf8") : null;
}
