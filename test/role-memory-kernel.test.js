const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-role-memory-'));
  process.env.CREW_CONVERSATION_SETTINGS_PATH = path.join(tempDir, 'conversation-settings.json');

  const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
  const { MemoryScope } = require('../lib/memory/types');
  const {
    DEFAULT_ROLE_ID,
    RoleStore,
    roleIdForProject
  } = require('../lib/roles');
  const { buildAgentContext, formatAgentContext } = require('../lib/context-builder');
  const conversationSettings = require('../lib/conversation-settings');

  const memoryPath = path.join(tempDir, 'memory', 'records.json');
  const memory = new LocalMemoryProvider({ storagePath: memoryPath });
  const helperRoleId = 'role-crew-helper';
  const teacherRoleId = 'role-crew-teacher';
  const helperProjectId = 'project-crew-helper';
  const teacherProjectId = 'project-crew-teacher';

  try {
    // Case 1: ROLE memory survives conversation boundaries for the same Role.
    const helperMemory = await memory.retain({
      text: 'Crew Helper completion requires terminal evidence.',
      scope: MemoryScope.ROLE,
      roleId: helperRoleId,
      projectId: helperProjectId,
      conversationId: 'conversation-old',
      importance: 0.9
    });
    const helperRecall = await memory.recall({
      text: 'terminal evidence',
      scopes: [MemoryScope.ROLE],
      roleId: helperRoleId,
      projectId: helperProjectId,
      conversationId: 'conversation-new'
    });
    assert.equal(helperRecall.length, 1);
    assert.equal(helperRecall[0].record.id, helperMemory.id);
    assert.equal(helperRecall[0].record.conversationId, 'conversation-old');

    // Case 2: ROLE / PROJECT scope filtering happens before relevance scoring.
    await memory.retain({
      text: 'Crew Helper project-specific terminal evidence must never leak.',
      scope: MemoryScope.PROJECT,
      roleId: helperRoleId,
      projectId: helperProjectId,
      importance: 1
    });
    const teacherRecall = await memory.recall({
      text: 'terminal evidence',
      scopes: [MemoryScope.ROLE, MemoryScope.PROJECT],
      roleId: teacherRoleId,
      projectId: teacherProjectId
    });
    assert.equal(teacherRecall.length, 0);

    // Case 3: GLOBAL memory is visible across Roles.
    const globalMemory = await memory.retain({
      text: 'Always preserve user-authored transcript text.',
      scope: MemoryScope.GLOBAL,
      importance: 0.8
    });
    for (const roleId of [helperRoleId, teacherRoleId]) {
      const globalRecall = await memory.recall({
        text: 'preserve transcript',
        scopes: [MemoryScope.GLOBAL],
        roleId
      });
      assert.ok(globalRecall.some(hit => hit.record.id === globalMemory.id));
    }

    // Case 4: legacy conversation settings lazily receive role-general without
    // losing existing compatibility fields.
    const legacyKey = 'codex:legacy-conversation';
    await fs.mkdir(path.dirname(conversationSettings.SETTINGS_PATH), { recursive: true });
    await fs.writeFile(conversationSettings.SETTINGS_PATH, JSON.stringify({
      [legacyKey]: {
        provider: 'codex',
        model: 'gpt-5.6-terra',
        effort: 'low',
        workspace: '/tmp/crew-helper',
        crewMemberId: 'member-helper',
        role: 'general',
        title: 'Legacy thread',
        customField: 'keep-me'
      }
    }, null, 2) + '\n', 'utf8');

    const migrated = await conversationSettings.getConversationSettings('codex', 'legacy-conversation');
    assert.equal(migrated.roleId, DEFAULT_ROLE_ID);
    assert.equal(migrated.crewMemberId, 'member-helper');
    assert.equal(migrated.workspace, '/tmp/crew-helper');
    assert.equal(migrated.role, 'general');
    assert.equal(migrated.customField, 'keep-me');

    const persistedSettings = JSON.parse(await fs.readFile(conversationSettings.SETTINGS_PATH, 'utf8'));
    assert.equal(persistedSettings[legacyKey].roleId, DEFAULT_ROLE_ID);
    assert.equal(persistedSettings[legacyKey].customField, 'keep-me');

    // Case 5: Context Builder enforces both item count and memory character budget.
    const budgetMemory = new LocalMemoryProvider({
      storagePath: path.join(tempDir, 'memory', 'budget-records.json')
    });
    for (let index = 0; index < 10; index++) {
      await budgetMemory.retain({
        text: `Helper evidence rule ${index}: ${'x'.repeat(120)}`,
        scope: MemoryScope.ROLE,
        roleId: helperRoleId,
        projectId: helperProjectId,
        importance: 0.5 + index / 100
      });
    }

    const helperRole = {
      id: helperRoleId,
      name: 'Crew Helper Developer',
      description: 'Long-lived helper developer role.',
      projectId: helperProjectId,
      systemContext: '',
      skills: []
    };
    const helperProject = {
      id: helperProjectId,
      name: 'Crew Helper',
      workspace: '/tmp/crew-helper',
      systemContext: ''
    };
    const context = await buildAgentContext({
      roleId: helperRoleId,
      projectId: helperProjectId,
      conversationId: 'conversation-budget',
      currentPrompt: 'helper evidence rule',
      memoryProvider: budgetMemory,
      roleResolver: async id => id === helperRoleId ? helperRole : null,
      projectResolver: async id => id === helperProjectId ? helperProject : null,
      memoryBudget: { maxItems: 3, maxChars: 600 }
    });
    assert.ok(context.memories.length <= 3);
    assert.ok(context.memoryChars <= 600);
    assert.ok(context.memories.length < 10);
    const formatted = formatAgentContext(context);
    assert.match(formatted, /\[Crew Role Identity\]/);
    assert.match(formatted, /\[Relevant Long-Term Memory\]/);

    // Case 6: Role points to Project directly and does not depend on Crew Member identity.
    const testProject = {
      id: 'project-helper-domain',
      name: 'crew-helper',
      workspace: '/tmp/crew-helper'
    };
    const roleStore = new RoleStore({
      storagePath: path.join(tempDir, 'roles.json'),
      projectProvider: {
        listProjects: async () => [testProject],
        getProject: async id => id === testProject.id ? testProject : null
      }
    });
    const androidRole = await roleStore.save({
      id: 'role-android-developer',
      name: 'Android Developer',
      projectId: testProject.id
    });
    assert.equal(androidRole.projectId, testProject.id);
    assert.equal(Object.prototype.hasOwnProperty.call(androidRole, 'crewMemberId'), false);
    assert.equal(roleIdForProject(testProject.id), 'role-helper-domain');

    const seededRoles = await roleStore.list();
    const seededProjectRole = seededRoles.find(role => role.projectId === testProject.id && role.source === 'project');
    assert.ok(seededProjectRole);
    assert.equal(seededProjectRole.name, 'Helper Dev');

    console.log('role-memory-kernel tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
