// Runs the BUILT extension (dist/markerSpaces/src/main.js) against a fake @papi/backend whose
// project is a folder of SFM files (a scratch copy: fixes are written to it). Checks activation,
// the commands, the check registration, scan, fix and the check's results.
//   ELECTRON_RUN_AS_NODE=1 "Paratext 10.exe" tests/mock_host.js FOLDER [CODES]
// CODES = All (default) or e.g. C,D: the kinds to fix. Prints a report; exits 1 on a failed check.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const HERE = __dirname;
const DIST = path.join(HERE, '..', 'dist', 'markerSpaces', 'src', 'main.js');
const folder = path.resolve(process.argv[2]);
const codes = process.argv[3] || 'All';
const PROJECT = 'TESTPROJECTID';
let failures = 0;
function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures += 1;
}

const vm = require('vm');
vm.runInThisContext(fs.readFileSync(path.join(HERE, '..', 'src', 'core.js'), 'utf8'));
/* global MSCore */

// ---------------------------------------------------------------- the fake project
const files = new Map();
for (const name of fs.readdirSync(folder)) {
  if (!/\.sfm$/i.test(name)) continue;
  const m = /^\uFEFF?\\id\s+(\w{3})/.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
  if (!m) continue;
  const num = MSCore.bookNumber(m[1]);
  if (num > 0 && name.toUpperCase().indexOf(m[1].toUpperCase()) >= 0) files.set(num, path.join(folder, name));
}
const present = MSCore.BOOK_ORDER.map((c, i) => (files.has(i + 1) ? '1' : '0')).join('');
const writes = [];
let canEdit = process.env.MS_CANEDIT !== '0';

function bookText(code) {
  const f = files.get(MSCore.bookNumber(code));
  if (!f) return undefined;
  return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
}

const providers = {
  'platform.base': {
    async getSetting(key) {
      if (key === 'platformScripture.booksPresent') return present;
      if (key === 'platform.name') return path.basename(folder);
      return undefined;
    },
  },
  'platformScripture.USFM_Book': {
    async getBookUSFM(ref) {
      return bookText(ref.book);
    },
    async setBookUSFM(ref, usfm) {
      writes.push(ref.book);
      fs.writeFileSync(files.get(MSCore.bookNumber(ref.book)), usfm, 'utf8');
      return true;
    },
  },
  'platformScripture.StyleInfo': {
    async getStyleInfo() {
      // As Paratext 10 gives it: markers with styleType and endMarker (from the built-in usfm.sty).
      const sty = MSCore.parseSty(
        fs.readFileSync(path.join(HERE, '..', '..', 'MarkerSpacesPlugin', 'Resources', 'usfm.sty'), 'utf8'),
      );
      const markers = {};
      sty.forEach((fields, key) => {
        markers[key] = { marker: key, styleType: fields.get('styletype'), endMarker: fields.get('endmarker') };
      });
      return { markers };
    },
  },
  'platformScripture.scriptureEditPermissions': {
    async canUserEditScripture() {
      return canEdit;
    },
  },
};

// ---------------------------------------------------------------- the fake papi
const commands = new Map();
const storage = new Map();
const logs = [];
let webViewProvider;
let scrRef;
const papi = {
  logger: {
    debug: (m) => logs.push(m),
    info: (m) => logs.push(m),
    warn: (m) => logs.push('WARN ' + m),
    error: (m) => logs.push('ERROR ' + m),
  },
  commands: {
    async registerCommand(name, handler) {
      commands.set(name, handler);
      return async () => commands.delete(name);
    },
    async sendCommand(name, ...args) {
      const h = commands.get(name);
      if (!h) throw new Error('no command ' + name);
      return h(...args);
    },
  },
  webViewProviders: {
    async registerWebViewProvider(type, provider) {
      webViewProvider = { type, provider };
      return async () => true;
    },
  },
  webViews: {
    async getOpenWebViewDefinition(id) {
      return id === 'EDITOR' ? { projectId: PROJECT } : undefined;
    },
    async openWebView(type, layout, options) {
      const def = await webViewProvider.provider.getWebView({ webViewType: type, id: 'W1' }, options);
      papi.lastWebView = def;
      return def ? 'W1' : undefined;
    },
  },
  dialogs: {
    async selectProject() {
      return undefined;
    },
  },
  projectDataProviders: {
    async get(name, projectId) {
      if (projectId !== PROJECT) throw new Error('unknown project ' + projectId);
      if (!providers[name]) throw new Error('no provider ' + name);
      return providers[name];
    },
  },
  settings: {
    async get(key) {
      return key === 'platform.interfaceLanguage' ? [process.env.MS_LANG || 'en'] : undefined;
    },
  },
  storage: {
    async readUserData(token, key) {
      if (!storage.has(key)) throw new Error('not found');
      return storage.get(key);
    },
    async writeUserData(token, key, data) {
      storage.set(key, data);
    },
  },
  scrollGroups: {
    async setScrRef(group, ref, projectId) {
      scrRef = { group, ref, projectId };
      return true;
    },
  },
};

// The checks framework: registerCheck as platform-scripture provides it.
let registeredCheck;
commands.set('platformScripture.registerCheck', async (details, create) => {
  registeredCheck = { details, create };
  return async () => true;
});

const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name === '@papi/backend') return papi;
  return originalRequire.apply(this, arguments);
};

