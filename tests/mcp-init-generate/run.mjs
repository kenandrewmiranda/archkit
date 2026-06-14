#!/usr/bin/env node
// Tests the archkit_init_generate MCP path: generating a real .arch/ scaffold
// from STRUCTURED answers (no inquirer TTY) via the shared scaffold-core.
//
// Two surfaces under test:
//   - generateScaffold()      — the pure decoupled core (src/wizard/scaffold-core.mjs)
//   - runInitGenerateJson()   — the MCP runner (src/commands/init-generate.mjs)

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateScaffold, normalizeAnswers } from "../../src/wizard/scaffold-core.mjs";
import { runInitGenerateJson } from "../../src/commands/init-generate.mjs";
import { APP_TYPES } from "../../src/data/app-types.mjs";
import { hasJsTsStack } from "../../src/lib/stack-detect.mjs";
import { appDescriptorSchema, buildSelfHostDescriptor } from "../../src/lib/generators.mjs";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); failed++; });
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archkit-init-gen-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ── Pure core: generateScaffold ────────────────────────────────────────

await test("generateScaffold writes the .arch/ scaffold from structured answers", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = generateScaffold({
      appName: "acme-billing",
      appType: "saas",
      features: [{ id: "auth", name: "Authentication", keywords: "login,auth" }, { id: "billing" }],
      skills: ["postgres", "stripe"],
      claudeMode: false,
    }, { projectRoot: dir });

    const arch = path.join(dir, ".arch");
    assert.ok(fs.existsSync(path.join(arch, "SYSTEM.md")), "SYSTEM.md written");
    assert.ok(fs.existsSync(path.join(arch, "INDEX.md")), "INDEX.md written");
    assert.ok(fs.existsSync(path.join(arch, "BOUNDARIES.md")), "BOUNDARIES.md written");
    assert.ok(fs.existsSync(path.join(arch, "CONTEXT.compact.md")), "CONTEXT.compact.md written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "infra.graph")), "infra cluster written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "auth.graph")), "auth cluster written");
    assert.ok(fs.existsSync(path.join(arch, "clusters", "billing.graph")), "billing cluster written");
    assert.ok(fs.existsSync(path.join(arch, "skills", "postgres.skill")), "postgres skill written");
    assert.ok(fs.existsSync(path.join(arch, "skills", "stripe.skill")), "stripe skill written");
    // stripe ships an .api stub
    assert.ok(fs.existsSync(path.join(arch, "apis", "stripe.api")), "stripe api stub written");
    // lenses
    assert.ok(fs.existsSync(path.join(arch, "lenses", "lens-implement.md")), "lens written");

    // SYSTEM.md should carry the app name and the resolved appType name
    const sys = fs.readFileSync(path.join(arch, "SYSTEM.md"), "utf8");
    assert.match(sys, /acme-billing/, "SYSTEM.md names the app");

    assert.equal(res.cfg.appName, "acme-billing");
    assert.deepEqual(res.cfg.features.map(f => f.id), ["auth", "billing"]);
    assert.ok(res.written.length >= 9, `expected many files, got ${res.written.length}`);
  } finally { cleanup(); }
});

await test("generateScaffold defaults features+stack from the archetype when omitted", () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = generateScaffold({ appName: "x", appType: "ecommerce", claudeMode: false }, { projectRoot: dir });
    assert.ok(res.cfg.features.length > 0, "archetype suggested features applied");
    assert.ok(Object.keys(res.cfg.stack).length > 0, "archetype default stack applied");
    // Each suggested feature got a cluster file
    for (const f of res.cfg.features) {
      assert.ok(fs.existsSync(path.join(dir, ".arch", "clusters", `${f.id}.graph`)), `${f.id}.graph written`);
    }
  } finally { cleanup(); }
});

await test("generateScaffold claudeMode:true writes Claude Code native files", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "x", appType: "saas",
      features: [{ id: "auth" }], skills: [], claudeMode: true,
    }, { projectRoot: dir });
    assert.ok(fs.existsSync(path.join(dir, "CLAUDE.md")), "CLAUDE.md written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "rules", "architecture.md")), "arch rule written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "rules", "auth.md")), "feature rule written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "archkit-protocol", "SKILL.md")), "protocol skill written");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "settings.json")), "settings.json written");
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.hooks && settings.hooks.PreToolUse, "hooks merged");
  } finally { cleanup(); }
});

