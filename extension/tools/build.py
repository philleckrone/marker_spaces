# -*- coding: utf-8 -*-
# Builds the Marker Spaces extension for Paratext 10.
#     python tools/build.py
# Writes dist/markerSpaces/ (the extension folder: manifest.json, package.json, src/main.js,
# contributions/, assets/) and release/markerSpaces_<version>.zip (the same files at the zip root).
#
# Extensions may only require papi modules (no relative files, no fs, no eval), so src/main.js is
# one file: src/core.js, then the web view HTML, the built-in usfm.sty and the version as string
# constants, then src/main.js. The result is syntax-checked with Paratext 10's own Node.
import json, os, shutil, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist', 'markerSpaces')
RELEASE = os.path.join(ROOT, 'release')
USFM_STY = os.path.join(ROOT, '..', 'MarkerSpacesPlugin', 'Resources', 'usfm.sty')
P10 = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'paratext-10-studio', 'Paratext 10.exe')
COPY = ['manifest.json', 'package.json', 'contributions', 'assets']


def read(path):
    with open(path, encoding='utf-8-sig') as f:
        return f.read()


def js_string(text):
    # JSON is a valid JavaScript string literal; keep it ASCII so no encoding can damage it.
    return json.dumps(text, ensure_ascii=True)


def main():
    manifest = json.loads(read(os.path.join(ROOT, 'manifest.json')))
    version = manifest['version']
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, 'src'))
    for name in COPY:
        src = os.path.join(ROOT, name)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, name))
        else:
            shutil.copy2(src, os.path.join(DIST, name))

    main_js = '\n'.join([
        '// Marker Spaces %s for Paratext 10. Built by tools/build.py from src/ - do not edit.' % version,
        "'use strict';",
        read(os.path.join(SRC, 'core.js')),
        'const MS_VERSION = %s;' % js_string(version),
        'const MS_WEB_VIEW_HTML = %s;' % js_string(read(os.path.join(SRC, 'marker-spaces.web-view.html'))),
        'const MS_USFM_STY = %s;' % js_string(read(USFM_STY)),
        read(os.path.join(SRC, 'main.js')),
    ])
    out = os.path.join(DIST, 'src', 'main.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(main_js)

    if os.path.exists(P10):
        env = dict(os.environ, ELECTRON_RUN_AS_NODE='1')
        p = subprocess.run([P10, '--check', out], capture_output=True, env=env)
        if p.returncode != 0:
            sys.stderr.write(p.stderr.decode('utf-8', 'replace'))
            sys.exit('main.js has a syntax error')
        # The web view's own script is checked too (it runs in the window, not in Node).
        html = read(os.path.join(SRC, 'marker-spaces.web-view.html'))
        script = html.split('<script>', 1)[1].split('</script>', 1)[0].replace('__MS_BOOT__', '{}')
        tmp = os.path.join(ROOT, 'dist', 'webview-check.js')
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(script)
        p = subprocess.run([P10, '--check', tmp], capture_output=True, env=env)
        os.remove(tmp)
        if p.returncode != 0:
            sys.stderr.write(p.stderr.decode('utf-8', 'replace'))
            sys.exit('the web view script has a syntax error')
    else:
        print('Paratext 10 not found: syntax not checked')

    os.makedirs(RELEASE, exist_ok=True)
    zip_path = os.path.join(RELEASE, 'markerSpaces_%s.zip' % version)
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, dirs, files in os.walk(DIST):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(folder, name)
                z.write(full, os.path.relpath(full, DIST).replace(os.sep, '/'))
    print('built %s (%d bytes)' % (out, os.path.getsize(out)))
    print('packed %s' % zip_path)


if __name__ == '__main__':
    main()
