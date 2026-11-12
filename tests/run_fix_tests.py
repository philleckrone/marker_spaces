# -*- coding: utf-8 -*-
# Tests the fixes with TestHost on copies (the originals are never touched):
#  1. the hand-made fixture: fixing All and fixing only C give exactly the expected files;
#     partial rights change only the chapters allowed; MS_NOHISTORY=1 changes nothing;
#  2. each real project given: fixing All leaves no fixable problem, and every changed
#     file differs from the original only in spaces, tabs, line breaks and '~'.
#     python tests/run_fix_tests.py [PROJECT_FOLDER ...]
# Exits 1 when a check fails.
import glob, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(HERE, 'TestHost', 'bin', 'Release', 'MarkerSpacesTestHost.exe')
FIXTURES = os.path.join(HERE, 'fixtures')
failures = []


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        failures.append(what)


def run(*args, env=None):
    e = dict(os.environ)
    e.pop('MS_NOHISTORY', None)
    if env:
        e.update(env)
    return subprocess.run([HOST] + list(args), capture_output=True, check=True, env=e).stdout.decode('utf-8')


def report(out):
    return dict(line.split(' ', 1) if ' ' in line else (line, '') for line in out.splitlines())


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def fresh_fixture(tmp, name):
    d = os.path.join(tmp, name)
    shutil.copytree(os.path.join(FIXTURES, 'fixproject'), d)
    return d, os.path.join(d, '41MATTEST.SFM')


def fixture_tests(tmp):
    d, f = fresh_fixture(tmp, 'all')
    out = report(run('fix', d, 'All', 'ALL', os.path.join(tmp, 'bak_all')))
    check(read(f) == read(os.path.join(FIXTURES, 'expected_all.SFM')), 'fixture: All gives expected_all.SFM')
    check(out['TOTAL'] == '17 BOOKS 1', 'fixture: 17 problems fixed in 1 book (%s)' % out['TOTAL'])
    check(out['WRITES'] == 'MAT 1, MAT 2', 'fixture: chapters 1 and 2 written (%s)' % out['WRITES'])
    check(out['BACKUPS'].startswith('Backup_MAT_') and out['BACKUPS'].endswith('.bak'), 'fixture: one .bak backup')
    rest = [l.split('\t') for l in run('scan', d).splitlines()]
    check(all(r[8] == '' for r in rest), 'fixture: nothing fixable left after All')
    check(sorted(r[3] for r in rest) == ['C', 'Unclosed', 'Unexpected'], 'fixture: only the by-hand problems are left')

    d, f = fresh_fixture(tmp, 'c')
    run('fix', d, 'C', 'ALL', os.path.join(tmp, 'bak_c'))
    check(read(f) == read(os.path.join(FIXTURES, 'expected_C.SFM')), 'fixture: C only gives expected_C.SFM')

    # Only chapter 2 may be edited: chapter 1 is listed and left alone.
    d, f = fresh_fixture(tmp, 'partial')
    before = read(f).decode('utf-8')
    out = report(run('fix', d, 'All', 'MAT:2', os.path.join(tmp, 'bak_partial')))
    after = read(f).decode('utf-8')
    cut_b, cut_a = before.index('\\c 2'), after.index('\\c 2')
    check(after[:cut_a] == before[:cut_b], 'partial: chapter 1 unchanged')
    expected = read(os.path.join(FIXTURES, 'expected_all.SFM')).decode('utf-8')
    check(after[cut_a:] == expected[expected.index('\\c 2'):], 'partial: chapter 2 fixed')
    check(out['NOPERMISSION'] == 'MAT 1', 'partial: MAT 1 listed as not permitted (%s)' % out['NOPERMISSION'])
    check(out['WRITES'] == 'MAT 2', 'partial: only MAT 2 written')

    # No history point: nothing changes.
    d, f = fresh_fixture(tmp, 'nohistory')
    out = report(run('fix', d, 'All', 'ALL', os.path.join(tmp, 'bak_nohist'), env={'MS_NOHISTORY': '1'}))
    check(read(f) == read(os.path.join(FIXTURES, 'fixproject', '41MATTEST.SFM')), 'no history: file unchanged')
    check(out['STOPPED'].startswith('True'), 'no history: reported as stopped')
    check(not os.path.exists(os.path.join(tmp, 'bak_nohist')), 'no history: no backup made')

    # MAT left out by the saved book choice: not examined, nothing written.
    d, f = fresh_fixture(tmp, 'excluded')
    os.makedirs(os.path.join(d, 'local', 'MarkerSpaces'))
    with open(os.path.join(d, 'local', 'MarkerSpaces', 'settings.xml'), 'w', encoding='utf-8') as x:
        x.write('<MarkerSpacesSettings><ExcludedBooks>MAT</ExcludedBooks></MarkerSpacesSettings>')
    check(run('scan', d) == '', 'excluded book: no problems found')
    out = report(run('fix', d, 'All', 'ALL', os.path.join(tmp, 'bak_excluded')))
    check(read(f) == read(os.path.join(FIXTURES, 'fixproject', '41MATTEST.SFM')) and out['WRITES'] == '' and out['HISTORY'] == '',
          'excluded book: file unchanged, no history point')
    check(run('scan', d, env={'MS_ALLBOOKS': '1'}) != '', 'excluded book: MS_ALLBOOKS=1 still examines it')

    # No rights at all: nothing written, no history point.
    d, f = fresh_fixture(tmp, 'none')
    out = report(run('fix', d, 'All', 'NONE', os.path.join(tmp, 'bak_none')))
    check(read(f) == read(os.path.join(FIXTURES, 'fixproject', '41MATTEST.SFM')), 'no rights: file unchanged')
    check(out['HISTORY'] == '' and out['NOPERMISSION'] == 'MAT', 'no rights: no history point, MAT listed')