async function main() {
  // Same rule as the extension host: no eval / Function while the extension runs.
  const ext = require(DIST);
  const registrations = [];
  await ext.activate({ executionToken: {}, registrations: { add: (r) => registrations.push(r) } });
  check(commands.has('markerSpaces.open') && commands.has('markerSpaces.scan') && commands.has('markerSpaces.fix'),
    'commands registered');
  await new Promise((r) => setTimeout(r, 50));
  check(!!registeredCheck, 'check registered with platformScripture.registerCheck');
  check(registeredCheck && registeredCheck.details.checkName === '%markerSpaces_checkName%', 'check name is a localize key');

  // Opening from the editor's menu: the editor's web view id gives the project.
  const id = await papi.commands.sendCommand('markerSpaces.open', 'EDITOR');
  check(id === 'W1', 'window opened for the editor project');
  const html = papi.lastWebView && papi.lastWebView.content;
  check(!!html && html.indexOf('"projectId":"TESTPROJECTID"') >= 0 && html.indexOf('__MS_BOOT__') < 0, 'window HTML has the project');
  check(papi.lastWebView.projectId === PROJECT && papi.lastWebView.contentType === 'html', 'window definition');

  // Scan with every book, so the result can be compared with scan_ext.js.
  await papi.commands.sendCommand('markerSpaces.saveOptions', PROJECT, { excludedBooks: '' });
  const result = await papi.commands.sendCommand('markerSpaces.scan', PROJECT);
  console.log(`scan: ${result.rows.length} problems in ${result.booksRead} books, canEdit ${result.canEdit}`);
  check(result.books.length === files.size, 'books present listed');
  const fixable = result.rows.filter((r) => r.canFix && (codes === 'All' || codes.split(',').indexOf(r.code) >= 0));

  // The check gives the same problems, book by book.
  const check1 = await registeredCheck.create();
  check((await check1.initialize(PROJECT)).length === 0, 'check initialized');
  let checkCount = 0;
  for (const num of files.keys()) {
    const code = MSCore.bookCode(num);
    const res = await check1.getCheckResults({
      start: { book: code, chapterNum: 1, verseNum: 0 },
      end: { book: code, chapterNum: 999, verseNum: 999 },
    });
    checkCount += res.length;
    if (res.length) {
      const r = res[0];
      const okShape = r.projectId === PROJECT && r.verseRef.book === code && typeof r.start.offset === 'number' &&
        /^%markerSpaces_message_/.test(r.messageFormatString) && r.formatStringArguments.marker.startsWith('\\');
      if (!okShape) check(false, 'result shape ' + JSON.stringify(r));
    }
  }
  check(checkCount === result.rows.length, `check results = window rows (${checkCount} / ${result.rows.length})`);
  // A one-verse range gives only that verse's problems.
  const sample = result.rows.find((r) => /^[0-9]+$/.test(r.verse));
  if (sample) {
    const one = await check1.getCheckResults({ start: { book: sample.book, chapterNum: sample.chapter, verseNum: +sample.verse } });
    const expected = result.rows.filter((r) => r.book === sample.book && r.chapter === sample.chapter && r.verse === sample.verse).length;
    check(one.length === expected, `one verse ${sample.book} ${sample.chapter}:${sample.verse}: ${one.length} result(s)`);
  }

  // Go to.
  if (sample) {
    await papi.commands.sendCommand('markerSpaces.goTo', PROJECT, sample.book, sample.chapter, sample.verse);
    check(scrRef && scrRef.ref.book === sample.book && scrRef.ref.verseNum === +sample.verse, 'go to sets the scroll group');
  }

  // Fix.
  const before = new Map(Array.from(files.keys()).map((n) => [n, bookText(MSCore.bookCode(n))]));
  const report = await papi.commands.sendCommand('markerSpaces.fix', PROJECT, fixable.map((r) => r.id));
  console.log('fix report: ' + JSON.stringify({ total: report.total, books: report.booksChanged, changed: report.changed, failed: report.failed }));
  check(report.total === fixable.length, `all ticked problems fixed (${report.total} / ${fixable.length})`);
  check(report.backups.length === report.booksChanged && report.backups.every((k) => storage.has(k)), 'one backup per changed book');
  for (const key of report.backups) {
    const code = key.split(':')[2];
    if (storage.get(key) !== before.get(MSCore.bookNumber(code))) check(false, 'backup of ' + code + ' is the old text');
  }
  // Only spaces changed.
  let onlySpaces = true;
  for (const [num, old] of before) {
    const now = bookText(MSCore.bookCode(num));
    if (old.replace(/[ \t\r\n~]/g, '') !== now.replace(/[ \t\r\n~]/g, '')) onlySpaces = false;
  }
  check(onlySpaces, 'only spaces changed');
  const again = await papi.commands.sendCommand('markerSpaces.scan', PROJECT);
  const left = again.rows.filter((r) => r.canFix && (codes === 'All' || codes.split(',').indexOf(r.code) >= 0));
  check(left.length === 0, `nothing of that kind left to fix (${left.length})`);

  // Changed since scan: edit a chapter, then fix with the old scan.
  if (again.rows.length && codes === 'All') check(true, '(changed-since-scan test skipped: nothing fixable left)');

  // No permission.
  canEdit = false;
  const denied = await papi.commands.sendCommand('markerSpaces.fix', PROJECT, again.rows.map((r) => r.id));
  check(denied.noPermission === true || again.rows.every((r) => !r.canFix), 'no permission: refused');
  canEdit = true;

  const errors = logs.filter((l) => /^ERROR/.test(l));
  check(errors.length === 0, 'no errors logged' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
