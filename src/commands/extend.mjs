#!/usr/bin/env node

/**
 * arch-extend — Create, manage, and discover CLI extensions
 * 
 * The AI (or you) builds new CLI commands when a pattern is worth automating.
 * Extensions live in .arch/extensions/ and are discoverable by both humans and AI.
 * 
 * Usage:
 *   node extend.mjs create            Interactive extension builder
 *   node extend.mjs list              List all extensions with descriptions
 *   node extend.mjs run <name> [args] Run an extension
 *   node extend.mjs describe <name>   Show full extension details
 *   node extend.mjs remove <name>     Remove an extension
 *   node extend.mjs registry          Output the registry for AI context injection
 */

import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { C, ICONS as I, findArchDir as _findArchDir, divider } from "../lib/shared.mjs";

function banner() {
  console.log("");
  console.log(`${C.cyan}${C.bold}  ${I.arch} arch-extend${C.reset}`);
  console.log(`${C.gray}  Self-evolving CLI extension system${C.reset}`);
  console.log(`${C.gray}  Build new commands when patterns are worth automating${C.reset}`);
  console.log("");
}

function findArchDir() {
  return _findArchDir();
}

function ensureExtDir(archDir) {
  const extDir = path.join(archDir, "extensions");
  fs.mkdirSync(extDir, { recursive: true });
  return extDir;
}

function loadRegistry(archDir) {
  const regPath = path.join(archDir, "extensions", "registry.json");
  if (!fs.existsSync(regPath)) return [];
  try { return JSON.parse(fs.readFileSync(regPath, "utf8")); } catch { return []; }
}

