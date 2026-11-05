'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SkillRegistry } = require('../lib/skills/registry');
const { eligibility, commandFromEvent, observedTest } = require('../lib/skills/auto-verify');
const { availableSkills, toMarkdown } = require('../lib/skills/native');

const command = 'node --test test/safe-regression.test.js';
const example = {
  title: 'Safe UI regression testing',
  problem: 'Improve repeatable UI behavior regression checks',
  triggers: ['UI regression', 'frontend unit test'],
  steps: ['Inspect the UI regression case', 'Run the focused regression test'],
  checks: [command], checkCategories: ['test']
};
const tap = '# tests 3\n# suites 0\n# pass 3\n# fail 0\n';
const event = (cmd = command, code = 0, output = tap) => ({
  state: code === 0 ? 'completed' : 'failed',
  info: { parameters: { command: cmd }, exitCode: code, output }
});
const accepted = observedTest(event());

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-skill-auto-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new SkillRegistry({ storagePath: path.join(dir, 'skills.json') });
}
test('only explicit harmless test file checks are auto-eligible', () => {
  assert.equal(eligibility(example).risk, 'low');
  assert.deepEqual(eligibility(example).commands, [command]);
  assert.equal(eligibility({ ...example, checks: ['npm test'] }).eligible, false);
  assert.equal(eligibility({ ...example, checks: ['node --test'] }).eligible, false);
  assert.equal(eligibility({ ...example, steps: [...example.steps, 'Deploy to production'] }).risk, 'high');
  assert.equal(eligibility({ ...example, steps: [...example.steps, '刪除資料庫'] }).risk, 'high');
  assert.equal(eligibility({ ...example, checks: [command + '; rm -rf /'] }).eligible, false);
  assert.equal(eligibility({ ...example, checks: ['node --test tests/../test/safe-regression.test.js'] }).eligible, false);
  assert.equal(eligibility({ ...example, title: 'Business workflow', problem: 'Some vague behavior',
    triggers: ['vague'], steps: ['One', 'Two'] }).eligible, false);
});
test('trusted test observation requires exact command, terminal state and runner summary', () => {
  assert.equal(commandFromEvent(event()), command);
  assert.deepEqual(accepted, { command, outcome: 'passed', tests: 3, passed: 3, failed: 0 });
  assert.equal(observedTest(event('npm test')), null);
  assert.equal(observedTest(event(command + ' && echo OK')), null);
  assert.equal(observedTest(event(command, 0, 'done')).outcome, 'unverified');
  assert.equal(observedTest(event(command, 0, '# tests 0\n# pass 0\n# fail 0')).outcome, 'unverified');
  assert.equal(observedTest(event(command, 0, '# tests 3\n# pass 2\n# fail 1')).outcome, 'unverified');
  assert.equal(observedTest(event(command, 1, 'crashed')).outcome, 'failed');
  assert.equal(observedTest({ ...event(), state: 'running' }), null);
  assert.equal(observedTest({ ...event(), info: { ...event().info, exitCode: null } }), null);
});
test('scoped acceptance passes twice on distinct turns, persists and revokes on failure', async t => {
  const registry = await fixture(t);
  const proposal = await registry.propose('role-a', example, ['source-work']);
  const otherRole = await registry.propose('role-b', example, ['source-other']);
  assert.equal(proposal.status, 'candidate');
  await assert.rejects(() => registry.recordEvidence('role-a', proposal.id, {
    kind: 'acceptance-test', outcome: 'passed', reference: 'fake', note: 'forged'
  }), /Invalid evidence kind/);

  const run = (roleId, turnId, outcome = 'passed') => registry.recordAutoChecks(roleId, {
    turnId, checks: [{ ...accepted, outcome }]
  });
  await run('role-a', 'first-test-turn-0001');
  assert.equal((await registry.list('role-a')).skills[0].status, 'candidate');
  assert.equal((await registry.list('role-a')).skills[0].autoEligibility.passed, 1);
  await run('role-a', 'first-test-turn-0001');
  assert.equal((await registry.list('role-a')).skills[0].autoEligibility.passed, 1, 'duplicate turn is ignored');
  assert.deepEqual(availableSkills((await registry.list('role-b')).skills), []);
  await run('role-a', 'second-test-turn-0002');
  const active = (await registry.list('role-a')).skills[0];
  assert.equal(active.status, 'active');
  assert.equal(active.verification.method, 'runtime-validated');
  assert.match(toMarkdown(active), /runtime-validated/);
  assert.equal(availableSkills([active]).length, 1);
  assert.equal((await registry.list('role-b')).skills[0].status, 'candidate');
  assert.equal(otherRole.roleId, 'role-b');

  const restored = new SkillRegistry({ storagePath: registry.storagePath });
  assert.equal((await restored.list('role-a')).skills[0].status, 'active');
  const revoke = await restored.recordAutoChecks('role-a', {
    turnId: 'failed-test-turn-0003', checks: [{ command, outcome: 'failed', tests: 3, passed: 2, failed: 1 }]
  });
  assert.equal(revoke[0].statusChanged, true);
  assert.equal(revoke[0].skill.status, 'candidate');
  assert.equal(availableSkills((await restored.list('role-a')).skills).length, 0);
  await restored.recordAutoChecks('role-a', {
    turnId: 'third-test-turn-0004', checks: [accepted]
  });
  assert.equal((await restored.list('role-a')).skills[0].status, 'candidate', 'old passes cannot count after failure');
  await restored.recordAutoChecks('role-a', {
    turnId: 'fourth-test-turn-0005', checks: [accepted]
  });
  assert.equal((await restored.list('role-a')).skills[0].status, 'active');
});
test('high-risk candidates, missing summaries and human activations cannot auto-promote or be overridden', async t => {
  const registry = await fixture(t);
  const unsafe = await registry.propose('role-high', { ...example, title: 'Production deploy UI tests',
    problem: 'Deploy production releases after tests' }, ['source']);
  const checks = [{ ...accepted }];
  for (const turnId of ['high-risk-turn-00001', 'high-risk-turn-00002']) {
    assert.deepEqual(await registry.recordAutoChecks('role-high', { turnId, checks }), []);
  }
  assert.equal((await registry.list('role-high')).skills[0].status, 'candidate');
  const candidate = await registry.propose('role-manual', example, ['source']);
  await registry.recordEvidence('role-manual', candidate.id, {
    kind: 'test', outcome: 'passed', reference: 'manual-test',
    note: 'Human checked the regression'
  });
  await registry.transition('role-manual', candidate.id, 'verify');
  await registry.transition('role-manual', candidate.id, 'activate');
  const result = await registry.recordAutoChecks('role-manual', {
    turnId: 'human-skill-turn-0001', checks: [{ ...accepted, outcome: 'failed' }]
  });
  assert.deepEqual(result, [], 'manual activations retain existing review behavior');
  assert.equal((await registry.list('role-manual')).skills[0].verification.method, 'user-attested');
  await registry.recordAutoChecks('role-high', { turnId: 'valid-high-turn-0001',
    checks: [{ command, outcome: 'unverified' }] });
  assert.equal((await registry.list('role-high')).skills[0].evidence.length, 0);
});
