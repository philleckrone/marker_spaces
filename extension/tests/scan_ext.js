// Runs the extension's scanner (src/core.js) on a folder of SFM files and prints one line per
// problem in the format of the C# test host's "scan" mode:
//   BOOK  CHAPTER  VERSE  CODE  MARKER  SHOWN  START  END  EDITS
// Modes:
//   scan FOLDER              (MS_ALLBOOKS=1 examines every book, as in the test host)
//   preview FOLDER           REF  CODE  NOW  AFTER
//   fixall FOLDER OUT.SFM CODES   apply the fixes of CODES (All or A,C,...) to the one book in
//                                 FOLDER and write the result (for the fixture tests)
// Run it with Paratext 10's own Node:  ELECTRON_RUN_AS_NODE=1 "Paratext 10.exe" scan_ext.js ...
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
vm.runInThisContext(fs.readFileSync(path.join(HERE, '..', 'src', 'core.js'), 'utf8'), { filename: 'core.js' });
/* global MSCore */

const BUILT_IN_STY = path.join(HERE, '..', '..', 'MarkerSpacesPlugin', 'Resources', 'usfm.sty');

function codePageLabel(cp) {
  if (cp === 65001) return 'utf-8';
  if (cp === 874 || (cp >= 1250 && cp <= 1258)) return 'windows-' + cp;
  if (cp >= 28591 && cp <= 28605) return 'iso-8859-' + (cp - 28590);
  if (cp === 20127) return 'ascii';
  return null;
}

/** File.ReadAllText(path, encoding): a BOM wins over the given encoding. */
function readText(file, label) {
  const b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder(label).decode(b);
}

/** decode('utf-8-sig'), falling back to the ANSI code page (StyleSheets.Decode). */
function readSty(file) {
  if (!fs.existsSync(file)) return new Map();
  let b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) {
    text = new TextDecoder('windows-1252').decode(b);
  }
  return MSCore.parseSty(text);
}

function loadStyles(folder) {
  let usfm = readSty(path.join(path.dirname(path.resolve(folder)), 'usfm.sty'));
  if (usfm.size === 0) usfm = readSty(BUILT_IN_STY);
  return MSCore.mergeSty(usfm, readSty(path.join(folder, 'custom.sty')));
}

function loadOptions(folder) {
  const o = Object.assign({}, MSCore.DEFAULT_OPTIONS);
  const file = path.join(folder, 'local', 'MarkerSpaces', 'settings.xml');
  if (!fs.existsSync(file)) return o;
  const xml = fs.readFileSync(file, 'utf8');
  const get = (name) => {
    const m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(xml);
    if (m) return m[1].trim();
    return new RegExp('<' + name + '\\s*/>').test(xml) ? '' : undefined;
  };
  const set = (key, name) => {
    const v = get(name);
    if (v !== undefined) o[key] = v;
  };
  set('excludeMarkers', 'ExcludeMarkers');
  set('noCloseMarkers', 'NoCloseMarkers');
  set('noCloseInNoteMarkers', 'NoCloseInNoteMarkers');
  set('extraSpacingMarkers', 'ExtraSpacingMarkers');
  set('noSpaceBeforeMarkers', 'NoSpaceBeforeMarkers');
  const fp = get('FootnotePrecedesText');
  if (fp !== undefined) o.footnotePrecedesText = fp === 'Yes';
  const xp = get('CrossReferencesPrecedeText');
  if (xp !== undefined) o.crossReferencesPrecedeText = xp === 'Yes';
  const ex = get('ExcludedBooks');
  if (ex !== undefined) o.excludedBooks = ex;
  return o;
}

