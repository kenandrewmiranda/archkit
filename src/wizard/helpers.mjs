import { C, ICONS } from "../lib/shared.mjs";

function heading(icon, text) {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${icon} ${text}${C.reset}`);
  console.log("");
}

function subheading(text) {
  console.log(`${C.blue}${C.bold}  ${text}${C.reset}`);
}

function info(text) {
  console.log(`${C.gray}  ${text}${C.reset}`);
}

function success(text) {
  console.log(`${C.green}  ${ICONS.check} ${text}${C.reset}`);
}

function warn(text) {
  console.log(`${C.yellow}  ${ICONS.warn} ${text}${C.reset}`);
}

function tip(text) {
  console.log(`${C.dim}${C.italic}  ${ICONS.light} ${text}${C.reset}`);
}

function bullet(text, indent = 2) {
  console.log(`${" ".repeat(indent)}${C.gray}${ICONS.dot}${C.reset} ${text}`);
}

function tree(label, isLast = false) {
  const prefix = isLast ? ICONS.corner : ICONS.tee;
  console.log(`${C.gray}    ${prefix}── ${C.reset}${label}`);
}

function filePreview(filepath, content) {
  const allLines = content.split("\n");
  const preview = allLines.slice(0, 8);
  console.log(`${C.gray}  ${ICONS.file} ${C.reset}${C.bold}${filepath}${C.reset} ${C.dim}(${content.length} bytes)${C.reset}`);
  for (const line of preview) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}${line.substring(0, 60)}${C.reset}`);
  }
  if (allLines.length > 8) {
    console.log(`${C.gray}    ${ICONS.pipe} ${C.dim}... (${allLines.length - 8} more lines)${C.reset}`);
  }
  console.log("");
}

function progressStep(step, total, label) {
  const bar = "█".repeat(step) + "░".repeat(total - step);
  console.log(`${C.cyan}  [${bar}] ${step}/${total} ${C.reset}${label}`);
}

export { heading, subheading, info, success, warn, tip, bullet, tree, filePreview, progressStep };
