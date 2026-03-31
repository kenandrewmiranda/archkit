// Summarize Chain
import Anthropic from "@anthropic-ai/sdk";
import { trace } from "langfuse";

// VIOLATION: hardcoded provider (should use adapter)
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// At least has tracing (partial compliance)
export async function summarizeChain(document: string) {
  // VIOLATION: inline prompt (should be in src/prompts/)
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      { role: "user", content: `Summarize the following document concisely:\n\n${document}` },
    ],
  });

  return { summary: response.content[0].text };
}
