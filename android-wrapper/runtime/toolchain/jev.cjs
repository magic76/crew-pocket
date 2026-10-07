#!/usr/bin/env node
// Crew's compatibility CLI for the official TypeSafe API. No community CLI dependency.
const fs = require('node:fs');
async function main(args) {
  if (args.includes('--version')) return console.log('jev 1.0.0 (Crew TypeSafe API adapter)');
  if (!args.length || args.includes('--help')) return console.log('jev ask <state> --questions <JSON> --format json [--model jev-latest]\njev run <request.json|->');
  let body;
  if (args[0] === 'ask') {
    const state = args[1];
    const options = {};
    for (let i = 2; i < args.length; i += 2) {
      if (!['--questions', '--format', '--model'].includes(args[i]) || args[i + 1] == null) throw new Error('Invalid arguments; see jev --help');
      options[args[i]] = args[i + 1];
    }
    if (state == null || !options['--questions'] || (options['--format'] && options['--format'] !== 'json')) throw new Error('State and JSON questions required');
    body = { state, questions: JSON.parse(options['--questions']), model: options['--model'] || 'jev-latest' };
  } else if (args[0] === 'run' && args.length === 2) {
    body = JSON.parse(fs.readFileSync(args[1] === '-' ? 0 : args[1], 'utf8'));
    body.model ||= 'jev-latest';
  } else throw new Error('Invalid arguments; see jev --help');
  if (!body.questions || typeof body.questions !== 'object' || Array.isArray(body.questions)) throw new Error('Questions must be an object');
  let key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    const file = require('node:path').join(process.env.HOME || '', '.config/jev/.env');
    if (fs.existsSync(file)) key = fs.readFileSync(file, 'utf8').match(/^TYPESAFE_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!key) { process.exitCode = 3; throw new Error('TYPESAFE_API_KEY is not configured'); }
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`TypeSafe API HTTP ${response.status}`);
  const result = await response.json();
  if (!result.answers || typeof result.answers !== 'object') throw new Error('Invalid TypeSafe response');
  console.log(JSON.stringify(result));
}
main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode ||= 1; });
