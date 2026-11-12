# -*- coding: utf-8 -*-
# Compares the plugin's scanner (TestHost scan) with Project Checker's port of
# MarkerSpace.py (which is itself diffed against the original script), problem
# by problem: book, chapter, kind, offsets in the chapter.
#     python tests/compare_scan.py PROJECT_FOLDER [PROJECT_FOLDER ...]
# Prints the differences and exits 1 when there are any.
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(HERE, 'TestHost', 'bin', 'Release', 'MarkerSpacesTestHost.exe')
PC = os.path.join(HERE, '..', '..', 'Project_Checker', 'ProjectChecker', 'bin', 'Release', 'ProjectChecker.exe')
CATEGORY = {'unclosed': 'Unclosed', 'unexpected': 'Unexpected', 'noclose': 'NoCloseSpace', 'wpipe': 'WPipe'}


def plugin_scan(folder):
    # Every book, as Project Checker scans them all.
    env = dict(os.environ, MS_ALLBOOKS='1')
    out = subprocess.run([HOST, 'scan', folder], capture_output=True, check=True, env=env).stdout.decode('utf-8')
    found = set()
    for line in out.splitlines():
        book, chapter, verse, code, marker, shown, start, end, edits = line.split('\t')
        found.add((book, int(chapter), code, int(start), int(end)))
    return found


def checker_scan(folder):
    fd, path = tempfile.mkstemp(suffix='.json')
    os.close(fd)
    try:
        subprocess.run([PC, '--cli', '--project', folder, '--check', 'markerspace', '--json', path], check=True)
        with open(path, encoding='utf-8-sig') as f:
            data = json.load(f)
    finally:
        os.remove(path)
    found = set()
    for x in data['findings']:
        code = CATEGORY.get(x['category'], x['category'])
        found.add((x['bookCode'], x['chapter'], code, x['begin'], x['end']))
    return found


def main():
    failed = False
    for folder in sys.argv[1:]:
        mine, theirs = plugin_scan(folder), checker_scan(folder)
        only_mine, only_theirs = sorted(mine - theirs), sorted(theirs - mine)
        counts = {}
        for t in mine:
            counts[t[2]] = counts.get(t[2], 0) + 1
        print('%s: plugin %d, Project Checker %d, only plugin %d, only Project Checker %d  %s' % (
            folder, len(mine), len(theirs), len(only_mine), len(only_theirs),
            ' '.join('%s=%d' % kv for kv in sorted(counts.items()))))
        for t in only_mine[:15]:
            print('  only plugin:', t)
        for t in only_theirs[:15]:
            print('  only Project Checker:', t)
        failed = failed or bool(only_mine or only_theirs)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
