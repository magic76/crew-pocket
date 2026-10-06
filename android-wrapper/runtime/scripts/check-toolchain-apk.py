#!/usr/bin/env python3
"""Fail the build if Android's asset filtering silently removes runtime modules."""
import gzip
import json
import pathlib
import sys
import zipfile

runtime = pathlib.Path(__file__).resolve().parents[1]
payload = runtime / 'src/main/assets/toolchain'
with zipfile.ZipFile(sys.argv[1]) as apk:
    names = set(apk.namelist())
    missing = []
    for path in payload.rglob('*'):
        if not path.is_file(): continue
        name = 'assets/toolchain/' + str(path.relative_to(payload))
        if name in names and path.read_bytes() == apk.read(name): continue
        # AAPT transparently expands .gz asset data and strips the suffix.
        if name.endswith('.gz') and name[:-3] in names:
            if gzip.decompress(path.read_bytes()) == apk.read(name[:-3]): continue
        missing.append(name)
    manifest = json.loads((payload / 'manifest.json').read_text())
    libraries = set(manifest['commands'].values()) | set(manifest['links'].values()) | {'libcrew_terminal_host.so', 'libcrew_java_paths.so', 'libcrew_sdk_unsupported.so', 'libcrew_native_paths.so'}
    native_map = payload / 'native-launchers.tsv'
    if native_map.exists(): libraries.update(line.split('\t')[1] for line in native_map.read_text().splitlines())
    java_map = payload / 'java-native.tsv'
    if java_map.exists(): libraries.update(line.split('\t')[1] for line in java_map.read_text().splitlines())
    missing.extend('lib/arm64-v8a/' + name for name in libraries
                   if 'lib/arm64-v8a/' + name not in names)
    if missing:
        raise SystemExit('APK missing toolchain entries:\n' + '\n'.join(missing))
print('APK toolchain assets and native libraries complete')
