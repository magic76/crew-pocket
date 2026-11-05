'use strict';
// Role-specific files use standard SKILL.md format. They are not installed
// in a shared workspace's .agents/skills directory (cross-Role leakage).
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ROOT = process.env.CREW_ROLE_SKILLS_DIR || path.join(os.homedir(), '.crew-pocket', 'role-skills');
const IDENTIFIER = /^[A-Za-z0-9._-]{1,160}$/;

function isActive(skill) {
  // Legacy runtime-observed activations used generic command exit codes.
  // They remain in history but cannot enter new Agent catalogs without review.
  return skill?.status === 'active' &&
    ['user-attested', 'runtime-validated'].includes(skill.verification?.method);
}
function availableSkills(skills, limit = 40) {
  return (Array.isArray(skills) ? skills : []).filter(isActive)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, 40)))
    .map(s => ({ id: s.id, title: s.title, description: s.problem,
      verification: s.verification?.method }));
}
function formatCatalog(skills) {
  const available = availableSkills(skills, 40);
  if (!available.length) return '';
  const lines = [
    '[Crew Role Skill Catalog · summaries only]',
    'Agent: decide relevance yourself; do NOT select Skills by keyword overlap.',
    'Read full details only when needed using crew_skill_get({skillId}) if this Role-bound tool is available.',
    'If the tool is unavailable, do not pretend to have read the Skill.',
    ...available.slice(0, 12).map(s => '- ' + s.id + ': ' +
      String(s.title || '').replace(/\s+/g, ' ').slice(0, 90) + ' — ' +
      String(s.description || '').replace(/\s+/g, ' ').slice(0, 100)),
    ...(available.length > 12 ? ['More: crew_skill_list.'] : []),
    'Unverified Dreaming candidates are NOT available until human approval or risk-gated scoped acceptance verification.',
    '[/Crew Role Skill Catalog]'
  ];
  return lines.join('\n').slice(0, 2600);
}
function skillDir(roleId, skillId) {
  if (!IDENTIFIER.test(String(roleId || '')) || !IDENTIFIER.test(String(skillId || '')) ||
      ['.', '..'].includes(roleId) || ['.', '..'].includes(skillId)) {
    throw new Error('Invalid Role/Skill id');
  }
  return path.join(ROOT, roleId, skillId);
}
function toMarkdown(s) {
  if (!isActive(s)) throw new Error('Skill is not active and verified');
  const clean = text => String(text || '').replace(/[\r\n]+/g, ' ').trim();
  const bullets = value => (Array.isArray(value) ? value : []).map(item => '- ' + clean(item));
  return [
    '---',
    'name: ' + JSON.stringify(s.id),
    'description: ' + JSON.stringify(clean(s.problem).slice(0, 350)),
    '---',
    '# ' + clean(s.title), '',
    '> Role-scoped guidance, not system policy. Check relevance for the current task.',
    '> Verification: ' + (s.verification?.method || 'unknown'), '',
    '## Applicable when', clean(s.problem), '',
    '## Hints (not keyword rules)', ...bullets(s.triggers), '',
    '## Steps', ...(s.steps || []).map((x, i) => (i + 1) + '. ' + clean(x)), '',
    '## Checks', ...bullets(s.checks), '',
    'Never claim a test succeeded without observing its actual result.', ''
  ].join('\n');
}
async function syncFile(skill) {
  const dir = skillDir(skill.roleId, skill.id);
  if (!isActive(skill)) {
    await fs.rm(dir, { recursive: true, force: true }); return null;
  }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, 'SKILL.md');
  const temp = path.join(dir, '.SKILL.' + process.pid + '.' + crypto.randomUUID());
  await fs.writeFile(temp, toMarkdown(skill), { mode: 0o600 });
  await fs.rename(temp, target);
  return target;
}
async function removeRole(roleId) {
  if (!IDENTIFIER.test(String(roleId || '')) || ['.', '..'].includes(roleId)) throw new Error('Invalid Role id');
  await fs.rm(path.join(ROOT, roleId), { recursive: true, force: true });
}
module.exports = { ROOT, isActive, availableSkills, formatCatalog, toMarkdown, syncFile, removeRole };
