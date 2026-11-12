// Marker Spaces for Paratext 10: the backend (runs in the extension host).
//
// tools/build.js makes dist/markerSpaces/src/main.js from: src/core.js (the scanner, MSCore), then
// the web view HTML and the built-in usfm.sty as string constants, then this file. Extensions may
// only require papi modules (no relative files, no fs, no eval), hence the single file.
//
// It adds:
//  - a check "Marker spaces" to Paratext 10's Checks panel (platformScripture.registerCheck);
//  - Tools > Marker Spaces... in the Scripture editor, which opens a window listing the problems,
//    where the ticked ones are fixed (book USFM read and written through platformScripture.USFM_Book).
/* global MSCore, MS_WEB_VIEW_HTML, MS_USFM_STY, MS_VERSION */
const papi = require('@papi/backend');

const { logger } = papi;
const WEB_VIEW_TYPE = 'markerSpaces.window';
const CHECK_ID_HINT = 'markerSpaces';

let executionToken;
/** The last scan of each project: issues (with their chapter text) and the book texts read. */
const sessions = new Map();
let builtInSty;

// ------------------------------------------------------------ helpers

function docs(summary) {
  return { method: { summary, params: [], result: { name: 'return value', schema: {} } } };
}

function verseRef(code, chapter, verse) {
  return { book: code, chapterNum: chapter, verseNum: verse };
}

async function interfaceLanguage() {
  try {
    const langs = await papi.settings.get('platform.interfaceLanguage');
    const first = Array.isArray(langs) && langs.length > 0 ? String(langs[0]).toLowerCase() : 'en';
    if (first.startsWith('es')) return 'es';
    if (first.startsWith('fr')) return 'fr';
  } catch (e) {
    logger.warn(`Marker Spaces: could not read the interface language: ${e}`);
  }
  return 'en';
}

async function projectName(projectId) {
  try {
    const base = await papi.projectDataProviders.get('platform.base', projectId);
    return (await base.getSetting('platform.name')) || projectId;
  } catch (e) {
    return projectId;
  }
}

/** Book numbers present in the project (setting platformScripture.booksPresent, "0101..."). */
async function booksPresent(projectId) {
  const base = await papi.projectDataProviders.get('platform.base', projectId);
  const present = String((await base.getSetting('platformScripture.booksPresent')) || '');
  const books = [];
  for (let i = 0; i < present.length && i < MSCore.BOOK_ORDER.length; i++)
    if (present[i] === '1') books.push({ num: i + 1, code: MSCore.bookCode(i + 1) });
  return books;
}

/** The stylesheet table for a book: Paratext's merged StyleInfo, or the built-in usfm.sty. */
async function styleTable(projectId, bookNum, cache) {
  if (cache && cache.has(bookNum)) return cache.get(bookNum);
  let sty;
  try {
    const pdp = await papi.projectDataProviders.get('platformScripture.StyleInfo', projectId);
    const info = await pdp.getStyleInfo(bookNum);
    if (info && info.markers && Object.keys(info.markers).length > 0) sty = MSCore.styFromStyleInfo(info);
  } catch (e) {
    logger.warn(`Marker Spaces: StyleInfo not available (${e}); using the built-in usfm.sty`);
  }
  if (!sty) {
    if (!builtInSty) builtInSty = MSCore.parseSty(MS_USFM_STY);
    sty = builtInSty;
  }
  if (cache) cache.set(bookNum, sty);
  return sty;
}

async function readBook(projectId, code) {
  const pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
  return pdp.getBookUSFM(verseRef(code, 1, 1));
}

// ------------------------------------------------------------ options (per project, user storage)

async function loadOptions(projectId) {
  const o = Object.assign({}, MSCore.DEFAULT_OPTIONS);
  try {
    const saved = JSON.parse(await papi.storage.readUserData(executionToken, `options:${projectId}`));
    Object.keys(o).forEach((k) => {
      if (saved && saved[k] !== undefined) o[k] = saved[k];
    });
  } catch (e) {
    // nothing saved yet
  }
  return o;
}

async function saveOptions(projectId, options) {
  const o = {};
  Object.keys(MSCore.DEFAULT_OPTIONS).forEach((k) => {
    o[k] = options && options[k] !== undefined ? options[k] : MSCore.DEFAULT_OPTIONS[k];
  });
  await papi.storage.writeUserData(executionToken, `options:${projectId}`, JSON.stringify(o));
  return o;
}

// ------------------------------------------------------------ scanning

