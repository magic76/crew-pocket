#!/usr/bin/env node
'use strict';

// Trusted local-only replay driver. NEVER execute arbitrary runner modules from HTTP.
const fs = require('node:fs/promises');
const path = require('node:path');
const { defaultToolImprovementStore } = require('../lib/tool-improvement/store');

async function main(args = process.argv.slice(2)) {
  if (args.length !== 3 || !/^tool-improvement-[a-f0-9]{24}$/.test(args[0])) {
    throw new Error('Usage: node scripts/evaluate-tool-improvement.js <candidate-id> <cases.json> <trusted-runner.js>');
  }
  const [id, casesFile, runnerFile] = args;
  const candidate = await defaultToolImprovementStore.get(id);
  if (!candidate) throw new Error('Candidate not found');
  const cases = JSON.parse(await fs.readFile(path.resolve(casesFile), 'utf8'));
  const runner = require(path.resolve(runnerFile));
  const runCase = typeof runner === 'function' ? runner : runner?.runCase;
  if (typeof runCase !== 'function') throw new Error('Runner must export runCase');
  const updated = await defaultToolImprovementStore.evaluate(id, cases, runCase);
  if (!updated) throw new Error('Candidate was rejected during replay');
  process.stdout.write(JSON.stringify({
    id: updated.id, status: updated.status, evaluation: updated.evaluation
  }, null, 2) + '\n');
  if (updated.evaluation.verdict !== 'improved') process.exitCode = 2;
}
if (require.main === module) main().catch(error => {
  console.error('[Tool Improvement Replay]', error.message);
  process.exitCode = 1;
});
module.exports = { main };