function saveRegistry(archDir, registry) {
  const regPath = path.join(archDir, "extensions", "registry.json");
  fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION TEMPLATE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateExtension(meta) {
  const { name, description, trigger, category, args: extArgs, body } = meta;

  return `#!/usr/bin/env node

/**
 * arch-ext: ${name}
 * ${description}
 * 
 * Category: ${category}
 * Trigger: ${trigger}
 * Created: ${new Date().toISOString().split("T")[0]}
 * 
 * Usage:
 *   node extend.mjs run ${name} [args...]
 */

export const meta = {
  name: "${name}",
  description: "${description}",
  category: "${category}",
  trigger: "${trigger}",
  args: ${JSON.stringify(extArgs, null, 4)},
  created: "${new Date().toISOString().split("T")[0]}",
  version: "1.0.0",
};

export async function run(args, context) {
  // context contains:
  //   context.archDir   - path to .arch/ directory
  //   context.cwd       - current working directory
  //   context.args      - parsed arguments
  //   context.system    - SYSTEM.md content
  //   context.index     - INDEX.md content

${body}
}
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESET EXTENSION TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const PRESETS = {
  "convert-openapi": {
    name: "convert-openapi",
    description: "Convert an OpenAPI/Swagger spec to the .api digest format",
    trigger: "When you need to generate or update a .api file from an OpenAPI spec",
    category: "api",
    args: [
      { name: "input", description: "Path to OpenAPI JSON/YAML file", required: true },
      { name: "output", description: "Output .api file path", required: false },
    ],
    body: `  const fs = await import("fs");
  const inputPath = args[0];
  if (!inputPath) { console.log("Usage: run convert-openapi <openapi.json>"); return; }
  
  const spec = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const info = spec.info || {};
  const base = (spec.servers || [{}])[0].url || "[BASE_URL]";
  
  let output = \`# \${info.title || "API"}.api\\n\`;
  output += \`# v\${info.version || "[VERSION]"} | base: \${base} | auth: [AUTH_METHOD]\\n\`;
  output += \`# generated: \${new Date().toISOString().split("T")[0]} | source: openapi\\n\\n\`;
  
  // Extract types from schemas
  output += "## Types\\n";
  const schemas = spec.components?.schemas || spec.definitions || {};
  for (const [name, schema] of Object.entries(schemas).slice(0, 20)) {
    if (schema.type === "object" && schema.properties) {
      const fields = Object.entries(schema.properties).map(([k, v]) => {
        const required = (schema.required || []).includes(k);
        const type = v.type === "integer" ? "int" : v.type === "string" ? "str" : v.type === "boolean" ? "bool" : v.type || "obj";
        return required ? \`\${k}: \${type}\` : \`\${k}?: \${type}\`;
      });
      output += \`\${name} = { \${fields.join(", ")} }\\n\`;
    }
  }
  
  // Extract endpoints
  output += "\\n## Endpoints\\n";
  for (const [pathStr, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (["get","post","put","patch","delete"].includes(method)) {
        const params = (op.parameters || [])
          .filter(p => p.in === "query" || p.in === "path")
          .map(p => \`\${p.name}: \${p.schema?.type === "integer" ? "int" : "str"}\${p.required ? "" : "?"}\`);
        
        const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
        if (bodySchema?.$ref) {
          const refName = bodySchema.$ref.split("/").pop();
          params.push(\`body: \${refName}\`);
        }
        
        const responseSchema = op.responses?.["200"]?.content?.["application/json"]?.schema;
        const returnType = responseSchema?.$ref ? responseSchema.$ref.split("/").pop() : "obj";
        
        output += \`\${method.toUpperCase().padEnd(4)} \${pathStr} (\${params.join(", ")}) -> \${returnType}\\n\`;
      }
    }
  }
  
  const outPath = args[1] || inputPath.replace(/\\.(json|yaml|yml)$/, ".api");
  fs.writeFileSync(outPath, output);
  console.log(\`  ✓ Generated \${outPath} (\${output.length} bytes)\`);
  console.log(\`    \${(output.match(/^(GET|POST|PUT|PATCH|DEL)/gm) || []).length} endpoints\`);
  console.log(\`    \${(output.match(/^\\w+ = \\{/gm) || []).length} types\`);`,
  },

  "scaffold-feature": {
    name: "scaffold-feature",
    description: "Scaffold a new feature with .graph, all layer files, and INDEX.md update",
    trigger: "When adding a new feature/domain to the project",
    category: "scaffold",
    args: [
      { name: "name", description: "Feature ID (lowercase)", required: true },
      { name: "display", description: "Display name", required: false },
    ],
    body: `  const fs = await import("fs");
  const path = await import("path");
  
  const featureId = args[0];
  if (!featureId) { console.log("Usage: run scaffold-feature <name> [display-name]"); return; }
  
  const displayName = args[1] || featureId.charAt(0).toUpperCase() + featureId.slice(1) + " management";
  const Id = featureId.charAt(0).toUpperCase() + featureId.slice(1);
  
  // 1. Create feature directory
  const featDir = path.join(context.cwd, "src", "features", featureId);
  fs.mkdirSync(featDir, { recursive: true });
  
  // 2. Create layer files
  const files = {
    [\`\${featureId}.controller.ts\`]: \`// \${Id} Controller — validate, delegate, respond\\nimport { \${Id}Service } from './${featureId}.service';\\nimport { create\${Id}Schema, update\${Id}Schema } from './${featureId}.validation';\\n\\n// TODO: Implement routes\\n\`,
    [\`\${featureId}.service.ts\`]: \`// \${Id} Service — business logic\\nimport { \${Id}Repository } from './${featureId}.repository';\\n\\n// TODO: Implement business logic\\n\`,
    [\`\${featureId}.repository.ts\`]: \`// \${Id} Repository — database access\\n// Returns typed domain objects, never raw rows\\n\\n// TODO: Implement queries\\n\`,
    [\`\${featureId}.types.ts\`]: \`// \${Id} Types\\n\\nexport interface \${Id} {\\n  id: string;\\n  // TODO: Define fields\\n}\\n\\nexport interface Create\${Id}Dto {\\n  // TODO: Define creation input\\n}\\n\\nexport interface Update\${Id}Dto {\\n  // TODO: Define update input\\n}\\n\`,
    [\`\${featureId}.validation.ts\`]: \`// \${Id} Validation — Zod schemas\\nimport { z } from 'zod';\\n\\nexport const create\${Id}Schema = z.object({\\n  // TODO: Define validation\\n});\\n\\nexport const update\${Id}Schema = z.object({\\n  // TODO: Define validation\\n});\\n\`,
    [\`\${featureId}.test.ts\`]: \`// \${Id} Tests\\nimport { describe, it, expect } from 'vitest';\\n\\ndescribe('\${Id}Service', () => {\\n  it('should create a \${featureId}', async () => {\\n    // TODO: Implement test\\n  });\\n});\\n\`,
  };
  
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(featDir, filename), content);
    console.log(\`  ✓ Created src/features/\${featureId}/\${filename}\`);
  }
  
  // 3. Create .graph file
  const graph = \`--- \${featureId} [feature] ---\\n\${Id}Cont  [C]    : \${displayName} routes | $auth → THIS → \${Id}Ser\\n\${Id}Ser   [S]    : \${displayName} business logic | \${Id}Cont ← THIS → \${Id}Repo ⇒ Evt\${Id}Changed\\n\${Id}Repo  [R]    : \${featureId} tables, RLS $tenant | \${Id}Ser ← THIS → $db\\n\${Id}Type  [T]    : \${Id}, Create\${Id}Dto, Update\${Id}Dto\\n\${Id}Val   [V]    : Zod schemas for \${featureId} input | \${Id}Cont ← THIS\\n\${Id}Test  [X]    : unit + integration tests\\n---\\n\`;
  
  const graphPath = path.join(context.archDir, "clusters", \`\${featureId}.graph\`);
  fs.writeFileSync(graphPath, graph);
  console.log(\`  ✓ Created .arch/clusters/\${featureId}.graph\`);
  
  // 4. Append to INDEX.md
  const indexPath = path.join(context.archDir, "INDEX.md");
  if (fs.existsSync(indexPath)) {
    let idx = fs.readFileSync(indexPath, "utf8");
    // Add to Keywords -> Nodes section
    const nodeSection = idx.indexOf("## Keywords → Nodes");
    if (nodeSection !== -1) {
      const nextSection = idx.indexOf("\\n## ", nodeSection + 20);
      const insertPoint = nextSection !== -1 ? nextSection : idx.length;
      idx = idx.slice(0, insertPoint) + \`\${featureId} → @\${featureId}\\n\` + idx.slice(insertPoint);
    }
    // Add to Nodes -> Clusters section
    const clusterSection = idx.indexOf("## Nodes → Clusters");
    if (clusterSection !== -1) {
      const nextSection2 = idx.indexOf("\\n## ", clusterSection + 20);
      const insertPoint2 = nextSection2 !== -1 ? nextSection2 : idx.length;
      idx = idx.slice(0, insertPoint2) + \`@\${featureId} = [\${featureId}] → src/features/\${featureId}/\\n\` + idx.slice(insertPoint2);
    }
    fs.writeFileSync(indexPath, idx);
    console.log(\`  ✓ Updated INDEX.md with @\${featureId} routing\`);
  }
  
  // 5. Add event to events.graph
  const eventsPath = path.join(context.archDir, "clusters", "events.graph");
  if (fs.existsSync(eventsPath)) {
    let events = fs.readFileSync(eventsPath, "utf8");
    const closingDash = events.lastIndexOf("---");
    if (closingDash > 0) {
      events = events.slice(0, closingDash) + \`Evt\${Id}Changed [E~] : {\${featureId}Id,...} | @\${featureId} ⇒ THIS ⇒ [subscribers]\\n\` + events.slice(closingDash);
      fs.writeFileSync(eventsPath, events);
      console.log(\`  ✓ Added Evt\${Id}Changed to events.graph\`);
    }
  }
  
  console.log(\`\\n  \${displayName} scaffolded with 6 files + graph + index update.\`);`,
  },

  "add-skill": {
    name: "add-skill",
    description: "Create a new skill file for a package not yet in the system",
    trigger: "When integrating a new package/API that needs AI context",
    category: "skill",
    args: [
      { name: "name", description: "Skill ID (lowercase)", required: true },
      { name: "package", description: "Package name and version", required: false },
      { name: "docs", description: "Documentation URL", required: false },
    ],
    body: `  const fs = await import("fs");
  const path = await import("path");
  
  const skillId = args[0];
  if (!skillId) { console.log("Usage: run add-skill <name> [package@version] [docs-url]"); return; }
  
  const pkg = args[1] || "[PACKAGE_NAME]@[VERSION]";
  const docs = args[2] || "[OFFICIAL_DOCS_URL]";
  
  const content = \`# \${skillId}.skill

## Meta
pkg: \${pkg}
docs: \${docs}
updated: \${new Date().toISOString().split("T")[0]}

## Use
[How YOUR project uses \${skillId}. 2-3 lines max.]

## Patterns
[Import paths, function signatures, conventions you follow.]

## Gotchas
[Add WRONG/RIGHT/WHY entries as you discover them.]
[Run: node gotcha.mjs \${skillId} "wrong" "right" "why"]

## Boundaries
[What \${skillId} does NOT do in your project.]

## Snippets
[2-3 code blocks showing correct patterns from YOUR project.]
\`;
  
  const skillPath = path.join(context.archDir, "skills", \`\${skillId}.skill\`);
  fs.writeFileSync(skillPath, content);
  console.log(\`  ✓ Created .arch/skills/\${skillId}.skill\`);
  
  // Update INDEX.md
  const indexPath = path.join(context.archDir, "INDEX.md");
  if (fs.existsSync(indexPath)) {
    let idx = fs.readFileSync(indexPath, "utf8");
    const skillSection = idx.indexOf("## Skills → Files");
    if (skillSection !== -1) {
      const nextSection = idx.indexOf("\\n## ", skillSection + 18);
      const insertPoint = nextSection !== -1 ? nextSection : idx.length;
      idx = idx.slice(0, insertPoint) + \`$\${skillId} → .arch/skills/\${skillId}.skill\\n\` + idx.slice(insertPoint);
      fs.writeFileSync(indexPath, idx);
      console.log(\`  ✓ Added $\${skillId} to INDEX.md\`);
    }
  }
  
  console.log(\`\\n  Now fill in the skill with your team's knowledge.\`);
  console.log(\`  Add gotchas as you find them: node gotcha.mjs \${skillId} "wrong" "right" "why"\`);`,
  },

  "gen-types": {
    name: "gen-types",
    description: "Extract TypeScript type signatures from node_modules for .api file generation",
    trigger: "When you need to create a .api file from an installed npm package's types",
    category: "api",
    args: [
      { name: "package", description: "Package name (e.g. stripe, @prisma/client)", required: true },
    ],
    body: `  const fs = await import("fs");
  const path = await import("path");
  
  const pkg = args[0];
  if (!pkg) { console.log("Usage: run gen-types <package-name>"); return; }
  
  // Find the package's type definitions
  const possiblePaths = [
    path.join(context.cwd, "node_modules", pkg, "types", "index.d.ts"),
    path.join(context.cwd, "node_modules", pkg, "dist", "index.d.ts"),
    path.join(context.cwd, "node_modules", pkg, "index.d.ts"),
    path.join(context.cwd, "node_modules", "@types", pkg.replace("@", "").replace("/", "__"), "index.d.ts"),
  ];
  
  let typesPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) { typesPath = p; break; }
  }
  
  if (!typesPath) {
    console.log(\`  ⚠ Could not find type definitions for \${pkg}\`);
    console.log(\`  Searched: \${possiblePaths.join("\\n           ")}\`);
    console.log(\`  Try: npx tsc --declaration --emitDeclarationOnly\`);
    return;
  }
  
  const content = fs.readFileSync(typesPath, "utf8");
  
  // Extract exported interfaces and types
  const interfaces = content.match(/export\\s+(?:interface|type)\\s+\\w+[^{]*\\{[^}]*\\}/g) || [];
  const functions = content.match(/export\\s+(?:function|declare function)\\s+\\w+[^;]*/g) || [];
  
  console.log(\`  Found type definitions at: \${typesPath}\`);
  console.log(\`  \${interfaces.length} interfaces/types\`);
  console.log(\`  \${functions.length} exported functions\`);
  console.log(\`\\n  Preview (first 5 interfaces):\`);
  
  interfaces.slice(0, 5).forEach(i => {
    const name = i.match(/(?:interface|type)\\s+(\\w+)/)?.[1] || "unknown";
    console.log(\`    \${name}\`);
  });
  
  console.log(\`\\n  Use this output to manually build your .api file.\`);
  console.log(\`  Focus on the interfaces and methods YOUR app actually uses.\`);`,
  },

  "check-deps": {
    name: "check-deps",
    description: "Check if any .skill or .api files are outdated vs installed package versions",
    trigger: "After running npm update, or periodically to catch stale skills",
    category: "maintenance",
    args: [],
    body: `  const fs = await import("fs");
  const path = await import("path");
  
  // Read package.json
  const pkgJsonPath = path.join(context.cwd, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    console.log("  ⚠ No package.json found in current directory.");
    return;
  }
  
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
  
  // Read all skill files and extract Meta pkg line
  const skillsDir = path.join(context.archDir, "skills");
  if (!fs.existsSync(skillsDir)) return;
  
  const skills = fs.readdirSync(skillsDir).filter(f => f.endsWith(".skill"));
  
  console.log(\`  Checking \${skills.length} skills against \${Object.keys(allDeps).length} installed packages...\\n\`);
  
  let staleCount = 0;
  let matchCount = 0;
  let unknownCount = 0;
  
  for (const file of skills) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf8");
    const pkgMatch = content.match(/^pkg:\\s*(.+)$/m);
    const updatedMatch = content.match(/^updated:\\s*(.+)$/m);
    
    const skillName = file.replace(".skill", "");
    
    if (!pkgMatch || pkgMatch[1].includes("[")) {
      console.log(\`  ○ \${skillName.padEnd(18)} — not configured (meta has placeholders)\`);
      unknownCount++;
      continue;
    }
    
    const skillPkg = pkgMatch[1].trim();
    const updated = updatedMatch ? updatedMatch[1].trim() : "unknown";
    
    // Check age
    if (updated !== "unknown" && !updated.includes("[")) {
      const updatedDate = new Date(updated);
      const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 90) {
        console.log(\`  ⚠ \${skillName.padEnd(18)} — last updated \${daysSince} days ago (pkg: \${skillPkg})\`);
        staleCount++;
        continue;
      }
    }
    
    console.log(\`  ✓ \${skillName.padEnd(18)} — \${skillPkg} (updated: \${updated})\`);
    matchCount++;
  }
  
  console.log(\`\\n  Summary: \${matchCount} current | \${staleCount} stale | \${unknownCount} unconfigured\`);
  if (staleCount > 0) {
    console.log(\`\\n  Stale skills may have outdated gotchas. Review and update the pkg: and updated: fields.\`);
  }`,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

async function cmdCreate(archDir) {
  console.log(`${C.blue}${C.bold}  Create a new extension${C.reset}`);
  console.log(`${C.gray}  Extensions automate repetitive tasks the AI or developer encounters.${C.reset}`);
  console.log(`${C.gray}  Rule of thumb: build on the 3rd occurrence, not the 1st.${C.reset}`);
  console.log("");

  // Ask if they want a preset or custom
  const presetChoices = Object.entries(PRESETS).map(([k, v]) => ({
    name: `${C.bold}${v.name}${C.reset} ${C.dim}— ${v.description}${C.reset}`,
    value: k,
    short: v.name,
  }));

  const { source } = await inquirer.prompt([{
    type: "list",
    name: "source",
    message: "Start from:",
    prefix: `  ${I.arch}`,
    choices: [
      new inquirer.Separator(`${C.green} ── Preset extensions ──${C.reset}`),
      ...presetChoices,
      new inquirer.Separator(`${C.gray} ── Custom ──${C.reset}`),
      { name: `${C.bold}Custom extension${C.reset} ${C.dim}— build from scratch${C.reset}`, value: "__custom", short: "Custom" },
    ],
    pageSize: 12,
  }]);

  let meta;

  if (source !== "__custom") {
    meta = PRESETS[source];
    console.log("");
    console.log(`${C.green}  ${I.check} Using preset: ${meta.name}${C.reset}`);
    console.log(`${C.gray}  ${meta.description}${C.reset}`);
    console.log(`${C.gray}  Trigger: ${meta.trigger}${C.reset}`);
  } else {
    // Custom extension builder
    console.log("");

    const { name } = await inquirer.prompt([{
      type: "input", name: "name",
      message: "Extension name (kebab-case):",
      prefix: `  ${I.arch}`,
      validate: v => /^[a-z][a-z0-9-]*$/.test(v) || "Use lowercase letters, numbers, hyphens",
    }]);

    const { description } = await inquirer.prompt([{
      type: "input", name: "description",
      message: "What does it do? (one line):",
      prefix: `  ${I.arch}`,
    }]);

    const { trigger } = await inquirer.prompt([{
      type: "input", name: "trigger",
      message: "When should the AI suggest using this?:",
      prefix: `  ${I.arch}`,
      default: `When the developer needs to ${description.toLowerCase()}`,
    }]);

    const { category } = await inquirer.prompt([{
      type: "list", name: "category",
      message: "Category:",
      prefix: `  ${I.arch}`,
      choices: ["scaffold", "api", "skill", "maintenance", "testing", "devops", "data", "other"],
    }]);

    // Collect arguments
    console.log("");
    console.log(`${C.gray}  Define the arguments this extension accepts.${C.reset}`);
    console.log(`${C.gray}  Type 'done' when finished.${C.reset}`);
    console.log("");

    const extArgs = [];
    let addingArgs = true;
    while (addingArgs) {
      const { argName } = await inquirer.prompt([{
        type: "input", name: "argName",
        message: "Argument name (or 'done'):",
        prefix: `  ${C.gray}+${C.reset}`,
      }]);
      if (argName === "done" || argName === "") { addingArgs = false; continue; }

      const { argDesc } = await inquirer.prompt([{
        type: "input", name: "argDesc", message: "  Description:",
        prefix: `  ${C.gray}${I.pipe}${C.reset}`,
      }]);
      const { argReq } = await inquirer.prompt([{
        type: "confirm", name: "argReq", message: "  Required?", default: true,
        prefix: `  ${C.gray}${I.corner}${C.reset}`,
      }]);
      extArgs.push({ name: argName, description: argDesc, required: argReq });
    }

    meta = {
      name, description, trigger, category, args: extArgs,
      body: `  // TODO: Implement extension logic
  // Available: args (array), context.archDir, context.cwd, context.system, context.index
  console.log("Extension ${name} executed with args:", args);`,
    };
  }

  // Generate and save
  const code = generateExtension(meta);
  const extDir = ensureExtDir(archDir);
  const extPath = path.join(extDir, `${meta.name}.mjs`);

  // Preview
  console.log("");
  divider();
  console.log("");
  console.log(`${C.blue}${C.bold}  Preview${C.reset}`);
  console.log(`${C.gray}  ${extPath}${C.reset}`);
  console.log("");
  const previewLines = code.split("\n").slice(0, 20);
  previewLines.forEach(l => console.log(`${C.gray}    ${I.pipe} ${C.dim}${l.substring(0, 70)}${C.reset}`));
  if (code.split("\n").length > 20) console.log(`${C.gray}    ${I.pipe} ${C.dim}... (${code.split("\n").length - 20} more lines)${C.reset}`);
  console.log("");

  const { confirmed } = await inquirer.prompt([{
    type: "confirm", name: "confirmed", message: "Save this extension?", default: true,
    prefix: `  ${I.arch}`,
  }]);

  if (!confirmed) { console.log(`${C.gray}  Cancelled.${C.reset}\n`); return; }

  fs.writeFileSync(extPath, code);

  // Update registry
  const registry = loadRegistry(archDir);
  registry.push({
    name: meta.name,
    description: meta.description,
    trigger: meta.trigger,
    category: meta.category,
    file: `${meta.name}.mjs`,
    args: meta.args,
    created: new Date().toISOString().split("T")[0],
  });
  saveRegistry(archDir, registry);

  console.log("");
  console.log(`${C.green}  ${I.check} Extension created: ${meta.name}${C.reset}`);
  console.log(`${C.gray}  File: ${extPath}${C.reset}`);
  console.log(`${C.gray}  Registry updated: ${registry.length} extension${registry.length > 1 ? "s" : ""} total${C.reset}`);
  console.log("");
  console.log(`${C.yellow}  Run it:${C.reset}`);
  console.log(`${C.gray}    node extend.mjs run ${meta.name} ${meta.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}${C.reset}`);
  console.log("");

  if (source === "__custom") {
    console.log(`${C.yellow}  Next: Edit ${extPath} to implement the logic.${C.reset}`);
    console.log("");
  }
}

function cmdList(archDir) {
  const registry = loadRegistry(archDir);
  if (registry.length === 0) {
    console.log(`${C.gray}  No extensions installed.${C.reset}`);
    console.log(`${C.gray}  Run: node extend.mjs create${C.reset}`);
    console.log("");
    return;
  }

  // Group by category
  const categories = {};
  for (const ext of registry) {
    if (!categories[ext.category]) categories[ext.category] = [];
    categories[ext.category].push(ext);
  }

  console.log(`${C.bold}  ${registry.length} extension${registry.length > 1 ? "s" : ""} installed${C.reset}`);
  console.log("");

  for (const [cat, exts] of Object.entries(categories)) {
    console.log(`${C.cyan}  ${cat}${C.reset}`);
    for (const ext of exts) {
      console.log(`    ${C.bold}${ext.name}${C.reset} ${C.dim}— ${ext.description}${C.reset}`);
      console.log(`    ${C.gray}Trigger: ${ext.trigger}${C.reset}`);
      if (ext.args.length > 0) {
        console.log(`    ${C.gray}Args: ${ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}${C.reset}`);
      }
      console.log("");
    }
  }
}

function cmdDescribe(archDir, name) {
  const registry = loadRegistry(archDir);
  const ext = registry.find(e => e.name === name);
  if (!ext) {
    console.log(`${C.red}  Extension "${name}" not found.${C.reset}`);
    cmdList(archDir);
    return;
  }

  console.log(`${C.cyan}${C.bold}  ${ext.name}${C.reset}`);
  console.log(`  ${ext.description}`);
  console.log("");
  console.log(`  ${C.gray}Category:${C.reset}  ${ext.category}`);
  console.log(`  ${C.gray}Created:${C.reset}   ${ext.created}`);
  console.log(`  ${C.gray}File:${C.reset}      .arch/extensions/${ext.file}`);
  console.log(`  ${C.gray}Trigger:${C.reset}   ${ext.trigger}`);
  console.log("");

  if (ext.args.length > 0) {
    console.log(`  ${C.gray}Arguments:${C.reset}`);
    for (const arg of ext.args) {
      const req = arg.required ? `${C.red}required${C.reset}` : `${C.gray}optional${C.reset}`;
      console.log(`    ${C.bold}${arg.name}${C.reset} (${req}) — ${arg.description}`);
    }
    console.log("");
  }

  console.log(`  ${C.yellow}Run:${C.reset} node extend.mjs run ${ext.name} ${ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ")}`);
  console.log("");
}

async function cmdRun(archDir, name, args) {
  const extDir = path.join(archDir, "extensions");
  const extPath = path.join(extDir, `${name}.mjs`);

  if (!fs.existsSync(extPath)) {
    console.log(`${C.red}  Extension "${name}" not found at ${extPath}${C.reset}`);
    console.log(`${C.gray}  Run: node extend.mjs list${C.reset}\n`);
    return;
  }

  // Load context
  const systemPath = path.join(archDir, "SYSTEM.md");
  const indexPath = path.join(archDir, "INDEX.md");
  const context = {
    archDir,
    cwd: process.cwd(),
    args,
    system: fs.existsSync(systemPath) ? fs.readFileSync(systemPath, "utf8") : "",
    index: fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "",
  };

  console.log(`${C.cyan}  ${I.gear} Running extension: ${name}${C.reset}`);
  console.log("");

  try {
    const ext = await import(extPath);
    await ext.run(args, context);
  } catch (err) {
    console.log(`${C.red}  ${I.cross} Extension error: ${err.message}${C.reset}`);
    if (err.stack) console.log(`${C.dim}${err.stack}${C.reset}`);
  }
  console.log("");
}

function cmdRemove(archDir, name) {
  const registry = loadRegistry(archDir);
  const idx = registry.findIndex(e => e.name === name);
  if (idx === -1) {
    console.log(`${C.red}  Extension "${name}" not found.${C.reset}\n`);
    return;
  }

  const ext = registry[idx];
  const extPath = path.join(archDir, "extensions", ext.file);

  registry.splice(idx, 1);
  saveRegistry(archDir, registry);

  if (fs.existsSync(extPath)) fs.unlinkSync(extPath);

  console.log(`${C.green}  ${I.check} Removed extension: ${name}${C.reset}`);
  console.log(`${C.gray}  ${registry.length} extension${registry.length > 1 ? "s" : ""} remaining${C.reset}\n`);
}

function cmdRegistry(archDir) {
  const registry = loadRegistry(archDir);
  if (registry.length === 0) {
    console.log(`${C.gray}  No extensions. Registry is empty.${C.reset}\n`);
    return;
  }

  // Output in a format optimized for AI context injection
  console.log(`${C.bold}  ## Available Extensions${C.reset}`);
  console.log(`${C.gray}  Paste this into your AI prompt or SYSTEM.md for extension discovery.${C.reset}`);
  console.log("");
  console.log(`${C.dim}--- extensions ---${C.reset}`);
  for (const ext of registry) {
    const argStr = ext.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(" ");
    console.log(`${C.dim}${ext.name.padEnd(22)} : ${ext.description} | run: arch-extend run ${ext.name} ${argStr}${C.reset}`);
  }
  console.log(`${C.dim}---${C.reset}`);
  console.log("");
  console.log(`${C.gray}  Trigger conditions (AI should suggest these automatically):${C.reset}`);
  for (const ext of registry) {
    console.log(`${C.dim}  ${ext.name}: ${ext.trigger}${C.reset}`);
  }
  console.log("");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  const archDir = findArchDir();
  if (!archDir) {
    banner();
    console.log(`${C.red}  ${I.warn} Cannot find .arch/ directory.${C.reset}`);
    console.log(`${C.gray}  Run archkit first, or run this from your project root.${C.reset}\n`);
    process.exit(1);
  }

  if (!cmd || cmd === "--help" || cmd === "-h") {
    banner();
    console.log(`${C.yellow}  Commands:${C.reset}`);
    console.log(`${C.gray}    create              Build a new extension (interactive wizard or from preset)${C.reset}`);
    console.log(`${C.gray}    list                Show all installed extensions${C.reset}`);
    console.log(`${C.gray}    run <name> [args]    Execute an extension${C.reset}`);
    console.log(`${C.gray}    describe <name>      Show full details for an extension${C.reset}`);
    console.log(`${C.gray}    remove <name>        Remove an extension${C.reset}`);
    console.log(`${C.gray}    registry             Output AI-readable extension registry${C.reset}`);
    console.log("");
    console.log(`${C.yellow}  Preset extensions available:${C.reset}`);
    for (const [k, v] of Object.entries(PRESETS)) {
      console.log(`${C.gray}    ${C.bold}${v.name}${C.reset}${C.gray} — ${v.description}${C.reset}`);
    }
    console.log("");
    return;
  }

  switch (cmd) {
    case "create":
      banner();
      await cmdCreate(archDir);
      break;
    case "list":
      banner();
      cmdList(archDir);
      break;
    case "run":
      await cmdRun(archDir, args[1], args.slice(2));
      break;
    case "describe":
      banner();
      cmdDescribe(archDir, args[1]);
      break;
    case "remove":
      banner();
      cmdRemove(archDir, args[1]);
      break;
    case "registry":
      banner();
      cmdRegistry(archDir);
      break;
    default:
      banner();
      console.log(`${C.red}  Unknown command: ${cmd}${C.reset}`);
      console.log(`${C.gray}  Run: node extend.mjs --help${C.reset}\n`);
  }
}

main().catch(err => {
  console.error(`${C.red}  Error: ${err.message}${C.reset}`);
  process.exit(1);
});