await test("generateScaffold claudeMode:false skips Claude Code native files", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({ appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: false }, { projectRoot: dir });
    assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.md")), "no CLAUDE.md");
    assert.ok(!fs.existsSync(path.join(dir, ".claude")), "no .claude dir");
    assert.ok(fs.existsSync(path.join(dir, ".arch", "SYSTEM.md")), "but .arch/ still written");
  } finally { cleanup(); }
});

await test("generateScaffold renames to CLAUDE.archkit.md when CLAUDE.md exists", () => {
  const { dir, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# existing\n");
    const res = generateScaffold({ appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: true }, { projectRoot: dir });
    assert.equal(res.claudeMdRenamed, true, "flagged renamed");
    assert.ok(fs.existsSync(path.join(dir, "CLAUDE.archkit.md")), "wrote CLAUDE.archkit.md");
    assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), "# existing\n", "did not clobber existing CLAUDE.md");
  } finally { cleanup(); }
});

await test("normalizeAnswers throws coded errors for invalid input", () => {
  assert.throws(() => normalizeAnswers({ appName: "x", appType: "nope" }), e => e.code === "invalid_app_type");
  assert.throws(() => normalizeAnswers({ appType: "saas" }), e => e.code === "missing_app_name");
  assert.throws(() => normalizeAnswers({ appName: "x", appType: "saas", skills: ["not-a-skill"] }), e => e.code === "invalid_skills");
});

// ── ios-swift archetype: Swift-correct, zero React leakage, option sets ──

await test("ios-swift archetype carries annotated server/storage option sets", () => {
  const at = APP_TYPES["ios-swift"];
  assert.ok(at, "ios-swift archetype exists");
  for (const key of ["serverStackOptions", "storageOptions"]) {
    assert.ok(Array.isArray(at[key]) && at[key].length >= 3, `${key} has options`);
    for (const opt of at[key]) {
      assert.ok(opt.id && opt.label, `${key} option has id+label`);
      assert.ok(Array.isArray(opt.pros) && opt.pros.length > 0, `${key} option has pros`);
      assert.ok(Array.isArray(opt.cons) && opt.cons.length > 0, `${key} option has cons`);
    }
  }
  // The three named server options and storage options from the goal.
  assert.deepEqual(at.serverStackOptions.map(o => o.id), ["vapor", "hono", "fastapi"]);
  assert.deepEqual(at.storageOptions.map(o => o.id), ["minio", "local-disk-caddy", "postgres-only"]);
  // A sensible fallback default is still selected for non-interactive callers.
  assert.equal(at.defaultServerStack, "vapor");
  assert.equal(at.defaultStorage, "minio");
});

await test("hasJsTsStack is false for the ios-swift archetype (verify-wiring gated off)", () => {
  // True even if a JS/Python backend is chosen — the scaffolded app is Swift.
  assert.equal(hasJsTsStack({ appType: "ios-swift", stack: APP_TYPES["ios-swift"].defaultStack }), false);
  assert.equal(hasJsTsStack({ appType: "ios-swift", stack: { Server: "Hono (TypeScript)" } }), false);
});

