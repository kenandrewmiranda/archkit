#!/usr/bin/env node
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genSkillFile, genReadme } from "../../src/lib/generators.mjs";
import { genBoundariesMd } from "../../src/data/boundaries.mjs";
import fs from "fs";
import path from "path";

const cfg = {
  appName: "chat-app",
  appType: "realtime",
  stack: {
    "Server": "Node.js WebSocket (ws)",
    "Auth": "Keycloak (JWT at connect)",
    "Database": "PostgreSQL",
    "Real-time State": "Valkey (pub/sub + ephemeral)",
  },
  features: [
    { id: "chat", name: "Chat messaging", keywords: "chat,message,send,edit,delete,thread" },
    { id: "channels", name: "Channels & rooms", keywords: "channel,room,join,leave,members" },
  ],
  skills: ["postgres", "valkey", "websocket", "jwt", "docker"],
  crossRefs: [
    { from: "chat", to: "channels", reason: "messages belong to channels" },
  ],
};

const base = path.resolve("examples/chat-app/.arch");
fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
fs.mkdirSync(path.join(base, "skills"), { recursive: true });

const write = (p, c) => { fs.writeFileSync(path.join(base, p), c); console.log(`  ✓ ${p}`); };

write("SYSTEM.md", genSystemMd(cfg));
write("INDEX.md", genIndexMd(cfg));
write("README.md", genReadme(cfg));
write("BOUNDARIES.md", genBoundariesMd("realtime"));
write("clusters/infra.graph", genInfraGraph(cfg));
cfg.features.forEach(f => write(`clusters/${f.id}.graph`, genGraph(f, cfg)));
cfg.skills.forEach(s => write(`skills/${s}.skill`, genSkillFile(s)));

console.log("\nDone. Run from project root:");
console.log("  node bin/archkit.mjs review examples/chat-app/src/handlers/chat.handler.ts");
