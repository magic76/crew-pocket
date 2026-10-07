const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CrewMessageStore } = require('../lib/crew-messages');
const sourceFs = require('node:fs');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-role-messaging-'));
  const roles = [
    { id: 'role-helper', name: 'Crew Helper Developer', description: 'Helper role' },
    { id: 'role-general', name: 'General Developer', description: 'General role' },
    { id: 'role-teacher', name: 'Crew Teacher Developer', description: 'Teacher role' }
  ];
  const roleProvider = {
    listRoles: async () => roles,
    getRole: async id => roles.find(role => role.id === id) || null
  };
  const store = new CrewMessageStore({
    storagePath: path.join(tempDir, 'crew-messages.json'),
    roleProvider
  });

  try {
    const listed = await store.listAvailableRoles();
    assert.deepEqual(listed.map(role => role.id), ['role-helper', 'role-general', 'role-teacher']);
    assert.equal(Object.prototype.hasOwnProperty.call(listed[0], 'projectId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(listed[0], 'systemContext'), false);

    const sent = await store.send({
      fromRoleId: 'role-helper',
      toRoleId: 'role-general',
      content: 'Please review the navigation fallback.'
    });
    assert.equal(sent.fromRoleId, 'role-helper');
    assert.equal(sent.toRoleId, 'role-general');
    assert.equal(sent.fromRoleName, 'Crew Helper Developer');
    assert.equal(sent.toRoleName, 'General Developer');

    const inbox = await store.inbox('role-general');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].content, 'Please review the navigation fallback.');
    assert.equal(inbox[0].deliveredAt, null);
    assert.equal((await store.inbox('role-teacher')).length, 0);

    const stored = JSON.parse(await fs.readFile(path.join(tempDir, 'crew-messages.json'), 'utf8'));
    assert.deepEqual(
      Object.keys(stored.messages[0]).sort(),
      ['content', 'createdAt', 'deliveredAt', 'fromRoleId', 'id', 'replyToId', 'toRoleId'].sort()
    );
    for (const forbidden of ['context', 'memory', 'conversation', 'project', 'workspace']) {
      assert.equal(Object.prototype.hasOwnProperty.call(stored.messages[0], forbidden), false);
    }

    assert.equal(await store.markDelivered('role-general', [sent.id]), 1);
    assert.equal((await store.inbox('role-general')).length, 0);
    assert.equal((await store.inbox('role-general', { undeliveredOnly: false })).length, 1);

    const reply = await store.send({
      fromRoleId: 'role-general',
      toRoleId: 'role-helper',
      content: 'Looks good. Keep fallback in runtime policy.',
      replyToId: sent.id
    });
    assert.equal(reply.replyToId, sent.id);
    assert.equal((await store.inbox('role-helper'))[0].fromRoleId, 'role-general');

    await assert.rejects(
      () => store.send({ fromRoleId: 'role-helper', toRoleId: 'role-helper', content: 'self' }),
      /another Role/
    );
    await assert.rejects(
      () => store.send({ fromRoleId: 'role-helper', toRoleId: 'role-missing', content: 'hello' }),
      /Recipient Role does not exist/
    );
    await assert.rejects(
      () => store.send({ fromRoleId: 'role-helper', toRoleId: 'role-general', content: '' }),
      /Message content is required/
    );

    const root = path.join(__dirname, '..');
    const server = sourceFs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const tool = sourceFs.readFileSync(path.join(root, 'scripts', 'crew-tool.js'), 'utf8');
    assert.ok(server.includes("pathname === '/api/crew-tool'"));
    assert.ok(server.includes("action === 'list_roles'"));
    assert.ok(server.includes("action === 'send_message'"));
    assert.ok(server.includes('crewAutoResponder.dispatch(message, { waitForReply: true })'));
    assert.ok(server.includes('const crewToolGuide = buildCrewToolGuide(role)'));
    assert.equal(server.includes('shouldExposeCrewTool'), false);
    assert.ok(server.includes('getCrewInbox(role.id'));
    assert.ok(server.includes('markCrewMessagesDelivered(role.id'));
    assert.ok(server.includes("produced inside each sender Role\\'s own current conversation") || server.includes("produced inside each sender Role's own current conversation"));
    assert.ok(tool.includes('crew-tool roles'));
    assert.ok(tool.includes('crew-tool send <from-role-id> <to-role-id> <message...>'));
    assert.ok(tool.includes("auto_response\\t"));
    assert.ok(tool.includes("recipient_conversation\\t"));
    assert.ok(tool.includes("reply\\t"));

    console.log('crew-role-messaging tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
