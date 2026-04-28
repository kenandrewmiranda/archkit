// src/mcp/server.mjs
// archkit MCP server — stdio transport, no auth, no persistent state.
// Exposes 10 archkit_* tools defined in ./tools.mjs.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools.mjs";
import { toMcpResult, toMcpError, formatZodError } from "./envelope.mjs";
import { archkitError } from "../lib/errors.mjs";

export async function startMcpServer() {
  const server = new McpServer({
    name: "archkit",
    version: "1.4.0",
  });

  for (const [toolName, def] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (rawInput) => {
        const parsed = def.inputSchema.safeParse(rawInput);
        if (!parsed.success) {
          return toMcpError(archkitError(
            "invalid_input",
            formatZodError(parsed.error),
            { suggestion: "Check the tool's input schema." }
          ));
        }
        try {
          const result = await def.handler(parsed.data);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err);
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    process.stderr.write("[archkit-mcp] shutting down\n");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.stderr.write("[archkit-mcp] ready (stdio, 10 tools)\n");
}
