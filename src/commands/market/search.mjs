import * as log from "../../lib/logger.mjs";
import { search } from "../../lib/marketplace.mjs";
import { commandBanner } from "../../lib/banner.mjs";
import { C } from "../../lib/shared.mjs";

function banner() {
  commandBanner("arch-market", "Search the archkit marketplace");
}

export async function cmdSearch(args) {
  const jsonMode = args.includes("--json");
  const typeFlag = args.indexOf("--type");
  const type = typeFlag !== -1 ? args[typeFlag + 1] : undefined;
  const query = args.filter(a => !a.startsWith("-") && a !== type).join(" ");

  if (!query) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: { code: "MISSING_QUERY", message: "Usage: archkit search <query>" } }));
    } else {
      banner();
      log.error("Usage: archkit search <query> [--type skill|graph|preset]");
    }
    process.exit(1);
  }

  if (!jsonMode) banner();
  log.agent(`Searching: "${query}"${type ? ` (type: ${type})` : ""}...`);

  const result = await search(query, type);

  if (result.error) {
    if (jsonMode) console.log(JSON.stringify(result));
    else log.error(result.error.message);
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(result));
    return;
  }

  if (result.results.length === 0) {
    log.warn(`No results for "${query}".`);
    return;
  }

  console.log("");
  console.log(`  ${C.bold}${result.total} result${result.total !== 1 ? "s" : ""}${C.reset}`);
  console.log("");
  console.log(`  ${C.gray}${"Name".padEnd(30)} ${"Type".padEnd(8)} ${"Downloads".padEnd(10)} ${"Rating".padEnd(7)} Tags${C.reset}`);
  console.log(`  ${C.gray}${"─".repeat(75)}${C.reset}`);

  for (const r of result.results) {
    const rating = r.avgRating ? `${r.avgRating.toFixed(1)}` : "—";
    const tags = (r.tags || []).slice(0, 3).join(", ");
    console.log(`  ${C.bold}${r.name.padEnd(30)}${C.reset} ${r.type.padEnd(8)} ${String(r.downloads).padEnd(10)} ${rating.padEnd(7)} ${C.dim}${tags}${C.reset}`);
  }
  console.log("");
  console.log(`  ${C.dim}Install: archkit install <slug>${C.reset}`);
  console.log("");
}
