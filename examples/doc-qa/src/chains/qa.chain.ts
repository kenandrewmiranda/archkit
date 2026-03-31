// QA Chain — document question answering
import Anthropic from "@anthropic-ai/sdk";

// VIOLATION: hardcoded LLM provider (should use $llm port interface)
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function qaChain(question: string, context: string[]) {
  // VIOLATION: inline prompt string (should be in src/prompts/)
  const systemPrompt = `You are a helpful document QA assistant. Answer questions based only on the provided context. If the answer is not in the context, say "I don't have enough information."`;

  // VIOLATION: no guardrails (input filtering, output validation, PII detection)
  // VIOLATION: no Langfuse tracing
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Context:\n${context.join("\n\n")}\n\nQuestion: ${question}`,
      },
    ],
  });

  // VIOLATION: no source citations returned
  return { answer: response.content[0].text };
}
