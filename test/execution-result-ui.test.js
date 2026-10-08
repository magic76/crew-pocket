const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTurnResult } = require('../lib/turn-result');

function run() {
  assert.equal(buildTurnResult({
    executionPolicy: { mode: 'CHAT' },
    toolMetrics: { events: 0, unique_tools: 0, executions: 0, polls: 0, changed_files: [] },
    elapsedMs: 420
  }), null, 'ordinary chat must not become an execution result');

  assert.equal(buildTurnResult({
    executionPolicy: { mode: 'INSPECT' },
    toolMetrics: { events: 0, unique_tools: 0, executions: 0, polls: 0, changed_files: [] },
    elapsedMs: 420
  }), null, 'tool-less inspect answers must stay ordinary answers');

  assert.equal(buildTurnResult({
    executionPolicy: { mode: 'CHAT' },
    toolMetrics: { events: 2, unique_tools: 1, executions: 1, polls: 0, changed_files: [] },
    elapsedMs: 900
  }), null, 'ordinary tool-assisted chat must stay expanded');

  assert.equal(buildTurnResult({
    executionPolicy: { mode: 'INSPECT' },
    toolMetrics: { events: 2, unique_tools: 1, executions: 1, polls: 0, changed_files: [] },
    elapsedMs: 900
  }), null, 'single-step inspect should not be collapsed as a heavy execution');

  const inspected = buildTurnResult({
    executionPolicy: { mode: 'INSPECT' },
    toolMetrics: { events: 4, unique_tools: 2, executions: 2, polls: 0, changed_files: [] },
    elapsedMs: 1200
  });
  assert.equal(inspected.kind, 'execution', 'multi-step inspect should become an execution result');

  const result = buildTurnResult({
    requestId: 'req-1',
    executionPolicy: { mode: 'SURGICAL_EDIT' },
    toolMetrics: {
      events: 5,
      unique_tools: 3,
      executions: 4,
      polls: 1,
      changed_files: ['public/js/chat.js', 'public/js/chat.js', 'server.js']
    },
    elapsedMs: 84211,
    status: 'completed'
  });

  assert.equal(result.kind, 'execution');
  assert.equal(result.status, 'completed');
  assert.equal(result.execution_mode, 'SURGICAL_EDIT');
  assert.equal(result.duration_ms, 84211);
  assert.deepEqual(result.changed_files, ['public/js/chat.js', 'server.js']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'commit'), false, 'commit must not be inferred');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'checks'), false, 'build/test checks must not be inferred');

  const failed = buildTurnResult({
    executionPolicy: { mode: 'DEBUG' },
    toolMetrics: { unique_tools: 1, executions: 1, changed_files: [] },
    elapsedMs: 1000,
    error: 'boom'
  });
  assert.equal(failed.status, 'failed', 'structured tool failures should produce a failed result');

  const chatSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.ok(
    !uiSource.includes("if (isStreaming) return alert('目前正在回覆中，請完成後再切換 Role。');"),
    'role switching must not be blocked by another role streaming'
  );
  assert.match(uiSource, /syncActiveRoleStreamingState/, 'activating a role must sync its own streaming state');
  assert.match(uiSource, /preserveActiveStream: true/, 'restoring a role on another provider must not stop its background stream');
  assert.match(chatSource, /const activeRoleStreamRegistry = new Map\(\)/, 'chat UI should track streams by role');
  assert.match(chatSource, /const streamRoleId = currentStreamRoleId\(\)/, 'each live turn must capture its owning role');
  assert.match(chatSource, /registerActiveRoleStream\(\{/, 'live turns must register against their role');
  assert.match(chatSource, /clearActiveRoleStream\(streamRoleId, streamAbortController\)/, 'finishing one role must only clear its own stream');
  assert.match(chatSource, /activeStream\?\.provider \|\| currentProvider/, 'stop must target the active role provider');
  assert.match(chatSource, /const queuedMessagesByRole = new Map\(\)/, 'queued messages must be cached per role');
  assert.match(chatSource, /\/api\/role-queue/, 'queued messages must persist through the backend Role queue');
  assert.match(chatSource, /updateHeader: isStreamVisible\(\)/, 'background role completion must not overwrite the visible role header');
  assert.match(appSource, /window\.stopGeneration/, 'new work should stop only the current role stream');

  assert.match(chatSource, /execution-result-card/, 'chat UI should render collapsed execution result cards');
  assert.match(chatSource, /IntersectionObserver/, 'sticky execution capsule should use viewport observation');
  assert.match(chatSource, /scrollIntoView/, 'sticky execution capsule should navigate back to the active card');
  assert.match(chatSource, /turn_result/, 'chat UI should consume structured turn_result metadata');

  console.log('execution-result-ui regression tests passed');
}

run();
