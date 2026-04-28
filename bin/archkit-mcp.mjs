#!/usr/bin/env node
// archkit-mcp — stdio MCP server for archkit.
// Also reachable via `archkit mcp serve`.

import { startMcpServer } from "../src/mcp/server.mjs";

startMcpServer().catch(err => {
  process.stderr.write(`[archkit-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
