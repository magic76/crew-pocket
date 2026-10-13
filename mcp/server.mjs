// Standalone MCP process: each process is bound to exactly one trusted Role.
// Never attach a single process to a multi-Role Codex App Server instance.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCrewMcpTools } = require('../lib/mcp/agent-tools.js');

const roleId = process.env.CREW_MCP_ROLE_ID;
if (!roleId || !/^[A-Za-z0-9._-]{1,160}$/.test(roleId)) {
  console.error('Crew Pocket MCP requires CREW_MCP_ROLE_ID from the trusted launcher');
  process.exit(2);
}

const tools = createCrewMcpTools({ roleId });
// Fail closed when a configured role has been deleted.
try {
  await tools.crew_whoami();
} catch (error) {
  console.error('Crew Pocket MCP: ' + error.message);
  process.exit(2);
}

const server = new McpServer({
  name: 'crew-pocket',
  version: '0.1.0'
}, {
  instructions: 'Tools operate as the already-bound Role. Never assume that a sent message was read or executed. Memory proposals are pending review, not retained memories.'
});

function addTool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const result = await run(args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: String(error.message || error).slice(0, 500) }]
      };
    }
  });
}

const bounded = (max) => z.string().min(1).max(max);

addTool('crew_whoami', 'Get this connection\'s bound Crew Role and its active runtime.',
  z.object({}), () => tools.crew_whoami());

addTool('crew_list_roles', 'Discover other Crew Roles without reading their private contexts.',
  z.object({}), () => tools.crew_list_roles());

addTool('crew_get_inbox', 'Read pending messages addressed to this Role; does not mark as delivered.',
  z.object({ limit: z.number().int().min(1).max(50).optional() }),
  args => tools.crew_get_inbox(args));

addTool('crew_send_message', 'Queue a plain-text message to another Role. A queued receipt does not mean task completion.',
  z.object({
    toRoleId: bounded(160),
    message: bounded(4000),
    replyToId: bounded(160).optional()
  }), args => tools.crew_send_message(args));

addTool('crew_recall', 'Recall permitted Global, own Role, own Project and active Session memories.',
  z.object({
    query: z.string().max(1000).optional(),
    limit: z.number().int().min(1).max(10).optional()
  }), args => tools.crew_recall(args));

addTool('crew_propose_memory', 'Propose a Role memory candidate for later review. Does not directly save canonical memory.',
  z.object({
    text: bounded(2000),
    kind: z.string().max(80).optional(),
    tags: z.array(bounded(64)).max(8).optional(),
    evidence: z.array(z.object({
      type: z.enum(['conversation', 'message', 'tool', 'git', 'document']),
      id: bounded(180)
    })).max(5).optional()
  }), args => tools.crew_propose_memory(args));

addTool('crew_handoff', 'Queue a delegated read-only task for another Role.',
  z.object({ toRoleId: bounded(160), task: bounded(4000),
    parentTaskId: bounded(80).optional(), timeoutMinutes: z.number().int().min(5).max(60).optional() }),
  args => tools.crew_handoff(args));
addTool('crew_get_task_status', 'Read the progress and result of a task you own or received.',
  z.object({ taskId: bounded(80) }), args => tools.crew_get_task_status(args));
addTool('crew_report_done', 'Submit findings for a running task assigned to your Role.',
  z.object({ taskId: bounded(80), summary: bounded(2000) }), args => tools.crew_report_done(args));
// stdout belongs exclusively to MCP JSON-RPC; do not console.log here.
await serveStdio(() => server);
