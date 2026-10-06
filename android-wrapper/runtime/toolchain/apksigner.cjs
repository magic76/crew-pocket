const path = require('node:path');
const { spawn } = require('node:child_process');
const child = spawn(path.join(process.env.JAVA_HOME, 'bin/java'), ['-jar', path.join(process.env.CREW_TOOL_ROOT, 'share/java/apksigner.jar'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
