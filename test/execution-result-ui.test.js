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
  assert.match(chatSource, /execution-result-card/, 'chat UI should render collapsed execution result cards');
  assert.match(chatSource, /IntersectionObserver/, 'sticky execution capsule should use viewport observation');
  assert.match(chatSource, /scrollIntoView/, 'sticky execution capsule should navigate back to the active card');
  assert.match(chatSource, /turn_result/, 'chat UI should consume structured turn_result metadata');

  console.log('execution-result-ui regression tests passed');
}

run();
