#!/usr/bin/env node

import { commandBanner } from "../lib/banner.mjs";
import * as log from "../lib/logger.mjs";
import { getApiKey } from "../lib/marketplace.mjs";

function banner() {
  commandBanner("arch-market", "archkit marketplace — search, install, share configs");
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    banner();
    console.error(`  Commands:`);
    console.error(`    login <am_sk_...>        Authenticate with marketplace`);
    console.error(`    logout                   Remove stored credentials`);
    console.error(`    search <query>           Search for configs`);
    console.error(`    info <slug>              Config details + versions`);
    console.error(`    install <slug>[@version] Install config into .arch/`);
    console.error("");
    console.error(`  Flags:`);
    console.error(`    --json                   Machine-readable output`);
    console.error(`    --type skill|graph|preset Filter search results`);
    console.error("");
    console.error(`  Get your API key at: https://market.thearchkit.com/dashboard/settings`);
    const key = getApiKey();
    if (key) console.error(`  Status: logged in`);
    else console.error(`  Status: not logged in`);
    console.error("");
    return;
  }

  const subArgs = args.slice(1);

  switch (cmd) {
    case "login": {
      const { cmdLogin } = await import("./market/login.mjs");
      await cmdLogin(subArgs);
      break;
    }
    case "logout": {
      const { cmdLogout } = await import("./market/login.mjs");
      await cmdLogout(subArgs);
      break;
    }
    case "search": {
      const { cmdSearch } = await import("./market/search.mjs");
      await cmdSearch(subArgs);
      break;
    }
    case "info": {
      const slug = subArgs.find(a => !a.startsWith("-"));
      if (!slug) { log.error("Usage: archkit market info <slug>"); process.exit(1); }
      const { getConfig } = await import("../lib/marketplace.mjs");
      const jsonMode = subArgs.includes("--json");
      log.agent(`Fetching: ${slug}...`);
      const result = await getConfig(slug);
      if (result.error) { log.error(result.error.message); process.exit(1); }
      if (jsonMode) { console.log(JSON.stringify(result)); return; }
      console.error("");
      console.error(`  ${result.name} (${result.type})`);
      console.error(`  by ${result.author} | ${result.downloads} downloads | ${result.avgRating ? result.avgRating.toFixed(1) + " rating" : "no ratings"}`);
      console.error(`  ${result.description}`);
      console.error(`  License: ${result.license || "—"}`);
      console.error(`  Latest: v${result.latestVersion}`);
      console.error(`  Versions: ${(result.versions || []).join(", ")}`);
      console.error(`  Tags: ${(result.tags || []).join(", ")}`);
      console.error("");
      console.error(`  Install: archkit install ${result.slug}`);
      console.error("");
      break;
    }
    case "install": {
      const { cmdInstall } = await import("./market/install.mjs");
      await cmdInstall(subArgs);
      break;
    }
    default:
      banner();
      log.error(`Unknown command: ${cmd}`);
      console.error(`  Run: archkit market --help`);
      console.error("");
  }
}

export { main };

if (import.meta.url === `file://${process.argv[1]}` || process.env.ARCHKIT_RUN) {
  main().catch(err => {
    console.error(`\x1b[31m  Error: ${err.message}\x1b[0m`);
    process.exit(1);
  });
}