/** Scans the chosen books; keeps the session for fixing; returns rows for the window. */
async function scanProject(projectId) {
  const options = await loadOptions(projectId);
  const books = await booksPresent(projectId);
  const chosen = books.filter((b) => !MSCore.isExcluded(options, b.code));
  const styCache = new Map();
  const issues = [];
  const texts = new Map();
  const failed = [];
  let scanner;
  let scannerSty;
  for (const book of chosen) {
    let text;
    try {
      text = await readBook(projectId, book.code);
    } catch (e) {
      failed.push(`${book.code}: ${e}`);
      continue;
    }
    if (!text) continue;
    texts.set(book.num, text);
    const sty = await styleTable(projectId, book.num, styCache);
    if (sty !== scannerSty) {
      scanner = new MSCore.Scanner(options, sty);
      scannerSty = sty;
    }
    issues.push(...MSCore.scanBook(scanner, book, text));
  }
  issues.forEach((issue, i) => {
    issue.id = i;
  });
  sessions.set(projectId, { issues, texts });

  let canEdit = true;
  try {
    const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
    canEdit = await perm.canUserEditScripture();
  } catch (e) {
    logger.warn(`Marker Spaces: could not read edit permission: ${e}`);
  }

  return {
    projectId,
    projectName: await projectName(projectId),
    canEdit,
    options,
    books: books.map((b) => ({ num: b.num, code: b.code, chosen: !MSCore.isExcluded(options, b.code) })),
    booksRead: chosen.length,
    failed,
    rows: issues.map((issue) => {
      const p = MSCore.preview(issue);
      return {
        id: issue.id,
        book: issue.book,
        chapter: issue.chapter,
        verse: issue.verse,
        kind: issue.kind,
        code: issue.code,
        marker: issue.marker,
        shown: issue.shown,
        canFix: issue.edits.length > 0,
        now: p.now,
        after: p.after,
      };
    }),
  };
}

// ------------------------------------------------------------ fixing

/**
 * Fixes the issues with these ids from the last scan. Each book is read again; a chapter whose text
 * differs from the scanned one is skipped ("changed since scan"). The book's text before the fix is
 * kept in the extension's user storage, then the whole book is written once.
 */
async function fixIssues(projectId, ids) {
  const report = { fixed: [], total: 0, booksChanged: 0, changed: [], failed: [], noPermission: false, backups: [] };
  const session = sessions.get(projectId);
  if (!session) throw new Error('Scan the project first.');
  const wanted = new Set(ids || []);
  const chosen = session.issues.filter((i) => wanted.has(i.id) && i.edits.length > 0);
  if (chosen.length === 0) return report;

  try {
    const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
    if (!(await perm.canUserEditScripture())) {
      report.noPermission = true;
      return report;
    }
  } catch (e) {
    logger.warn(`Marker Spaces: could not read edit permission, trying anyway: ${e}`);
  }

  const byBook = new Map();
  chosen.forEach((i) => {
    if (!byBook.has(i.bookNum)) byBook.set(i.bookNum, []);
    byBook.get(i.bookNum).push(i);
  });
  const pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');

  for (const [bookNum, list] of byBook) {
    const code = MSCore.bookCode(bookNum);
    let current;
    try {
      current = await pdp.getBookUSFM(verseRef(code, 1, 1));
    } catch (e) {
      report.failed.push(`${code}: ${e}`);
      continue;
    }
    if (!current) {
      report.failed.push(`${code}: no text`);
      continue;
    }
    // Chapters as scanned; keep only those whose text is still the same.
    const now = new Map(MSCore.bookChapters(current).map((ch) => [ch.chapter, ch]));
    const byChapter = new Map();
    list.forEach((i) => {
      if (!byChapter.has(i.chapter)) byChapter.set(i.chapter, []);
      byChapter.get(i.chapter).push(i);
    });
    const pieces = [];
    let pos = 0;
    let count = 0;
    const order = Array.from(byChapter.keys())
      .map((c) => ({ c, ch: now.get(c) }))
      .sort((a, b) => (a.ch ? a.ch.start : 0) - (b.ch ? b.ch.start : 0));
    for (const { c, ch } of order) {
      const issues = byChapter.get(c);
      if (!ch || ch.text !== issues[0].chapterText) {
        report.changed.push(`${code} ${c}`);
        continue;
      }
      pieces.push(current.substring(pos, ch.start));
      pieces.push(MSCore.apply(ch.text, issues.flatMap((i) => i.edits)));
      pos = ch.start + ch.text.length;
      count += issues.length;
    }
    if (count === 0) continue;
    pieces.push(current.substring(pos));
    const fixed = pieces.join('');
    if (fixed === current) continue;

    const backupKey = `backup:${projectId}:${code}:${stamp}`;
    try {
      await papi.storage.writeUserData(executionToken, backupKey, current);
    } catch (e) {
      report.failed.push(`${code}: the backup could not be written, so the book was not changed (${e})`);
      continue;
    }
    try {
      await pdp.setBookUSFM(verseRef(code, 1, 1), fixed);
    } catch (e) {
      report.failed.push(`${code}: ${e}`);
      continue;
    }
    // Read it back: Paratext may normalize or refuse silently.
    let after;
    try {
      after = await pdp.getBookUSFM(verseRef(code, 1, 1));
    } catch (e) {
      after = undefined;
    }
    if (after === current) {
      report.failed.push(`${code}: Paratext did not save the change`);
      continue;
    }
    report.fixed.push({ book: code, count });
    report.backups.push(backupKey);
    report.total += count;
    report.booksChanged += 1;
  }
  return report;
}

