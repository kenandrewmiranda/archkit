// Self-update archkit from GitHub.
// Detects installation method and updates accordingly.

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = "kenandrewmiranda/archkit";

function banner() {
  commandBanner("arch-update", "Update archkit to the latest version");
}

function getCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function getArchkitRoot() {
  return path.resolve(__dirname, "../..");
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function isNpmGlobalInstall() {
  try {
    const result = execFileSync("npm", ["ls", "-g", "archkit", "--json"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return result.includes("archkit");
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const checkOnly = args.includes("--check");

  if (!jsonMode) banner();

  const currentVersion = getCurrentVersion();
  const root = getArchkitRoot();

  log.agent(`Current version: ${currentVersion}`);
  log.agent(`Installation: ${root}`);

  // Check for latest version on GitHub
  let latestVersion = null;
  try {
    log.agent("Checking GitHub for latest version...");
    const result = execFileSync("gh", ["api", `repos/${REPO}/releases/latest`, "--jq", ".tag_name"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    latestVersion = result.replace(/^v/, "");
  } catch {
    // No releases — check latest commit
    try {
      const result = execFileSync("gh", ["api", `repos/${REPO}/commits/main`, "--jq", ".sha[:7]"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      latestVersion = `main@${result}`;
    } catch {
      log.warn("Could not check latest version. Is gh CLI installed?");
    }
  }

  if (latestVersion) log.agent(`Latest: ${latestVersion}`);

  if (checkOnly) {
    const result = { currentVersion, latestVersion, upToDate: currentVersion === latestVersion };
    if (jsonMode) console.log(JSON.stringify(result));
    else if (result.upToDate) log.ok("Already up to date.");
    else log.warn(`Update available: ${currentVersion} → ${latestVersion}`);
    return;
  }

  // Update based on installation method
  if (isGitRepo(root)) {
    // Git clone — pull latest
    log.agent("Updating via git pull...");
    try {
      execFileSync("git", ["-C", root, "pull", "--rebase", "origin", "main"], { stdio: "inherit" });
      log.agent("Installing dependencies...");
      execFileSync("npm", ["install", "--prefix", root], { stdio: "inherit" });
      const newVersion = getCurrentVersion();
      log.ok(`Updated: ${currentVersion} → ${newVersion}`);
    } catch (err) {
      log.error(`Git pull failed: ${err.message}`);
      log.agent("Try manually: cd " + root + " && git pull && npm install");
      process.exit(1);
    }
  } else if (isNpmGlobalInstall()) {
    // npm global — reinstall from GitHub
    log.agent("Updating via npm...");
    try {
      execFileSync("npm", ["install", "-g", `github:${REPO}`], { stdio: "inherit" });
      log.ok("Updated via npm install -g");
    } catch (err) {
      log.error(`npm update failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Unknown — give instructions
    log.warn("Could not determine installation method.");
    console.error("");
    console.error("  Update options:");
    console.error(`    git clone:   cd ${root} && git pull && npm install`);
    console.error(`    npm global:  npm install -g github:${REPO}`);
    console.error(`    npx:         npx github:${REPO}`);
    console.error("");
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main();
}
