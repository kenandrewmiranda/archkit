#!/usr/bin/env node
// Generates .arch/ for the task-manager demo using archkit programmatically
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genEventsGraph, genSkillFile, genReadme } from "../../src/lib/generators.mjs";
import { genBoundariesMd } from "../../src/data/boundaries.mjs";
import fs from "fs";
import path from "path";

const cfg = {
  appName: "task-manager",
  appType: "saas",
  stack: {
    "Frontend": "Next.js + Tailwind + shadcn/ui",
    "API Framework": "Hono",
    "Auth": "Keycloak",
    "Database": "PostgreSQL (with RLS)",
    "Cache": "Valkey",
    "Job Queue": "BullMQ",
  },
  features: [
    { id: "tasks", name: "Task management", keywords: "task,todo,assign,status,priority" },
    { id: "auth", name: "Authentication", keywords: "login,logout,JWT,session,SSO" },
    { id: "teams", name: "Team management", keywords: "team,member,invite,role" },
  ],
  skills: ["prisma", "valkey", "bullmq", "hono", "zod", "keycloak", "docker"],
  crossRefs: [
    { from: "tasks", to: "auth", reason: "tasks require authenticated user context" },
    { from: "tasks", to: "teams", reason: "tasks are scoped to teams" },
    { from: "teams", to: "auth", reason: "team invites require auth" },
  ],
};

const base = path.resolve("examples/task-manager/.arch");
fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
fs.mkdirSync(path.join(base, "skills"), { recursive: true });

const write = (p, c) => { fs.writeFileSync(path.join(base, p), c); console.log(`  ✓ ${p}`); };

write("SYSTEM.md", genSystemMd(cfg));
write("INDEX.md", genIndexMd(cfg));
write("README.md", genReadme(cfg));
write("BOUNDARIES.md", genBoundariesMd("saas"));
write("clusters/infra.graph", genInfraGraph(cfg));
cfg.features.forEach(f => write(`clusters/${f.id}.graph`, genGraph(f, cfg)));
const events = genEventsGraph(cfg);
if (events) write("clusters/events.graph", events);
cfg.skills.forEach(s => write(`skills/${s}.skill`, genSkillFile(s)));

console.log("\nDone. Run from project root:");
console.log("  node bin/archkit.mjs review examples/task-manager/src/features/tasks/tasks.controller.ts");
