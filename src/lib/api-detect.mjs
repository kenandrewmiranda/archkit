// API-involvement detector. Given a single edited file (path + content), does a
// best-effort heuristic scan for signs the edit pulls in an external API, so a
// later PreToolUse gate can flag undeclared API usage.
//
// Three evidence classes:
//   'sdk-import'   — a bare-specifier import/require that is neither a relative
//                    path (./ ../) nor a node: builtin. Third-party SDKs
//                    (stripe, @aws-sdk/*, openai, …) are the usual shape.
//   'external-url' — a base-URL / fetch(host) literal whose host is NOT in the
//                    internalHosts allowlist (localhost, 127.0.0.1, …).
//   'declared'     — an api the goal already declared it will touch, passed in
//                    via declaredApis. Surfaced so the caller can reconcile
//                    detected-vs-declared without a second scan.
//
// Contract: PURE and NEVER THROWS. On unparseable / binary-ish / empty content
// it returns whatever it found so far (or []) rather than erroring. This lib is
// self-contained — it does NOT read config. The internalHosts allowlist is an
// arg (a sane default set is used when omitted); the api-registry config reader
// is wired in by a later lane.

// Hosts that are always "internal" — never flagged as external-url. Matches the
// default apiGate.internalHosts the config reader will ship with.
const DEFAULT_INTERNAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];

// node: builtins that may be imported bare (without the node: prefix). Importing
// one of these is not an external-API signal.
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

function isBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  // strip subpath (e.g. "fs/promises" -> "fs")
  const root = spec.split("/")[0];
  return NODE_BUILTINS.has(root);
}

function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

// Normalize an internalHosts entry / a parsed host for comparison. Lowercase and
// strip any surrounding brackets from IPv6 literals ([::1] -> ::1).
function normHost(h) {
  if (typeof h !== "string") return "";
  return h.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

// Pull the host out of a URL-ish string. Returns "" if it can't (relative path,
// junk, etc.). Uses the URL parser when there's a scheme; otherwise treats a
// leading authority (host[:port]) heuristically.
function hostFromUrl(raw) {
  const s = String(raw).trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      return normHost(new URL(s).hostname);
    }
  } catch {
    // fall through to heuristic
  }
  // protocol-relative //host/... or bare host/path
  const m = s.match(/^\/\/([^/?#]+)/) || s.match(/^([a-z0-9.-]+(?::\d+)?)(?:[/?#]|$)/i);
  if (m) {
    const authority = m[1];
    // strip userinfo and port
    const hostPort = authority.split("@").pop();
    const host = hostPort.replace(/:\d+$/, "");
    // require a dotted host or a known-hosty token — avoids matching random words
    if (/\./.test(host) || normHost(host) === "localhost") return normHost(host);
  }
  return "";
}

export function detectApis({ filePath, content, declaredApis, internalHosts } = {}) {
  const out = [];
  const seen = new Set(); // dedup key: `${evidence} ${api}`

  const push = (api, evidence) => {
    if (!api || typeof api !== "string") return;
    const key = `${evidence} ${api}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ api, evidence });
  };

  // 1. declared apis — surfaced verbatim, order-preserving, before scan results.
  try {
    if (Array.isArray(declaredApis)) {
      for (const d of declaredApis) {
        if (typeof d === "string" && d.trim()) push(d.trim(), "declared");
      }
    }
  } catch {
    /* never throw */
  }

  // Everything below is heuristic scanning of content — wrap defensively.
  try {
    const text = typeof content === "string" ? content : "";
    if (!text) return out;

    const allow = new Set(
      (Array.isArray(internalHosts) && internalHosts.length
        ? internalHosts
        : DEFAULT_INTERNAL_HOSTS
      ).map(normHost)
    );

    const isJsLike = !filePath || /\.(m?[jt]sx?|cjs)$/i.test(String(filePath));

    // --- sdk-import: bare, non-relative, non-builtin specifiers ---
    if (isJsLike) {
      const importFromRe = /\bimport\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g;
      const importCallRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
      const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
      for (const re of [importFromRe, importCallRe, requireRe]) {
        let m;
        while ((m = re.exec(text)) !== null) {
          const spec = m[1];
          if (!spec || isRelative(spec) || isBuiltin(spec)) continue;
          // scoped pkg -> keep @scope/name; plain pkg -> first path segment
          const api = spec.startsWith("@")
            ? spec.split("/").slice(0, 2).join("/")
            : spec.split("/")[0];
          push(api, "sdk-import");
        }
      }
    }

    // --- external-url: any URL/host literal whose host is not internal ---
    // Full URLs with a scheme.
    const urlRe = /["'`]([a-z][a-z0-9+.-]*:\/\/[^"'`\s]+)["'`]/gi;
    let m;
    while ((m = urlRe.exec(text)) !== null) {
      const host = hostFromUrl(m[1]);
      if (host && !allow.has(host)) push(host, "external-url");
    }
    // fetch("host/...") / fetch(`//host`) with a bare (schemeless) authority.
    const fetchRe = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/gi;
    while ((m = fetchRe.exec(text)) !== null) {
      const host = hostFromUrl(m[1]);
      if (host && !allow.has(host)) push(host, "external-url");
    }
  } catch {
    /* best-effort — return whatever we gathered */
  }

  return out;
}

export default detectApis;