SPACE = re.compile(r'[\s~]')


def project_test(tmp, project):
    name = os.path.basename(os.path.normpath(project))
    root = os.path.join(tmp, 'p_' + name)
    d = os.path.join(root, name)
    os.makedirs(d)
    # usfm.sty above the project folder, custom.sty in it, as in a real projects folder.
    parent_sty = os.path.join(os.path.dirname(os.path.normpath(project)), 'usfm.sty')
    if os.path.exists(parent_sty):
        shutil.copy(parent_sty, root)
    for f in glob.glob(os.path.join(project, 'custom.sty')) + glob.glob(os.path.join(project, '*.SFM')):
        shutil.copy(f, d)
    originals = {os.path.basename(f): read(f) for f in glob.glob(os.path.join(d, '*.SFM'))}
    fixable = sum(1 for l in run('scan', d).splitlines() if l.split('\t')[8])
    out = report(run('fix', d, 'All', 'ALL', os.path.join(root, 'bak')))
    left = [l for l in run('scan', d).splitlines() if l.split('\t')[8]]
    check(not left, '%s: %d fixable, %s; nothing fixable left (%d left)' % (name, fixable, out['TOTAL'], len(left)))
    for l in left[:5]:
        print('     left:', l)
    check(out['FAILED'] == '' and out['CHANGED'] == '', '%s: no failures' % name)
    bad = []
    for fn, old in originals.items():
        new = read(os.path.join(d, fn))
        if new != old and SPACE.sub('', new.decode('utf-8')) != SPACE.sub('', old.decode('utf-8')):
            bad.append(fn)
    check(not bad, '%s: only spaces changed %s' % (name, bad))


def main():
    tmp = tempfile.mkdtemp(prefix='ms_fix_')
    try:
        fixture_tests(tmp)
        for project in sys.argv[1:]:
            project_test(tmp, project)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('%d failure(s)' % len(failures))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
