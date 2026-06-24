// src/mcp/resources.mjs
// MCP resources — expose .arch/ artifacts as @archkit:… handles so the agent
// can reference them (e.g. @archkit:archkit://system) without a tool
// round-trip. Tools return computed/analyzed views; resources hand back the
// raw source files, which is cheaper for repeated reads in long sessions.
//
// Static:    archkit://system, archkit://index, archkit://boundaries
// Templated: archkit://playbook/{id} (alias archkit://skill/{id}), archkit://decision/{number}
//
// archDir is resolved at read time from the server's cwd (the project Claude
// Code launched it in); resources degrade gracefully when there's no .arch/.

import fs from "node:fs";
import path from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findArchDir } from "../lib/shared.mjs";
import { listDecisions } from "../lib/decisions.mjs";
import { listPlaybooks, resolvePlaybookPath } from "../lib/playbooks.mjs";

function archDir() {
  return findArchDir({ requireFile: "SYSTEM.md" });
}

function fileContent(uriHref, filePath, mimeType = "text/markdown") {
  if (!filePath || !fs.existsSync(filePath)) {
    return { contents: [{ uri: uriHref, mimeType: "text/plain", text: filePath ? `Not found: ${filePath}` : "No .arch/ project found from the server's working directory." }] };
  }
  return { contents: [{ uri: uriHref, mimeType, text: fs.readFileSync(filePath, "utf8") }] };
}

const STATIC = [
  { name: "archkit-system", uri: "archkit://system", file: "SYSTEM.md", title: "archkit SYSTEM.md", description: "Project architecture spec — type, stack, pattern, rules, reserved words, naming." },
  { name: "archkit-index", uri: "archkit://index", file: "INDEX.md", title: "archkit INDEX.md", description: "Node→cluster map with base paths and keyword routing." },
  { name: "archkit-boundaries", uri: "archkit://boundaries", file: "BOUNDARIES.md", title: "archkit BOUNDARIES.md", description: "NEVER rules + machine-enforceable BAN directives." },
];

export function registerResources(server) {
  for (const r of STATIC) {
    server.registerResource(
      r.name,
      r.uri,
      { title: r.title, description: r.description, mimeType: "text/markdown" },
      async (uri) => {
        const dir = archDir();
        return fileContent(uri.href, dir ? path.join(dir, r.file) : null);
      }
    );
  }

  // Playbooks (formerly "skills", ADR 0016): archkit://playbook/{id}
  // The reader resolves the canonical .arch/playbooks/<id>.playbook AND the
  // legacy .arch/skills/<id>.skill, so both layouts surface here.
  server.registerResource(
    "archkit-playbook",
    new ResourceTemplate("archkit://playbook/{id}", {
      list: async () => ({
        resources: listPlaybooks(archDir()).map((u) => ({
          name: `archkit-playbook-${u.id}`,
          uri: `archkit://playbook/${u.id}`,
          title: `playbook: ${u.id}`,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "archkit playbook", description: "A .arch/playbooks/<id>.playbook file (legacy .arch/skills/<id>.skill) — WRONG/RIGHT/WHY gotchas and patterns for a package or area." },
    async (uri, vars) => {
      const id = Array.isArray(vars.id) ? vars.id[0] : vars.id;
      return fileContent(uri.href, resolvePlaybookPath(archDir(), id));
    }
  );

  // Back-compat alias: archkit://skill/{id} → resolves the same units, so
  // existing references keep working after the playbook rename.
  server.registerResource(
    "archkit-skill",
    new ResourceTemplate("archkit://skill/{id}", {
      list: async () => ({
        resources: listPlaybooks(archDir()).map((u) => ({
          name: `archkit-skill-${u.id}`,
          uri: `archkit://skill/${u.id}`,
          title: `skill: ${u.id}`,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "archkit skill (alias)", description: "Deprecated alias for archkit://playbook/<id> — kept for back-compat. Prefer archkit://playbook/<id>." },
    async (uri, vars) => {
      const id = Array.isArray(vars.id) ? vars.id[0] : vars.id;
      return fileContent(uri.href, resolvePlaybookPath(archDir(), id));
    }
  );

  // Decisions: archkit://decision/{number}
  server.registerResource(
    "archkit-decision",
    new ResourceTemplate("archkit://decision/{number}", {
      list: async () => {
        const dir = archDir();
        if (!dir) return { resources: [] };
        return {
          resources: listDecisions(dir).map((d) => ({
            name: `archkit-decision-${d.number}`,
            uri: `archkit://decision/${d.number}`,
            title: `ADR ${d.number}: ${d.title}`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { title: "archkit ADR", description: "An architectural decision record (.arch/decisions/) by its number." },
    async (uri, vars) => {
      const dir = archDir();
      const raw = Array.isArray(vars.number) ? vars.number[0] : vars.number;
      let file = null;
      if (dir) {
        const want = parseInt(raw, 10);
        const d = listDecisions(dir).find((x) => parseInt(x.number, 10) === want || x.number === raw);
        file = d ? d.filepath : null;
      }
      return fileContent(uri.href, file);
    }
  );
}