await test("ios-swift scaffolds a Swift-correct .arch/ with zero React/.tsx leakage", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "trailmark",
      appType: "ios-swift",
      claudeMode: true,
      stackDecision: {
        serverStack: { chosen: "vapor", rationale: "Swift end to end — shared Codable models", recommendations: [{ id: "vapor", pct: 60 }, { id: "hono", pct: 25 }, { id: "fastapi", pct: 15 }] },
        storage: { chosen: "minio", rationale: "Media-heavy, presigned URLs", recommendations: [{ id: "minio", pct: 70 }, { id: "local-disk-caddy", pct: 20 }, { id: "postgres-only", pct: 10 }] },
      },
    }, { projectRoot: dir });

    const arch = path.join(dir, ".arch");
    // Gather every generated text file we scaffold for this archetype.
    const scan = [
      path.join(arch, "SYSTEM.md"),
      path.join(arch, "INDEX.md"),
      path.join(arch, "CONTEXT.compact.md"),
      path.join(arch, "clusters", "feed.graph"),
      path.join(arch, "clusters", "infra.graph"),
      path.join(dir, "CLAUDE.md"),
      path.join(dir, ".claude", "rules", "architecture.md"),
      path.join(dir, ".claude", "rules", "feed.md"),
      path.join(dir, ".claude", "rules", "superpowers-integration.md"),
      path.join(dir, ".claude", "skills", "archkit-protocol", "SKILL.md"),
    ];
    const blob = scan.map(f => fs.readFileSync(f, "utf8")).join("\n");

    // ZERO React-stack leakage (goal: no React/.tsx/FlashList/WatermelonDB).
    for (const bad of ["FlashList", "WatermelonDB", "React Native", ".tsx", "FlatList"]) {
      assert.ok(!blob.includes(bad), `no "${bad}" leakage in ios-swift scaffold`);
    }
    assert.ok(!/\bReact\b/.test(blob), "no bare React leakage");

    // Swift-correct content present.
    const sys = fs.readFileSync(path.join(arch, "SYSTEM.md"), "utf8");
    assert.match(sys, /SwiftUI/, "SYSTEM.md mentions SwiftUI");
    assert.match(sys, /ViewModel/, "SYSTEM.md mentions ViewModel");
    assert.match(sys, /PascalCase Swift/, "Swift naming convention emitted");
    // Swift MVVM graph nodes (not Screen/Hook).
    const feed = fs.readFileSync(path.join(arch, "clusters", "feed.graph"), "utf8");
    assert.match(feed, /FeedView/, "graph has FeedView node");
    assert.match(feed, /FeedVM/, "graph has FeedVM node");
    assert.match(feed, /FeedSvc/, "graph has FeedSvc node");

    // Option-set decision metadata recorded in SYSTEM.md.
    assert.match(sys, /## Stack Decision/, "Stack Decision section present");
    assert.match(sys, /Vapor \(Swift\)/, "chosen server option labeled");
    assert.match(sys, /recommended 60%/, "AI-weighted recommendation % recorded");
    assert.match(sys, /MinIO \(self-hosted S3\)/, "chosen storage option labeled");
    assert.match(sys, /recommended 70%/, "storage recommendation % recorded");
    assert.match(sys, /Swift end to end/, "rationale recorded");
    // Pros/cons of every option surfaced.
    assert.match(sys, /Pros:/, "option pros surfaced");
    assert.match(sys, /Cons:/, "option cons surfaced");

    // verify-wiring guidance (JS-only) stripped from generated guidance.
    const sup = fs.readFileSync(path.join(dir, ".claude", "rules", "superpowers-integration.md"), "utf8");
    const proto = fs.readFileSync(path.join(dir, ".claude", "skills", "archkit-protocol", "SKILL.md"), "utf8");
    assert.ok(!/verify-wiring/.test(sup), "no verify-wiring in superpowers rule");
    assert.ok(!/verify-wiring/.test(proto), "no verify-wiring in protocol skill");
  } finally { cleanup(); }
});

await test("runInitGenerateJson surfaces ios-swift option sets and records the decision", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    // No stackDecision → envelope echoes options + a note, uses defaults.
    const undecided = await runInitGenerateJson({
      cwd: dir, archDir: null,
      answers: { appName: "x", appType: "ios-swift", claudeMode: false },
    });
    assert.equal(undecided.stackDecisionRecorded, false);
    assert.ok(undecided.stackOptions?.serverStack?.options?.length >= 3, "server options echoed");
    assert.ok(undecided.stackOptions?.storage?.options?.length >= 3, "storage options echoed");
    assert.match(undecided.stackDecisionNote, /recommendations/i);

    // With a stackDecision (overwrite) → recorded.
    const decided = await runInitGenerateJson({
      cwd: dir, archDir: path.join(dir, ".arch"), overwrite: true,
      answers: {
        appName: "x", appType: "ios-swift", claudeMode: false,
        stackDecision: { serverStack: { chosen: "fastapi", recommendations: [{ id: "fastapi", pct: 50 }] }, storage: { chosen: "postgres-only" } },
      },
    });
    assert.equal(decided.stackDecisionRecorded, true);
    const sys = fs.readFileSync(path.join(dir, ".arch", "SYSTEM.md"), "utf8");
    assert.match(sys, /FastAPI \(Python\)/, "chosen FastAPI recorded");
    assert.match(sys, /Postgres-only/, "chosen storage recorded");
  } finally { cleanup(); }
});

