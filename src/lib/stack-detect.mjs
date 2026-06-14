// Detects whether a wizard config's stack includes JS/TS code.
// Used to gate verify-wiring guidance — arch-poly dogfood (Python-only)
// reported that mandating `archkit resolve verify-wiring src/` in CLAUDE.md
// produces dead-weight output on non-JS projects.
//
// Heuristic: any stack value mentioning a JS/TS framework or runtime.
// False positives (keep the verify-wiring line on a borderline-JS project)
// are cheaper than false negatives (drop it when JS code is present).

const JS_TS_SIGNALS = [
  "next.js", "nextjs", "next ",
  "react", "vue", "svelte", "nuxt", "astro", "remix",
  "hono", "express", "fastify", "nestjs", "nest.js",
  "node.js", "nodejs", "node ",
  "typescript", "javascript",
  "tanstack", "tailwind", "shadcn",
  "bullmq", "watermelondb",
  "react native", "react-native",
  "echarts",
];

// Archetypes whose scaffolded project is NOT a JS/TS codebase, regardless of
// what backend stack is chosen. The native iOS app is Swift even when its API
// is Hono/FastAPI, so `archkit resolve verify-wiring src/` (which scans JS/TS)
// is always dead weight here — strip it unconditionally.
const NON_JS_ARCHETYPES = new Set(["ios-swift"]);

export function hasJsTsStack(cfg) {
  if (cfg?.appType && NON_JS_ARCHETYPES.has(cfg.appType)) return false;
  if (!cfg?.stack || typeof cfg.stack !== "object") return true;
  const values = Object.values(cfg.stack);
  return values.some(
    (v) =>
      typeof v === "string" &&
      JS_TS_SIGNALS.some((sig) => v.toLowerCase().includes(sig))
  );
}

// For runtime detection (no cfg available, e.g. in warmup): check a directory
// for JS/TS source files.
export async function dirHasJsTsFiles(dir, fs) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && /\.(ts|tsx|js|mjs|cjs|jsx)$/.test(e.name)) return true;
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        if (await dirHasJsTsFiles(`${dir}/${e.name}`, fs)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
