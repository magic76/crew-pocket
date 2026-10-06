const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(process.env.CREW_TOOL_ROOT, 'opt/gradle');
const main = fs.readdirSync(path.join(root, 'lib')).find(name => /^gradle-gradle-cli-main-[\d.]+\.jar$/.test(name));
if (!main) throw Error('Packaged Gradle launcher missing');
// Android has no compatible upstream desktop native integration/daemon launcher.
const args = ['-Xmx768m', '-Dorg.gradle.native=false', '-Dorg.gradle.internal.instrumentation.agent=false', '-jar', path.join(root, 'lib', main), '--no-daemon', ...process.argv.slice(2)];
const child = spawn(path.join(process.env.JAVA_HOME, 'bin/java'), args, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
