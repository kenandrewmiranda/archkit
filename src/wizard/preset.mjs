import fs from "fs";
import path from "path";
import { C, ICONS } from "../lib/shared.mjs";
import { APP_TYPES } from "../data/app-types.mjs";
import { success, info, warn } from "./helpers.mjs";

/**
 * Load and validate a preset JSON file.
 * Returns the parsed preset or null on failure.
 */
export function loadPreset(filePath) {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    warn(`Preset file not found: ${resolved}`);
    return null;
  }

  let preset;
  try {
    preset = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    warn(`Failed to parse preset: ${err.message}`);
    return null;
  }

  // Validate appType if provided
  if (preset.appType && !APP_TYPES[preset.appType]) {
    const valid = Object.keys(APP_TYPES).join(", ");
    warn(`Invalid appType "${preset.appType}" in preset. Valid types: ${valid}`);
    return null;
  }

  // Normalize features: accept both full objects and shorthand strings
  if (preset.features) {
    preset.features = preset.features.map(f => {
      if (typeof f === "string") {
        return { id: f, name: f.charAt(0).toUpperCase() + f.slice(1) + " management", keywords: f };
      }
      return f;
    });
  }

  // Normalize crossRefs: "ai" string is valid, otherwise default to empty array
  if (preset.features && !preset.crossRefs) {
    preset.crossRefs = [];
  }
  // Keep "ai" as-is; only validate array entries

  // Apply --claude flag if present in CLI
  if (process.argv.includes("--claude")) {
    preset.claudeMode = true;
  }

  return preset;
}

/**
 * Scan for preset JSON files in known locations.
 * Returns array of { name, path } objects.
 */
export function findPresets() {
  const presets = [];
  const searchDirs = [
    path.resolve("presets"),                           // ./presets/ in cwd
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../presets"), // archkit/presets/
  ];

  const seen = new Set();
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (seen.has(file)) continue;
        seen.add(file);

        // Quick-validate: must have appName or appType
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
          if (data.appName || data.appType) {
            presets.push({ name: file.replace(".json", ""), path: fullPath });
          }
        } catch { /* skip invalid JSON */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return presets;
}