/** The book files of FolderBookSource: first line \id XXX, and the file name contains XXX. */
function bookFiles(folder) {
  let label = 'utf-8';
  const settings = path.join(folder, 'Settings.xml');
  if (fs.existsSync(settings)) {
    const m = /<Encoding>(\d+)<\/Encoding>/.exec(fs.readFileSync(settings, 'latin1'));
    if (m && m[1] !== '65001') {
      label = codePageLabel(parseInt(m[1], 10));
      if (!label) throw new Error('unsupported code page ' + m[1]);
    }
  }
  const files = new Map();
  const names = fs
    .readdirSync(folder)
    .filter((n) => /\.sfm$/i.test(n))
    .sort((a, b) => (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0));
  for (const name of names) {
    const file = path.join(folder, name);
    if (!fs.statSync(file).isFile()) continue;
    const first = fs.readFileSync(file).subarray(0, 400).toString('utf8').split(/\r\n|\r|\n/)[0];
    const m = /^\uFEFF?\\id[\f\n\r\t\v\x85\p{Z}]+([\p{L}\p{Mn}\p{Nd}\p{Pc}]{3})/u.exec(first);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const num = MSCore.bookNumber(code);
    if (num < 1) continue;
    if (path.basename(name, path.extname(name)).toUpperCase().indexOf(code) < 0) continue;
    files.set(num, file);
  }
  return {
    label,
    books: Array.from(files.keys())
      .sort((a, b) => a - b)
      .map((num) => ({ num, code: MSCore.bookCode(num), file: files.get(num) })),
  };
}

function scanFolder(folder) {
  const options = loadOptions(folder);
  const scanner = new MSCore.Scanner(options, loadStyles(folder));
  const { label, books } = bookFiles(folder);
  const all = process.env.MS_ALLBOOKS === '1';
  const issues = [];
  for (const b of books) {
    if (!all && MSCore.isExcluded(options, b.code)) continue;
    const text = readText(b.file, label);
    issues.push(...MSCore.scanBook(scanner, { num: b.num, code: b.code }, text));
  }
  return { issues, books, label };
}

function editsText(i) {
  return i.edits.map((e) => e.start + ':' + e.length + ':' + e.insert.replace(/ /g, '_')).join(';');
}

function main() {
  const [mode, folder] = process.argv.slice(2);
  const out = [];
  if (mode === 'scan') {
    for (const i of scanFolder(folder).issues)
      out.push([i.book, i.chapter, i.verse, i.code, i.marker, i.shown, i.start, i.end, editsText(i)].join('\t'));
  } else if (mode === 'preview') {
    for (const i of scanFolder(folder).issues) {
      const p = MSCore.preview(i);
      out.push(i.book + ' ' + i.chapter + ':' + i.verse + '\t' + i.code + '\t' + p.now + '\t' + p.after);
    }
  } else if (mode === 'fixall') {
    // Each chapter on its own, as the fix window does it; chapters are put back in book order.
    const [, , outFile, codes] = process.argv.slice(2);
    const wanted = codes === 'All' ? null : codes.split(',');
    const { issues, books, label } = scanFolder(folder);
    if (books.length !== 1) throw new Error('fixall needs a folder with one book');
    const text = readText(books[0].file, label);
    const byChapter = new Map();
    for (const i of issues) {
      if (i.edits.length === 0 || (wanted && wanted.indexOf(i.code) < 0)) continue;
      if (!byChapter.has(i.chapter)) byChapter.set(i.chapter, []);
      byChapter.get(i.chapter).push(i);
    }
    const fixed = fixBook(text, byChapter);
    fs.writeFileSync(outFile, fixed, 'utf8');
    out.push('FIXED ' + Array.from(byChapter.values()).reduce((n, l) => n + l.length, 0));
  } else {
    console.error('modes: scan | preview | fixall');
    process.exit(2);
  }
  process.stdout.write(out.map((l) => l + '\n').join(''));
}

/** Applies each chapter's edits to that chapter of the book (as main.js does before writing). */
function fixBook(bookText, byChapter) {
  const spans = MSCore.chapterSpans(bookText);
  const pieces = [];
  let pos = 0;
  const order = Array.from(byChapter.keys())
    .map((c) => ({ c, span: spans.get(c) || [0, bookText.length] }))
    .sort((a, b) => a.span[0] - b.span[0]);
  for (const { c, span } of order) {
    pieces.push(bookText.substring(pos, span[0]));
    const chapterText = bookText.substring(span[0], span[1]);
    pieces.push(MSCore.apply(chapterText, byChapter.get(c).flatMap((i) => i.edits)));
    pos = span[1];
  }
  pieces.push(bookText.substring(pos));
  return pieces.join('');
}

main();
