const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const cli = process.argv.slice(2);
const projectFlag = cli.findIndex(arg => arg === '-p' || arg === '--project-dir');
const project = path.resolve(projectFlag >= 0 ? cli[projectFlag + 1] : process.cwd());
const wrapper = path.join(project, 'gradle/wrapper/gradle-wrapper.properties');
const declared = fs.existsSync(wrapper) ? fs.readFileSync(wrapper, 'utf8').match(/distributionUrl=.*gradle-([\d.]+)-(?:bin|all)\.zip/)?.[1] : null;
const build = ['build.gradle', 'build.gradle.kts'].map(name => {
  const file = path.join(project, name); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}).join('\n');
const agp8 = /com\.android\.application['"]\)?\s+version\s+['"]8\./.test(build);
const version = process.env.CREW_GRADLE_VERSION || declared || (agp8 ? '8.13' : '9.8.0');
const root = path.join(process.env.CREW_TOOL_ROOT, version === '9.8' || version === '9.8.0' ? 'opt/gradle' : `opt/gradle-${version}`);
if (!fs.existsSync(path.join(root, 'lib'))) throw Error(`Gradle ${version} is not bundled. Available: 8.13, 9.8.0. Set CREW_GRADLE_VERSION explicitly if the project supports one of these.`);
const main = fs.readdirSync(path.join(root, 'lib')).find(name => /^gradle-(?:gradle-cli-main|launcher)-[\d.]+\.jar$/.test(name));
if (!main) throw Error('Packaged Gradle launcher missing');
// Android has no compatible upstream desktop native integration/daemon launcher.
const entry = main.startsWith('gradle-launcher-') ? ['-cp', path.join(root, 'lib', main), 'org.gradle.launcher.GradleMain'] : ['-jar', path.join(root, 'lib', main)];
const androidArgs = [];
if (process.env.CREW_NATIVE_DIR) {
  // AGP requires the filename "aapt2", so use the SDK alias to the JNI ELF.
  androidArgs.push(`-Pandroid.aapt2FromMavenOverride=${path.join(process.env.CREW_TOOL_ROOT, 'android-sdk/build-tools/35.0.0/aapt2')}`);
}
const args = ['-Xmx768m', '-Dorg.gradle.native=false', '-Dorg.gradle.internal.instrumentation.agent=false', ...entry, '--no-daemon', ...androidArgs, ...cli];
const child = spawn(path.join(process.env.JAVA_HOME, 'bin/java'), args, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