// ------------------------------------------------------------ the check in the Checks panel

const checkDetails = Object.freeze({
  checkName: '%markerSpaces_checkName%',
  checkDescription: '%markerSpaces_checkDescription%',
});

/** Offset of pos within its verse's text (after "\v N "), as hello-rock3's check counts it. */
function verseOffset(chapterText, pos) {
  const before = chapterText.substring(0, pos);
  const m = /\\v\s+\S+\s?/g;
  let last = null;
  let found;
  while ((found = m.exec(before)) !== null) last = found;
  if (!last) return 0;
  return Math.max(0, pos - (last.index + last[0].length));
}

function messageArgs(issue) {
  const close = issue.shown.endsWith('*') ? issue.shown : `${issue.marker}*`;
  return { marker: `\\${issue.shown}`, base: `\\${issue.marker}`, close: `\\${close}` };
}

class MarkerSpacesCheck {
  constructor() {
    this.projectId = undefined;
    this.pdp = undefined;
    this.cache = new Map(); // bookNum -> { text, issues }
  }

  async initialize(projectId) {
    this.projectId = projectId;
    this.cache.clear();
    try {
      this.pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
      this.options = await loadOptions(projectId);
    } catch (e) {
      return [String(e)];
    }
    return [];
  }

  async dispose() {
    this.projectId = undefined;
    this.pdp = undefined;
    this.cache.clear();
    return true;
  }

  getCheckDetails() {
    return checkDetails;
  }

  async getCheckResults(range) {
    if (!this.pdp) throw new Error('Check not initialized');
    const first = MSCore.bookNumber(range.start.book);
    const last = range.end ? MSCore.bookNumber(range.end.book) : first;
    const results = [];
    for (let bookNum = first; bookNum <= last && bookNum > 0; bookNum++) {
      const code = MSCore.bookCode(bookNum);
      let text;
      try {
        text = await this.pdp.getBookUSFM(verseRef(code, 1, 1));
      } catch (e) {
        continue;
      }
      if (!text) continue;
      let cached = this.cache.get(bookNum);
      if (!cached || cached.text !== text) {
        const sty = await styleTable(this.projectId, bookNum);
        const scanner = new MSCore.Scanner(this.options, sty);
        cached = { text, issues: MSCore.scanBook(scanner, { num: bookNum, code }, text) };
        this.cache.set(bookNum, cached);
      }
      const seen = new Map();
      for (const issue of cached.issues) {
        const v = MSCore.verseNumber(issue.verse);
        if (!inRange(range, bookNum, issue.chapter, v)) continue;
        const ref = verseRef(code, issue.chapter, v);
        const key = `${issue.chapter}:${v}:${issue.code}:${issue.shown}`;
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        const offStart = verseOffset(issue.chapterText, issue.start);
        const offEnd = verseOffset(issue.chapterText, issue.end);
        results.push({
          checkResultType: issue.code,
          checkResultUniqueId: `${issue.shown}#${n}`,
          projectId: this.projectId,
          verseText: MSCore.preview(issue).now,
          itemText: `\\${issue.shown}`,
          messageFormatString: `%markerSpaces_message_${issue.code}%`,
          formatStringArguments: messageArgs(issue),
          isDenied: false,
          verseRef: ref,
          start: { verseRef: ref, offset: offStart },
          end: { verseRef: ref, offset: Math.max(offStart, offEnd) },
        });
      }
    }
    return results;
  }
}

function refNumber(book, chapter, verse) {
  return book * 1000000 + chapter * 1000 + verse;
}

function inRange(range, bookNum, chapter, verse) {
  const s = range.start;
  const e = range.end || range.start;
  const n = refNumber(bookNum, chapter, verse);
  const lo = refNumber(MSCore.bookNumber(s.book), s.chapterNum, s.verseNum);
  const hi = refNumber(MSCore.bookNumber(e.book), e.chapterNum, range.end ? e.verseNum : s.verseNum);
  // Verse 0 at the start takes in the chapter's heading and everything before verse 1.
  return n >= lo && n <= hi;
}

