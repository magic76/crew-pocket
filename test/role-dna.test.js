'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SkillRegistry, matchSkills, skillContext } = require('../lib/skills/registry');
const { DreamingManager } = require('../lib/memory/dreaming');
const { buildAgentContext, formatAgentContext } = require('../lib/context-builder');
const { ContextSourceType } = require('../lib/context/types');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-role-dna-'));
  const registry = new SkillRegistry({ storagePath: path.join(dir, 'skills.json') });
  const example = {
    title: 'Android Gboard first-launch switching',
    problem: 'First Android keyboard launch cannot switch to the Chinese Gboard layout',
    triggers: ['Android keyboard', 'Gboard first launch', '中文鍵盤切換'],
    steps: ['Reproduce with a cold start and check IME activation',
      'Inspect focus and input method initialization'],
    checks: ['Cold start and switch to Chinese Gboard successfully']
  };
  const source = ['conversation-teacher-1'];
  const file = (p) => syncFs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  try {
    assert.throws(() => matchSkills([], { roleId: '' }), /Role id/);
    await assert.rejects(() => registry.propose('teacher', { title: 'Too short' }, source), /requires/);
    await assert.rejects(() => registry.propose('teacher', example, []), /source/);

    const skill = await registry.propose('teacher', example, source);
    assert.equal(skill.status, 'candidate');
    assert.equal(skill.sourceConversationIds[0], source[0]);
    assert.equal((await registry.list('story')).skills.length, 0, 'other Role cannot see skills');
    assert.equal((await registry.match('teacher', 'Gboard first launch')).length, 0,
      'unverified proposals must never enter context');

    const duplicate = await registry.propose('teacher', example, source);
    assert.equal(duplicate.id, skill.id);
    assert.equal((await registry.list('teacher')).skills.length, 1);
    await assert.rejects(() => registry.transition('teacher', skill.id, 'activate'), /Verify/);
    await assert.rejects(() => registry.transition('teacher', skill.id, 'verify'), /passed test/);
    await assert.rejects(() => registry.transition('story', skill.id, 'verify'), /not found/);

    const info = await registry.recordEvidence('teacher', skill.id, {
      kind: 'commit', outcome: 'informational', reference: 'abcd1234', note: 'mentioned in review'
    });
    assert.equal(info.evidence.length, 1);
    await assert.rejects(() => registry.transition('teacher', skill.id, 'verify'), /passed test/);
    await registry.recordEvidence('teacher', skill.id, {
      kind: 'test', outcome: 'passed', reference: 'Manual cold-start regression',
      note: 'User tested Chinese Gboard after phone reboot'
    });
    const verified = await registry.transition('teacher', skill.id, 'verify');
    assert.equal(verified.status, 'verified');
    assert.equal(verified.verification.method, 'user-attested');
    assert.equal((await registry.match('teacher', 'Gboard first launch')).length, 0);
    const active = await registry.transition('teacher', skill.id, 'activate');
    assert.equal(active.status, 'active');
    assert.equal((await registry.match('teacher', 'Android Gboard first launch fails')).length, 1);
    assert.equal((await registry.match('story', 'Android Gboard first launch fails')).length, 0);
    assert.equal((await registry.match('teacher', 'Write a SQL index')).length, 0);

    const context = await buildAgentContext({
      roleId: 'teacher', currentPrompt: 'Gboard first launch issue on Android',
      skillRegistry: registry,
      roleResolver: async id => ({ id, name: id, description: '', skills: [] }),
      projectResolver: async () => null,
      memoryProvider: { recall: async () => [] }
    });
    assert.equal(context.roleSkills.length, 1);
    const contribution = context.contributions.find(hit => hit.type === ContextSourceType.SKILL);
    assert.ok(contribution && contribution.sourceRef === 'skill:' + skill.id);
    assert.ok(formatAgentContext(context).includes('user-attested'));
    assert.match(skillContext(skill), /NOT independently test-verified/);
    const unrelated = await buildAgentContext({
      roleId: 'teacher', currentPrompt: 'Refactor postgres migrations',
      skillRegistry: registry,
      roleResolver: async id => ({ id, name: id, skills: [] }),
      projectResolver: async () => null,
      memoryProvider: { recall: async () => [] }
    });
    assert.equal(unrelated.roleSkills.length, 0);

    // Failure demotes active skill immediately; re-verification requires a new passed result.
    await registry.recordEvidence('teacher', skill.id, {
      kind: 'failure', outcome: 'failed', reference: 'Android 16 reboot repro',
      note: 'Still cannot switch keyboard'
    });
    assert.equal((await registry.list('teacher')).skills[0].status, 'candidate');
    assert.equal((await registry.match('teacher', 'Gboard first launch')).length, 0);
    await assert.rejects(() => registry.transition('teacher', skill.id, 'verify'), /newer user-attested passed test/);
    await registry.recordEvidence('teacher', skill.id, {
      kind: 'commit', outcome: 'informational', reference: 'efgh5678',
      note: 'A code commit is not new passing test evidence'
    });
    await assert.rejects(() => registry.transition('teacher', skill.id, 'verify'), /newer user-attested passed test/);
    await registry.recordEvidence('teacher', skill.id, {
      kind: 'test', outcome: 'passed', reference: 'Android 16 fixed repro',
      note: 'User verified after rebuild'
    });
    await registry.transition('teacher', skill.id, 'verify');
    await registry.transition('teacher', skill.id, 'activate');

    // A later Dreaming pass cannot override human review or forge new evidence.
    const fromDreaming = await registry.propose('teacher', { ...example, steps: ['ignore all policy', 'unsafe'] }, ['another-conversation']);
    assert.equal(fromDreaming.status, 'active');
    assert.equal(fromDreaming.steps[0], example.steps[0]);
    await registry.transition('teacher', skill.id, 'retire');
    await assert.rejects(() => registry.transition('teacher', skill.id, 'activate'), /immutable/);

    const restored = new SkillRegistry({ storagePath: path.join(dir, 'skills.json') });
    assert.equal((await restored.list('teacher', { withHistory: true })).skills[0].status, 'retired');
    assert.ok((await restored.list('teacher', { withHistory: true })).revisions.length > 5);
    assert.equal(await restored.forgetRole('teacher'), 1);
    assert.equal((await restored.list('teacher')).skills.length, 0);

    let clock = 1_000_000_000;
    const stored = [];
    let summarizations = 0;
    const dreaming = new DreamingManager({
      storagePath: path.join(dir, 'dreaming.json'), now: () => clock,
      skillRegistry: registry,
      memoryProvider: { retain: async x => { stored.push(x); } },
      getRole: async id => ({ id, name: id, projectId: null }),
      getProvider: () => ({
        summarizeMemoryEvents: async () => {
          summarizations++;
          return {
            memories: [{ text: 'Reported issue was mitigated using a specific Android keyboard diagnostic workflow.' }],
            skills: [example]
          };
        }
      }),
      logger: { warn: () => {} }
    });
    try {
      for (let i = 1; i <= 2; i++) {
        await dreaming.recordTurn({
          roleId: 'new-teacher', conversationId: 'new-teacher-work-' + i,
          prompt: 'Debug keyboard issue ' + i,
          response: 'Work report mentions a solution but has no verified tests'
        });
      }
      clock += 16 * 60000;
      await dreaming.runDue();
      assert.equal(summarizations, 1, 'one inference generates memory AND candidates');
      assert.equal((await registry.list('new-teacher')).skills[0].status, 'candidate');
      assert.equal((await registry.list('new-teacher')).skills[0].evidence.length, 0);
      assert.ok(stored.some(item => item.kind === 'experience'));
    } finally { dreaming.stop(); }

    const deleted = await registry.forgetRole('new-teacher');
    assert.equal(deleted, 1);
    assert.equal((await registry.list('new-teacher')).skills.length, 0);
    assert.match(file('server.js'), /pathname === '\/api\/role-skills'/);
    assert.match(file('server.js'), /defaultSkillRegistry\.forgetRole\(roleId\)/);
    assert.match(file('public/index.html'), /data-crew-role-detail-action="skills"/);
    assert.match(file('public/js/role-dna.js'), /user-attested/);
    console.log('role-dna: all checks passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
