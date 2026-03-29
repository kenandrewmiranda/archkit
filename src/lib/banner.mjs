import { C } from "./shared.mjs";

const VERSION = "1.0.0";

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