/** platform-scripture may activate after us: try for a while, in the background. */
function registerCheckWhenReady(context) {
  let tries = 0;
  const attempt = async () => {
    tries += 1;
    try {
      const unsubscribe = await papi.commands.sendCommand(
        'platformScripture.registerCheck',
        checkDetails,
        async () => new MarkerSpacesCheck(),
      );
      context.registrations.add(unsubscribe);
      logger.info('Marker Spaces: check registered');
    } catch (e) {
      if (tries < 30) setTimeout(attempt, 2000);
      else logger.error(`Marker Spaces: could not register the check: ${e}`);
    }
  };
  attempt();
}

// ------------------------------------------------------------ the window

async function webViewHtml(projectId) {
  const boot = { projectId, lang: await interfaceLanguage(), version: MS_VERSION };
  // JSON inside a <script>: keep "</script>" and U+2028/9 from ending or breaking it.
  const json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return MS_WEB_VIEW_HTML.replace('__MS_BOOT__', json);
}

const webViewProvider = {
  async getWebView(savedWebView, options) {
    if (savedWebView.webViewType !== WEB_VIEW_TYPE)
      throw new Error(`${WEB_VIEW_TYPE} provider received a request for ${savedWebView.webViewType}`);
    const projectId = (options && options.projectId) || savedWebView.projectId;
    if (!projectId) return undefined;
    const lang = await interfaceLanguage();
    const title = { en: 'Marker Spaces', es: 'Espacios de marcadores', fr: 'Espaces autour des marqueurs' }[lang];
    return {
      ...savedWebView,
      title: `${title} - ${await projectName(projectId)}`,
      projectId,
      contentType: 'html',
      content: await webViewHtml(projectId),
    };
  },
};

/** Opens the window for the editor's project, or for projectId when given (from Phils Checks). */
async function openWindow(editorWebViewId, givenProjectId) {
  let projectId = typeof givenProjectId === 'string' && givenProjectId ? givenProjectId : undefined;
  if (!projectId && typeof editorWebViewId === 'string' && editorWebViewId) {
    try {
      const def = await papi.webViews.getOpenWebViewDefinition(editorWebViewId);
      projectId = def && def.projectId;
    } catch (e) {
      logger.warn(`Marker Spaces: could not read the editor's project: ${e}`);
    }
  }
  if (!projectId) {
    try {
      projectId = await papi.dialogs.selectProject({
        title: 'Marker Spaces',
        prompt: 'Choose the project to check for marker spacing problems',
        includeProjectInterfaces: ['platformScripture.USFM_Book'],
      });
    } catch (e) {
      logger.warn(`Marker Spaces: project chooser failed: ${e}`);
    }
  }
  if (!projectId) return undefined;
  return papi.webViews.openWebView(
    WEB_VIEW_TYPE,
    { type: 'float', floatSize: { width: 1000, height: 640 } },
    { existingId: '?', existingProjectId: projectId, projectId },
  );
}

async function goTo(projectId, code, chapter, verse) {
  await papi.scrollGroups.setScrRef(undefined, verseRef(code, chapter, MSCore.verseNumber(String(verse))), projectId);
  return true;
}

// ------------------------------------------------------------ activation

async function activate(context) {
  logger.info(`Marker Spaces ${MS_VERSION} is activating`);
  executionToken = context.executionToken;

  const register = papi.webViewProviders.registerWebViewProvider || papi.webViewProviders.register;
  const registrations = await Promise.all([
    register.call(papi.webViewProviders, WEB_VIEW_TYPE, webViewProvider),
    papi.commands.registerCommand('markerSpaces.open', openWindow, docs('Open the Marker Spaces window')),
    papi.commands.registerCommand('markerSpaces.scan', scanProject, docs('Scan a project for marker spacing problems')),
    papi.commands.registerCommand('markerSpaces.fix', fixIssues, docs('Fix marker spacing problems from the last scan')),
    papi.commands.registerCommand('markerSpaces.saveOptions', saveOptions, docs('Save Marker Spaces options for a project')),
    papi.commands.registerCommand('markerSpaces.goTo', goTo, docs('Go to a verse')),
  ]);
  registrations.forEach((r) => context.registrations.add(r));
  registerCheckWhenReady(context);
  logger.info(`Marker Spaces is finished activating (${CHECK_ID_HINT})`);
}

async function deactivate() {
  sessions.clear();
  return true;
}

exports.activate = activate;
exports.deactivate = deactivate;
