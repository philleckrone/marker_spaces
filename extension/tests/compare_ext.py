# -*- coding: utf-8 -*-
# Compares the Paratext 10 extension's scanner (src/core.js, run by tests/scan_ext.js under
# Paratext 10's own Node) with the Paratext 9 plugin's scanner (tests/TestHost "scan"), line by
# line: book, chapter, verse, kind, marker, offsets and fix edits, in the same order.
#     python compare_ext.py PROJECT_FOLDER [PROJECT_FOLDER ...]
#     python compare_ext.py --all "C:\My Paratext 8 Projects"
#     python compare_ext.py --preview PROJECT_FOLDER ...   (also compares the Now/After previews)
# Prints the differences and exits 1 when there are any.
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(HERE, '..', '..', 'tests', 'TestHost', 'bin', 'Release', 'MarkerSpacesTestHost.exe')
SCAN = os.path.join(HERE, 'scan_ext.js')
P10 = os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'paratext-10-studio', 'Paratext 10.exe')


def run(cmd):
    env = dict(os.environ, MS_ALLBOOKS='1', ELECTRON_RUN_AS_NODE='1')
    p = subprocess.run(cmd, capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError('%s failed: %s' % (os.path.basename(cmd[0]), p.stderr.decode('utf-8', 'replace')[-800:]))
    return p.stdout.decode('utf-8', 'replace').splitlines()


def projects(root):
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if os.path.isdir(folder) and os.path.exists(os.path.join(folder, 'Settings.xml')):
            yield folder


def main():
    args = sys.argv[1:]
    mode = 'scan'
    if args and args[0] == '--preview':
        mode, args = 'preview', args[1:]
    folders = list(projects(args[1])) if args and args[0] == '--all' else args
    failed = 0
    total = 0
    for folder in folders:
        try:
            plugin = run([HOST, mode, folder])
            ext = run([P10, SCAN, mode, folder])
        except Exception as e:
            print('%s: ERROR %s' % (folder, e))
            failed += 1
            continue
        total += len(plugin)
        if plugin == ext:
            print('%s: %d problems, same' % (folder, len(plugin)))
            continue
        failed += 1
        same_set = sorted(plugin) == sorted(ext)
        print('%s: plugin %d, extension %d, %s' % (
            folder, len(plugin), len(ext), 'same lines in another order' if same_set else 'DIFFERENT'))
        only_p = [l for l in plugin if l not in set(ext)]
        only_e = [l for l in ext if l not in set(plugin)]
        for l in only_p[:10]:
            print('  only plugin:   ', l)
        for l in only_e[:10]:
            print('  only extension:', l)
    print('%d folders, %d problems, %d with differences' % (len(folders), total, failed))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
