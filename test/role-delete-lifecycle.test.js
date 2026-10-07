const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-role-delete-'));
  process.env.CREW_CONVERSATION_SETTINGS_PATH = path.join(tempDir, 'conversation-settings.json');

  const { RoleStore, DEFAULT_ROLE_ID } = require('../lib/roles');
  const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
  const { MemoryScope } = require('../lib/memory/types');
  const { CrewMessageStore } = require('../lib/crew-messages');
  const conversationSettings = require('../lib/conversation-settings');
  const { deleteRoleLifecycle } = require('../lib/role-delete');

  const project = {
    id: 'project-helper',
    name: 'crew-helper',
    workspace: path.join(tempDir, 'crew-helper')
  };
  const projectProvider = {
    listProjects: async () => [project],
    getProject: async id => id === project.id ? project : null
  };

  try {
    // Project-derived Roles are bootstrap-only. Deleting one must not recreate it.
    const roleStore = new RoleStore({
      storagePath: path.join(tempDir, 'roles.json'),
      projectProvider
    });
    const bootstrapped = await roleStore.list();
    const seeded = bootstrapped.find(role => role.projectId === project.id && role.source === 'project');
    assert.ok(seeded);
    assert.equal(await roleStore.delete(seeded.id).then(Boolean), true);
    assert.equal((await roleStore.list()).some(role => role.id === seeded.id), false);
    assert.ok(await roleStore.get(DEFAULT_ROLE_ID));
    await assert.rejects(() => roleStore.delete(DEFAULT_ROLE_ID), /cannot be deleted/);

    const storedRoles = JSON.parse(await fs.readFile(path.join(tempDir, 'roles.json'), 'utf8'));
    assert.equal(storedRoles.version, 2);
    assert.equal(storedRoles.bootstrapped, true);
    assert.equal(storedRoles.roles.some(role => role.id === seeded.id), false);

    // Deleting Role Memory removes only ROLE scope owned by the Role.
    const memory = new LocalMemoryProvider({
      storagePath: path.join(tempDir, 'memory', 'records.json')
    });
    await memory.retain({
      id: 'role-memory-target',
      text: 'target role memory',
      scope: MemoryScope.ROLE,
      roleId: seeded.id
    });
    await memory.retain({
      id: 'role-memory-other',
      text: 'other role memory',
      scope: MemoryScope.ROLE,
      roleId: 'role-other'
    });
    await memory.retain({
      id: 'project-memory-target',
      text: 'project memory remains',
      scope: MemoryScope.PROJECT,
      roleId: seeded.id,
      projectId: project.id
    });
    await memory.retain({
      id: 'session-memory-target',
      text: 'session memory remains',
      scope: MemoryScope.SESSION,
      roleId: seeded.id,
      conversationId: 'conversation-1'
    });

    assert.equal(await memory.forgetRole(seeded.id), 1);
    const remainingMemoryIds = (await memory.readAll()).map(record => record.id).sort();
    assert.deepEqual(remainingMemoryIds, [
      'project-memory-target',
      'role-memory-other',
      'session-memory-target'
    ]);

    // Pending messages involving the deleted Role are removed; delivered history remains
    // with a Role-name snapshot.
    const roleList = [
      { id: 'role-a', name: 'Role A', description: '' },
      { id: 'role-b', name: 'Role B', description: '' }
    ];
    const roleProvider = {
      listRoles: async () => roleList,
      getRole: async id => roleList.find(role => role.id === id) || null
    };
    const messages = new CrewMessageStore({
      storagePath: path.join(tempDir, 'crew-messages.json'),
      roleProvider
    });
    const delivered = await messages.send({
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'delivered history'
    });
    await messages.markDelivered('role-b', [delivered.id]);
    await messages.send({
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'pending incoming'
    });
    await messages.send({
      fromRoleId: 'role-b',
      toRoleId: 'role-a',
      content: 'pending outgoing'
    });

    const cleanup = await messages.removePendingForRole('role-b', 'Role B');
    assert.equal(cleanup.removed, 2);
    assert.equal(cleanup.preserved, 1);

    roleList.splice(roleList.findIndex(role => role.id === 'role-b'), 1);
    const activity = await messages.recentActivity('role-a');
    assert.equal(activity.length, 1);
    assert.equal(activity[0].toRoleName, 'Role B（已刪除）');
    assert.equal(activity[0].content, 'delivered history');

    // Conversation history remains owned by the historical role id with a name snapshot.
    await conversationSettings.saveConversationSettings('codex', 'thread-1', {
      model: 'gpt-test',
      effort: 'low',
      roleId: 'role-b',
      role: 'general'
    });
    assert.equal(await conversationSettings.markRoleDeleted('role-b', 'Role B', 123456), 1);
    const historical = await conversationSettings.getConversationSettings('codex', 'thread-1');
    assert.equal(historical.roleId, 'role-b');
    assert.equal(historical.roleNameSnapshot, 'Role B');
    assert.equal(historical.roleDeletedAt, 123456);

    // Lifecycle coordinator preserves history, clears live state, then deletes the Role.
    const calls = [];
    const deleted = await deleteRoleLifecycle('role-z', {
      getRoleFn: async id => id === 'role-z' ? { id, name: 'Role Z' } : null,
      deleteRoleFn: async id => {
        calls.push(['deleteRole', id]);
        return { id, name: 'Role Z' };
      },
      memoryProvider: {
        forgetRole: async id => {
          calls.push(['forgetRole', id]);
          return 3;
        }
      },
      clearRoleRuntimeFn: async id => {
        calls.push(['clearRuntime', id]);
        return true;
      },
      removePendingMessagesFn: async (id, name) => {
        calls.push(['removePending', id, name]);
        return { removed: 2, preserved: 4 };
      },
      markRoleDeletedFn: async (id, name, deletedAt) => {
        calls.push(['snapshotHistory', id, name, deletedAt]);
        return 5;
      },
      stopActiveRoleFn: async role => {
        calls.push(['stopActive', role.id]);
        return true;
      },
      now: () => 777
    });
    assert.equal(deleted.deletedAt, 777);
    assert.equal(deleted.stoppedActiveWork, true);
    assert.equal(deleted.deletedMemories, 3);
    assert.equal(deleted.pendingMessagesDeleted, 2);
    assert.equal(deleted.historicalMessagesPreserved, 4);
    assert.equal(deleted.conversationSnapshots, 5);
    assert.equal(calls.at(-1)[0], 'deleteRole');

    await assert.rejects(
      () => deleteRoleLifecycle(DEFAULT_ROLE_ID, {
        getRoleFn: async () => ({ id: DEFAULT_ROLE_ID, name: 'General Developer' })
      }),
      /cannot be deleted/
    );

    console.log('role-delete-lifecycle tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
