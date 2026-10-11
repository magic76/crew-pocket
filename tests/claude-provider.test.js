'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');

const nativePath = process.env.PATH || '';
const fixtureRoot = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'crew-claude-test-'));
process.env.HOME = fixtureRoot;
process.env.CREW_UPLOADS_DIR = path.join(fixtureRoot, 'uploads');
process.env.CREW_CLAUDE_DATA_DIR = path.join(fixtureRoot, 'claude-store');
process.env.CREW_TEST_ARGS_PATH = path.join(fixtureRoot, 'cli-args.jsonl');
process.env.PATH = fixtureRoot + path.delimiter + nativePath;
const fakeBin = path.join(fixtureRoot, 'claude');

const fake = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('fake-claude 1.0\n');
  process.exit(0);
}
fs.appendFileSync(process.env.CREW_TEST_ARGS_PATH, JSON.stringify(args) + '\n');
const session_id = 'd5a23db8-a79e-4796-9f66-0ac1886d72cc';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
emit({ type: 'system', subtype: 'init', session_id });
if (args.some(arg => arg.includes('SLOW_TEST'))) {
  setInterval(() => {}, 1000);
} else {
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } });
  emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hello world' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'README.md' } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'contents' }] } });
  emit({ type: 'result', is_error: false, result: 'hello world', session_id });
}
`;

const provider = require('../lib/providers/claude');

test.before(async () => {
  await fs.writeFile(fakeBin, fake, { mode: 0o755 });
  await fs.chmod(fakeBin, 0o755);
});
test.after(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  process.env.PATH = nativePath;
});

test('Claude stream, metadata, history, and resume are scoped to the Pocket conversation', async () => {
  const events = [];
  let id;
  await provider.startTurn({
    prompt: '<USER_REQUEST>hello user</USER_REQUEST>',
    model: 'sonnet', effort: 'low', workspace: fixtureRoot,
    onAbort() {}, onEvent(event) { events.push(event); if (event.type === 'session_started') id = event.conversationId; }
  });
  assert.match(id, /^claude_[a-f0-9]{32}$/);
  assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.delta).join(''), 'hello world');
  assert.equal(events.filter(event => event.type === 'turn_completed').length, 1);
  assert.equal(events.find(event => event.type === 'tool' && event.state === 'completed').name, 'Read');
  const first = await provider.getHistory(id);
  assert.equal(first.messages[0].content, 'hello user');
  assert.equal(first.messages[1].content, 'hello world');
  assert.equal(first.messages[1].tools[0].args.file_path, 'README.md');
  assert.equal(first.messages[1].tools[0].output, 'contents');

  await provider.startTurn({
    conversationId: id, prompt: 'second turn', model: 'sonnet',
    workspace: fixtureRoot, onAbort() {}, onEvent() {}
  });
  const args = (await fs.readFile(process.env.CREW_TEST_ARGS_PATH, 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  assert.ok(!args[0].includes('--resume'));
  assert.ok(args[1].includes('--resume'));
  assert.ok(args[1].includes('d5a23db8-a79e-4796-9f66-0ac1886d72cc'));
  const history = await provider.getHistory(id);
  assert.equal(history.messages.length, 4);
  assert.equal((await provider.listConversations()).length, 1);
  assert.equal(provider.getStatus(id).isBusy, false);
});

test('Claude history can be renamed and removed without deleting native sessions', async () => {
  const [row] = await provider.listConversations();
  await provider.renameConversation(row.id, 'My local Claude Role');
  assert.equal((await provider.listConversations())[0].title, 'My local Claude Role');
  assert.equal((await provider.deleteConversation(row.id)).localDataDeleted, true);
  assert.equal((await provider.listConversations()).length, 0);
});

test('Claude turns support non-blocking stop and do not emit fake completion', async () => {
  let sessionId;
  const events = [];
  const done = provider.startTurn({
    prompt: 'SLOW_TEST', model: 'sonnet', workspace: fixtureRoot,
    onAbort() {},
    onEvent(event) {
      events.push(event);
      if (event.type === 'session_started') {
        sessionId = event.conversationId;
        setImmediate(() => provider.stop(sessionId));
      }
    }
  });
  await done;
  assert.equal(provider.getStatus(sessionId).isBusy, false);
  assert.equal(events.some(event => event.type === 'turn_completed'), false);
});

test('a Claude conversation cannot resume from a different workspace', async () => {
  const [row] = await provider.listConversations();
  await assert.rejects(provider.startTurn({
    conversationId: row.id, prompt: 'wrong workspace', workspace: os.tmpdir(),
    onAbort() {}, onEvent() {}
  }), /workspace cannot change/);
});
