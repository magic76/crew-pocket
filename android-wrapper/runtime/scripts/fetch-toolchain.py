#!/usr/bin/env python3
"""Download SHA256-checked Android packages; stage data and relocated ELF closure."""
import importlib.util
import concurrent.futures
import argparse, glob, gzip, hashlib, json, os, pathlib, re, shutil, subprocess, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'android-wrapper/runtime'
REGISTRY = RUNTIME / 'toolchain/tools.json'
SYSTEM = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so', 'libz.so'}

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Crew-Toolchain/1'}), timeout=120) as response:
        return response.read()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True)
    parser.add_argument('--refresh-lock', action='store_true', help='Resolve new package versions from the current repository index')
    parser.add_argument('--base', default='https://packages.termux.dev/apt/termux-main')
    args = parser.parse_args()
    work = pathlib.Path(args.work); work.mkdir(parents=True, exist_ok=True)
    registry = json.loads(REGISTRY.read_text())
    raw = gzip.decompress(download(args.base + '/dists/stable/main/binary-aarch64/Packages.gz')).decode()
    records = {}
    for paragraph in raw.split('\n\n'):
        fields = {}; key = None
        for line in paragraph.splitlines():
            if line.startswith(' ') and key: fields[key] += ' ' + line.strip()
            elif ': ' in line: key, value = line.split(': ', 1); fields[key] = value
        if 'Filename' in fields: records[fields['Package']] = fields
    lock_path = RUNTIME / 'toolchain/packages.lock.json'
    if lock_path.exists() and not args.refresh_lock:
        locked = json.loads(lock_path.read_text())
        if locked['roots'] != registry['packages']:
            raise RuntimeError('Package registry changed; rebuild with --refresh-lock')
        records = {record['Package']: record for record in locked['packages']}
    selected = {}; queue = list(registry['packages'])
    while queue:
        name = queue.pop(0)
        if name in selected: continue
        if name not in records: raise RuntimeError('Unresolved package: ' + name)
        record = selected[name] = records[name]
        for group in (record.get('Depends', '') + ',' + record.get('Pre-Depends', '')).split(','):
            alternatives = [re.split(r'[\s(:]', x.strip())[0] for x in group.split('|') if x.strip()]
            if not alternatives: continue
            dependency = next((x for x in alternatives if x in records), None)
            if not dependency: raise RuntimeError('Unresolved dependency: ' + group)
            queue.append(dependency)
    if args.refresh_lock or not lock_path.exists():
        lock_path.write_text(json.dumps({'schemaVersion': 1, 'roots': registry['packages'],
            'packages': [{key: record[key] for key in ['Package', 'Version', 'Filename', 'SHA256', 'Depends', 'Pre-Depends'] if key in record}
                         for record in selected.values()]}, indent=2) + '\n')
    stage = work / 'root'
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir()
    def fetch_package(item):
        name, record = item
        deb = work / pathlib.Path(record['Filename']).name
        if not deb.exists():
            print('Download', name, record['Version'], flush=True)
            temporary = deb.with_suffix('.partial')
            temporary.write_bytes(download(args.base + '/' + record['Filename']))
            temporary.replace(deb)
        if hashlib.sha256(deb.read_bytes()).hexdigest() != record['SHA256']: raise RuntimeError('SHA256 mismatch: ' + name)
        return deb
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        debs = list(pool.map(fetch_package, selected.items()))
    provenance = []
    for (name, record), deb in zip(selected.items(), debs):
        subprocess.run(['dpkg-deb', '-x', str(deb), str(stage)], check=True)
        provenance.append({k: record[k] for k in ['Package', 'Version', 'SHA256', 'Filename']})
    prefix = stage / 'data/data/com.termux/files/usr'
    assets = RUNTIME / 'src/main/assets/toolchain'
    jni = RUNTIME / 'src/main/jniLibs/arm64-v8a'
    shutil.rmtree(assets, ignore_errors=True); assets.mkdir(parents=True); jni.mkdir(parents=True, exist_ok=True)
    for old in jni.glob('libcrew_tool_*.so'): old.unlink()
    # Preserve logical names in data. ELF entries become links to JNI files at runtime.
    elf = {}; links = {}; commands = {}; scripts = dict(registry['scripts'])
    def library_name(source):
        return 'libcrew_tool_' + hashlib.sha256(str(source.relative_to(prefix)).encode()).hexdigest()[:16] + '.so'
    def is_elf(path):
        with path.open('rb') as f: header = f.read(20)
        return header[:4] == b'\x7fELF' and int.from_bytes(header[16:18], 'little') in (2, 3)
    def add_elf(source):
        source = source.resolve()
        with source.open('rb') as stream: header = stream.read(20)
        if header[:4] != b'\x7fELF' or header[4] != 2 or int.from_bytes(header[18:20], 'little') != 183:
            raise RuntimeError('Not an ARM64 ELF: ' + str(source))
        if source not in elf: elf[source] = library_name(source)
        return elf[source]
    def copy_data(source, relative):
        target = assets / relative
        if source.is_dir():
            for child in source.iterdir(): copy_data(child, relative / child.name)
        elif source.is_file():
            if is_elf(source): links[str(relative)] = add_elf(source)
            else:
                target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
                if re.match(rb'#![^\n]*(?:/sh|/bash)(?:\s|$)', source.read_bytes().split(b'\n', 1)[0]) and str(relative).startswith('libexec/git-core/'):
                    scripts[source.name] = ['bash', str(relative)]
    for pattern in registry['data']:
        for source in prefix.glob(pattern): copy_data(source, source.relative_to(prefix))
    for name, relative in registry['commands'].items(): commands[name] = add_elf(prefix / relative)
    for relative, library in links.items():
        if relative.startswith('libexec/git-core/'): commands[pathlib.Path(relative).name] = library
    # DT_NEEDED closure; all missing Android dependencies stop the build.
    pending = list(elf); visited = set(); rewrites = {}
    while pending:
        source = pending.pop(0)
        if source in visited: continue
        visited.add(source)
        needed = run('patchelf', '--print-needed', str(source)).splitlines()
        rewrites[source] = {}
        for name in needed:
            if name in SYSTEM: continue
            candidate = prefix / 'lib' / name
            if not candidate.exists():
                matches = list((prefix / 'lib').rglob(name)); candidate = matches[0] if matches else candidate
            if not candidate.exists(): raise RuntimeError(f'Missing {name} needed by {source}')
            library = add_elf(candidate); rewrites[source][name] = library; pending.append(candidate.resolve())
            links['lib/' + name] = library
    for source, library in elf.items():
        target = jni / library; shutil.copyfile(source, target); target.chmod(0o755)
        for old, new in rewrites[source].items(): subprocess.run(['patchelf', '--replace-needed', old, new, str(target)], check=True)
        subprocess.run(['patchelf', '--set-rpath', '$ORIGIN', str(target)], check=True)
        if run('patchelf', '--print-soname', str(target)):
            subprocess.run(['patchelf', '--set-soname', library, str(target)], check=True)
    # Android's verneed resolver requires rewritten DT_NEEDED and SONAME to
    # agree. Update Python's runtime metadata used by ctypes.PyDLL as well.
    for config in (assets / 'lib').glob('python*/_sysconfigdata*.py'):
        text = config.read_text()
        for logical, library in links.items():
            if pathlib.Path(logical).name.startswith('libpython'):
                text = text.replace("'LDLIBRARY': '" + pathlib.Path(logical).name + "'", "'LDLIBRARY': '" + library + "'")
        config.write_text(text)
    interpreters = {'node': 'libnode_exec.so', 'bash': 'libbash_exec.so', 'python3': commands['python3']}
    (assets / 'launchers.tsv').write_text(''.join(f'{name}\t{interpreters[interpreter]}\t{entry}\n' for name, (interpreter, entry) in scripts.items()))
    for name in scripts: commands[name] = 'libcrew_tool_launcher.so'
    (assets / 'crew').mkdir(exist_ok=True)
    shutil.copyfile(RUNTIME / 'toolchain/jev.cjs', assets / 'crew/jev.cjs')
    shutil.copyfile(RUNTIME / 'toolchain/sources.json', assets / 'crew/sources.json')
    shutil.copyfile(RUNTIME / 'toolchain/posix-semaphore.c', assets / 'crew/posix-semaphore.c')
    for name, (_, entry) in scripts.items():
        if not (assets / entry).is_file(): raise RuntimeError(f'Missing script for {name}: {entry}')
    relocation_spec = importlib.util.spec_from_file_location('crew_python_relocation', RUNTIME / 'scripts/relocate-python.py')
    relocation = importlib.util.module_from_spec(relocation_spec)
    relocation_spec.loader.exec_module(relocation)
    relocation.relocate(assets)
    # Upstream license/copyright data travels with the payload, not just versions.
    copy_data(prefix / 'share/doc', pathlib.Path('share/doc')) if (prefix / 'share/doc').exists() else None
    manifest = {'schemaVersion': 1, 'limitations': registry.get('limitations', []), 'tools': list(registry['commands']) + list(registry['scripts']), 'commands': commands, 'links': links, 'packages': provenance,
                'nativeOverrides': {'libandroid-posix-semaphore.so': {'source': 'crew/posix-semaphore.c', 'sha256': hashlib.sha256((RUNTIME / 'toolchain/posix-semaphore.c').read_bytes()).hexdigest()}},
                'dataAliases': {name: 'libexec/git-core/' + name for name in ['git-sh-setup', 'git-sh-i18n'] if (assets / 'libexec/git-core' / name).exists()},
                'pythonHome': '.', 'pythonVersion': next((x.name for x in (assets / 'lib').glob('python*')), None)}
    (assets / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Packaged {len(commands)} commands, {len(elf)} ELF files, {len(selected)} packages', flush=True)

if __name__ == '__main__': main()
