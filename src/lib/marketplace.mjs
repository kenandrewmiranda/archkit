// Marketplace API client for arch-market.
// Handles auth, requests, and error mapping.

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import * as log from "./logger.mjs";

const DEFAULT_BASE_URL = "https://market.thearchkit.com/api/cli";
const CREDENTIALS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".archkit");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials");

export function getBaseUrl() {
  return process.env.ARCHKIT_MARKET_URL || DEFAULT_BASE_URL;
}

export function getApiKey() {
  try {
    return fs.readFileSync(CREDENTIALS_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

export function saveApiKey(key) {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, key, { mode: 0o600 });
}

export function removeApiKey() {
  try { fs.unlinkSync(CREDENTIALS_FILE); } catch {}
}

export async function apiRequest(method, endpoint, params = {}) {
  const key = getApiKey();
  if (!key) {
    return { error: { code: "NO_API_KEY", message: "Not logged in. Run: archkit login" } };
  }

  // Concatenate base + endpoint (new URL() would strip the /api/cli prefix)
  const url = new URL(getBaseUrl() + endpoint);
  if (method === "GET" && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  try {
    // Use Node's built-in fetch (available in Node 18+)
    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "archkit-cli/1.1.0",
      },
      signal: AbortSignal.timeout(15000),
    };

    const res = await fetch(url.toString(), options);
    const body = await res.json();

    if (!res.ok) {
      return { error: body.error || { code: `HTTP_${res.status}`, message: res.statusText } };
    }

    return body;
  } catch (err) {
    if (err.name === "TimeoutError") {
      return { error: { code: "TIMEOUT", message: "Request timed out (15s)" } };
    }
    return { error: { code: "NETWORK_ERROR", message: err.message } };
  }
}

// Convenience methods
export const search = (q, type, page, limit) => apiRequest("GET", "/search", { q, type, page, limit });
export const getConfig = (slug) => apiRequest("GET", `/configs/${slug}`);
export const downloadConfig = (slug, version) => apiRequest("POST", `/configs/${slug}/download`, { version });
