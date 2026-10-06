#!/usr/bin/env python3
"""Stage official SDK Java/data components; never ship desktop ELF tools."""
import hashlib, json, os, pathlib, shutil, urllib.request, zipfile

runtime = pathlib.Path(__file__).resolve().parents[1]
assets = runtime / 'src/main/assets/toolchain/android-sdk'
cache = pathlib.Path(os.environ.get('CREW_TOOLCHAIN_WORK_DIR', '/tmp/crew-build-sdk'))
cache.mkdir(parents=True, exist_ok=True)
packages = [
    {'path': 'platforms/android-35', 'url': 'https://dl.google.com/android/repository/platform-35_r02.zip', 'sha1': '0bb560a90a7a2cbd0dd8348224d518b638fe7949'},
    {'path': 'build-tools/34.0.0', 'url': 'https://dl.google.com/android/repository/build-tools_r34-linux.zip', 'sha1': 'd6d58e0c6925a9e4d9a541e84cd1f405c2f9d2a9'}
]
lock = runtime / "toolchain/android-build-sdk.lock.json"
if lock.exists(): packages = json.loads(lock.read_text())["packages"]
for package in packages:
    archive = cache / package['url'].split('/')[-1]
    if not archive.exists():
        print('Download official SDK:', package['path'], flush=True)
        with urllib.request.urlopen(package['url'], timeout=120) as response, archive.with_suffix('.partial').open('wb') as output:
            shutil.copyfileobj(response, output)
        archive.with_suffix('.partial').replace(archive)
    digest = hashlib.sha1(archive.read_bytes()).hexdigest()
    if package.get('sha256') and hashlib.sha256(archive.read_bytes()).hexdigest() != package['sha256']: raise RuntimeError('SDK SHA256 mismatch: ' + str(archive))
    if digest != package['sha1']: raise RuntimeError('Official SDK checksum mismatch: ' + str(archive))
    target = assets / package['path']
    shutil.rmtree(target, ignore_errors=True); target.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            relative = pathlib.PurePosixPath(info.filename)
            if len(relative.parts) < 2 or info.is_dir(): continue
            relative = pathlib.Path(*relative.parts[1:])
            if relative.is_absolute() or '..' in relative.parts: raise RuntimeError('Unsafe SDK zip entry')
            if package['path'].startswith('build-tools') and relative.suffix not in ['.jar', '.properties', '.txt']: continue
            data = source.read(info)
            if data.startswith(b'\x7fELF'): continue
            output = target / relative; output.parent.mkdir(parents=True, exist_ok=True); output.write_bytes(data)
    package['sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
    print('Staged', package['path'], flush=True)
(assets / 'provenance.json').write_text(json.dumps(packages, indent=2) + '\n')
