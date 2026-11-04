'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SkillRegistry } = require('../lib/skills/registry');
const { createCrewMcpTools } = require('../lib/mcp/agent-tools');
const { availableSkills, formatCatalog, toMarkdown, syncFile, removeRole } = require('../lib/skills/native');

const example = {
  title: 'Android keyboard cold-start diagnosis',
  problem: 'Diagnose Gboard when switching input language fails after a cold start',
  triggers: ['Gboard keyboard', 'IME first start'],
  steps: ['Reproduce after a cold boot', 'Inspect IME focus transitions'],
  checks: ['Confirm language switching succeeds after reopening the keyboard'],
  checkCategories: ['test']
};

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-skill-agent-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const registry = new SkillRegistry({ storagePath: path.join(dir, 'dna.json') });
  const roleIds = new Set(['role-a', 'role-b']);
  const forRole = roleId => createCrewMcpTools({
    roleId, skillRegistry: registry,
    resolveRole: async id => roleIds.has(id) ? { id, name: id } : null,
    resolveRuntime: async () => ({ providerId: 'codex', conversationId: 'test-thread' })
  });
  return { dir, registry, forRole };
}

test('Agent lists only human-verified active skills, and full content is Role-bound', async t => {
  const { registry, forRole } = await fixture(t);
  const proposal = await registry.propose('role-a', example, ['source-a']);
  assert.deepEqual((await forRole('role-a').crew_skill_list()).skills, []);
  assert.equal(formatCatalog([proposal]), '');
  await assert.rejects(forRole('role-a').crew_skill_get({ skillId: proposal.id }), /not found/);
  await assert.rejects(forRole('role-b').crew_skill_get({ skillId: proposal.id }), /not found/);
  await assert.rejects(forRole('role-a').crew_skill_get({ skillId: '../private' }), /Invalid Skill ID/);

  await registry.recordRuntimeCheck('role-a', [proposal.id], {
    turnId: 'one-turn', checks: [{ category: 'test', outcome: 'passed' }]
  });
  await registry.recordRuntimeCheck('role-a', [proposal.id], {
    turnId: 'two-turn', checks: [{ category: 'test', outcome: 'passed' }]
  });
  assert.equal((await registry.list('role-a')).skills[0].status, 'candidate');
  assert.deepEqual((await forRole('role-a').crew_skill_list()).skills, []);

  await registry.recordEvidence('role-a', proposal.id, {
    kind: 'test', outcome: 'passed', reference: 'manual-regression',
    note: 'Verified the cold start and changed IME language'
  });
  await registry.transition('role-a', proposal.id, 'verify');
  const activated = await registry.transition('role-a', proposal.id, 'activate');
  assert.equal(availableSkills([activated]).length, 1);
  assert.match(formatCatalog([activated]), /crew_skill_get/);
  const loaded = await forRole('role-a').crew_skill_get({ skillId: proposal.id });
  assert.match(loaded.markdown, /## Steps/);
  assert.match(loaded.markdown, /## Checks/);
  assert.equal(loaded.markdown, toMarkdown(activated));
  assert.equal(loaded.source, 'role-skill-dna');
  await assert.rejects(forRole('role-b').crew_skill_get({ skillId: proposal.id }), /not found/);
  assert.equal((await forRole('role-b').crew_skill_list()).skills.length, 0);
});

test('SKILL.md remains readable after registry restart and is removed on retirement', async t => {
  const { dir, registry } = await fixture(t);
  const proposal = await registry.propose('role-a', example, ['source-a']);
  await registry.recordEvidence('role-a', proposal.id, {
    kind: 'ci', outcome: 'passed', reference: 'CI-1', note: 'Verified CI run'
  });
  await registry.transition('role-a', proposal.id, 'verify');
  const active = await registry.transition('role-a', proposal.id, 'activate');
  const nativeFile = await syncFile(active);
  assert.match(nativeFile, /SKILL\.md$/);
  assert.match(await fs.readFile(nativeFile, 'utf8'), /Gboard/);
  const restored = new SkillRegistry({ storagePath: path.join(dir, 'dna.json') });
  assert.equal((await restored.list('role-a')).skills[0].status, 'active');
  assert.match(toMarkdown((await restored.list('role-a')).skills[0]), /## Steps/);
  const retired = await restored.transition('role-a', proposal.id, 'retire');
  await syncFile(retired);
  await assert.rejects(fs.access(nativeFile), { code: 'ENOENT' });
  assert.equal(formatCatalog([retired]), '');
});

test('Legacy auto-activated evidence remains readable but is quarantined', async t => {
  const { registry } = await fixture(t);
  const proposal = await registry.propose('role-a', example, ['source']);
  const raw = JSON.parse(await fs.readFile(registry.storagePath, 'utf8'));
  raw.skills[0].status = 'active';
  raw.skills[0].verification = { method: 'runtime-observed', successfulTurns: 2 };
  await fs.writeFile(registry.storagePath, JSON.stringify(raw));
  const legacy = (await registry.list('role-a')).skills[0];
  assert.equal(availableSkills([legacy]).length, 0);
  assert.throws(() => toMarkdown(legacy), /not active and verified/);
  const pending = await registry.transition('role-a', proposal.id, 'review');
  assert.equal(pending.status, 'candidate');
  assert.equal(pending.verification, null);
  assert.throws(() => removeRole('..'), /Invalid Role id/);
});
