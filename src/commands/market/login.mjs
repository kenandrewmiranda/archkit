import * as log from "../../lib/logger.mjs";
import { saveApiKey, getApiKey, removeApiKey, search } from "../../lib/marketplace.mjs";
import { commandBanner } from "../../lib/banner.mjs";

function banner() {
  commandBanner("arch-market", "Login to the archkit marketplace");
}

export async function cmdLogin(args) {
  const jsonMode = args.includes("--json");
  if (!jsonMode) banner();

  // Check if already logged in
  const existing = getApiKey();
  if (existing && !args.includes("--force")) {
    if (jsonMode) {
      console.log(JSON.stringify({ status: "already_logged_in", hint: "Use --force to re-login" }));
    } else {
      log.ok("Already logged in. Use --force to re-login.");
    }
    return;
  }

  // Get API key from args or env
  const key = args.find(a => a.startsWith("am_sk_")) || process.env.ARCHKIT_API_KEY;
  if (!key) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: { code: "NO_KEY", message: "Usage: archkit login am_sk_<your-key>" } }));
    } else {
      log.error("Usage: archkit login am_sk_<your-key>");
      console.error("  Get your API key at: https://market.thearchkit.com/dashboard/settings");
    }
    process.exit(1);
  }

  if (!key.startsWith("am_sk_")) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: { code: "INVALID_KEY", message: "API key must start with am_sk_" } }));
    } else {
      log.error("Invalid API key format. Must start with am_sk_");
    }
    process.exit(1);
  }

  // Validate key by making a test request
  log.agent("Validating API key...");
  saveApiKey(key);
  const result = await search("test");

  if (result.error) {
    removeApiKey();
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      log.error(`Login failed: ${result.error.message}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify({ status: "logged_in" }));
  } else {
    log.ok("Logged in to archkit marketplace.");
  }
}

export async function cmdLogout(args) {
  removeApiKey();
  const jsonMode = args.includes("--json");
  if (jsonMode) {
    console.log(JSON.stringify({ status: "logged_out" }));
  } else {
    log.ok("Logged out.");
  }
}
