'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createQueuedMessageDelivery } = require('../public/js/queued-message-delivery');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 2400) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Timed out: ' + label);
    await pause(12);
  }
}

function createHarness({ outcomes = [], scope = { roleId: 'role-a', providerId: 'codex', conversationId: 'conv-a' } } = {}) {
  const queue = [];
  const calls = [];
  const states = [];
  let busy = false;
  let hydrations = 0;
  let index = 0;
  const controller = createQueuedMessageDelivery({
    getScope: () => scope,
    list: () => [...queue],
    hydrate: async () => { hydrations++; },
    isBusy: () => busy,
    deliver: async message => {
      calls.push(message.id);
      const response = outcomes[index++] || { accepted: true };
      // The simulated provider acknowledges the turn before the queue removes it.
      if (response.accepted) queue.splice(queue.indexOf(message), 1);
      await pause(3);
      return response;
    },
    onState: (message, status) => states.push(message.id + ':' + status)
  });
  const add = (id, conversationId = 'conv-a') => queue.push({
    id, roleId: 'role-a', providerId: 'codex', conversationId, text: id
  });
  return { controller, queue, calls, states, add, scope, get hydrations() { return hydrations; }, set busy(value) { busy = value; } };
}

(async () => {
  const first = createHarness({ outcomes: [
    { accepted: false, retryable: true, error: 'CONVERSATION_BUSY' },
    { accepted: true }, { accepted: true }
  ] });
  first.add('one');
  first.add('two');
  first.busy = true;
  first.controller.kick('role-a');
  await pause(25);
  assert.deepEqual(first.calls, [], 'cannot send while previous Role turn is busy');
  first.busy = false;
  first.controller.kick('role-a');
  first.controller.kick('role-a');
  await until(() => first.calls.length === 1, 'first send attempt');
  assert.equal(first.queue.length, 2, '409 must never dequeue unaccepted input');
  await until(() => first.queue.length === 0, '409 retry + ordered subsequent message');
  assert.deepEqual(first.calls, ['one', 'one', 'two'], 'one in flight per Role, FIFO after acceptance');
  assert.ok(first.states.includes('one:waiting'));

  const failed = createHarness({ outcomes: [{ accepted: false, retryable: false, error: 'offline' }, { accepted: true }] });
  failed.add('unsent');
  failed.controller.kick('role-a');
  await until(() => failed.states.includes('unsent:failed'), 'failed status');
  assert.equal(failed.queue.length, 1, 'non-retryable failure keeps persistent queue record');
  failed.controller.kick('role-a');
  await pause(30);
  assert.deepEqual(failed.calls, ['unsent'], 'failed message must not be resent on automatic kicks');
  failed.controller.retry('role-a', 'unsent');
  await until(() => failed.queue.length === 0, 'manual retry');
  assert.deepEqual(failed.calls, ['unsent', 'unsent']);

  const wrongThread = createHarness();
  wrongThread.add('target-a');
  wrongThread.scope.conversationId = 'conv-b';
  wrongThread.controller.kick('role-a');
  await pause(25);
  assert.deepEqual(wrongThread.calls, [], 'never send queued message into another conversation');
  wrongThread.scope.conversationId = 'conv-a';
  wrongThread.controller.kick('role-a');
  await until(() => wrongThread.queue.length === 0, 'back on thread');

  const chat = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(chat, /function acceptQueuedDelivery\(\)/, 'provider init must acknowledge durable queued record');
  assert.match(chat, /if \(queuedDelivery\) acceptQueuedDelivery\(\)/);
  assert.match(chat, /stoppingRoleStreams\.add\(roleId\)/);
  assert.match(chat, /queuedMessageDelivery\.kick\(currentStreamRoleId\(\)\)/);
  assert.doesNotMatch(chat.slice(chat.indexOf('if (queuedInterruptBtn) {')), /setTimeout\(\(\) => \{\s*sendMessage\(msgToSend\)/, 'no fixed 200ms send race');
  assert.match(html, /queued-message-delivery\.js/);
  console.log('queued-message-delivery: ack, busy retry, FIFO, failure recovery, thread isolation, UI integration passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
