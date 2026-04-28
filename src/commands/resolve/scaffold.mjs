import fs from "fs";
import path from "path";
import { loadFile, parseSystem, parseIndex } from "../../lib/parsers.mjs";
import * as log from "../../lib/logger.mjs";
import { SKELETONS } from "../../data/skeleton-templates.mjs";
import { renderSkeleton } from "../../lib/skeleton-renderer.mjs";
import { archkitError } from "../../lib/errors.mjs";

export function cmdScaffold(archDir, featureId, opts = {}) {
  const apply = opts.apply === true;
  const overwrite = opts.overwrite === true;

  log.resolve(`Scaffolding feature: ${featureId} (${apply ? "APPLY" : "dry-run"})`);

  const systemContent = loadFile(archDir, "SYSTEM.md");
  const system = parseSystem(systemContent);
  const indexContent = loadFile(archDir, "INDEX.md");

  const appTypeKey = detectSkeletonKey(system);
  const templates = SKELETONS[appTypeKey];

  if (!templates) {
    return {
      error: "no_templates_for_app_type",
      detail: `No scaffold templates available for app type "${appTypeKey}". v1.3 ships SaaS only; other app types coming in v1.3.x.`,
      requestedAppType: appTypeKey,
    };
  }

  const basePath = `src/features/${featureId}/`;
  const cwd = process.cwd();

  // Plan all files
  const plannedFiles = [];

  // Source skeleton files (one per template layer)
  for (const [filename, template] of Object.entries(templates)) {
    const ext = path.extname(filename);
    const targetPath = path.join(basePath, `${featureId}.${filename}`);
    const content = renderSkeleton(template, { feature: featureId }, ext);
    plannedFiles.push({
      path: targetPath,
      type: `skeleton-${filename.replace(/\..+$/, "")}`,
      content,
      size: content.length,
    });
  }

  // Cluster graph file
  const clusterPath = path.join(".arch", "clusters", `${featureId}.graph`);
  const clusterContent = renderClusterGraph(featureId, Object.keys(templates));
  plannedFiles.push({
    path: clusterPath,
    type: "cluster-graph",
    content: clusterContent,
    size: clusterContent.length,
  });

  // Plan INDEX.md update
  const indexUpdate = {
    path: path.relative(cwd, path.join(archDir, "INDEX.md")),
    diff: `+@${featureId} = [${featureId}] → ${basePath}`,
  };

  if (!apply) {
    return {
      feature: featureId,
      appType: appTypeKey,
      wouldCreate: plannedFiles.map(f => ({ path: f.path, type: f.type, size: f.size })),
      wouldUpdate: [indexUpdate],
    };
  }

  // Apply mode
  const created = [];
  const skipped = [];
  for (const f of plannedFiles) {
    const fullPath = path.join(cwd, f.path);
    if (fs.existsSync(fullPath) && !overwrite) {
      skipped.push({ path: f.path, skipped: "already exists" });
      log.warn(`Skipped (exists): ${f.path}`);
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, f.content);
    created.push({ path: f.path, type: f.type, size: f.size });
    log.generate(`Created ${f.path}`);
  }

  // Apply INDEX.md update — append to ## Nodes section
  const updated = [];
  if (indexContent) {
    const indexPath = path.join(archDir, "INDEX.md");
    const newLine = `@${featureId} = [${featureId}] → ${basePath}\n`;
    let newIndex;
    if (indexContent.includes("## Nodes")) {
      newIndex = indexContent.replace(/## Nodes\n/, `## Nodes\n${newLine}`);
    } else {
      newIndex = indexContent + `\n## Nodes\n${newLine}`;
    }
    fs.writeFileSync(indexPath, newIndex);
    updated.push({ path: path.relative(cwd, indexPath), diff: `+@${featureId} = [${featureId}] → ${basePath}` });
  }

  return {
    feature: featureId,
    appType: appTypeKey,
    created,
    skipped,
    updated,
  };
}

export async function runScaffoldJson({ archDir, cwd = process.cwd(), feature }) {
  if (!archDir) throw archkitError("no_arch_dir", "No .arch/ directory found", { suggestion: "Run `archkit init`." });
  if (!feature) throw archkitError("invalid_input", "feature is required", { suggestion: "Pass a feature name." });
  return cmdScaffold(archDir, feature, { cwd, returnData: true });
}

function detectSkeletonKey(system) {
  const typeStr = (system.type || system.Type || "").toLowerCase();
  if (typeStr.includes("saas") || typeStr.includes("b2b")) return "saas";
  if (typeStr.includes("mobile") || typeStr.includes("mvvm")) return "mobile";
  if (typeStr.includes("ai") || typeStr.includes("hexagonal")) return "ai";
  if (typeStr.includes("data") || typeStr.includes("cqrs")) return "data";
  if (typeStr.includes("ecommerce") || typeStr.includes("commerce")) return "ecommerce";
  if (typeStr.includes("realtime") || typeStr.includes("real-time")) return "realtime";
  if (typeStr.includes("internal")) return "internal";
  if (typeStr.includes("content") || typeStr.includes("cms")) return "content";
  return "saas"; // default
}

function renderClusterGraph(featureId, layerFilenames) {
  const Id = featureId.charAt(0).toUpperCase() + featureId.slice(1);
  let graph = `[${featureId}] : ${featureId} feature\n`;
  for (const fn of layerFilenames) {
    const layer = fn.replace(/\..+$/, "");
    const suffix = { controller: "Cont", service: "Service", repository: "Repo", types: "Type" }[layer] || layer;
    graph += `  [${Id}${suffix}] : ${layer}\n`;
  }
  return graph;
}
