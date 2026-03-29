import { C, ICONS } from "./shared.mjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
const VERSION = pkg.version;

export function showBanner() {
  console.log("");
  console.log(`${C.cyan}${C.bold}      ┌─┐ ┬─┐ ┌─┐ ┬ ┬ ┬┌─ ┬ ┌┬┐${C.reset}`);
  console.log(`${C.cyan}${C.bold}      ├─┤ ├┬┘ │   ├─┤ ├┴┐ │  │ ${C.reset}`);
  console.log(`${C.cyan}${C.bold}      ┴ ┴ ┴└─ └─┘ ┴ ┴ ┴ ┴ ┴  ┴ ${C.reset}`);
  console.log("");
  console.log(`  ${C.dim}Context Engineering Scaffolder${C.reset}  ${C.gray}v${VERSION}${C.reset}`);
  console.log(`  ${C.gray}Generates .arch/ with SYSTEM.md, graphs, skills, APIs${C.reset}`);
  console.log("");
  console.log(`  ${C.dim}${"─".repeat(52)}${C.reset}`);
  console.log("");
}

export function commandBanner(name, description) {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${ICONS.arch} ${name}${C.reset}`);
  console.log(`${C.gray}  ${description}${C.reset}`);
  console.log("");
}
