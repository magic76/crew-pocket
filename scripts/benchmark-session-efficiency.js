#!/usr/bin/env node
'use strict';

// Offline A/B analysis of *recorded real sessions*. Does not call a model,
// alter live compaction, infer completion from transport status, or replay tools.
const fs = require('node:fs');
const path = require('node:path');
const { aggregateSession, relativeDelta, estimateUsd } = require('../lib/context/session-efficiency');

function readJsonl(file) {
  if (!file) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch (error) { throw new Error(`Invalid JSONL in ${file}:${index + 1}: ${error.message}`); }
  });
}

function readOptions(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!/^--[a-z-]+$/.test(key) || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error(`Invalid option: ${key}`);
    if (!['manifest', 'baseline', 'candidate', 'baseline-compactions',
      'candidate-compactions', 'pricing', 'out'].includes(key.slice(2)))
      throw new Error(`Unknown option: ${key}`);
    opts[key.slice(2)] = argv[++i];
  }
  for (const field of ['manifest', 'baseline', 'candidate'])
    if (!opts[field]) throw new Error(`Missing --${field}`);
  return opts;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value.trim();
}

function requireRun(run, label) {
  if (!run || typeof run !== 'object') throw new Error(`Missing ${label}`);
  requireString(run.conversationId, label + '.conversationId');
  if (run.taskSuccess != null && typeof run.taskSuccess !== 'boolean')
    throw new Error(`${label}.taskSuccess must be boolean or null`);
  return run;
}

function runBenchmark({ manifest, baseline, candidate,
  baselineCompactions = [], candidateCompactions = [], pricing = {} }) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length)
    throw new Error('Manifest must contain version: 1 and nonempty cases');
  const keys = new Set();
  const rows = manifest.cases.map((entry, index) => {
    const id = requireString(entry.id, `cases[${index}].id`);
    const provider = requireString(entry.provider, id + '.provider');
    const model = requireString(entry.model, id + '.model');
    const cacheCondition = requireString(entry.cacheCondition, id + '.cacheCondition');
    const key = JSON.stringify([id, provider, model, cacheCondition]);
    if (keys.has(key)) throw new Error('Duplicate benchmark case: ' + key);
    keys.add(key);
    const before = requireRun(entry.baseline, id + '.baseline');
    const after = requireRun(entry.candidate, id + '.candidate');
    // A/B needs different session IDs to prevent contaminated context/caches.
    if (before.conversationId === after.conversationId)
      throw new Error(id + ': baseline and candidate must be distinct conversations');
    const base = aggregateSession(baseline, baselineCompactions,
      { conversationId: before.conversationId, provider });
    const next = aggregateSession(candidate, candidateCompactions,
      { conversationId: after.conversationId, provider });
    if (!base || !next) throw new Error(id + ': missing measured baseline/candidate turns');
    for (const [label, result] of [['baseline', base], ['candidate', next]]) {
      if (result.model && result.model !== model)
        throw new Error(`${id}: ${label} model mismatch (${result.model} vs ${model})`);
    }
    const price = pricing[`${provider}/${model}`] || null;
    const baseCost = estimateUsd(base, price);
    const nextCost = estimateUsd(next, price);
    const baseSuccess = before.taskSuccess ?? null;
    const nextSuccess = after.taskSuccess ?? null;
    return {
      id, provider, model, cacheCondition,
      baseline: { ...base, taskSuccess: baseSuccess, estimatedUsd: baseCost },
      candidate: { ...next, taskSuccess: nextSuccess, estimatedUsd: nextCost },
      comparison: {
        inputTokenDelta: relativeDelta(base.inputTokens, next.inputTokens),
        elapsedDelta: relativeDelta(base.elapsedMs, next.elapsedMs),
        estimatedCostDelta: relativeDelta(baseCost, nextCost),
        additionalSuspectedReads: next.suspectedReads - base.suspectedReads,
        successRegression: baseSuccess === true && nextSuccess === false
      }
    };
  });
  const knownSuccess = rows.filter(row =>
    row.baseline.taskSuccess !== null && row.candidate.taskSuccess !== null);
  const regressions = knownSuccess.filter(row => row.comparison.successRegression);
  const measuredTokenPairs = rows.filter(row => row.comparison.inputTokenDelta !== null);
  const measuredCostPairs = rows.filter(row => row.comparison.estimatedCostDelta !== null);
  const average = (items, key) => items.length
    ? items.reduce((n, row) => n + row.comparison[key], 0) / items.length : null;
  return {
    schemaVersion: 1,
    warning: 'Offline trace comparison only; no provider rerun, no causal claim. Null means unknown, not zero.',
    cases: rows,
    summary: {
      cases: rows.length,
      successLabeledPairs: knownSuccess.length,
      successRegressions: regressions.length,
      averageInputTokenDelta: average(measuredTokenPairs, 'inputTokenDelta'),
      averageEstimatedCostDelta: average(measuredCostPairs, 'estimatedCostDelta'),
      inputTokenComparablePairs: measuredTokenPairs.length,
      pricedComparablePairs: measuredCostPairs.length,
      // Quality gate cannot pass without all task labels and the real costs.
      acceptance: regressions.length ? 'fail'
        : knownSuccess.length !== rows.length || measuredCostPairs.length !== rows.length
          ? 'inconclusive'
          : average(measuredCostPairs, 'estimatedCostDelta') <= -0.1 &&
            rows.every(row => row.comparison.elapsedDelta === null ||
              row.comparison.elapsedDelta <= 0.2) ? 'pass' : 'fail'
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const opts = readOptions(argv);
  const manifest = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
  const pricing = opts.pricing ? JSON.parse(fs.readFileSync(opts.pricing, 'utf8')) : {};
  const result = runBenchmark({
    manifest, pricing,
    baseline: readJsonl(opts.baseline),
    candidate: readJsonl(opts.candidate),
    baselineCompactions: readJsonl(opts['baseline-compactions']),
    candidateCompactions: readJsonl(opts['candidate-compactions'])
  });
  const output = JSON.stringify(result, null, 2) + '\n';
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, output);
  } else process.stdout.write(output);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { readJsonl, readOptions, runBenchmark, main };
