#!/usr/bin/env python3
"""Remove executable Termux defaults from the staged Python standard library."""
import pathlib
import shutil


def relocate(root):
    for home in (root / 'lib').glob('python*'):
        if not home.is_dir(): continue
        replacements = {
            'subprocess.py': ("'/data/data/com.termux/files/usr/bin/sh'", "'/system/bin/sh'"),
            'posixpath.py': ("'/data/data/com.termux/files/usr/bin'", "'/system/bin'"),
            'tempfile.py': ("'/data/data/com.termux/files/usr/tmp'", "_os.environ.get('TMPDIR', _os.getcwd())"),
            'mimetypes.py': ('"/data/data/com.termux/files/usr/etc/mime.types"', '"/system/etc/mime.types"'),
            'ctypes/util.py': ("'/data/data/com.termux/files/usr/bin/ldconfig'", "'/system/bin/ldconfig'"),
        }
        for relative, (old, new) in replacements.items():
            file = home / relative
            text = file.read_text()
            if old not in text: raise RuntimeError('Python relocation pattern changed: ' + relative)
            file.write_text(text.replace(old, new))
        utility = home / 'ctypes/util.py'
        utility.write_text(utility.read_text() + '''

# Crew: prefer APK-owned libraries; Android has no Linux ldconfig/compiler tools.
_crew_original_find_library = find_library

def find_library(name):
    root = os.environ.get('CREW_TOOL_ROOT')
    if root:
        import glob
        base = os.path.join(root, 'lib', 'lib' + name + '.so')
        for candidate in [base] + sorted(glob.glob(base + '.*')):
            if os.path.isfile(candidate):
                return os.path.realpath(candidate)
    if name in ('c', 'm', 'dl', 'log', 'android'):
        return 'lib' + name + '.so'
    return _crew_original_find_library(name)
''')
        (home / 'sitecustomize.py').write_text('import os, posixpath\nos.defpath = posixpath.defpath = \'/system/bin\'\n')
        # These Debian/Termux package-manager helpers are not Python's stdlib.
        shutil.rmtree(home / 'debpython', ignore_errors=True)