// ── Hosting decision + Cloud/Hetzner full IaC ──────────────────────────

await test("ios-swift carries a hostingOptions decision set (Cloud vs Self-host)", () => {
  const at = APP_TYPES["ios-swift"];
  assert.ok(Array.isArray(at.hostingOptions) && at.hostingOptions.length >= 2, "hostingOptions present");
  assert.deepEqual(at.hostingOptions.map(o => o.id), ["cloud", "self-host"]);
  for (const opt of at.hostingOptions) {
    assert.ok(opt.id && opt.label, "option has id+label");
    assert.ok(Array.isArray(opt.pros) && opt.pros.length > 0, "option has pros");
    assert.ok(Array.isArray(opt.cons) && opt.cons.length > 0, "option has cons");
  }
  assert.equal(at.defaultHosting, "cloud", "cloud is the fallback default");
});

await test("ios-swift + hosting:cloud emits Hetzner full IaC (vapor + minio)", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "trailmark", appType: "ios-swift", claudeMode: false,
      stackDecision: {
        serverStack: { chosen: "vapor", recommendations: [{ id: "vapor", pct: 60 }] },
        storage: { chosen: "minio", recommendations: [{ id: "minio", pct: 70 }] },
        hosting: { chosen: "cloud", rationale: "App Store review needs a public TLS endpoint", recommendations: [{ id: "cloud", pct: 80 }, { id: "self-host", pct: 20 }] },
      },
    }, { projectRoot: dir });

    // Terraform/hcloud — server + SSH key + firewall + primary IP.
    const tf = fs.readFileSync(path.join(dir, "infra", "terraform", "main.tf"), "utf8");
    assert.match(tf, /hetznercloud\/hcloud/, "hcloud provider");
    assert.match(tf, /resource "hcloud_server"/, "server resource");
    assert.match(tf, /resource "hcloud_ssh_key"/, "ssh key resource");
    assert.match(tf, /resource "hcloud_firewall"/, "firewall resource");
    assert.match(tf, /resource "hcloud_primary_ip"/, "primary IP resource");
    assert.ok(fs.existsSync(path.join(dir, "infra", "terraform", "variables.tf")), "variables.tf");
    assert.ok(fs.existsSync(path.join(dir, "infra", "terraform", "outputs.tf")), "outputs.tf");
    assert.ok(fs.existsSync(path.join(dir, "infra", "terraform", "terraform.tfvars.example")), "tfvars example");

    // cloud-init bootstrap — Docker, Caddy/firewall, fail2ban, non-root deploy user.
    const ci = fs.readFileSync(path.join(dir, "infra", "cloud-init.yaml"), "utf8");
    assert.match(ci, /get\.docker\.com/, "installs Docker");
    assert.match(ci, /ufw/, "configures ufw firewall");
    assert.match(ci, /fail2ban/, "enables fail2ban");
    assert.match(ci, /name: deploy/, "creates non-root deploy user");

    // Caddy automatic-TLS reverse proxy → vapor :8080; MinIO S3 subdomain.
    const caddy = fs.readFileSync(path.join(dir, "infra", "Caddyfile"), "utf8");
    assert.match(caddy, /reverse_proxy api:8080/, "proxies to vapor port");
    assert.match(caddy, /s3\.\{?\$DOMAIN\}?/, "minio s3 subdomain route");

    // compose parameterized: postgres + minio + api wired to S3.
    const compose = fs.readFileSync(path.join(dir, "infra", "docker-compose.yml"), "utf8");
    assert.match(compose, /postgres:16/, "db service");
    assert.match(compose, /minio\/minio/, "minio service");
    assert.match(compose, /S3_ENDPOINT/, "api wired to minio");
    assert.ok(fs.existsSync(path.join(dir, "infra", ".env.example")), ".env.example");

    // .arch/skills/hetzner.skill deploy runbook with WRONG/RIGHT/WHY.
    const skill = fs.readFileSync(path.join(dir, ".arch", "skills", "hetzner.skill"), "utf8");
    assert.match(skill, /Deploy Runbook/, "runbook section");
    assert.match(skill, /docker build/, "build step");
    assert.match(skill, /docker compose .* up/, "compose up step");
    assert.match(skill, /caddy reload/, "Caddy reload step");
    assert.match(skill, /WRONG:/, "gotcha WRONG");
    assert.match(skill, /RIGHT:/, "gotcha RIGHT");
    assert.match(skill, /WHY:/, "gotcha WHY");

    // infra.graph carries the Caddy TLS edge over API + DB + storage.
    const infra = fs.readFileSync(path.join(dir, ".arch", "clusters", "infra.graph"), "utf8");
    assert.match(infra, /hetzner-edge/, "hetzner edge slice");
    assert.match(infra, /Caddy/, "Caddy node");
    assert.match(infra, /automatic-TLS/, "TLS edge described");
    assert.match(infra, /Vapor \(Swift\)/, "API node names the chosen stack");

    // SYSTEM.md records the hosting decision + AI-weighted %.
    const sys = fs.readFileSync(path.join(dir, ".arch", "SYSTEM.md"), "utf8");
    assert.match(sys, /### Hosting:/, "hosting decision section");
    assert.match(sys, /Cloud VPS \(Hetzner\)/, "chosen hosting labeled");
    assert.match(sys, /recommended 80%/, "hosting recommendation % recorded");
  } finally { cleanup(); }
});

