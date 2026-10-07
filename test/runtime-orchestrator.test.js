const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  inferPromptExecutionMode,
  looksLikeContinuation,
  selectPolicyCompatibleCandidate
} = require('../lib/runtime/turn-orchestrator');

assert.equal(inferPromptExecutionMode('review下最新code'), 'INSPECT');
assert.equal(inferPromptExecutionMode('修一下這個按鈕'), 'SURGICAL_EDIT');
assert.equal(inferPromptExecutionMode('為什麼一直閃退'), 'DEBUG');
assert.equal(inferPromptExecutionMode('build aab release'), 'BUILD');
assert.equal(inferPromptExecutionMode('你好'), 'CHAT');
assert.equal(looksLikeContinuation('做吧'), true);
assert.equal(looksLikeContinuation('幫我重構整個專案'), false);

const policy = {
  mode: 'SURGICAL_EDIT',
  allowWrite: true,
  maxFilesChanged: 3,
  hardToolExecutions: 12,
  allowBuild: false,
  allowDependencyChanges: false
};
const selected = selectPolicyCompatibleCandidate([
  {
    id: 'too-wide',
    intent: {
      summary: 'wide',
      expectedFiles: 8,
      estimatedTools: 20,
      needsBuild: true,
      needsDependencyChange: false,
      destructive: false,
      broadRefactor: false
    }
  },
  {
    id: 'narrow',
    intent: {
      summary: 'narrow',
      expectedFiles: 1,
      estimatedTools: 4,
      needsBuild: false,
      needsDependencyChange: false,
      destructive: false,
      broadRefactor: false
    }
  }
], policy);
assert.equal(selected?.id, 'narrow');

const root = path.join(__dirname, '..');
for (const file of [
  'server.js',
  'lib/auth.js',
  'lib/runtime/turn-orchestrator.js',
  'lib/providers/codex.js',
  'public/index.html',
  'public/js/auth.js',
  'public/js/chat.js'
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(source, /\bjev\b|TypeSafe Jev|TYPESAFE_API_KEY/i, file);
}

assert.equal(fs.existsSync(path.join(root, 'lib', 'jev-router.js')), false);
assert.equal(fs.existsSync(path.join(root, 'lib', 'runtime-decision.js')), false);

console.log('runtime-orchestrator tests: ok');
