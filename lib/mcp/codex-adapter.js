// Shared role-bound Crew tool catalog for native MCP and Codex App Server dynamic tools.
// Codex dynamic tools are a separate protocol adapter, NOT an MCP transport.
const { createCrewMcpTools } = require('./agent-tools');

const defs = Object.freeze([
  {
    name: 'crew_whoami',
    description: "Identify the current Crew Role and its own active session.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'crew_list_roles',
    description: "List public names and descriptions of other available Crew Roles.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'crew_get_inbox',
    description: "Read the current Role's queued Crew messages without marking them delivered.",
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    }, additionalProperties: false }
  },
  {
    name: 'crew_send_message',
    description: "Queue a plain-text message to another Crew Role. Queued does not mean executed or completed.",
    inputSchema: { type: 'object', properties: {
      toRoleId: { type: 'string', minLength: 1, maxLength: 160 },
      message: { type: 'string', minLength: 1, maxLength: 4000 },
      replyToId: { type: 'string', minLength: 1, maxLength: 160 }
    }, required: ['toRoleId','message'], additionalProperties: false }
  },
  {
    name: 'crew_recall',
    description: "Recall long-term memories visible to this Role: own Role/Project/Session and shared Global.",
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', maxLength: 1000 },
      limit: { type: 'integer', minimum: 1, maximum: 10 }
    }, additionalProperties: false }
  },
  {"name":"crew_handoff","description":"Queue a read-only inspection for another Role. Returns taskId.","inputSchema":{"type":"object","properties":{"toRoleId":{"type":"string","minLength":1,"maxLength":160},"task":{"type":"string","minLength":1,"maxLength":4000},"parentTaskId":{"type":"string","maxLength":80},"timeoutMinutes":{"type":"integer","minimum":5,"maximum":60}},"required":["toRoleId","task"],"additionalProperties":false}},
  {"name":"crew_get_task_status","description":"Read a handoff task status and its result.","inputSchema":{"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":80}},"required":["taskId"],"additionalProperties":false}},
  {"name":"crew_report_done","description":"Report outcome for an assigned running task.","inputSchema":{"type":"object","properties":{"taskId":{"type":"string","minLength":1,"maxLength":80},"summary":{"type":"string","minLength":1,"maxLength":2000}},"required":["taskId","summary"],"additionalProperties":false}},
  {
    name: 'crew_context_propose',
    description: 'Propose a context handoff summary after finishing a milestone. Advisory only: native compaction is gated and occurs after the turn, if enabled.',
    inputSchema: { type: 'object', properties: {
      summary: { type: 'string', minLength: 40, maxLength: 2500 },
      keepIds: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 180 } }
    }, required: ['summary'], additionalProperties: false }
  },
  {
    name: 'crew_context_list',
    description: 'List this Role and active session archived tool outputs; no raw data is returned.',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 30 }
    }, additionalProperties: false }
  },
  {
    name: 'crew_context_curate',
    description: 'Attach brief notes to already archived tool outputs. This does not remove them from provider-native context.',
    inputSchema: { type: 'object', properties: {
      items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
        id: { type: 'string', minLength: 64, maxLength: 64 },
        note: { type: 'string', minLength: 3, maxLength: 240 }
      }, required: ['id','note'], additionalProperties: false } }
    }, required: ['items'], additionalProperties: false }
  },
  {
    name: 'crew_context_recall',
    description: 'Read a bounded, paginated piece of an archived tool output from this Role and session.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', minLength: 64, maxLength: 64 },
      offset: { type: 'integer', minimum: 0 },
      maxChars: { type: 'integer', minimum: 1, maximum: 12000 }
    }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'crew_propose_memory',
    description: "Submit a candidate learning for review; it is not added to accepted Memory.",
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', minLength: 1, maxLength: 2000 },
      kind: { type: 'string', maxLength: 80 },
      tags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 64 } },
      evidence: { type: 'array', maxItems: 5, items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['conversation','message','tool','git','document'] },
          id: { type: 'string', minLength: 1, maxLength: 180 }
        }, required: ['type','id'], additionalProperties: false
      } }
    }, required: ['text'], additionalProperties: false }
  }
]);

function listCodexRoleTools() {
  return defs.map(({ name, description, inputSchema }) => ({
    name, description, inputSchema
  }));
}

function parseArguments(input) {
  if (input === undefined || input === null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string' && input.length < 10000) {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  throw new Error('Crew tool arguments must be a JSON object');
}

async function invokeCrewRoleTool(roleId, name, argumentsValue, overrides = {}) {
  if (!defs.some(def => def.name === name)) throw new Error('Unknown Crew tool');
  const methods = createCrewMcpTools({ roleId, ...overrides });
  const args = parseArguments(argumentsValue);
  // The bound role is never an input argument, even if the model provides one.
  return methods[name](args);
}

module.exports = { listCodexRoleTools, invokeCrewRoleTool, parseArguments };