await test("Hetzner IaC reparameterizes by stack+storage (hono + local-disk-caddy)", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "notes", appType: "ios-swift", claudeMode: false,
      stackDecision: {
        serverStack: { chosen: "hono" },
        storage: { chosen: "local-disk-caddy" },
        hosting: { chosen: "cloud" },
      },
    }, { projectRoot: dir });

    const caddy = fs.readFileSync(path.join(dir, "infra", "Caddyfile"), "utf8");
    assert.match(caddy, /reverse_proxy api:3000/, "proxies to hono port 3000");
    assert.match(caddy, /file_server/, "local-disk media file_server route");
    assert.ok(!/s3\./.test(caddy), "no minio s3 subdomain for local-disk");

    const compose = fs.readFileSync(path.join(dir, "infra", "docker-compose.yml"), "utf8");
    assert.ok(!/minio\/minio/.test(compose), "no minio service");
    assert.match(compose, /MEDIA_DIR/, "api wired to local media dir");
    assert.match(compose, /media:\/srv\/media/, "media volume mounted");

    const infra = fs.readFileSync(path.join(dir, ".arch", "clusters", "infra.graph"), "utf8");
    assert.match(infra, /Caddy file_server/, "graph storage node = Caddy file server");
    assert.match(infra, /Hono \(TypeScript\)/, "API node names the hono stack");
  } finally { cleanup(); }
});

await test("hosting:self-host does NOT emit Hetzner-specific IaC (Cloud-branch gate)", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "x", appType: "ios-swift", claudeMode: false,
      stackDecision: { hosting: { chosen: "self-host" } },
    }, { projectRoot: dir });
    // self-host emits infra/ (its own fleet plane), but NONE of the Hetzner
    // cloud artifacts: no Terraform, no cloud-init, no hetzner.skill/edge.
    assert.ok(!fs.existsSync(path.join(dir, "infra", "terraform")), "no terraform dir for self-host");
    assert.ok(!fs.existsSync(path.join(dir, "infra", "cloud-init.yaml")), "no cloud-init for self-host");
    assert.ok(!fs.existsSync(path.join(dir, ".arch", "skills", "hetzner.skill")), "no hetzner skill");
    const infra = fs.readFileSync(path.join(dir, ".arch", "clusters", "infra.graph"), "utf8");
    assert.ok(!/hetzner-edge/.test(infra), "no hetzner slice in infra graph");
  } finally { cleanup(); }
});

await test("runInitGenerateJson echoes hostingOptions and flags emitted Hetzner IaC", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = await runInitGenerateJson({
      cwd: dir, archDir: null,
      answers: {
        appName: "x", appType: "ios-swift", claudeMode: false,
        stackDecision: { hosting: { chosen: "cloud" } },
      },
    });
    assert.ok(res.stackOptions?.hosting?.options?.length >= 2, "hosting options echoed");
    assert.equal(res.stackOptions.hosting.default, "cloud", "default hosting echoed");
    assert.ok(res.hetznerIaC?.emitted === true, "hetznerIaC flagged emitted");
    assert.match(res.hetznerIaC.note, /terraform/i, "note describes the IaC");
  } finally { cleanup(); }
});

// ── Self-host (local rig) full fleet plane ─────────────────────────────

