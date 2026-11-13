#!/usr/bin/env node
/**
 * DDT Finance Gateway MCP server (local staging + sandbox read-only).
 * Does not register create/update/delete QuickBooks tools.
 * Does not implement apply_approved_batch.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RegisterTool } from '../../helpers/register-tool.js';
import { DDT_FINANCE_GATEWAY_TOOLS } from './mcp-tools.js';
import { initGateway, packageRootDir } from './operations.js';

async function main() {
  // Force write tool categories off for this process even if .env left them false.
  process.env.QUICKBOOKS_DISABLE_WRITE = 'true';
  process.env.QUICKBOOKS_DISABLE_UPDATE = 'true';
  process.env.QUICKBOOKS_DISABLE_DELETE = 'true';

  initGateway(packageRootDir());

  const server = new McpServer(
    {
      name: 'DDT Finance Gateway',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  for (const tool of DDT_FINANCE_GATEWAY_TOOLS) {
    RegisterTool(server, tool as any);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('DDT Finance Gateway failed to start:', error);
  process.exit(1);
});
