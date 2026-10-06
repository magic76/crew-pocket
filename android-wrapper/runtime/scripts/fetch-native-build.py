#!/usr/bin/env python3
"""Stage pinned ARM64 Android native-build tools before ELF relocation."""
import hashlib
import json
import pathlib
import shutil
import tarfile
import urllib.request
import zipfile

RUNTIME = pathlib.Path(__file__).resolve().parents[1]


def stage(work, prefix):
    packages = json.loads((RUNTIME / 'toolchain/native-build.lock.json').read_text())['packages']
    for package in packages:
        archive = work / package['url'].rsplit('/', 1)[1]
        if not archive.exists():
            print('Download native build payload:', archive.name, flush=True)
            temporary = archive.with_suffix('.partial')
            with urllib.request.urlopen(package['url'], timeout=120) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            temporary.replace(archive)
        with archive.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != package['sha256']:
            raise RuntimeError('Native build SHA256 mismatch: ' + archive.name)
        unpack = work / ('native-unpack-' + package['kind'])
        shutil.rmtree(unpack, ignore_errors=True)
        unpack.mkdir()
        if archive.name.endswith('.tar.xz'):
            with tarfile.open(archive) as source:
                source.extractall(unpack, filter='data')
        else:
            with zipfile.ZipFile(archive) as source:
                for entry in source.infolist():
                    relative = pathlib.PurePosixPath(entry.filename)
                    if relative.is_absolute() or '..' in relative.parts:
                        raise RuntimeError('Unsafe build payload entry')
                source.extractall(unpack)
        target = prefix / package['destination']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(unpack / package['root']), target)
        if package['kind'] == 'ndk':
            # AGP expects this host directory name; its binaries are ARM64 Android,
            # not the Linux x86_64 tools from Google's desktop distribution.
            host = target / 'toolchains/llvm/prebuilt/linux-arm64'
            if host.with_name('linux-x86_64').is_symlink():
                host.with_name('linux-x86_64').unlink()
            host.rename(host.with_name('linux-x86_64'))
            for file in (target / 'build/cmake').glob('android*.cmake'):
                file.write_text(file.read_text().replace('set(ANDROID_HOST_TAG "linux-${ARCH}")', 'set(ANDROID_HOST_TAG "linux-x86_64")'))
            keep = {'clang', 'clang++', 'clang-19', 'lld', 'ld.lld', 'llvm-ar', 'llvm-ranlib',
                    'llvm-nm', 'llvm-objcopy', 'llvm-strip', 'llvm-objdump', 'llvm-readelf', 'llvm-readobj'}
            for file in (host.with_name('linux-x86_64') / 'bin').iterdir():
                if file.name not in keep:
                    file.unlink()
            shutil.rmtree(target / 'prebuilt', ignore_errors=True)
        elif package['kind'] == 'cmake':
            (target / 'source.properties').write_text('Pkg.Desc=Android ARM64 CMake\nPkg.Revision=3.22.1\n')
        elif package['kind'] == 'gradle':
            shutil.rmtree(target / 'bin')
        print('Staged native build payload:', package['destination'], flush=True)
    return packages