await test("hosting:self-host emits the vendored fleet plane (vapor + minio)", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "trailmark", appType: "ios-swift", claudeMode: false,
      stackDecision: {
        serverStack: { chosen: "vapor", recommendations: [{ id: "vapor", pct: 60 }] },
        storage: { chosen: "minio", recommendations: [{ id: "minio", pct: 70 }] },
        hosting: { chosen: "self-host", rationale: "Reuse the home rig; no hosting bill", recommendations: [{ id: "self-host", pct: 70 }, { id: "cloud", pct: 30 }] },
      },
    }, { projectRoot: dir });

    // Fleet-app descriptor (registry/apps/<slug>.yaml), parameterized by stack+storage.
    const descPath = path.join(dir, "infra", "registry", "apps", "trailmark.yaml");
    assert.ok(fs.existsSync(descPath), "registry descriptor written");
    const descYaml = fs.readFileSync(descPath, "utf8");
    assert.match(descYaml, /name: trailmark/, "descriptor name");
    assert.match(descYaml, /serverPath: \/home\/rig\/apps\/trailmark/, "descriptor serverPath");
    assert.match(descYaml, /domain: trailmark\.rig\.home/, "descriptor domain");
    assert.match(descYaml, /port: 8080/, "vapor port in descriptor");
    assert.match(descYaml, /trailmark-minio/, "minio container in descriptor");
    assert.match(descYaml, /trailmark_minio_data/, "minio backup volume");

    // App compose (api + db + minio) for the rig.
    const compose = fs.readFileSync(path.join(dir, "infra", "trailmark", "compose.yaml"), "utf8");
    assert.match(compose, /name: trailmark/, "compose project name = slug");
    assert.match(compose, /postgres:16/, "db service");
    assert.match(compose, /minio\/minio/, "minio service");
    assert.match(compose, /S3_ENDPOINT/, "api wired to minio");
    assert.match(compose, /"8080:8080"/, "api publishes vapor port");
    assert.ok(fs.existsSync(path.join(dir, "infra", "trailmark", ".env.example")), "app .env.example");

    // Caddy automatic-TLS edge (local domain via tls internal).
    const caddy = fs.readFileSync(path.join(dir, "infra", "caddy", "Caddyfile"), "utf8");
    assert.match(caddy, /tls internal/, "automatic TLS via internal CA");
    assert.match(caddy, /\{\$RIG_DOMAIN\}/, "local domain from env");
    assert.match(caddy, /reverse_proxy localhost:8080/, "proxies to vapor");
    assert.match(caddy, /s3\.\{\$RIG_DOMAIN\}/, "minio s3 subdomain");
    assert.ok(fs.existsSync(path.join(dir, "infra", "caddy", "compose.yaml")), "caddy compose");

    // Monitoring: Prometheus + Loki + Grafana + Alertmanager.
    const mon = fs.readFileSync(path.join(dir, "infra", "monitoring", "compose.yaml"), "utf8");
    assert.match(mon, /prom\/prometheus/, "prometheus");
    assert.match(mon, /grafana\/loki/, "loki");
    assert.match(mon, /grafana\/grafana/, "grafana");
    assert.match(mon, /prom\/alertmanager/, "alertmanager");
    assert.ok(fs.existsSync(path.join(dir, "infra", "monitoring", "prometheus", "prometheus.yml")), "prometheus.yml");
    assert.ok(fs.existsSync(path.join(dir, "infra", "monitoring", "prometheus", "alerts.yml")), "alerts.yml");
    assert.ok(fs.existsSync(path.join(dir, "infra", "monitoring", "loki", "loki-config.yml")), "loki config");
    assert.ok(fs.existsSync(path.join(dir, "infra", "monitoring", "promtail", "promtail-config.yml")), "promtail config");
    assert.ok(fs.existsSync(path.join(dir, "infra", "monitoring", "grafana", "provisioning", "datasources", "datasources.yml")), "grafana datasources");
    const prom = fs.readFileSync(path.join(dir, "infra", "monitoring", "prometheus", "prometheus.yml"), "utf8");
    assert.match(prom, /trailmark-api/, "prometheus scrapes the app");

    // ntfy notifications.
    const ntfy = fs.readFileSync(path.join(dir, "infra", "ntfy", "compose.yaml"), "utf8");
    assert.match(ntfy, /binwiederhier\/ntfy/, "ntfy server");
    assert.match(ntfy, /alertmanager-ntfy/, "alertmanager→ntfy bridge");
    assert.ok(fs.existsSync(path.join(dir, "infra", "ntfy", "server.yml")), "ntfy server.yml");

    // Backups job (engine + manifest + systemd) and rsync→compose deploy flow.
    const backup = fs.readFileSync(path.join(dir, "infra", "backups", "backup.sh"), "utf8");
    assert.match(backup, /pg_dumpall/, "db dump");
    assert.match(backup, /arch_backup_last_status/, "node-exporter metric");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "infra", "backups", "manifest.json"), "utf8"));
    assert.equal(manifest.apps[0].name, "trailmark", "manifest derived from descriptor");
    assert.ok(manifest.apps[0].volumes.includes("trailmark_db_data"), "manifest db volume");
    assert.ok(fs.existsSync(path.join(dir, "infra", "backups", "arch-backup@.service")), "systemd service");
    assert.ok(fs.existsSync(path.join(dir, "infra", "backups", "arch-backup@trailmark.timer")), "systemd timer");
    const deploy = fs.readFileSync(path.join(dir, "infra", "deploy.sh"), "utf8");
    assert.match(deploy, /rsync/, "rsync deploy");
    assert.match(deploy, /docker compose .* up -d/, "compose up -d");

    // self-host.skill runbook with WRONG/RIGHT/WHY gotchas.
    const skill = fs.readFileSync(path.join(dir, ".arch", "skills", "self-host.skill"), "utf8");
    assert.match(skill, /## Runbook/, "runbook section");
    assert.match(skill, /Provision the rig/, "provision step");
    assert.match(skill, /Bootstrap infra/, "bootstrap step");
    assert.match(skill, /Enable scheduled backups/, "backup step");
    assert.match(skill, /WRONG:/, "gotcha WRONG");
    assert.match(skill, /RIGHT:/, "gotcha RIGHT");
    assert.match(skill, /WHY:/, "gotcha WHY");

    // infra.graph: self-host edge over API + DB + storage + Caddy + monitoring.
    const infra = fs.readFileSync(path.join(dir, ".arch", "clusters", "infra.graph"), "utf8");
    assert.match(infra, /selfhost-edge/, "self-host edge slice");
    assert.match(infra, /Caddy/, "Caddy node");
    assert.match(infra, /automatic-TLS/, "TLS edge described");
    assert.match(infra, /Vapor \(Swift\)/, "API node names the chosen stack");
    assert.match(infra, /Mon /, "monitoring node");
    assert.match(infra, /Backup /, "backup node");
    assert.ok(!/hetzner-edge/.test(infra), "no hetzner slice");
  } finally { cleanup(); }
});

