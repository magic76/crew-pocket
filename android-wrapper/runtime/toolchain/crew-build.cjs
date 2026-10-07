const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('crew-build <workspace> [Gradle tasks/options]\nDefault: assembleDebug. Signed APK artifacts and logs are retained under private HOME.');
} else {
  const home = fs.realpathSync(process.env.HOME);
  const cwd = fs.realpathSync(path.resolve(args[0]));
  if (cwd !== home && !cwd.startsWith(home + path.sep)) throw Error('Workspace must be inside Runtime HOME');
  const id = crypto.randomUUID();
  const folder = path.join(home, '.crew-pocket/builds', id);
  fs.mkdirSync(folder, { recursive: true });
  const log = fs.createWriteStream(path.join(folder, 'build.log'));
  const tasks = args.length > 1 ? args.slice(1) : ['assembleDebug'];
  const started = Date.now();
  const report = { id, cwd, tasks, startedAt: new Date(started).toISOString(), state: 'running', artifacts: [] };
  const save = () => fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  save(); console.log(`Build ${id}\nWorkspace: ${cwd}`);
  const child = spawn('gradle', ['-p', cwd, ...tasks], { stdio: ['inherit', 'pipe', 'pipe'] });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', chunk => { log.write(chunk); output.write(chunk); });
  child.on('error', error => { report.error = error.message; });
  child.on('close', (code, signal) => {
    report.state = code === 0 ? 'completed' : 'failed'; report.exitCode = code; report.signal = signal; report.durationMs = Date.now() - started;
    if (code === 0) {
      let index = 0;
      function collect(directory, depth = 0) {
        if (depth > 9) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory() && !['node_modules', '.git', '.gradle', '.crew-pocket'].includes(entry.name)) collect(file, depth + 1);
          if (entry.isFile() && entry.name.endsWith('.apk') && file.includes(`${path.sep}build${path.sep}outputs${path.sep}`)) {
            const filename = `${++index}-${entry.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const destination = path.join(folder, filename); fs.copyFileSync(file, destination);
            report.artifacts.push({ filename, originalPath: file, bytes: fs.statSync(destination).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), download: `/api/build-artifacts/${id}/${filename}` });
          }
        }
      }
      try { collect(cwd); } catch (error) { report.error = error.message; report.state = 'failed'; }
      if (!report.artifacts.length) { report.error ||= 'Gradle succeeded but produced no APK artifact'; report.state = 'failed'; }
    }
    save(); log.end(); console.log('\nCREW_BUILD_RESULT ' + JSON.stringify(report)); process.exitCode = report.state === 'completed' ? 0 : code || 1;
  });
}
