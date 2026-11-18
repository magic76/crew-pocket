'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { defaultHelperCoachStore } = require('./store');
const { CODE_PROPOSAL_RE } = require('./service');

const execFileAsync = promisify(execFile);
const REPOSITORY = 'magic76/crew-helper';
const REMOTE = 'https://github.com/magic76/crew-helper.git';
const ALLOWED_PATHS = [
  /^app\/src\/main\/java\/com\/crewpocket\/helper\/[A-Za-z0-9_./-]+\.java$/,
  /^app\/src\/test\/java\/com\/crewpocket\/helper\/[A-Za-z0-9_./-]+\.java$/
];
const MAX_PATCH_BYTES = 64 * 1024;

function validPatchPath(filePath) {
  return typeof filePath === 'string' && !filePath.startsWith('/') &&
    !filePath.split('/').some(part => !part || part === '.' || part === '..') &&
    ALLOWED_PATHS.some(pattern => pattern.test(filePath));
}

function validateHelperPatch(patch) {
  const value = String(patch || '');
  if (!value.trim() || Buffer.byteLength(value, 'utf8') > MAX_PATCH_BYTES) throw new Error('Patch is empty or too large');
  if (/^GIT binary patch|^Binary files /m.test(value)) throw new Error('Binary changes are not accepted');
  if (/^(?:old mode|new mode|rename from|rename to|copy from|copy to) /m.test(value)) {
    throw new Error('Renames, copies, and mode changes are not accepted');
  }
  const touched = new Set();
  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/([^ ]+) b\/([^ ]+)$/);
      if (!match || match[1] !== match[2] || !validPatchPath(match[1])) throw new Error('Patch path is outside the Helper Java source/test allowlist');
      touched.add(match[1]);
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const match = line.match(/^(?:---|\+\+\+) [ab]\/([^\t]+)(?:\t.*)?$/);
      if (!match || !validPatchPath(match[1])) throw new Error('Patch contains a non-allowlisted path or file deletion');
      touched.add(match[1]);
    }
  }
  if (!touched.size || touched.size > 12) throw new Error('Patch must change 1–12 allowlisted Java files');
  return { patch: value, files: [...touched] };
}

class HelperCodePRService {
  constructor({ store = defaultHelperCoachStore, run = null, makeTempDir = null } = {}) {
    this.store = store;
    this.run = run || ((command, args, options = {}) => execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout || 10 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true
    }));
    this.makeTempDir = makeTempDir || (() => fs.mkdtemp(path.join(os.tmpdir(), 'crew-helper-coach-')));
  }

  async openPullRequest({ proposalId, title, patch, confirmed } = {}) {
    if (confirmed !== true) throw Object.assign(new Error('Explicit confirmation is required to run tests and open a GitHub PR.'), { statusCode: 400 });
    if (!CODE_PROPOSAL_RE.test(String(proposalId || ''))) throw Object.assign(new Error('Invalid code proposal id'), { statusCode: 400 });
    const checked = validateHelperPatch(patch);
    const state = await this.store.snapshot();
    const proposal = state.codeProposals.find(item => item.id === proposalId);
    if (!proposal || proposal.status !== 'proposal_only') throw Object.assign(new Error('Code proposal is unavailable or already processed.'), { statusCode: 404 });
    const safeTitle = String(title || proposal.diagnosis).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 90);
    if (safeTitle.length < 8) throw Object.assign(new Error('A descriptive PR title is required.'), { statusCode: 400 });

    const tempRoot = await this.makeTempDir();
    const checkout = path.join(tempRoot, 'crew-helper');
    const branch = `helper-coach/${proposal.id.slice(-12)}`;
    try {
      await this.run('gh', ['auth', 'status', '--hostname', 'github.com'], { cwd: tempRoot, timeout: 30_000 });
      await this.run('git', ['clone', '--depth=1', '--branch', 'main', REMOTE, checkout], { cwd: tempRoot });
      await this.run('git', ['switch', '-c', branch], { cwd: checkout });
      const patchPath = path.join(tempRoot, 'proposal.patch');
      await fs.writeFile(patchPath, checked.patch, { mode: 0o600 });
      await this.run('git', ['apply', '--check', patchPath], { cwd: checkout });
      await this.run('git', ['apply', '--index', patchPath], { cwd: checkout });
      await this.run('git', ['diff', '--cached', '--check'], { cwd: checkout });
      await this.run('./gradlew', ['testDebugUnitTest', '--no-daemon'], { cwd: checkout, timeout: 20 * 60 * 1000 });
      await this.run('git', ['commit', '-m', `fix(helper): ${safeTitle}`], { cwd: checkout, timeout: 60_000 });
      await this.run('git', ['push', '--set-upstream', 'origin', branch], { cwd: checkout, timeout: 120_000 });
      const bodyPath = path.join(tempRoot, 'pull-request.md');
      await fs.writeFile(bodyPath, [
        '## Helper Coach evidence',
        '',
        `- Task: \`${proposal.taskId}\``,
        `- Evidence events: ${proposal.evidenceEventIds.map(id => `\`${id}\``).join(', ')}`,
        `- Diagnosis: ${proposal.diagnosis}`,
        '',
        '## Reproduction',
        ...proposal.reproductionSteps.map((step, index) => `${index + 1}. ${step}`),
        '',
        '## Verification',
        ...proposal.testPlan.map(step => `- ${step}`),
        '- `./gradlew testDebugUnitTest --no-daemon`',
        '',
        'Opened by the explicit Helper Coach code proposal flow. This PR is not merged, deployed, or installed.'
      ].join('\n') + '\n', { mode: 0o600 });
      const result = await this.run('gh', [
        'pr', 'create', '--repo', REPOSITORY, '--draft', '--head', branch,
        '--base', 'main', '--title', safeTitle, '--body-file', bodyPath
      ], { cwd: checkout, timeout: 120_000 });
      const prUrl = String(result?.stdout || '').trim().split(/\s+/).find(item => /^https:\/\/github\.com\/magic76\/crew-helper\/pull\/\d+$/.test(item));
      if (!prUrl) throw new Error('GitHub CLI did not return a Crew Helper PR URL');
      await this.store.mutate(current => {
        const item = current.codeProposals.find(candidate => candidate.id === proposal.id);
        if (!item) throw new Error('Code proposal disappeared after PR creation');
        item.status = 'draft_pr_opened';
        item.branch = branch;
        item.prUrl = prUrl;
        item.updatedAt = Date.now();
      });
      return { success: true, repository: REPOSITORY, branch, prUrl, tests: './gradlew testDebugUnitTest --no-daemon' };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { HelperCodePRService, validateHelperPatch, validPatchPath, REPOSITORY, REMOTE };