await test("self-host descriptor validates against the vendored arch-server schema", () => {
  // vapor + minio
  const d1 = buildSelfHostDescriptor({
    appName: "trailmark", appType: "ios-swift",
    stackDecision: { serverStack: { chosen: "vapor" }, storage: { chosen: "minio" }, hosting: { chosen: "self-host" } },
  });
  const p1 = appDescriptorSchema.safeParse(d1);
  assert.ok(p1.success, `vapor+minio descriptor matches schema: ${p1.error?.message || ""}`);
  assert.equal(d1.name, "trailmark");
  assert.equal(d1.port, 8080);
  assert.equal(d1.health.type, "http");
  assert.equal(d1.backup.db.engine, "postgres");
  assert.ok(d1.backup.volumes.includes("trailmark_minio_data"), "minio volume present");

  // fastapi + postgres-only — no separate object store, no minio volume.
  const d2 = buildSelfHostDescriptor({
    appName: "notes-api", appType: "ios-swift",
    stackDecision: { serverStack: { chosen: "fastapi" }, storage: { chosen: "postgres-only" }, hosting: { chosen: "self-host" } },
  });
  const p2 = appDescriptorSchema.safeParse(d2);
  assert.ok(p2.success, `fastapi+postgres descriptor matches schema: ${p2.error?.message || ""}`);
  assert.equal(d2.port, 8000, "fastapi port");
  assert.ok(!d2.containers.some(c => /minio/.test(c)), "no minio container for postgres-only");
  assert.ok(!d2.backup.volumes.some(v => /minio/.test(v)), "no minio volume for postgres-only");
});

