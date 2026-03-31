#!/usr/bin/env node
import { genSystemMd, genIndexMd, genGraph, genInfraGraph, genSkillFile, genReadme } from "../../src/lib/generators.mjs";
import { genBoundariesMd } from "../../src/data/boundaries.mjs";
import fs from "fs";
import path from "path";

const cfg = {
  appName: "doc-qa",
  appType: "ai",
  stack: {
    "API": "Hono",
    "LLM": "Anthropic Claude (via SDK)",
    "Database": "PostgreSQL + pgvector",
    "Cache": "Valkey (semantic cache)",
    "LLM Observability": "Langfuse",
  },
  features: [
    { id: "rag", name: "RAG (document Q&A)", keywords: "RAG,retrieve,document,search,context,citation" },
    { id: "summarize", name: "Summarization", keywords: "summarize,summary,condense,extract" },
  ],
  skills: ["llm_sdk", "pgvector", "langfuse", "postgres", "valkey", "docker"],
  crossRefs: [
    { from: "summarize", to: "rag", reason: "summarization uses the same document retrieval pipeline" },
  ],
};

const base = path.resolve("examples/doc-qa/.arch");
fs.mkdirSync(path.join(base, "clusters"), { recursive: true });
fs.mkdirSync(path.join(base, "skills"), { recursive: true });

const write = (p, c) => { fs.writeFileSync(path.join(base, p), c); console.log(`  ✓ ${p}`); };

write("SYSTEM.md", genSystemMd(cfg));
write("INDEX.md", genIndexMd(cfg));
write("README.md", genReadme(cfg));
write("BOUNDARIES.md", genBoundariesMd("ai"));
write("clusters/infra.graph", genInfraGraph(cfg));
cfg.features.forEach(f => write(`clusters/${f.id}.graph`, genGraph(f, cfg)));
cfg.skills.forEach(s => write(`skills/${s}.skill`, genSkillFile(s)));

console.log("\nDone. Run from project root:");
console.log("  node bin/archkit.mjs review examples/doc-qa/src/chains/qa.chain.ts");
