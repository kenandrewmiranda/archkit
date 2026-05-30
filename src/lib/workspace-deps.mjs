import fs from "fs";
import path from "path";

// Read package.json dependencies as a single union across the repo root AND any
// workspace members, so dependency checks (e.g. drift's orphaned-skill) don't
// false-positive in pnpm/npm/yarn workspace monorepos — where runtime deps live
// in member package.jsons (apps/*, packages/*) rather than the repo root.

function readDeps(pkgPath) {
  try {
    const pj = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return { ...pj.dependencies, ...pj.devDependencies };
  } catch {
    return {};
  }
}

// Workspace package globs declared at the repo root, from either:
//   - pnpm-workspace.yaml → a `packages:` list of globs
//   - package.json        → a `workspaces` array, or `workspaces.packages` array
export function resolveWorkspaceGlobs(cwd) {
  const globs = [];

  // pnpm-workspace.yaml — only collect list items under the `packages:` key, so
  // an unrelated top-level list elsewhere in the file isn't mistaken for a glob.
  try {
    const ws = fs.readFileSync(path.join(cwd, "pnpm-workspace.yaml"), "utf8");
    let inPackages = false;
    for (const line of ws.split(/\r?\n/)) {
      if (/^\s*packages\s*:/.test(line)) { inPackages = true; continue; }
      // A new non-indented, non-list line ends the packages: block.
      if (inPackages && /^\S/.test(line) && !/^\s*-/.test(line)) inPackages = false;
      if (!inPackages) continue;
      const m = line.match(/^\s*-\s*(.+?)\s*$/);
      if (!m) continue;
      // strip a trailing inline comment, then surrounding quotes
      const g = m[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
      if (g) globs.push(g);
    }
  } catch { /* no pnpm workspace */ }

  // package.json workspaces (npm/yarn) — array form or { packages: [...] } form.
  try {
    const root = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const w = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages;
    if (Array.isArray(w)) globs.push(...w);
  } catch { /* no root manifest */ }

  return globs;
}

// Union the deps of every workspace member. Handles the common `apps/*` /
// `packages/*` (enumerate immediate child dirs) and direct `apps/api` forms.
// Non-recursive by design — nested or non-`/*` glob patterns aren't expanded;
// that covers the overwhelmingly common monorepo layout.
export function collectWorkspaceDeps(cwd) {
  let deps = {};
  const seen = new Set();

  const addPkg = (pkgPath) => {
    if (seen.has(pkgPath)) return;
    seen.add(pkgPath);
    deps = { ...deps, ...readDeps(pkgPath) };
  };

  for (const glob of resolveWorkspaceGlobs(cwd)) {
    if (glob.startsWith("!")) continue; // exclusion pattern — skip
    if (/\/\*+$/.test(glob)) {
      const base = path.join(cwd, glob.replace(/\/\*+$/, ""));
      let entries;
      try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isDirectory()) addPkg(path.join(base, e.name, "package.json"));
      }
    } else {
      addPkg(path.join(cwd, glob, "package.json"));
    }
  }

  return deps;
}

// The full dependency set: root manifest deps unioned with all workspace members.
export function collectDeps(cwd) {
  return {
    ...readDeps(path.join(cwd, "package.json")),
    ...collectWorkspaceDeps(cwd),
  };
}