await test("self-host reparameterizes by stack+storage (hono + local-disk-caddy)", () => {
  const { dir, cleanup } = tmpProject();
  try {
    generateScaffold({
      appName: "notes", appType: "ios-swift", claudeMode: false,
      stackDecision: {
        serverStack: { chosen: "hono" },
        storage: { chosen: "local-disk-caddy" },
        hosting: { chosen: "self-host" },
      },
    }, { projectRoot: dir });

    const caddy = fs.readFileSync(path.join(dir, "infra", "caddy", "Caddyfile"), "utf8");
    assert.match(caddy, /reverse_proxy localhost:3000/, "proxies to hono port 3000");
    assert.match(caddy, /file_server/, "local-disk media file_server route");
    assert.ok(!/s3\./.test(caddy), "no minio s3 subdomain for local-disk");

    const compose = fs.readFileSync(path.join(dir, "infra", "notes", "compose.yaml"), "utf8");
    assert.ok(!/minio\/minio/.test(compose), "no minio service");
    assert.match(compose, /MEDIA_DIR/, "api wired to local media dir");

    const infra = fs.readFileSync(path.join(dir, ".arch", "clusters", "infra.graph"), "utf8");
    assert.match(infra, /Caddy file_server/, "graph storage node = Caddy file server");
    assert.match(infra, /Hono \(TypeScript\)/, "API node names the hono stack");
  } finally { cleanup(); }
});

await test("runInitGenerateJson flags the emitted self-host fleet plane", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = await runInitGenerateJson({
      cwd: dir, archDir: null,
      answers: {
        appName: "x", appType: "ios-swift", claudeMode: false,
        stackDecision: { hosting: { chosen: "self-host" } },
      },
    });
    assert.ok(res.stackOptions?.hosting?.options?.length >= 2, "hosting options echoed");
    assert.ok(res.selfHostStack?.emitted === true, "selfHostStack flagged emitted");
    assert.match(res.selfHostStack.note, /fleet/i, "note describes the fleet plane");
    assert.ok(!res.hetznerIaC, "no hetzner flag for self-host");
  } finally { cleanup(); }
});

// ── MCP runner: runInitGenerateJson ───────────────────────────────────

await test("runInitGenerateJson generates a scaffold and returns a structured envelope", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    const res = await runInitGenerateJson({
      cwd: dir, archDir: null,
      answers: { appName: "demo", appType: "ai", features: [{ id: "chat" }], claudeMode: false },
    });
    assert.equal(res.ok, true);
    assert.equal(res.appName, "demo");
    assert.equal(res.appType, "ai");
    assert.ok(res.features.includes("chat"));
    assert.ok(res.filesWritten > 0);
    assert.ok(Array.isArray(res.written) && res.written.includes("SYSTEM.md"));
    assert.match(res.nextStep, /warmup/i);
    assert.ok(fs.existsSync(path.join(dir, ".arch", "clusters", "chat.graph")));
  } finally { cleanup(); }
});

await test("runInitGenerateJson refuses to clobber an existing .arch/ without overwrite", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, ".arch"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".arch", "SYSTEM.md"), "# existing\n");
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: path.join(dir, ".arch"), answers: { appName: "x", appType: "saas" } }),
      e => e.code === "arch_dir_exists"
    );
    // overwrite:true proceeds
    const res = await runInitGenerateJson({
      cwd: dir, archDir: path.join(dir, ".arch"),
      answers: { appName: "x", appType: "saas", features: [{ id: "auth" }], claudeMode: false }, overwrite: true,
    });
    assert.equal(res.ok, true);
  } finally { cleanup(); }
});

await test("runInitGenerateJson surfaces invalid appType as a coded error with valid list", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: null, answers: { appName: "x", appType: "bogus" } }),
      e => e.code === "invalid_app_type" && /saas/.test(e.suggestion || "")
    );
  } finally { cleanup(); }
});

await test("runInitGenerateJson requires an answers object", async () => {
  const { dir, cleanup } = tmpProject();
  try {
    await assert.rejects(
      runInitGenerateJson({ cwd: dir, archDir: null }),
      e => e.code === "missing_answers"
    );
  } finally { cleanup(); }
});

console.log(`\n${passed}/${passed + failed} init-generate assertions passed.`);
if (failed) process.exit(1);
