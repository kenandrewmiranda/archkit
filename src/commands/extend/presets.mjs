// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION TEMPLATE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export function generateExtension(meta) {
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
 *   archkit extend run ${name} [args...]
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

export const PRESETS = {
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
  console.log(\`  \u2713 Generated \${outPath} (\${output.length} bytes)\`);
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
    [\`\${featureId}.controller.ts\`]: \`// \${Id} Controller \u2014 validate, delegate, respond\\nimport { \${Id}Service } from './\${featureId}.service';\\nimport { create\${Id}Schema, update\${Id}Schema } from './\${featureId}.validation';\\n\\n// TODO: Implement routes\\n\`,
    [\`\${featureId}.service.ts\`]: \`// \${Id} Service \u2014 business logic\\nimport { \${Id}Repository } from './\${featureId}.repository';\\n\\n// TODO: Implement business logic\\n\`,
    [\`\${featureId}.repository.ts\`]: \`// \${Id} Repository \u2014 database access\\n// Returns typed domain objects, never raw rows\\n\\n// TODO: Implement queries\\n\`,
    [\`\${featureId}.types.ts\`]: \`// \${Id} Types\\n\\nexport interface \${Id} {\\n  id: string;\\n  // TODO: Define fields\\n}\\n\\nexport interface Create\${Id}Dto {\\n  // TODO: Define creation input\\n}\\n\\nexport interface Update\${Id}Dto {\\n  // TODO: Define update input\\n}\\n\`,
    [\`\${featureId}.validation.ts\`]: \`// \${Id} Validation \u2014 Zod schemas\\nimport { z } from 'zod';\\n\\nexport const create\${Id}Schema = z.object({\\n  // TODO: Define validation\\n});\\n\\nexport const update\${Id}Schema = z.object({\\n  // TODO: Define validation\\n});\\n\`,
    [\`\${featureId}.test.ts\`]: \`// \${Id} Tests\\nimport { describe, it, expect } from 'vitest';\\n\\ndescribe('\${Id}Service', () => {\\n  it('should create a \${featureId}', async () => {\\n    // TODO: Implement test\\n  });\\n});\\n\`,
  };

  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(featDir, filename), content);
    console.log(\`  \u2713 Created src/features/\${featureId}/\${filename}\`);
  }

  // 3. Create .graph file
  const graph = \`--- \${featureId} [feature] ---\\n\${Id}Cont  [C]    : \${displayName} routes | $auth \u2192 THIS \u2192 \${Id}Ser\\n\${Id}Ser   [S]    : \${displayName} business logic | \${Id}Cont \u2190 THIS \u2192 \${Id}Repo \u21D2 Evt\${Id}Changed\\n\${Id}Repo  [R]    : \${featureId} tables, RLS $tenant | \${Id}Ser \u2190 THIS \u2192 $db\\n\${Id}Type  [T]    : \${Id}, Create\${Id}Dto, Update\${Id}Dto\\n\${Id}Val   [V]    : Zod schemas for \${featureId} input | \${Id}Cont \u2190 THIS\\n\${Id}Test  [X]    : unit + integration tests\\n---\\n\`;

  const graphPath = path.join(context.archDir, "clusters", \`\${featureId}.graph\`);
  fs.writeFileSync(graphPath, graph);
  console.log(\`  \u2713 Created .arch/clusters/\${featureId}.graph\`);

  // 4. Append to INDEX.md
  const indexPath = path.join(context.archDir, "INDEX.md");
  if (fs.existsSync(indexPath)) {
    let idx = fs.readFileSync(indexPath, "utf8");
    // Add to Keywords -> Nodes section
    const nodeSection = idx.indexOf("## Keywords \u2192 Nodes");
    if (nodeSection !== -1) {
      const nextSection = idx.indexOf("\\n## ", nodeSection + 20);
      const insertPoint = nextSection !== -1 ? nextSection : idx.length;
      idx = idx.slice(0, insertPoint) + \`\${featureId} \u2192 @\${featureId}\\n\` + idx.slice(insertPoint);
    }
    // Add to Nodes -> Clusters section
    const clusterSection = idx.indexOf("## Nodes \u2192 Clusters");
    if (clusterSection !== -1) {
      const nextSection2 = idx.indexOf("\\n## ", clusterSection + 20);
      const insertPoint2 = nextSection2 !== -1 ? nextSection2 : idx.length;
      idx = idx.slice(0, insertPoint2) + \`@\${featureId} = [\${featureId}] \u2192 src/features/\${featureId}/\\n\` + idx.slice(insertPoint2);
    }
    fs.writeFileSync(indexPath, idx);
    console.log(\`  \u2713 Updated INDEX.md with @\${featureId} routing\`);
  }

  // 5. Add event to events.graph
  const eventsPath = path.join(context.archDir, "clusters", "events.graph");
  if (fs.existsSync(eventsPath)) {
    let events = fs.readFileSync(eventsPath, "utf8");
    const closingDash = events.lastIndexOf("---");
    if (closingDash > 0) {
      events = events.slice(0, closingDash) + \`Evt\${Id}Changed [E~] : {\${featureId}Id,...} | @\${featureId} \u21D2 THIS \u21D2 [subscribers]\\n\` + events.slice(closingDash);
      fs.writeFileSync(eventsPath, events);
      console.log(\`  \u2713 Added Evt\${Id}Changed to events.graph\`);
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
[Run: archkit gotcha \${skillId} "wrong" "right" "why"]

## Boundaries
[What \${skillId} does NOT do in your project.]

## Snippets
[2-3 code blocks showing correct patterns from YOUR project.]
\`;

  const skillPath = path.join(context.archDir, "skills", \`\${skillId}.skill\`);
  fs.writeFileSync(skillPath, content);
  console.log(\`  \u2713 Created .arch/skills/\${skillId}.skill\`);

  // Update INDEX.md
  const indexPath = path.join(context.archDir, "INDEX.md");
  if (fs.existsSync(indexPath)) {
    let idx = fs.readFileSync(indexPath, "utf8");
    const skillSection = idx.indexOf("## Skills \u2192 Files");
    if (skillSection !== -1) {
      const nextSection = idx.indexOf("\\n## ", skillSection + 18);
      const insertPoint = nextSection !== -1 ? nextSection : idx.length;
      idx = idx.slice(0, insertPoint) + \`$\${skillId} \u2192 .arch/skills/\${skillId}.skill\\n\` + idx.slice(insertPoint);
      fs.writeFileSync(indexPath, idx);
      console.log(\`  \u2713 Added $\${skillId} to INDEX.md\`);
    }
  }

  console.log(\`\\n  Now fill in the skill with your team's knowledge.\`);
  console.log(\`  Add gotchas as you find them: archkit gotcha \${skillId} "wrong" "right" "why"\`);`,
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
    console.log(\`  \u26A0 Could not find type definitions for \${pkg}\`);
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
    console.log("  \u26A0 No package.json found in current directory.");
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
      console.log(\`  \u25CB \${skillName.padEnd(18)} \u2014 not configured (meta has placeholders)\`);
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
        console.log(\`  \u26A0 \${skillName.padEnd(18)} \u2014 last updated \${daysSince} days ago (pkg: \${skillPkg})\`);
        staleCount++;
        continue;
      }
    }

    console.log(\`  \u2713 \${skillName.padEnd(18)} \u2014 \${skillPkg} (updated: \${updated})\`);
    matchCount++;
  }

  console.log(\`\\n  Summary: \${matchCount} current | \${staleCount} stale | \${unknownCount} unconfigured\`);
  if (staleCount > 0) {
    console.log(\`\\n  Stale skills may have outdated gotchas. Review and update the pkg: and updated: fields.\`);
  }`,
  },
};
