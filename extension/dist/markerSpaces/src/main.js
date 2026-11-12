// Marker Spaces 0.1.0 for Paratext 10. Built by tools/build.py from src/ - do not edit.
'use strict';
// Marker Spaces core: a port of MarkerSpacesPlugin\MarkerSpaceScanner.cs, ProjectScan.cs and the
// chapter cutting of tests\TestHost\FolderBookSource.cs. No papi here: the extension build puts this
// file in front of main.js, and the tests load it with vm.runInThisContext.
//
// .NET and JavaScript regexes differ, so the .NET classes are spelled out:
//   \s  = [\f\n\r\t\v\x85\p{Z}]      \d = \p{Nd}      \w = [\p{L}\p{Mn}\p{Nd}\p{Pc}]
//   char.IsWhiteSpace = [\t-\r\x85\p{Z}]   char.IsPunctuation = \p{P}
// String offsets are UTF-16 code units in both, so they match the C# test host exactly.
var MSCore = (function () {
  'use strict';

  var S = '[\\f\\n\\r\\t\\v\\x85\\p{Z}]';
  var SP = '[\\f\\n\\r\\t\\v\\x85\\p{Z}~]';
  var D = '\\p{Nd}';
  var W = '[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]';
  var WHITE_RE = /[\t-\r\x85\p{Z}]/u;
  var PUNCT_RE = /\p{P}/u;

  /** The kinds of problem, in the order of the C# enum (issues with the same start sort by it). */
  var KINDS = [
    'MissingSpaceBeforeOpen', // A
    'SpaceBeforeOpen', // B
    'SpaceBeforeClose', // C
    'MissingSpaceAfterClose', // D
    'SpaceBeforePunctuation', // E
    'SpaceAfterClose', // F
    'MissingSpaceBeforeNoClose',
    'SpaceBeforePipe',
    'Unclosed',
    'UnexpectedClose',
  ];
  var CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'NoCloseSpace', 'WPipe', 'Unclosed', 'Unexpected'];
  var K = {};
  KINDS.forEach(function (name, i) {
    K[name] = i;
  });

  var BOOK_ORDER = (
    'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM ' +
    'EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP ' +
    'COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV TOB JDT ESG WIS SIR BAR LJE S3Y SUS ' +
    'BEL 1MA 2MA 3MA 4MA 1ES 2ES MAN PS2 ODA PSS JSA JDB TBS SST DNT BLT XXA XXB XXC XXD XXE XXF XXG FRT ' +
    'BAK OTH 3ES EZA 5EZ 6EZ INT CNC GLO TDX NDX DAG PS3 2BA LBA JUB ENO 1MQ 2MQ 3MQ REP 4BA LAO'
  ).split(' ');

  /** Books that are not Bible text (ScanOptions.OtherBooks): left out unless the user ticks them. */
  var OTHER_BOOKS = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');

  var DEFAULT_OPTIONS = {
    excludeMarkers: '',
    noCloseMarkers: 'v fk fp fq fqa ft fr xk xo xq',
    noCloseInNoteMarkers: 'xt',
    extraSpacingMarkers: 'f x',
    noSpaceBeforeMarkers: 'f x',
    footnotePrecedesText: false,
    crossReferencesPrecedeText: true,
    /** Codes of the books not examined, space separated; null = the default (OTHER_BOOKS). */
    excludedBooks: null,
  };

  function bookCode(num) {
    return BOOK_ORDER[num - 1];
  }

  function bookNumber(code) {
    return BOOK_ORDER.indexOf(String(code).toUpperCase()) + 1;
  }

  function isBibleBook(code) {
    return OTHER_BOOKS.indexOf(String(code).toUpperCase()) < 0;
  }

  function isExcluded(options, code) {
    if (options.excludedBooks === null || options.excludedBooks === undefined) return !isBibleBook(code);
    return splitWhite(options.excludedBooks).some(function (c) {
      return c.toUpperCase() === String(code).toUpperCase();
    });
  }

  function isWhite(c) {
    return WHITE_RE.test(c);
  }

  /** string.Split((char[])null, RemoveEmptyEntries): split on char.IsWhiteSpace. */
  function splitWhite(s) {
    var out = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      if (isWhite(s[i])) {
        if (cur) out.push(cur);
        cur = '';
      } else cur += s[i];
    }
    if (cur) out.push(cur);
    return out;
  }

  /** string.Trim(): char.IsWhiteSpace at both ends (JavaScript's trim also removes U+FEFF). */
  function csTrim(s) {
    var a = 0;
    var b = s.length;
    while (a < b && isWhite(s[a])) a++;
    while (b > a && isWhite(s[b - 1])) b--;
    return s.substring(a, b);
  }

  /** Regex.Escape, limited to what a 'u' regex accepts as an escape. */
  function esc(s) {
    return s.replace(/[\\^$.*+?()[\]{}|\/#]/g, function (c) {
      return c === '#' ? '#' : '\\' + c;
    });
  }

  // ------------------------------------------------------------ stylesheets

  /**
   * StyleSheets.ParseText: a \Marker line opens an entry; any other \Field line sets that field
   * (name lowercased) on it. Returns a Map in file order.
   */
  function parseSty(text) {
    var entries = new Map();
    var current = null;
    text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .forEach(function (raw) {
        var line = csTrim(raw);
        if (line.length === 0 || line[0] === '#' || line[0] !== '\\') return;
        var rest = line.substring(1);
        var ws = 0;
        while (ws < rest.length && !isWhite(rest[ws])) ws++;
        var field = rest.substring(0, ws);
        if (field.length === 0) return;
        var value = csTrim(rest.substring(ws));
        if (field === 'Marker') {
          current = entries.get(value);
          if (!current) {
            current = new Map();
            entries.set(value, current);
          }
        } else if (current) current.set(field.toLowerCase(), value);
      });
    return entries;
  }

  /** usfm.sty merged field by field with custom.sty (StyleSheets.Load). */
  function mergeSty(usfm, custom) {
    var markers = new Map();
    usfm.forEach(function (fields, key) {
      markers.set(key, new Map(fields));
    });
    custom.forEach(function (fields, key) {
      var target = markers.get(key);
      if (!target) {
        target = new Map();
        markers.set(key, target);
      }
      fields.forEach(function (v, f) {
        target.set(f, v);
      });
    });
    return markers;
  }

  /** The same table from Paratext 10's StyleInfo (merged usfm.sty + custom.sty). */
  function styFromStyleInfo(styleInfo) {
    var markers = new Map();
    var all = (styleInfo && styleInfo.markers) || {};
    Object.keys(all).forEach(function (key) {
      var info = all[key] || {};
      var fields = new Map();
      if (info.styleType) fields.set('styletype', String(info.styleType));
      if (info.endMarker) fields.set('endmarker', String(info.endMarker));
      markers.set(info.marker || key, fields);
    });
    return markers;
  }

  // ------------------------------------------------------------ scanner

  var TPREFIX_KEEP = ['tl', 'ts-s', 'ts-e'];
  var VERSE_RE = new RegExp('\\\\v' + S + '+(' + D + '+(?:[,-]' + D + '+)*)' + S + '*', 'gu');
  var NEXT_CLOSE_RE = /\\\+?[a-zA-Z][a-zA-Z0-9]*\*/y;
  var NOTE_SPAN_RE = new RegExp('\\\\f' + S + '[\\s\\S]*?\\\\f\\*|\\\\x' + S + '[\\s\\S]*?\\\\x\\*', 'gu');
  var MARKER_SPACE_RE = new RegExp(
    '\\\\\\+?[a-zA-Z][a-zA-Z0-9]*\\*?(?:' + SP + '+' + D + '+(?:[,-]' + D + '+)*)?' + SP + '+',
    'gu',
  );
  var CLOSING_PUNCT = ',.;:!?)]}\u2026\u00BB\u201D\u2019\u203A';

  function names(raw) {
    var list = [];
    splitWhite(raw || '').forEach(function (m) {
      var n = m.replace(/^\\+/, '');
      if (n.length > 0 && list.indexOf(n) < 0) list.push(n);
    });
    return list;
  }

  function isIgnoredTMarker(marker) {
    return marker.toLowerCase().indexOf('t') === 0 && TPREFIX_KEEP.indexOf(marker) < 0;
  }

  function resolveEndmarker(marker, fields) {
    var end = splitWhite((fields && fields.get('endmarker')) || '');
    return end.length > 0 ? end[0] : marker + '*';
  }

  function markerPattern(bare, allNames) {
    var lookahead = '';
    if (allNames) {
      var ext = [];
      allNames.forEach(function (m) {
        if (m !== bare && m.indexOf(bare) === 0) ext.push(esc(m.substring(bare.length)));
      });
      if (ext.length > 0) lookahead = '(?!' + ext.join('|') + ')';
    }
    return '\\\\\\+?' + esc(bare) + lookahead;
  }

  function openMarkerRegex(marker, allNames) {
    return new RegExp(markerPattern(marker, allNames) + '(?!\\*)', 'gu');
  }

  function isPunct(c) {
    return c !== '\\' && PUNCT_RE.test(c);
  }

  function isSpace(c) {
    return isWhite(c) || c === '~';
  }

  function isInlineSpace(c) {
    return c === ' ' || c === '\t' || c === '~';
  }

  function isClosingPunct(c) {
    return CLOSING_PUNCT.indexOf(c) >= 0;
  }

  function contentStartsWithClosingPunct(text, contentStart) {
    var n = text.length;
    var k = contentStart;
    while (k < n && isSpace(text[k])) k++;
    return k < n && isClosingPunct(text[k]);
  }

  function spaceRunStart(text, pos, limit) {
    var k = pos;
    while (k > limit && k > 0 && isSpace(text[k - 1])) k--;
    return k;
  }

  function allMatches(re, text) {
    re.lastIndex = 0;
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      out.push(m);
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  /** First match at or after start (Regex.Match(text, start)). */
  function matchFrom(re, text, start) {
    re.lastIndex = start;
    return re.exec(text);
  }

  /** Match exactly at pos (\G). re must be sticky. */
  function matchAt(re, text, pos) {
    re.lastIndex = pos;
    return re.test(text);
  }

  /**
   * new MarkerSpaceScanner(options, sty). sty is a Map marker -> Map(field -> value), in
   * stylesheet order.
   */
  function Scanner(options, sty) {
    var o = Object.assign({}, DEFAULT_OPTIONS, options || {});
    this.exclude = names(o.excludeMarkers);
    this.noClose = names(o.noCloseMarkers);
    this.noteContext = names(o.noCloseInNoteMarkers);
    this.extraSpacing = names(o.extraSpacingMarkers);
    this.noSpaceBefore = names(o.noSpaceBeforeMarkers);
    this.footnotePrecedes = !!o.footnotePrecedesText;
    if (this.footnotePrecedes) remove(this.noSpaceBefore, 'f');
    this.xrefPrecedes = !!o.crossReferencesPrecedeText;
    if (this.xrefPrecedes) remove(this.noSpaceBefore, 'x');

    var self = this;
    var chars = new Map();
    this.charMarkers = []; // [marker, endmarker] in the CMS check's order
    this.noCloseEnd = [];
    function add(marker, endmarker) {
      chars.set(marker, endmarker);
      self.charMarkers.push([marker, endmarker]);
    }
    sty.forEach(function (fields, key) {
      var st = fields.get('styletype');
      if (st === undefined || csTrim(st).toLowerCase() !== 'character') return;
      if (self.exclude.indexOf(key) >= 0 || self.noClose.indexOf(key) >= 0 || isIgnoredTMarker(key)) return;
      add(key, resolveEndmarker(key, fields));
    });
    this.noteContext.forEach(function (m) {
      if (self.exclude.indexOf(m) >= 0 || isIgnoredTMarker(m)) return;
      if (!chars.has(m)) add(m, resolveEndmarker(m, sty.get(m)));
    });
    this.extraSpacing.forEach(function (m) {
      if (self.exclude.indexOf(m) >= 0 || self.noClose.indexOf(m) >= 0 || self.noteContext.indexOf(m) >= 0) return;
      if (isIgnoredTMarker(m)) return;
      if (!chars.has(m)) add(m, resolveEndmarker(m, sty.get(m)));
    });
    this.noClose.forEach(function (m) {
      if (isIgnoredTMarker(m)) return;
      self.noCloseEnd.push([m, resolveEndmarker(m, sty.get(m))]);
    });

    var all = new Set(sty.keys());
    chars.forEach(function (v, k) {
      all.add(k);
    });
    this.noCloseEnd.forEach(function (kv) {
      all.add(kv[0]);
    });
    [this.exclude, this.noClose, this.noteContext, this.extraSpacing, this.noSpaceBefore].forEach(function (list) {
      list.forEach(function (m) {
        all.add(m);
      });
    });

    this.openRes = new Map();
    this.closeRes = new Map();
    this.charMarkers.forEach(function (kv) {
      self.openRes.set(kv[0], openMarkerRegex(kv[0], all));
      self.closeRes.set(kv[0], new RegExp(markerPattern(kv[1], null), 'gu'));
    });
    this.noCloseRes = new Map();
    this.noCloseOpenRes = new Map();
    this.noCloseEnd.forEach(function (kv) {
      self.noCloseRes.set(kv[0], new RegExp(markerPattern(kv[1], null), 'gu'));
      if (self.exclude.indexOf(kv[0]) < 0) self.noCloseOpenRes.set(kv[0], openMarkerRegex(kv[0], all));
    });
    // \b after each name: the next character is not a word character when the name ends in one.
    this.noSpaceBeforeRe =
      this.noSpaceBefore.length > 0
        ? new RegExp(
            '\\\\\\+?(?:' +
              this.noSpaceBefore
                .map(function (m) {
                  var endsWord = new RegExp(W + '$', 'u').test(m);
                  return esc(m) + (endsWord ? '(?!' + W + ')' : '(?=' + W + ')');
                })
                .join('|') +
              ')',
            'yu',
          )
        : null;
  }

  function remove(list, item) {
    var i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  /** The problems in one chapter, in text order. book = {num, code}. */
  Scanner.prototype.scanChapter = function (book, chapter, text) {
    var self = this;
    var issues = [];
    if (!text) return issues;
    var n = text.length;

    var versePos = allMatches(VERSE_RE, text).map(function (vm) {
      return [vm.index + vm[0].length, vm[1]];
    });
    function verseAt(offset) {
      var label = null;
      for (var i = 0; i < versePos.length; i++) {
        if (versePos[i][0] <= offset) label = versePos[i][1];
        else break;
      }
      return label === null ? '-' : label;
    }
    function make(kind, marker, shown, refPos, start, end) {
      var issue = {
        book: book.code,
        bookNum: book.num,
        chapter: chapter,
        verse: verseAt(refPos),
        kind: kind,
        code: CODES[kind],
        marker: marker,
        shown: shown,
        start: start,
        end: end,
        edits: [],
      };
      issues.push(issue);
      return issue;
    }

    var noteSpans = [];
    if (this.noteContext.length > 0)
      allMatches(NOTE_SPAN_RE, text).forEach(function (m) {
        noteSpans.push([m.index, m.index + m[0].length]);
      });
    var markerSpaceEnds = new Set();
    if (this.noSpaceBefore.length > 0)
      allMatches(MARKER_SPACE_RE, text).forEach(function (m) {
        markerSpaceEnds.add(m.index + m[0].length);
      });

    this.charMarkers.forEach(function (kv) {
      var marker = kv[0];
      var endmarker = kv[1];
      var openRe = self.openRes.get(marker);
      var closeRe = self.closeRes.get(marker);
      var skipInNotes = self.noteContext.indexOf(marker) >= 0;

      var opens = allMatches(openRe, text);
      if (opens.length === 0) return;
      var closes = endmarker.indexOf('\\') < 0 ? allMatches(closeRe, text) : null;
      var ci = 0;
      for (var idx = 0; idx < opens.length; idx++) {
        var m = opens[idx];
        var mEnd = m.index + m[0].length;
        var nextOpen = idx + 1 < opens.length ? opens[idx + 1].index : n;
        var close;
        if (closes) {
          while (ci < closes.length && closes[ci].index < mEnd) ci++;
          close = ci < closes.length ? closes[ci] : null;
        } else close = matchFrom(closeRe, text, mEnd);

        if (!close || close.index >= nextOpen) {
          // \xt inside a footnote or cross-reference needs no closing marker.
          var skip = false;
          if (skipInNotes)
            for (var s = 0; s < noteSpans.length; s++)
              if (noteSpans[s][0] <= m.index && m.index < noteSpans[s][1]) {
                skip = true;
                break;
              }
          if (!skip) make(K.Unclosed, marker, marker, m.index, m.index, mEnd);
          continue;
        }

        var os = m.index;
        var oe = mEnd;
        var cs = close.index;
        var ce = close.index + close[0].length;
        var invertOpen = self.noSpaceBefore.indexOf(marker) >= 0;
        var invertClose = (self.footnotePrecedes && marker === 'f') || (self.xrefPrecedes && marker === 'x');
        self.checkPair(text, marker, endmarker, os, oe, cs, ce, invertOpen, invertClose, markerSpaceEnds, make);

        if (marker === 'w') {
          var pipe = cs > oe ? text.substring(0, cs).indexOf('|', oe) : -1;
          if (pipe > oe && isSpace(text[pipe - 1])) {
            var issue = make(K.SpaceBeforePipe, marker, marker, os, pipe - 1, pipe + 1);
            var k = spaceRunStart(text, pipe, oe + 1);
            if (k < pipe) issue.edits.push(edit(k, pipe - k, ''));
          }
        }
      }
    });

    this.noCloseEnd.forEach(function (kv) {
      allMatches(self.noCloseRes.get(kv[0]), text).forEach(function (m) {
        make(K.UnexpectedClose, kv[0], kv[1], m.index, m.index, m.index + m[0].length);
      });
    });

    this.noCloseOpenRes.forEach(function (re, marker) {
      allMatches(re, text).forEach(function (m) {
        var hs = m.index;
        var he = m.index + m[0].length;
        if (hs === 0) return;
        var before = text[hs - 1];
        if (isSpace(before) || isPunct(before) || contentStartsWithClosingPunct(text, he)) return;
        var issue = make(K.MissingSpaceBeforeNoClose, marker, marker, hs, hs, he);
        issue.edits.push(edit(hs, 0, ' '));
      });
    });

    issues.sort(function (a, b) {
      return a.start !== b.start ? a.start - b.start : a.kind - b.kind;
    });
    return issues;
  };

  /** _check_pair: the spacing around one \marker ... \marker* pair, each problem with its fix. */
  Scanner.prototype.checkPair = function (text, marker, endmarker, os, oe, cs, ce, invertOpen, invertClose, markerSpaceEnds, make) {
    var n = text.length;
    var issue;
    var k;

    if (os > 0) {
      var beforeOpen = text[os - 1];
      if (invertOpen) {
        // B: \f or \x attaches to the word before it, except right after another marker's space.
        if (isSpace(beforeOpen) && !markerSpaceEnds.has(os)) {
          issue = make(K.SpaceBeforeOpen, marker, marker, os, os, oe);
          k = spaceRunStart(text, os, 0);
          issue.edits.push(edit(k, os - k, ''));
        }
      } else if (!isSpace(beforeOpen) && !isPunct(beforeOpen) && !contentStartsWithClosingPunct(text, oe)) {
        issue = make(K.MissingSpaceBeforeOpen, marker, marker, os, os, oe); // A
        issue.edits.push(edit(os, 0, ' '));
      }
    }

    if (cs > 0 && isSpace(text[cs - 1])) {
      // C: the space moves outside the closing marker.
      issue = make(K.SpaceBeforeClose, marker, endmarker, os, cs, ce);
      k = spaceRunStart(text, cs, oe + 1);
      if (k < cs) {
        issue.edits.push(edit(k, cs - k, ''));
        if (!invertClose && this.needsSpaceAfter(text, ce)) issue.edits.push(edit(ce, 0, ' '));
      }
    }

    if (ce < n) {
      var afterClose = text[ce];
      if (isInlineSpace(afterClose)) {
        k = ce;
        while (k < n && isInlineSpace(text[k])) k++;
        if (k < n && isClosingPunct(text[k])) {
          issue = make(K.SpaceBeforePunctuation, marker, endmarker, os, cs, ce); // E
          issue.edits.push(edit(ce, k - ce, ''));
        } else if (invertClose && k < n && !isPunct(text[k])) {
          issue = make(K.SpaceAfterClose, marker, endmarker, os, cs, ce); // F
          issue.edits.push(edit(ce, k - ce, ''));
        }
      } else if (!invertClose && this.needsSpaceAfter(text, ce)) {
        issue = make(K.MissingSpaceAfterClose, marker, endmarker, os, cs, ce); // D
        issue.edits.push(edit(ce, 0, ' '));
      }
    }
  };

  /** Check D's test: the closing marker ending at ce is glued to a word or marker. */
  Scanner.prototype.needsSpaceAfter = function (text, ce) {
    if (ce >= text.length) return false;
    var c = text[ce];
    if (isSpace(c) || isPunct(c)) return false;
    if (c === '\\' && ((this.noSpaceBeforeRe && matchAt(this.noSpaceBeforeRe, text, ce)) || matchAt(NEXT_CLOSE_RE, text, ce)))
      return false;
    return true;
  };

  function edit(start, length, insert) {
    return { start: start, length: length, insert: insert || '' };
  }

  // ------------------------------------------------------------ applying fixes

  /**
   * MarkerSpaceScanner.Apply: the same insertion at the same place is made once, overlapping
   * deletions are joined, and an insertion inside a deleted stretch is dropped.
   */
  function apply(text, edits) {
    var deletes = [];
    var inserts = new Map();
    edits.forEach(function (e) {
      if (e.length > 0) deletes.push([e.start, e.start + e.length]);
      if (e.insert.length > 0) {
        var existing = inserts.get(e.start);
        if (existing === undefined || existing !== e.insert)
          inserts.set(e.start, existing === undefined ? e.insert : existing + e.insert);
      }
    });
    deletes.sort(function (a, b) {
      return a[0] - b[0];
    });
    var merged = [];
    deletes.forEach(function (d) {
      var last = merged[merged.length - 1];
      if (last && d[0] <= last[1]) last[1] = Math.max(last[1], d[1]);
      else merged.push([d[0], d[1]]);
    });

    var out = [];
    var pos = 0;
    var di = 0;
    var points = Array.from(inserts.keys()).sort(function (a, b) {
      return a - b;
    });
    points.push(Infinity);
    for (var p = 0; p < points.length; p++) {
      var at = points[p];
      var stop = Math.min(at, text.length);
      while (pos < stop) {
        while (di < merged.length && merged[di][1] <= pos) di++;
        if (di < merged.length && merged[di][0] <= pos) {
          pos = Math.min(merged[di][1], text.length);
          continue;
        }
        var next = di < merged.length ? Math.min(merged[di][0], stop) : stop;
        out.push(text.substring(pos, next));
        pos = next;
      }
      if (at === Infinity) break;
      var insideDelete = merged.some(function (d) {
        return d[0] < at && at < d[1];
      });
      if (!insideDelete && at <= text.length) out.push(inserts.get(at));
    }
    return out.join('');
  }

  // ------------------------------------------------------------ books and chapters

  var CHAPTER_RE = /\\c[ \t]+(\p{Nd}+)/gu;

  function asciiInt(s) {
    return /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
  }

  /**
   * Chapters as Paratext cuts them (FolderBookSource.ChapterSpans): chapter 1 runs from the start
   * of the book (\id) to the second \c; a book without \c is all chapter 1. Map chapter -> [start, end].
   */
  function chapterSpans(text) {
    var starts = [];
    allMatches(CHAPTER_RE, text).forEach(function (m) {
      var c = asciiInt(m[1]);
      if (!isNaN(c)) starts.push([c, m.index]);
    });
    var spans = new Map();
    if (starts.length === 0) {
      spans.set(1, [0, text.length]);
      return spans;
    }
    for (var i = 0; i < starts.length; i++) {
      var start = i === 0 ? 0 : starts[i][1];
      var end = i + 1 < starts.length ? starts[i + 1][1] : text.length;
      if (!spans.has(starts[i][0])) spans.set(starts[i][0], [start, end]);
    }
    return spans;
  }

  /**
   * ProjectScan.Scan for one book: [{chapter, start, text}] in the order the chapters are scanned
   * (\c order, chapter 1 first when the book has no \c 1; then it is the whole book).
   */
  function bookChapters(bookText) {
    var chapters = [];
    allMatches(CHAPTER_RE, bookText).forEach(function (m) {
      var c = asciiInt(m[1]);
      if (!isNaN(c) && chapters.indexOf(c) < 0) chapters.push(c);
    });
    if (chapters.indexOf(1) < 0) chapters.unshift(1);
    var spans = chapterSpans(bookText);
    var out = [];
    chapters.forEach(function (c) {
      var span = spans.get(c);
      if (span) out.push({ chapter: c, start: span[0], text: bookText.substring(span[0], span[1]) });
      else if (c === 1) out.push({ chapter: 1, start: 0, text: bookText, wholeBook: true });
    });
    return out;
  }

  /** Every problem in one book, each with chapterText set (the text its offsets refer to). */
  function scanBook(scanner, book, bookText) {
    var issues = [];
    if (!bookText) return issues;
    bookChapters(bookText).forEach(function (ch) {
      scanner.scanChapter(book, ch.chapter, ch.text).forEach(function (issue) {
        issue.chapterText = ch.text;
        issue.chapterStart = ch.start;
        issue.wholeBook = !!ch.wholeBook;
        issues.push(issue);
      });
    });
    return issues;
  }

  /** The first verse number of a label ("3-4" -> 3, "-" -> 0). */
  function verseNumber(label) {
    var m = /^[0-9]+/.exec(label || '');
    return m ? parseInt(m[0], 10) : 0;
  }

  // ------------------------------------------------------------ preview

  var DOT = '\u00B7';
  var PILCROW = '\u00B6';
  var ELLIPSIS = '\u2026';
  var PLACEHOLDER = '\u0001';
  var CONTEXT = 25;

  function render(c, removed) {
    if (removed) {
      if (c === '\n') return PILCROW;
      if (c === '\r') return '';
      if (c === ' ' || c === '\t') return DOT;
      return c;
    }
    if (c === '\r') return '';
    return c === '\n' || c === '\t' ? ' ' : c;
  }

  /** ProjectScan.Preview: {now, after}; after is '' for a problem fixed by hand. */
  function preview(issue) {
    var text = issue.chapterText;
    var canFix = issue.edits.length > 0;
    var a = issue.start;
    var b = issue.end;
    if (canFix) {
      a = Math.min.apply(null, issue.edits.map(function (e) { return e.start; }));
      b = Math.max.apply(null, issue.edits.map(function (e) { return e.start + e.length; }));
    }
    var ws = Math.max(0, a - CONTEXT);
    var we = Math.min(text.length, b + CONTEXT);
    var slice = text.substring(ws, we);
    var prefix = ws > 0 ? ELLIPSIS : '';
    var suffix = we < text.length ? ELLIPSIS : '';
    var removed = new Array(slice.length).fill(false);
    issue.edits.forEach(function (e) {
      for (var i = Math.max(e.start, ws); i < Math.min(e.start + e.length, we); i++) removed[i - ws] = true;
    });
    var now = '';
    for (var i = 0; i < slice.length; i++) now += render(slice[i], removed[i]);
    now = prefix + csTrim(now) + suffix;
    if (!canFix) return { now: now, after: '' };
    var fixedSlice = apply(
      slice,
      issue.edits.map(function (e) {
        return edit(e.start - ws, e.length, e.insert.length > 0 ? PLACEHOLDER.repeat(e.insert.length) : '');
      }),
    );
    var after = '';
    for (var j = 0; j < fixedSlice.length; j++)
      after += fixedSlice[j] === PLACEHOLDER ? DOT : render(fixedSlice[j], false);
    return { now: now, after: prefix + csTrim(after) + suffix };
  }

  return {
    KINDS: KINDS,
    CODES: CODES,
    BOOK_ORDER: BOOK_ORDER,
    OTHER_BOOKS: OTHER_BOOKS,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    bookCode: bookCode,
    bookNumber: bookNumber,
    isBibleBook: isBibleBook,
    isExcluded: isExcluded,
    parseSty: parseSty,
    mergeSty: mergeSty,
    styFromStyleInfo: styFromStyleInfo,
    Scanner: Scanner,
    apply: apply,
    chapterSpans: chapterSpans,
    bookChapters: bookChapters,
    scanBook: scanBook,
    verseNumber: verseNumber,
    preview: preview,
  };
})();

const MS_VERSION = "0.1.0";
const MS_WEB_VIEW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      :root {\n        --ms-bg: #ffffff;\n        --ms-fg: #1f2328;\n        --ms-muted: #59636e;\n        --ms-line: #d0d7de;\n        --ms-head: #f3f5f7;\n        --ms-sel: #dbeafe;\n        --ms-accent: #0b6bcb;\n        --ms-warn: #9a3412;\n        --ms-ok: #166534;\n        --ms-mono: Consolas, 'Cascadia Mono', monospace;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root {\n          --ms-bg: #1e1f22;\n          --ms-fg: #e6e6e6;\n          --ms-muted: #a0a6ad;\n          --ms-line: #3a3d42;\n          --ms-head: #2a2c30;\n          --ms-sel: #1e3a5f;\n          --ms-accent: #6cb6ff;\n          --ms-warn: #fdba74;\n          --ms-ok: #86efac;\n        }\n      }\n      html,\n      body {\n        margin: 0;\n        height: 100%;\n        background: var(--ms-bg);\n        color: var(--ms-fg);\n        font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n      }\n      body {\n        display: flex;\n        flex-direction: column;\n        padding: 8px 12px;\n        box-sizing: border-box;\n        gap: 6px;\n      }\n      .row {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 8px;\n      }\n      .grow {\n        flex: 1;\n      }\n      button {\n        font: inherit;\n        padding: 3px 10px;\n        border: 1px solid var(--ms-line);\n        background: var(--ms-head);\n        color: var(--ms-fg);\n        border-radius: 4px;\n        cursor: pointer;\n      }\n      button.primary {\n        background: var(--ms-accent);\n        border-color: var(--ms-accent);\n        color: #fff;\n        font-weight: 600;\n      }\n      button:disabled {\n        opacity: 0.5;\n        cursor: default;\n      }\n      select,\n      input[type='text'] {\n        font: inherit;\n        background: var(--ms-bg);\n        color: var(--ms-fg);\n        border: 1px solid var(--ms-line);\n        border-radius: 3px;\n        padding: 2px 4px;\n      }\n      #intro,\n      #status,\n      .hint {\n        color: var(--ms-muted);\n      }\n      #status.busy {\n        color: var(--ms-warn);\n        font-weight: 600;\n      }\n      #tableWrap {\n        flex: 1;\n        overflow: auto;\n        border: 1px solid var(--ms-line);\n        min-height: 120px;\n      }\n      table {\n        border-collapse: collapse;\n        width: 100%;\n      }\n      th,\n      td {\n        border-bottom: 1px solid var(--ms-line);\n        padding: 3px 6px;\n        text-align: left;\n        vertical-align: top;\n      }\n      th {\n        position: sticky;\n        top: 0;\n        background: var(--ms-head);\n        font-weight: 600;\n        z-index: 1;\n      }\n      td.text {\n        font-family: var(--ms-mono);\n        white-space: pre-wrap;\n        word-break: break-word;\n      }\n      td.ref {\n        white-space: nowrap;\n      }\n      tr:hover td {\n        background: var(--ms-sel);\n      }\n      .byhand {\n        color: var(--ms-muted);\n        font-style: italic;\n      }\n      #results {\n        max-height: 110px;\n        overflow: auto;\n        white-space: pre-wrap;\n        border: 1px solid var(--ms-line);\n        padding: 4px 6px;\n        font-size: 12px;\n      }\n      #results.ok {\n        color: var(--ms-ok);\n      }\n      .panel {\n        border: 1px solid var(--ms-line);\n        background: var(--ms-head);\n        padding: 8px;\n        border-radius: 4px;\n      }\n      .panel label.field {\n        display: grid;\n        grid-template-columns: minmax(200px, 45%) 1fr;\n        gap: 8px;\n        align-items: center;\n        margin: 3px 0;\n      }\n      .overlay {\n        position: fixed;\n        inset: 0;\n        background: rgba(0, 0, 0, 0.35);\n        display: none;\n        align-items: center;\n        justify-content: center;\n        z-index: 10;\n      }\n      .overlay.show {\n        display: flex;\n      }\n      .dialog {\n        background: var(--ms-bg);\n        border: 1px solid var(--ms-line);\n        border-radius: 6px;\n        padding: 14px;\n        max-width: 640px;\n        width: calc(100% - 40px);\n        max-height: calc(100% - 40px);\n        overflow: auto;\n        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);\n      }\n      .dialog h3 {\n        margin: 0 0 8px;\n      }\n      #bookGrid {\n        display: grid;\n        grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));\n        gap: 2px 8px;\n        margin: 8px 0;\n        font-family: var(--ms-mono);\n      }\n      .hidden {\n        display: none !important;\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"row\">\n      <strong id=\"project\"></strong>\n      <span class=\"grow\"></span>\n      <button id=\"booksBtn\" type=\"button\"></button>\n      <button id=\"optionsBtn\" type=\"button\"></button>\n      <button id=\"rescanBtn\" type=\"button\"></button>\n    </div>\n    <div id=\"intro\"></div>\n\n    <div id=\"optionsPanel\" class=\"panel hidden\">\n      <label class=\"field\"><span id=\"lExclude\"></span><input type=\"text\" id=\"oExclude\" /></label>\n      <label class=\"field\"><span id=\"lNoClose\"></span><input type=\"text\" id=\"oNoClose\" /></label>\n      <label class=\"field\"><span id=\"lNoCloseInNote\"></span><input type=\"text\" id=\"oNoCloseInNote\" /></label>\n      <label class=\"field\"><span id=\"lExtra\"></span><input type=\"text\" id=\"oExtra\" /></label>\n      <label class=\"field\"><span id=\"lNoSpaceBefore\"></span><input type=\"text\" id=\"oNoSpaceBefore\" /></label>\n      <div class=\"row\">\n        <label><input type=\"checkbox\" id=\"oFootnote\" /> <span id=\"lFootnote\"></span></label>\n        <label><input type=\"checkbox\" id=\"oXref\" /> <span id=\"lXref\"></span></label>\n      </div>\n      <div class=\"hint\" id=\"optionsHint\"></div>\n      <div class=\"row\" style=\"margin-top: 6px\">\n        <button id=\"saveOptionsBtn\" type=\"button\" class=\"primary\"></button>\n        <button id=\"defaultsBtn\" type=\"button\"></button>\n      </div>\n    </div>\n\n    <div class=\"row\">\n      <label><span id=\"lKind\"></span> <select id=\"kindFilter\"></select></label>\n      <label><span id=\"lMarker\"></span> <select id=\"markerFilter\"></select></label>\n      <label><input type=\"checkbox\" id=\"showByHand\" /> <span id=\"lShowByHand\"></span></label>\n    </div>\n    <div id=\"status\"></div>\n    <div id=\"tableWrap\">\n      <table>\n        <thead>\n          <tr>\n            <th style=\"width: 3em\" id=\"hFix\"></th>\n            <th id=\"hRef\"></th>\n            <th id=\"hProblem\"></th>\n            <th id=\"hNow\"></th>\n            <th id=\"hAfter\"></th>\n          </tr>\n        </thead>\n        <tbody id=\"rows\"></tbody>\n      </table>\n    </div>\n    <div class=\"row\">\n      <button id=\"tickBtn\" type=\"button\"></button>\n      <button id=\"untickBtn\" type=\"button\"></button>\n      <span class=\"grow hint\" id=\"goToHint\"></span>\n      <button id=\"fixBtn\" type=\"button\" class=\"primary\"></button>\n    </div>\n    <div id=\"results\"></div>\n\n    <div class=\"overlay\" id=\"confirmOverlay\">\n      <div class=\"dialog\">\n        <h3 id=\"confirmTitle\"></h3>\n        <div id=\"confirmText\" style=\"white-space: pre-wrap\"></div>\n        <div class=\"row\" style=\"margin-top: 12px; justify-content: flex-end\">\n          <button id=\"confirmYes\" type=\"button\" class=\"primary\"></button>\n          <button id=\"confirmNo\" type=\"button\"></button>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"overlay\" id=\"booksOverlay\">\n      <div class=\"dialog\">\n        <h3 id=\"booksTitle\"></h3>\n        <div class=\"hint\" id=\"booksIntro\"></div>\n        <div class=\"row\" style=\"margin-top: 6px\" id=\"bookQuick\"></div>\n        <div id=\"bookGrid\"></div>\n        <div class=\"hint\" id=\"booksError\"></div>\n        <div class=\"row\" style=\"justify-content: flex-end\">\n          <button id=\"booksOk\" type=\"button\" class=\"primary\"></button>\n          <button id=\"booksCancel\" type=\"button\"></button>\n        </div>\n      </div>\n    </div>\n\n    <script>\n      const BOOT = __MS_BOOT__;\n      const papi = require('@papi/frontend');\n      const { logger } = require('@papi/frontend');\n\n      const DOT = '\u00b7';\n      const MAX_ROWS = 3000;\n\n      const T = {\n        en: {\n          intro:\n            'These are the spacing problems found around markers. Tick the ones to fix, then click Fix. The \"After fix\" column shows the change; a dot (' +\n            DOT +\n            ') marks a space that is removed or added. Double-click a row to go to the verse.',\n          project: 'Project: {0}',\n          scanning: 'Scanning...',\n          fixing: 'Fixing...',\n          optionsShow: 'Options...',\n          optionsHide: 'Hide options',\n          optExclude: 'Marker codes to exclude',\n          optNoClose: 'Markers that do not require a closing marker',\n          optNoCloseInNote: 'Markers that do not require a closing marker only inside a footnote/cross-reference',\n          optExtra: 'Extra markers to check for spacing',\n          optNoSpaceBefore: 'Markers that should have NO space before them',\n          optFootnote: 'Footnote precedes text',\n          optXref: 'Cross-references occur before word',\n          optionsHint:\n            'Marker codes are separated by spaces, without backslashes (for example: w rq). The options are saved for this project.',\n          saveRescan: 'Save options and scan again',\n          defaults: 'Restore defaults',\n          kind: 'Problem:',\n          marker: 'Marker:',\n          all: '(all)',\n          showByHand: 'Also show problems that must be fixed by hand (unclosed or unexpected closing markers)',\n          counts: '{0} problem(s) shown, {1} can be fixed, {2} ticked in all.',\n          tooMany: 'Only the first {0} are listed; use the filters to see the others.',\n          noProblems: 'No marker spacing problems were found.',\n          colFix: 'Fix',\n          colRef: 'Reference',\n          colProblem: 'Problem',\n          colNow: 'Now',\n          colAfter: 'After fix',\n          byHand: '(fix by hand)',\n          goToHint: 'Double-click a row to go to the verse.',\n          tickShown: 'Tick all shown',\n          untickShown: 'Untick all shown',\n          fix: 'Fix ticked problems ({0})',\n          rescan: 'Scan again',\n          nothingTicked: 'Tick at least one problem to fix.',\n          confirmTitle: 'Fix marker spaces',\n          confirm:\n            'Fix {0} problem(s) in {1} book(s)?\\n\\nA copy of each book is kept before it is changed (in the extension\\'s own storage).',\n          yes: 'Fix',\n          cancel: 'Cancel',\n          ok: 'OK',\n          resFixed: '{0}: {1} problem(s) fixed',\n          resTotal: 'Fixed: {0} problem(s) in {1} book(s).',\n          resNothing: 'Nothing was changed.',\n          resNoPermission: 'Not changed, because you do not have permission to edit this project.',\n          resChanged: 'Not changed, because the text changed after the scan (scan again, then try again): {0}',\n          resFailed: 'Could not change: {0}',\n          resBackups: '{0} backup(s) kept.',\n          noPermissionProject: 'You do not have permission to edit this project, so these problems cannot be fixed here.',\n          readFailed: 'Could not read: {0}',\n          error: 'Marker Spaces could not finish: {0}',\n          booksButton: 'Books: {0} of {1}...',\n          booksTitle: 'Books to examine',\n          booksIntro: 'Tick the books to examine. Unticked books are not read at all. The choice is saved for this project.',\n          booksAll: 'All',\n          booksNone: 'None',\n          booksBible: 'Bible books',\n          booksOT: 'Old Testament',\n          booksNT: 'New Testament',\n          booksDC: 'Deuterocanon',\n          booksOther: 'Other books',\n          booksNoneChosen: 'Tick at least one book.',\n          kinds: [\n            'Missing space before an opening marker',\n            'Space before \\\\f or \\\\x',\n            'Space before a closing marker',\n            'Missing space after a closing marker',\n            'Space before punctuation after a closing marker',\n            'Space after a closing marker (note precedes text)',\n            'Missing space before \\\\v, \\\\ft, \\\\fr, ...',\n            'Space before | in \\\\w',\n            'Unclosed marker',\n            'Unexpected closing marker',\n          ],\n          messages: [\n            'Missing space before \\\\{0}',\n            'Unwanted space before \\\\{0}',\n            'Unwanted space before \\\\{0}',\n            'Missing space after \\\\{0}',\n            'Unwanted space before punctuation after \\\\{0}',\n            'Unwanted space after \\\\{0} (precedes text)',\n            'Missing space before \\\\{0}',\n            'Unwanted space before | in \\\\w...\\\\w* (produces a double space)',\n            'Unclosed \\\\{0} (no matching \\\\{0}* found)',\n            'Unexpected \\\\{0} (\\\\{1} is not normally closed)',\n          ],\n        },\n        es: {\n          intro:\n            'Estos son los problemas de espaciado encontrados alrededor de los marcadores. Marque los que desea corregir y haga clic en Corregir. La columna \"Despu\u00e9s\" muestra el cambio; un punto (' +\n            DOT +\n            ') indica un espacio que se quita o se agrega. Haga doble clic en una fila para ir al vers\u00edculo.',\n          project: 'Proyecto: {0}',\n          scanning: 'Revisando...',\n          fixing: 'Corrigiendo...',\n          optionsShow: 'Opciones...',\n          optionsHide: 'Ocultar opciones',\n          optExclude: 'C\u00f3digos de marcador a excluir',\n          optNoClose: 'Marcadores que no requieren un marcador de cierre',\n          optNoCloseInNote:\n            'Marcadores que no requieren un marcador de cierre solo dentro de una nota al pie/referencia cruzada',\n          optExtra: 'Marcadores adicionales para verificar el espaciado',\n          optNoSpaceBefore: 'Marcadores que NO deben tener espacio antes',\n          optFootnote: 'La nota precede al texto',\n          optXref: 'Las referencias cruzadas ocurren antes de la palabra',\n          optionsHint:\n            'Los c\u00f3digos de marcador se separan con espacios, sin barra invertida (por ejemplo: w rq). Las opciones se guardan para este proyecto.',\n          saveRescan: 'Guardar opciones y revisar de nuevo',\n          defaults: 'Restaurar valores predeterminados',\n          kind: 'Problema:',\n          marker: 'Marcador:',\n          all: '(todos)',\n          showByHand:\n            'Mostrar tambi\u00e9n los problemas que hay que corregir a mano (marcadores sin cerrar o cierres inesperados)',\n          counts: '{0} problema(s) mostrado(s), {1} se pueden corregir, {2} marcado(s) en total.',\n          tooMany: 'Solo se muestran los primeros {0}; use los filtros para ver los dem\u00e1s.',\n          noProblems: 'No se encontraron problemas de espaciado en los marcadores.',\n          colFix: 'Corregir',\n          colRef: 'Referencia',\n          colProblem: 'Problema',\n          colNow: 'Ahora',\n          colAfter: 'Despu\u00e9s',\n          byHand: '(corregir a mano)',\n          goToHint: 'Haga doble clic en una fila para ir al vers\u00edculo.',\n          tickShown: 'Marcar todos los mostrados',\n          untickShown: 'Desmarcar todos los mostrados',\n          fix: 'Corregir los problemas marcados ({0})',\n          rescan: 'Revisar de nuevo',\n          nothingTicked: 'Marque al menos un problema para corregir.',\n          confirmTitle: 'Corregir espacios de marcadores',\n          confirm:\n            '\u00bfCorregir {0} problema(s) en {1} libro(s)?\\n\\nAntes de cambiar cada libro se guarda una copia (en el almacenamiento propio de la extensi\u00f3n).',\n          yes: 'Corregir',\n          cancel: 'Cancelar',\n          ok: 'Aceptar',\n          resFixed: '{0}: {1} problema(s) corregido(s)',\n          resTotal: 'Corregido: {0} problema(s) en {1} libro(s).',\n          resNothing: 'No se cambi\u00f3 nada.',\n          resNoPermission: 'No se cambiaron, porque usted no tiene permiso para editar este proyecto.',\n          resChanged:\n            'No se cambiaron, porque el texto cambi\u00f3 despu\u00e9s de la revisi\u00f3n (revise de nuevo y vuelva a intentarlo): {0}',\n          resFailed: 'No se pudo cambiar: {0}',\n          resBackups: 'Se guardaron {0} copia(s) de seguridad.',\n          noPermissionProject:\n            'Usted no tiene permiso para editar este proyecto, as\u00ed que estos problemas no se pueden corregir aqu\u00ed.',\n          readFailed: 'No se pudo leer: {0}',\n          error: 'Espacios de marcadores no pudo terminar: {0}',\n          booksButton: 'Libros: {0} de {1}...',\n          booksTitle: 'Libros a revisar',\n          booksIntro:\n            'Marque los libros que desea revisar. Los libros sin marcar no se leen. La selecci\u00f3n se guarda para este proyecto.',\n          booksAll: 'Todos',\n          booksNone: 'Ninguno',\n          booksBible: 'Libros de la Biblia',\n          booksOT: 'Antiguo Testamento',\n          booksNT: 'Nuevo Testamento',\n          booksDC: 'Deuterocan\u00f3nicos',\n          booksOther: 'Otros libros',\n          booksNoneChosen: 'Marque al menos un libro.',\n          kinds: [\n            'Falta espacio antes de un marcador de apertura',\n            'Espacio antes de \\\\f o \\\\x',\n            'Espacio antes de un marcador de cierre',\n            'Falta espacio despu\u00e9s de un marcador de cierre',\n            'Espacio antes de puntuaci\u00f3n despu\u00e9s de un marcador de cierre',\n            'Espacio despu\u00e9s de un marcador de cierre (la nota precede al texto)',\n            'Falta espacio antes de \\\\v, \\\\ft, \\\\fr, ...',\n            'Espacio antes de | en \\\\w',\n            'Marcador sin cerrar',\n            'Marcador de cierre inesperado',\n          ],\n          messages: [\n            'Falta espacio antes de \\\\{0}',\n            'Espacio no deseado antes de \\\\{0}',\n            'Espacio no deseado antes de \\\\{0}',\n            'Falta espacio despu\u00e9s de \\\\{0}',\n            'Espacio no deseado antes de la puntuaci\u00f3n despu\u00e9s de \\\\{0}',\n            'Espacio no deseado despu\u00e9s de \\\\{0} (precede al texto)',\n            'Falta espacio antes de \\\\{0}',\n            'Espacio no deseado antes de | en \\\\w...\\\\w* (produce un espacio doble)',\n            '\\\\{0} sin cerrar (no se encontr\u00f3 \\\\{0}*)',\n            '\\\\{0} inesperado (\\\\{1} normalmente no se cierra)',\n          ],\n        },\n        fr: {\n          intro:\n            'Voici les probl\u00e8mes d\u2019espacement trouv\u00e9s autour des marqueurs. Cochez ceux \u00e0 corriger, puis cliquez sur Corriger. La colonne \u00ab Apr\u00e8s correction \u00bb montre le changement ; un point (' +\n            DOT +\n            ') indique une espace supprim\u00e9e ou ajout\u00e9e. Double-cliquez sur une ligne pour aller au verset.',\n          project: 'Projet : {0}',\n          scanning: 'Analyse...',\n          fixing: 'Correction...',\n          optionsShow: 'Options...',\n          optionsHide: 'Masquer les options',\n          optExclude: 'Codes de marqueurs \u00e0 exclure',\n          optNoClose: 'Marqueurs qui n\u2019exigent pas de marqueur de fermeture',\n          optNoCloseInNote:\n            'Marqueurs qui n\u2019exigent pas de marqueur de fermeture seulement dans une note de bas de page/r\u00e9f\u00e9rence crois\u00e9e',\n          optExtra: 'Autres marqueurs dont l\u2019espacement est \u00e0 v\u00e9rifier',\n          optNoSpaceBefore: 'Marqueurs qui ne doivent PAS \u00eatre pr\u00e9c\u00e9d\u00e9s d\u2019une espace',\n          optFootnote: 'La note pr\u00e9c\u00e8de le texte',\n          optXref: 'Les r\u00e9f\u00e9rences crois\u00e9es se trouvent avant le mot',\n          optionsHint:\n            'Les codes de marqueurs sont s\u00e9par\u00e9s par des espaces, sans barre oblique inverse (par exemple : w rq). Les options sont enregistr\u00e9es pour ce projet.',\n          saveRescan: 'Enregistrer les options et analyser de nouveau',\n          defaults: 'R\u00e9tablir les valeurs par d\u00e9faut',\n          kind: 'Probl\u00e8me :',\n          marker: 'Marqueur :',\n          all: '(tous)',\n          showByHand:\n            'Afficher aussi les probl\u00e8mes \u00e0 corriger \u00e0 la main (marqueurs non ferm\u00e9s ou fermetures inattendues)',\n          counts: '{0} probl\u00e8me(s) affich\u00e9(s), {1} corrigeable(s), {2} coch\u00e9(s) au total.',\n          tooMany: 'Seuls les {0} premiers sont list\u00e9s ; utilisez les filtres pour voir les autres.',\n          noProblems: 'Aucun probl\u00e8me d\u2019espacement autour des marqueurs n\u2019a \u00e9t\u00e9 trouv\u00e9.',\n          colFix: 'Corriger',\n          colRef: 'R\u00e9f\u00e9rence',\n          colProblem: 'Probl\u00e8me',\n          colNow: 'Actuel',\n          colAfter: 'Apr\u00e8s correction',\n          byHand: '(\u00e0 corriger \u00e0 la main)',\n          goToHint: 'Double-cliquez sur une ligne pour aller au verset.',\n          tickShown: 'Cocher toutes les lignes affich\u00e9es',\n          untickShown: 'D\u00e9cocher toutes les lignes affich\u00e9es',\n          fix: 'Corriger les probl\u00e8mes coch\u00e9s ({0})',\n          rescan: 'Analyser de nouveau',\n          nothingTicked: 'Cochez au moins un probl\u00e8me \u00e0 corriger.',\n          confirmTitle: 'Corriger les espaces autour des marqueurs',\n          confirm:\n            'Corriger {0} probl\u00e8me(s) dans {1} livre(s) ?\\n\\nUne copie de chaque livre est conserv\u00e9e avant sa modification (dans le stockage propre de l\u2019extension).',\n          yes: 'Corriger',\n          cancel: 'Annuler',\n          ok: 'OK',\n          resFixed: '{0} : {1} probl\u00e8me(s) corrig\u00e9(s)',\n          resTotal: 'Corrig\u00e9 : {0} probl\u00e8me(s) dans {1} livre(s).',\n          resNothing: 'Rien n\u2019a \u00e9t\u00e9 chang\u00e9.',\n          resNoPermission: 'Non chang\u00e9, car vous n\u2019avez pas l\u2019autorisation de modifier ce projet.',\n          resChanged:\n            'Non chang\u00e9, car le texte a chang\u00e9 apr\u00e8s l\u2019analyse (analysez de nouveau, puis r\u00e9essayez) : {0}',\n          resFailed: 'Impossible de changer : {0}',\n          resBackups: '{0} copie(s) de sauvegarde conserv\u00e9e(s).',\n          noPermissionProject:\n            'Vous n\u2019avez pas l\u2019autorisation de modifier ce projet, donc ces probl\u00e8mes ne peuvent pas \u00eatre corrig\u00e9s ici.',\n          readFailed: 'Impossible de lire : {0}',\n          error: 'Espaces autour des marqueurs n\u2019a pas pu terminer : {0}',\n          booksButton: 'Livres : {0} sur {1}...',\n          booksTitle: 'Livres \u00e0 analyser',\n          booksIntro:\n            'Cochez les livres \u00e0 analyser. Les livres non coch\u00e9s ne sont pas lus du tout. Le choix est enregistr\u00e9 pour ce projet.',\n          booksAll: 'Tous',\n          booksNone: 'Aucun',\n          booksBible: 'Livres de la Bible',\n          booksOT: 'Ancien Testament',\n          booksNT: 'Nouveau Testament',\n          booksDC: 'Deut\u00e9rocanoniques',\n          booksOther: 'Autres livres',\n          booksNoneChosen: 'Cochez au moins un livre.',\n          kinds: [\n            'Espace manquante avant un marqueur d\u2019ouverture',\n            'Espace avant \\\\f ou \\\\x',\n            'Espace avant un marqueur de fermeture',\n            'Espace manquante apr\u00e8s un marqueur de fermeture',\n            'Espace avant la ponctuation apr\u00e8s un marqueur de fermeture',\n            'Espace apr\u00e8s un marqueur de fermeture (la note pr\u00e9c\u00e8de le texte)',\n            'Espace manquante avant \\\\v, \\\\ft, \\\\fr, ...',\n            'Espace avant | dans \\\\w',\n            'Marqueur non ferm\u00e9',\n            'Marqueur de fermeture inattendu',\n          ],\n          messages: [\n            'Espace manquante avant \\\\{0}',\n            'Espace superflue avant \\\\{0}',\n            'Espace superflue avant \\\\{0}',\n            'Espace manquante apr\u00e8s \\\\{0}',\n            'Espace superflue avant la ponctuation apr\u00e8s \\\\{0}',\n            'Espace superflue apr\u00e8s \\\\{0} (pr\u00e9c\u00e8de le texte)',\n            'Espace manquante avant \\\\{0}',\n            'Espace superflue avant | dans \\\\w...\\\\w* (produit une double espace)',\n            '\\\\{0} non ferm\u00e9 (aucun \\\\{0}* correspondant)',\n            '\\\\{0} inattendu (\\\\{1} n\u2019est normalement pas ferm\u00e9)',\n          ],\n        },\n      };\n      const S = T[BOOT.lang] || T.en;\n      const REPORT_ONLY = [8, 9];\n      const OT_END = 39;\n      const NT_END = 66;\n\n      function fmt(s, ...args) {\n        return s.replace(/\\{(\\d+)\\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m));\n      }\n      const $ = (id) => document.getElementById(id);\n\n      let state = null; // last scan result\n      const ticked = new Set();\n      let optionsOpen = false;\n      let busy = false;\n\n      function setText() {\n        $('intro').textContent = S.intro;\n        $('lExclude').textContent = S.optExclude;\n        $('lNoClose').textContent = S.optNoClose;\n        $('lNoCloseInNote').textContent = S.optNoCloseInNote;\n        $('lExtra').textContent = S.optExtra;\n        $('lNoSpaceBefore').textContent = S.optNoSpaceBefore;\n        $('lFootnote').textContent = S.optFootnote;\n        $('lXref').textContent = S.optXref;\n        $('optionsHint').textContent = S.optionsHint;\n        $('saveOptionsBtn').textContent = S.saveRescan;\n        $('defaultsBtn').textContent = S.defaults;\n        $('lKind').textContent = S.kind;\n        $('lMarker').textContent = S.marker;\n        $('lShowByHand').textContent = S.showByHand;\n        $('hFix').textContent = S.colFix;\n        $('hRef').textContent = S.colRef;\n        $('hProblem').textContent = S.colProblem;\n        $('hNow').textContent = S.colNow;\n        $('hAfter').textContent = S.colAfter;\n        $('tickBtn').textContent = S.tickShown;\n        $('untickBtn').textContent = S.untickShown;\n        $('goToHint').textContent = S.goToHint;\n        $('rescanBtn').textContent = S.rescan;\n        $('optionsBtn').textContent = S.optionsShow;\n        $('confirmTitle').textContent = S.confirmTitle;\n        $('confirmYes').textContent = S.yes;\n        $('confirmNo').textContent = S.cancel;\n        $('booksTitle').textContent = S.booksTitle;\n        $('booksIntro').textContent = S.booksIntro;\n        $('booksOk').textContent = S.ok;\n        $('booksCancel').textContent = S.cancel;\n        $('project').textContent = fmt(S.project, BOOT.projectId);\n        updateFixButton();\n      }\n\n      function setBusy(on, text) {\n        busy = on;\n        $('status').className = on ? 'busy' : '';\n        if (text !== undefined) $('status').textContent = text;\n        ['rescanBtn', 'booksBtn', 'saveOptionsBtn', 'defaultsBtn', 'tickBtn', 'untickBtn'].forEach((id) => {\n          $(id).disabled = on;\n        });\n        updateFixButton();\n      }\n\n      function canFixRow(r) {\n        return r.canFix && state && state.canEdit;\n      }\n\n      function shownRows() {\n        if (!state) return [];\n        const kind = $('kindFilter').value;\n        const marker = $('markerFilter').value;\n        const byHand = $('showByHand').checked;\n        return state.rows.filter(\n          (r) =>\n            (byHand || REPORT_ONLY.indexOf(r.kind) < 0) &&\n            (kind === '' || String(r.kind) === kind) &&\n            (marker === '' || r.marker === marker),\n        );\n      }\n\n      function fillFilters() {\n        const kindSel = $('kindFilter');\n        const markerSel = $('markerFilter');\n        const keepKind = kindSel.value;\n        const keepMarker = markerSel.value;\n        const byHand = $('showByHand').checked;\n        const kinds = new Map();\n        const markers = new Map();\n        state.rows.forEach((r) => {\n          if (!byHand && REPORT_ONLY.indexOf(r.kind) >= 0) return;\n          kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1);\n          markers.set(r.marker, (markers.get(r.marker) || 0) + 1);\n        });\n        kindSel.innerHTML = '';\n        markerSel.innerHTML = '';\n        kindSel.add(new Option(S.all, ''));\n        markerSel.add(new Option(S.all, ''));\n        Array.from(kinds.keys())\n          .sort((a, b) => a - b)\n          .forEach((k) => kindSel.add(new Option(`${S.kinds[k]} (${kinds.get(k)})`, String(k))));\n        Array.from(markers.keys())\n          .sort()\n          .forEach((m) => markerSel.add(new Option(`\\\\${m} (${markers.get(m)})`, m)));\n        kindSel.value = Array.from(kindSel.options).some((o) => o.value === keepKind) ? keepKind : '';\n        markerSel.value = Array.from(markerSel.options).some((o) => o.value === keepMarker) ? keepMarker : '';\n      }\n\n      function message(r) {\n        return fmt(S.messages[r.kind], r.shown, r.marker);\n      }\n\n      function renderRows() {\n        const body = $('rows');\n        body.innerHTML = '';\n        if (!state) return;\n        const rows = shownRows();\n        const frag = document.createDocumentFragment();\n        rows.slice(0, MAX_ROWS).forEach((r) => {\n          const tr = document.createElement('tr');\n          tr.dataset.id = r.id;\n          const tdBox = document.createElement('td');\n          if (canFixRow(r)) {\n            const box = document.createElement('input');\n            box.type = 'checkbox';\n            box.checked = ticked.has(r.id);\n            box.addEventListener('change', () => {\n              if (box.checked) ticked.add(r.id);\n              else ticked.delete(r.id);\n              updateCounts();\n            });\n            tdBox.appendChild(box);\n          }\n          tr.appendChild(tdBox);\n          const cells = [\n            [`${r.book} ${r.chapter}:${r.verse}`, 'ref'],\n            [message(r), ''],\n            [r.now, 'text'],\n            [r.canFix ? r.after : S.byHand, r.canFix ? 'text' : 'byhand'],\n          ];\n          cells.forEach(([text, cls]) => {\n            const td = document.createElement('td');\n            if (cls) td.className = cls;\n            td.textContent = text;\n            tr.appendChild(td);\n          });\n          tr.addEventListener('dblclick', () => {\n            papi.commands\n              .sendCommand('markerSpaces.goTo', BOOT.projectId, r.book, r.chapter, r.verse)\n              .catch((e) => logger.warn(`Marker Spaces go to failed: ${e}`));\n          });\n          frag.appendChild(tr);\n        });\n        body.appendChild(frag);\n        updateCounts();\n      }\n\n      function updateCounts() {\n        if (!state) return;\n        const rows = shownRows();\n        let text;\n        if (state.rows.length === 0) text = S.noProblems;\n        else {\n          text = fmt(S.counts, rows.length, rows.filter(canFixRow).length, ticked.size);\n          if (rows.length > MAX_ROWS) text += ' ' + fmt(S.tooMany, MAX_ROWS);\n          if (!state.canEdit) text += ' ' + S.noPermissionProject;\n        }\n        if (state.failed && state.failed.length) text += ' ' + fmt(S.readFailed, state.failed.join('; '));\n        $('status').textContent = text;\n        updateFixButton();\n      }\n\n      function updateFixButton() {\n        $('fixBtn').textContent = fmt(S.fix, ticked.size);\n        $('fixBtn').disabled = busy || ticked.size === 0;\n      }\n\n      function fillOptions(o) {\n        $('oExclude').value = o.excludeMarkers || '';\n        $('oNoClose').value = o.noCloseMarkers || '';\n        $('oNoCloseInNote').value = o.noCloseInNoteMarkers || '';\n        $('oExtra').value = o.extraSpacingMarkers || '';\n        $('oNoSpaceBefore').value = o.noSpaceBeforeMarkers || '';\n        $('oFootnote').checked = !!o.footnotePrecedesText;\n        $('oXref').checked = !!o.crossReferencesPrecedeText;\n      }\n\n      function readOptions() {\n        return Object.assign({}, state.options, {\n          excludeMarkers: $('oExclude').value.trim(),\n          noCloseMarkers: $('oNoClose').value.trim(),\n          noCloseInNoteMarkers: $('oNoCloseInNote').value.trim(),\n          extraSpacingMarkers: $('oExtra').value.trim(),\n          noSpaceBeforeMarkers: $('oNoSpaceBefore').value.trim(),\n          footnotePrecedesText: $('oFootnote').checked,\n          crossReferencesPrecedeText: $('oXref').checked,\n        });\n      }\n\n      async function scan() {\n        setBusy(true, S.scanning);\n        $('rows').innerHTML = '';\n        try {\n          state = await papi.commands.sendCommand('markerSpaces.scan', BOOT.projectId);\n          ticked.clear();\n          $('project').textContent = fmt(S.project, state.projectName);\n          const chosen = state.books.filter((b) => b.chosen).length;\n          $('booksBtn').textContent = fmt(S.booksButton, chosen, state.books.length);\n          fillOptions(state.options);\n          fillFilters();\n          setBusy(false);\n          renderRows();\n        } catch (e) {\n          setBusy(false, fmt(S.error, e && e.message ? e.message : e));\n        }\n      }\n\n      async function saveOptions(options) {\n        setBusy(true, S.scanning);\n        try {\n          await papi.commands.sendCommand('markerSpaces.saveOptions', BOOT.projectId, options);\n        } catch (e) {\n          setBusy(false, fmt(S.error, e && e.message ? e.message : e));\n          return;\n        }\n        await scan();\n      }\n\n      // ---------------------------------------------------------------- fixing\n\n      function askFix() {\n        if (ticked.size === 0) {\n          $('results').textContent = S.nothingTicked;\n          return;\n        }\n        const books = new Set(state.rows.filter((r) => ticked.has(r.id)).map((r) => r.book));\n        $('confirmText').textContent = fmt(S.confirm, ticked.size, books.size);\n        $('confirmOverlay').classList.add('show');\n        $('confirmYes').focus();\n      }\n\n      async function doFix() {\n        $('confirmOverlay').classList.remove('show');\n        setBusy(true, S.fixing);\n        let report;\n        try {\n          report = await papi.commands.sendCommand('markerSpaces.fix', BOOT.projectId, Array.from(ticked));\n        } catch (e) {\n          setBusy(false);\n          $('results').className = '';\n          $('results').textContent = fmt(S.error, e && e.message ? e.message : e);\n          return;\n        }\n        const lines = [];\n        if (report.noPermission) lines.push(S.resNoPermission);\n        report.fixed.forEach((f) => lines.push(fmt(S.resFixed, f.book, f.count)));\n        if (report.total > 0) lines.push(fmt(S.resTotal, report.total, report.booksChanged));\n        else if (!report.noPermission) lines.push(S.resNothing);\n        if (report.changed.length) lines.push(fmt(S.resChanged, report.changed.join(', ')));\n        if (report.failed.length) lines.push(fmt(S.resFailed, report.failed.join('; ')));\n        if (report.backups.length) lines.push(fmt(S.resBackups, report.backups.length));\n        $('results').className = report.total > 0 && !report.failed.length ? 'ok' : '';\n        $('results').textContent = lines.join('\\n');\n        await scan();\n      }\n\n      // ---------------------------------------------------------------- books\n\n      let bookChoice = null;\n      function openBooks() {\n        bookChoice = new Map(state.books.map((b) => [b.code, b.chosen]));\n        const quick = $('bookQuick');\n        quick.innerHTML = '';\n        const groups = [\n          [S.booksAll, () => true],\n          [S.booksNone, () => false],\n          [S.booksBible, (b) => !isOther(b.code)],\n          [S.booksOT, (b) => b.num <= OT_END],\n          [S.booksNT, (b) => b.num > OT_END && b.num <= NT_END],\n          [S.booksDC, (b) => b.num > NT_END && !isOther(b.code)],\n          [S.booksOther, (b) => isOther(b.code)],\n        ];\n        groups.forEach(([label, test]) => {\n          const btn = document.createElement('button');\n          btn.type = 'button';\n          btn.textContent = label;\n          btn.addEventListener('click', () => {\n            state.books.forEach((b) => bookChoice.set(b.code, test(b)));\n            drawBooks();\n          });\n          quick.appendChild(btn);\n        });\n        drawBooks();\n        $('booksError').textContent = '';\n        $('booksOverlay').classList.add('show');\n      }\n\n      const OTHER = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');\n      function isOther(code) {\n        return OTHER.indexOf(code) >= 0;\n      }\n\n      function drawBooks() {\n        const grid = $('bookGrid');\n        grid.innerHTML = '';\n        state.books.forEach((b) => {\n          const label = document.createElement('label');\n          const box = document.createElement('input');\n          box.type = 'checkbox';\n          box.checked = !!bookChoice.get(b.code);\n          box.addEventListener('change', () => bookChoice.set(b.code, box.checked));\n          label.appendChild(box);\n          label.appendChild(document.createTextNode(' ' + b.code));\n          grid.appendChild(label);\n        });\n      }\n\n      async function booksOk() {\n        const chosen = state.books.filter((b) => bookChoice.get(b.code));\n        if (chosen.length === 0) {\n          $('booksError').textContent = S.booksNoneChosen;\n          return;\n        }\n        $('booksOverlay').classList.remove('show');\n        const excluded = state.books.filter((b) => !bookChoice.get(b.code)).map((b) => b.code);\n        await saveOptions(Object.assign({}, state.options, { excludedBooks: excluded.join(' ') }));\n      }\n\n      // ---------------------------------------------------------------- events\n\n      $('rescanBtn').addEventListener('click', scan);\n      $('optionsBtn').addEventListener('click', () => {\n        optionsOpen = !optionsOpen;\n        $('optionsPanel').classList.toggle('hidden', !optionsOpen);\n        $('optionsBtn').textContent = optionsOpen ? S.optionsHide : S.optionsShow;\n      });\n      $('saveOptionsBtn').addEventListener('click', () => saveOptions(readOptions()));\n      $('defaultsBtn').addEventListener('click', () => saveOptions({ excludedBooks: null }));\n      $('kindFilter').addEventListener('change', renderRows);\n      $('markerFilter').addEventListener('change', renderRows);\n      $('showByHand').addEventListener('change', () => {\n        fillFilters();\n        renderRows();\n      });\n      $('tickBtn').addEventListener('click', () => {\n        shownRows()\n          .slice(0, MAX_ROWS)\n          .filter(canFixRow)\n          .forEach((r) => ticked.add(r.id));\n        renderRows();\n      });\n      $('untickBtn').addEventListener('click', () => {\n        shownRows().forEach((r) => ticked.delete(r.id));\n        renderRows();\n      });\n      $('fixBtn').addEventListener('click', askFix);\n      $('confirmYes').addEventListener('click', doFix);\n      $('confirmNo').addEventListener('click', () => $('confirmOverlay').classList.remove('show'));\n      $('booksBtn').addEventListener('click', openBooks);\n      $('booksOk').addEventListener('click', booksOk);\n      $('booksCancel').addEventListener('click', () => $('booksOverlay').classList.remove('show'));\n\n      setText();\n      $('booksBtn').textContent = fmt(S.booksButton, '-', '-');\n      scan();\n    </script>\n  </body>\n</html>\n";
const MS_USFM_STY = "# Version=3.0.11\n# ********************************************************************\n# * usfm.sty is the default stylesheet for Paratext projects         *\n# *   using USFM markup.                                             *\n# * Latest documentation and stylesheets are maintained at:          *\n# *   http://markups.paratext.org/usfm                               *\n# ********************************************************************\n\n# File Identification\n\n\\Marker id\n\\Name id - File - Identification\n\\Description File identification information (BOOKID, FILENAME, EDITOR, MODIFICATION DATE)\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular book\n\\FontSize 12\n\n\\Marker usfm\n\\Name usfm - File - USFM Version ID\n\\Description File markup version information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n\\Marker ide\n\\Name ide - File - Encoding\n\\Description File encoding information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n# Headers\n\n\\Marker h\n\\Name h - File - Header\n\\Description Running header text for a book (basic)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h1\n\\Name DEPRECATED h1 - File - Header\n\\Description Running header text\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h2\n\\Name DEPRECATED h2 - File - Left Header\n\\Description Running header text, left side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h3\n\\Name DEPRECATED h3 - File - Right Header\n\\Description Running header text, right side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker toc1\n\\Name toc1 - File - Long Table of Contents Text\n\\Description Long table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Bold\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc2\n\\Name toc2 - File - Short Table of Contents Text\n\\Description Short table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc3\n\\Name toc3 - File - Book Abbreviation\n\\Description Book Abbreviation\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Italic\n\\Color 128\n#!\\ColorName lowcon red\n\n\\Marker toca1\n\\Name toca1 - File - Alternative Language Long Table of Contents Text\n\\Description Alternative language long table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca2\n\\Name toca2 - File - Alternative Language Short Table of Contents Text\n\\Description Alternative language short table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca3\n\\Name toca3 - File - Alternative Language Book Abbreviation\n\\Description Alternative language book Abbreviation\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n# Remarks and Comments\n\n\\Marker rem\n\\Name rem - File - Remark\n\\Description Comments and remarks\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker sts\n\\Name sts - File - Status\n\\Description Status of this file\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker restore\n\\Name restore - File - Restore Information\n\\Description Project restore information\n\\OccursUnder id\n\\Rank 99\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Introduction\n\n\\Marker imt\n\\Name imt - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt1\n\\Name imt1 - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt2\n\\Name imt2 - Introduction - Major Title Level 2\n\\Description Introduction major title, level 2\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType other\n\\StyleType Paragraph\n\\FontSize 13\n\\Italic\n\\Justification Center\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker imt3\n\\Name imt3 - Introduction - Major Title Level 3\n\\Description Introduction major title, level 3\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker imt4\n\\Name imt4 - Introduction - Major Title Level 4\n\\Description Introduction major title, level 4 (usually within parenthesis)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n \n\\Marker imte\n\\Name imte - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte1\n\\Name imte1 - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte2\n\\Name imte2 - Introduction - [Uncommon] Major Title at Introduction End Level 2\n\\Description Introduction major title at introduction end, level 2\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2 \n\n\\Marker is\n\\Name is - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is1 \n\\Name is1 - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is2\n\\Name is2 - Introduction - Section Heading Level 2\n\\Description Introduction section heading, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker iot \n\\Name iot - Introduction - Outline Title\n\\Description Introduction outline title (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker io\n\\Name io - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io1\n\\Name io1 - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io2\n\\Name io2 - Introduction - Outline Level 2\n\\Description Introduction outline text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\n\\Marker io3\n\\Name io3 - Introduction - Outline Level 3\n\\Description Introduction outline text, level 3 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\n\\Marker io4\n\\Name io4 - Introduction - Outline Level 4\n\\Description Introduction outline text, level 4 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\n\\Marker ior\n\\Endmarker ior*\n\\Name ior...ior* - Introduction - Outline References Range\n\\Description Introduction references range for outline entry; for marking references separately\n\\OccursUnder id io io1 io2 io3 io4 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ip\n\\Name ip - Introduction - Paragraph\n\\Description Introduction prose paragraph (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker im\n\\Name im - Introduction - Paragraph - no first line indent\n\\Description Introduction prose paragraph, with no first line indent (may occur after poetry)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker ipi\n\\Name ipi - Introduction - Indented Para - first line indent\n\\Description Introduction prose paragraph, indented, with first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker imi\n\\Name imi - Introduction - Indented Para - no first line indent\n\\Description Introduction prose paragraph text, indented, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker ili\n\\Name ili - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili1\n\\Name ili1 - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili2\n\\Name ili2 - Introduction - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker ipq\n\\Name ipq - Introduction - Paragraph - quote from text\n\\Description Introduction prose paragraph, quote from the body text\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\Italic\n\n\\Marker imq\n\\Name imq - Introduction - Paragraph - quote from text - no first line indent\n\\Description Introduction prose paragraph, quote from the body text, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Italic\n\n\\Marker ipr\n\\Name ipr - Introduction - Paragraph - right aligned\n\\Description Introduction prose paragraph, right aligned\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Justification Right\n\\Italic\n\n\\Marker ib\n\\Name ib - Introduction - Blank Line\n\\Description Introduction blank line\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker iq\n\\Name iq - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq1\n\\Name iq1 - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq2\n\\Name iq2 - Introduction - Poetry Level 2\n\\Description Introduction poetry text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq3\n\\Name iq3 - Introduction - Poetry Level 3\n\\Description Introduction poetry text, level 3\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iex\n\\Name iex - Introduction - Explanatory or Bridge Text\n\\Description Introduction explanatory or bridge text (e.g. explanation of missing book in Short Old Testament)\n\\OccursUnder id c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker iqt\n\\Endmarker iqt*\n\\Name iqt...iqt* - Special Text - Quoted Scripture Text in Introduction\n\\Description For quoted scripture text appearing in the introduction\n\\OccursUnder imt imt1 imt2 imt3 imt4 ib ie ili ili1 ili2 im imi imq io io1 io2 io3 io4 iot ip ipi ipq ipr iq iq1 iq2 iq3 is is1 is2 imte imte1 imte2 iex\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ie\n\\Name ie - Introduction - End Marker\n\\Description Introduction ending marker\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n# Chapters and Verses\n\n\\Marker c\n\\Name c - Chapter Number\n\\Description Chapter number (necessary for normal Paratext operation)\n\\OccursUnder id\n\\Rank 8\n\\TextType ChapterNumber\n\\TextProperties chapter\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker ca\n\\Endmarker ca*\n\\Name ca...ca* - Chapter Number - Alternate\n\\Description Second (alternate) chapter number (for coding dual versification; useful for places where different traditions of chapter breaks need to be supported in the same translation)\n\\OccursUnder c \n\\TextType Other\n\\StyleType Character\n\\Italic\n\\FontSize 16\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker cp\n\\Name cp - Chapter Number - Publishing Alternate\n\\Description Published chapter number (chapter string that should appear in the published text)\n\\OccursUnder c \n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker cl\n\\Name cl - Chapter - Publishing Label\n\\Description Chapter label used for translations that add a word such as \"Chapter\" before chapter numbers (e.g. Psalms). The subsequent text is the chapter label.\n\\OccursUnder id c ms ms1 ms2 ms3 mr\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Justification Center\n\n\\Marker cd\n\\Name cd - Chapter - Description\n\\Description Chapter Description (Publishing option D, e.g. in Russian Bibles)\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 11\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker v\n\\Name v - Verse Number\n\\Description A verse number (Necessary for normal paratext operation) (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType VerseNumber\n\\TextProperties verse\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker va\n\\Endmarker va*\n\\Name va...va* - Verse Number - Alternate\n\\Description Second (alternate) verse number (for coding dual numeration in Psalms; see also NRSV Exo 22.1-4)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker vp\n\\Endmarker vp*\n\\Name vp...vp* - Verse Number - Publishing Alternate\n\\Description Published verse marker (verse string that should appear in the published text)\n\\OccursUnder cd lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Paragraphs\n\n\\Marker p\n\\Name p - Paragraph - Normal - First Line Indent\n\\Description Paragraph text, with first line indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker m\n\\Name m - Paragraph - Margin - No First Line Indent\n\\Description Paragraph text, with no first line indent (may occur after poetry) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker po\n\\Name po - Paragraph - Letter Opening\n\\Description Letter opening\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker pr\n\\Name pr - Paragraph - Text Refrain (right aligned)\n\\Description Text refrain (paragraph text, right aligned)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\n\\Marker cls\n\\Name cls - Paragraph - Letter Closing\n\\Description Letter Closing\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker pmo\n\\Name pmo - Paragraph - Embedded Text Opening\n\\Description Embedded text opening\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pm\n\\Name pm - Paragraph - Embedded Text\n\\Description Embedded text paragraph\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po psi q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmc\n\\Name pmc - Paragraph - Embedded Text Closing\n\\Description Embedded text closing\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmr\n\\Name pmr - Paragraph - Embedded Text Refrain\n\\Description Embedded text refrain (e.g. Then all the people shall say, \"Amen!\")\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi\n\\Name pi - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if single level), with first line indent; often used for discourse (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi1\n\\Name pi1 - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if multiple levels), with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi2\n\\Name pi2 - Paragraph - Indented - Level 2 - First Line Indent\n\\Description Paragraph text, level 2 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .5\n\\RightMargin .25\n\n\\Marker pi3\n\\Name pi3 - Paragraph - Indented - Level 3 - First Line Indent\n\\Description Paragraph text, level 3 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .75\n\\RightMargin .25\n\n\\Marker pc\n\\Name pc - Paragraph - Centered (for Inscription)\n\\Description Paragraph text, centered (for Inscription)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Center\n\\FontSize 12\n\n\\Marker mi\n\\Name mi - Paragraph - Indented - No First Line Indent\n\\Description Paragraph text, indented, with no first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker nb\n\\Name nb - Paragraph - No Break with Previous Paragraph\n\\Description Paragraph text, with no break from previous paragraph text (at chapter boundary) (basic)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n# Poetry\n\n\\Marker q\n\\Name q - Poetry - Indent Level 1 - Single Level Only\n\\Description Poetry text, level 1 indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q1\n\\Name q1 - Poetry - Indent Level 1\n\\Description Poetry text, level 1 indent (if multiple levels) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q2\n\\Name q2 - Poetry - Indent Level 2\n\\Description Poetry text, level 2 indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.375  # 1/4 inch indent, 3/4 inch wrap\n\n\\Marker q3\n\\Name q3 - Poetry - Indent Level 3\n\\Description Poetry text, level 3 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.25 # 3/8 inch indent, 3/4 inch wrap\n\n\\Marker q4\n\\Name q4 - Poetry - Indent Level 4\n\\Description Poetry text, level 4 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.125 # 1/2 inch indent, 3/4 inch wrap\n\n\\Marker qc\n\\Name qc - Poetry - Centered\n\\Description Poetry text, centered\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\n\\Marker qr\n\\Name qr - Poetry - Right Aligned\n\\Description Poetry text, Right Aligned\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker qs\n\\Endmarker qs*\n\\Name qs...qs* - Poetry Text - Selah\n\\Description Poetry text, Selah\n\\OccursUnder q q1 q2 q3 q4 qc qr qd NEST\n\\Rank 4\n\\TextType VerseText\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qa\n\\Name qa - Poetry - Acrostic Heading/Marker\n\\Description Poetry text, Acrostic marker/heading\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\n\\Marker qac\n\\Endmarker qac*\n\\Name qac...qac* - Poetry Text - Acrostic Letter\n\\Description Poetry text, Acrostic markup of the first character of a line of acrostic poetry\n\\OccursUnder q q1 q2 q3 q4 qc qr  NEST\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qm\n\\Name qm - Poetry - Embedded Text - Indent Level 1 - Single Level Only\n\\Description Poetry text, embedded, level 1 indent (if single level)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm1\n\\Name qm1 - Poetry - Embedded Text - Indent Level 1\n\\Description Poetry text, embedded, level 1 indent (if multiple levels)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm2\n\\Name qm2 - Poetry - Embedded Text - Indent Level 2\n\\Description Poetry text, embedded, level 2 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\n\\Marker qm3\n\\Name qm3 - Poetry - Embedded Text - Indent Level 3\n\\Description Poetry text, embedded, level 3 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\n\\Marker qd\n\\Name qd - Poetry - Hebrew Note\n\\Description A Hebrew musical performance annotation, similar in content to Hebrew descriptive title.\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\LeftMargin .25\n\n\\Marker b\n\\Name b - Poetry - Stanza Break (Blank Line)\n\\Description Poetry text stanza break (e.g. stanza break) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n# Titles & Headings\n\n\\Marker mt\n\\Name mt - Title - Major Title Level 1\n\\Description The main title of the book (if single level)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mt1\n\\Name mt1 - Title - Major Title Level 1\n\\Description The main title of the book (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 4\n\n\\Marker mt2\n\\Name mt2 - Title - Major Title Level 2\n\\Description A secondary title usually occurring before the main title (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker mt3\n\\Name mt3 - Title - Major Title Level 3\n\\Description A secondary title occurring after the main title\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mt4\n\\Name mt4 - Title - Major Title level 4\n\\Description A small secondary title sometimes occurring within parentheses\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mte\n\\Name mte - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder c\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mte1\n\\Name mte1 - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tc1 tc2 tc3 tc4 s3 d\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n \n\\Marker mte2\n\\Name mte2 - Title - [Uncommon] Major Title Ending Level 2\n\\Description A secondary title occurring before or after the 'ending' main title\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\OccursUnder mte1\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker ms\n\\Name ms - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms1\n\\Name ms1 - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms2\n\\Name ms2 - Heading - Major Section Level 2\n\\Description A major section division heading, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms3\n\\Name ms3 - Heading - Major Section Level 3\n\\Description A major section division heading, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Italic\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker mr\n\\Name mr - Heading - Major Section Range References\n\\Description A major section division references range heading (basic)\n\\OccursUnder ms ms1 ms2 ms3\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker s\n\\Name s - Heading - Section Level 1\n\\Description A section heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s1\n\\Name s1 - Heading - Section Level 1\n\\Description A section heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s2\n\\Name s2 - Heading - Section Level 2\n\\Description A section heading, level 2 (e.g. Proverbs 22-24)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s3\n\\Name s3 - Heading - Section Level 3\n\\Description A section heading, level 3 (e.g. Genesis \"The First Day\")\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker s4\n\\Name s4 - Heading - Section Level 4\n\\Description A section heading, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker sr\n\\Name sr - Heading - Section Range References\n\\Description A section division references range heading\n\\OccursUnder s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker r\n\\Name r - Heading - Parallel References\n\\Description Parallel reference(s) (basic)\n\\OccursUnder c s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker sp\n\\Name sp - Label - Speaker\n\\Description A heading, to identify the speaker (e.g. Job)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker d\n\\Name d - Label - Descriptive Title - Hebrew Subtitle\n\\Description A Hebrew text heading, to provide description (e.g. Psalms)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker sd\n\\Name sd - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd1\n\\Name sd1 - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd2\n\\Name sd2 - Label - Semantic Division Location - Level 2\n\\Description Vertical space used to divide the text into sections, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\SpaceBefore 18\n\\SpaceAfter 18\n\n\\Marker sd3\n\\Name sd3 - Label - Semantic Division Location - Level 3\n\\Description Vertical space used to divide the text into sections, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\SpaceBefore 12\n\\SpaceAfter 12\n\n\\Marker sd4\n\\Name sd4 - Label - Semantic Division Location - Level 4\n\\Description Vertical space used to divide the text into sections, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\SpaceBefore 8\n\\SpaceAfter 8\n\n# Tables\n\n\\Marker tr\n\\Name tr - Table - Row\n\\Description A new table row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker th1 \n\\Name th1 - Table - Column 1 Heading\n\\Description A table heading, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th2\n\\Name th2 - Table - Column 2 Heading\n\\Description A table heading, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th3\n\\Name th3 - Table - Column 3 Heading\n\\Description A table heading, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th4\n\\Name th4 - Table - Column 4 Heading\n\\Description A table heading, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th5\n\\Name th5 - Table - Column 5 Heading\n\\Description A table heading, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th6\n\\Name th6 - Table - Column 6 Heading\n\\Description A table heading, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th7\n\\Name th7 - Table - Column 7 Heading\n\\Description A table heading, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th8\n\\Name th8 - Table - Column 8 Heading\n\\Description A table heading, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th9\n\\Name th9 - Table - Column 9 Heading\n\\Description A table heading, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th10\n\\Name th10 - Table - Column 10 Heading\n\\Description A table heading, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th11\n\\Name th11 - Table - Column 11 Heading\n\\Description A table heading, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th12\n\\Name th12 - Table - Column 12 Heading\n\\Description A table heading, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker tc1\n\\Name tc1 - Table - Column 1 Cell\n\\Description A table cell item, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc2\n\\Name tc2 - Table - Column 2 Cell\n\\Description A table cell item, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc3\n\\Name tc3 - Table - Column 3 Cell\n\\Description A table cell item, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc4\n\\Name tc4 - Table - Column 4 Cell\n\\Description A table cell item, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc5\n\\Name tc5 - Table - Column 5 Cell\n\\Description A table cell item, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc6\n\\Name tc6 - Table - Column 6 Cell\n\\Description A table cell item, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc7\n\\Name tc7 - Table - Column 7 Cell\n\\Description A table cell item, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc8\n\\Name tc8 - Table - Column 8 Cell\n\\Description A table cell item, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc9\n\\Name tc9 - Table - Column 9 Cell\n\\Description A table cell item, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc10\n\\Name tc10 - Table - Column 10 Cell\n\\Description A table cell item, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc11\n\\Name tc11 - Table - Column 11 Cell\n\\Description A table cell item, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc12\n\\Name tc12 - Table - Column 12 Cell\n\\Description A table cell item, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Center Aligned Table Heads and Columns\n\n\\Marker thc1 \n\\Name thc1 - Table - Column 1 Heading - Center Aligned\n\\Description A table heading, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc2\n\\Name thc2 - Table - Column 2 Heading - Center Aligned\n\\Description A table heading, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc3\n\\Name thc3 - Table - Column 3 Heading - Center Aligned\n\\Description A table heading, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc4\n\\Name thc4 - Table - Column 4 Heading - Center Aligned\n\\Description A table heading, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc5\n\\Name thc5 - Table - Column 5 Heading - Center Aligned\n\\Description A table heading, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc6\n\\Name thc6 - Table - Column 6 Heading - Center Aligned\n\\Description A table heading, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc7\n\\Name thc7 - Table - Column 7 Heading - Center Aligned\n\\Description A table heading, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc8\n\\Name thc8 - Table - Column 8 Heading - Center Aligned\n\\Description A table heading, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc9\n\\Name thc9 - Table - Column 9 Heading - Center Aligned\n\\Description A table heading, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc10\n\\Name thc10 - Table - Column 10 Heading - Center Aligned\n\\Description A table heading, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc11\n\\Name thc11 - Table - Column 11 Heading - Center Aligned\n\\Description A table heading, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc12\n\\Name thc12 - Table - Column 12 Heading - Center Aligned\n\\Description A table heading, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker tcc1\n\\Name tcc1 - Table - Column 1 Cell - Center Aligned\n\\Description A table cell item, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc2\n\\Name tcc2 - Table - Column 2 Cell - Center Aligned\n\\Description A table cell item, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc3\n\\Name tcc3 - Table - Column 3 Cell - Center Aligned\n\\Description A table cell item, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc4\n\\Name tcc4 - Table - Column 4 Cell - Center Aligned\n\\Description A table cell item, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc5\n\\Name tcc5 - Table - Column 5 Cell - Center Aligned\n\\Description A table cell item, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc6\n\\Name tcc6 - Table - Column 6 Cell - Center Aligned\n\\Description A table cell item, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc7\n\\Name tcc7 - Table - Column 7 Cell - Center Aligned\n\\Description A table cell item, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc8\n\\Name tcc8 - Table - Column 8 Cell - Center Aligned\n\\Description A table cell item, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc9\n\\Name tcc9 - Table - Column 9 Cell - Center Aligned\n\\Description A table cell item, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc10\n\\Name tcc10 - Table - Column 10 Cell - Center Aligned\n\\Description A table cell item, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc11\n\\Name tcc11 - Table - Column 11 Cell - Center Aligned\n\\Description A table cell item, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc12\n\\Name tcc12 - Table - Column 12 Cell - Center Aligned\n\\Description A table cell item, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n# Right Aligned Table Heads and Columns\n\n\\Marker thr1 \n\\Name thr1 - Table - Column 1 Heading - Right Aligned\n\\Description A table heading, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr2\n\\Name thr2 - Table - Column 2 Heading - Right Aligned\n\\Description A table heading, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr3\n\\Name thr3 - Table - Column 3 Heading - Right Aligned\n\\Description A table heading, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr4\n\\Name thr4 - Table - Column 4 Heading - Right Aligned\n\\Description A table heading, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr5\n\\Name thr5 - Table - Column 5 Heading - Right Aligned\n\\Description A table heading, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr6\n\\Name thr6 - Table - Column 6 Heading - Right Aligned\n\\Description A table heading, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr7\n\\Name thr7 - Table - Column 7 Heading - Right Aligned\n\\Description A table heading, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr8\n\\Name thr8 - Table - Column 8 Heading - Right Aligned\n\\Description A table heading, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr9\n\\Name thr9 - Table - Column 9 Heading - Right Aligned\n\\Description A table heading, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr10\n\\Name thr10 - Table - Column 10 Heading - Right Aligned\n\\Description A table heading, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr11\n\\Name thr11 - Table - Column 11 Heading - Right Aligned\n\\Description A table heading, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr12\n\\Name thr12 - Table - Column 12 Heading - Right Aligned\n\\Description A table heading, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker tcr1 \n\\Name tcr1 - Table - Column 1 Cell - Right Aligned\n\\Description A table cell item, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr2\n\\Name tcr2 - Table - Column 2 Cell - Right Aligned\n\\Description A table cell item, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr3\n\\Name tcr3 - Table - Column 3 Cell - Right Aligned\n\\Description A table cell item, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr4\n\\Name tcr4 - Table - Column 4 Cell - Right Aligned\n\\Description A table cell item, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr5\n\\Name tcr5 - Table - Column 5 Cell - Right Aligned\n\\Description A table cell item, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr6\n\\Name tcr6 - Table - Column 6 Cell - Right Aligned\n\\Description A table cell item, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr7\n\\Name tcr7 - Table - Column 7 Cell - Right Aligned\n\\Description A table cell item, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr8\n\\Name tcr8 - Table - Column 8 Cell - Right Aligned\n\\Description A table cell item, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr9\n\\Name tcr9 - Table - Column 9 Cell - Right Aligned\n\\Description A table cell item, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr10\n\\Name tcr10 - Table - Column 10 Cell - Right Aligned\n\\Description A table cell item, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr11\n\\Name tcr11 - Table - Column 11 Cell - Right Aligned\n\\Description A table cell item, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr12\n\\Name tcr12 - Table - Column 12 Cell - Right Aligned\n\\Description A table cell item, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n# Lists\n\n\\Marker lh\n\\Name lh - List Header\n\\Description List header (introductory remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker li\n\\Name li - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li1\n\\Name li1 - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li2\n\\Name li2 - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker li3\n\\Name li3 - List Entry - Level 3\n\\Description A list entry, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker li4\n\\Name li4 - List Entry - Level 4\n\\Description A list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lf\n\\Name lf - List Footer\n\\Description List footer (concluding remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker lim\n\\Name lim - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim1\n\\Name lim1 - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim2\n\\Name lim2 - Embedded List Entry - Level 2\n\\Description An embedded list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker lim3\n\\Name lim3 - Embedded List Item - Level 3\n\\Description An embedded list item, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lim4\n\\Name lim4 - Embedded List Entry - Level 4\n\\Description An embedded list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.5\n\\FirstLineIndent -.375\n\n\\Marker litl\n\\Endmarker litl*\n\\Name litl...litl* - List Entry - Total\n\\Description List entry total text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker lik\n\\Endmarker lik*\n\\Name lik...lik* - Structured List Entry - Key\n\\Description Structured list entry key text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker liv\n\\Endmarker liv*\n\\Name liv...liv* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if single value)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv1\n\\Endmarker liv1*\n\\Name liv1...liv1* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if multiple values)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv2\n\\Endmarker liv2*\n\\Name liv2...liv2* - Structured List Entry - Value 2\n\\Description Structured list entry value 2 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv3\n\\Endmarker liv3*\n\\Name liv3...liv3* - Structured List Entry - Value 3\n\\Description Structured list entry value 3 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv4\n\\Endmarker liv4*\n\\Name liv4...liv4* - Structured List Entry - Value 4\n\\Description Structured list entry value 4 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv5\n\\Endmarker liv5*\n\\Name liv5...liv5* - Structured List Entry - Value 5\n\\Description Structured list entry value 5 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Footnotes\n\n\\Marker f\n\\Endmarker f*\n\\Name f...f* - Footnote \n\\Description A Footnote text item (basic)\n\\OccursUnder c cp lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fe\n\\Endmarker fe*\n\\Name fe...fe* - Endnote\n\\Description An Endnote text item\n\\OccursUnder c lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fr\n\\Endmarker fr*\n\\Name fr - Footnote - Reference\n\\Description The origin reference for the footnote (basic)\n\\OccursUnder f fe\n\\TextType NoteText\n\\TextProperties publishable vernacular note\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker ft\n\\Endmarker ft*\n\\Name ft - Footnote - Text\n\\Description Footnote text, Protocanon (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fk\n\\Endmarker fk*\n\\Name fk - Footnote - Keyword\n\\Description A footnote keyword (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker fq\n\\Endmarker fq*\n\\Name fq - Footnote - Quotation or Alternate Rendering\n\\Description A footnote scripture quote or alternate rendering (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fqa\n\\Endmarker fqa*\n\\Name fqa - Footnote - Alternate Translation Rendering\n\\Description A footnote alternate rendering for a portion of scripture text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fl\n\\Endmarker fl*\n\\Name fl - Footnote - Label Text\n\\Description A footnote label text item, for marking or \"labelling\" the type or alternate translation being provided in the note.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker fw\n\\Endmarker fw*\n\\Name fw - Footnote - Witness List\n\\Description A footnote witness list, for distinguishing a list of sigla representing witnesses in critical editions.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fp\n\\Endmarker fp*\n\\Name fp - Footnote Paragraph Mark\n\\Description A Footnote additional paragraph marker\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fv\n\\Endmarker fv*\n\\Name fv...fv* - Footnote - Embedded Verse Number\n\\Description A verse number within the footnote text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker fdc\n\\Endmarker fdc*\n\\Name DEPRECATED fdc...fdc* - Footnote - DC text\n\\Description Footnote text, applies to Deuterocanon only\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fm\n\\Endmarker fm*\n\\Name fm - Footnote - Additional Caller to Previous Note\n\\Description An additional footnote marker location for a previous footnote \n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Cross References\n\n\\Marker x\n\\Endmarker x*\n\\Name x...x* - Cross Reference\n\\Description A list of cross references (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 s s1 s2 s3 d\n\\TextProperties publishable vernacular note crossreference\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker xo\n\\Endmarker xo*\n\\Name xo - Cross Reference - Origin Reference\n\\Description The cross reference origin reference (basic)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker xop\n\\Endmarker xop*\n\\Name xop - Cross Reference - Origin Reference Publishing Alternate\n\\Description Published cross reference origin reference (origin reference that should appear in the published text)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xt\n\\Endmarker xt*\n\\Name xt - Cross Reference - Target References\n\\Description The cross reference target reference(s), protocanon only (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x ef ex NEST\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?link-href\n\n\\Marker xta\n\\Endmarker xta*\n\\Name xta - Cross Reference - Target References Added Text\n\\Description Cross reference target references added text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xk\n\\Endmarker xk*\n\\Name xk - Cross Reference - Keyword\n\\Description A cross reference keyword\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xq\n\\Endmarker xq*\n\\Name xq - Cross Reference - Quotation\n\\Description A cross-reference quotation from the scripture text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xot\n\\Endmarker xot*\n\\Name xot...xot* - Cross Reference - OT Target Refs (optional)\n\\Description Cross-reference target reference(s), Old Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xnt\n\\Endmarker xnt*\n\\Name xnt...xnt* - Cross Reference - NT Target Refs (optional)\n\\Description Cross-reference target reference(s), New Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xdc\n\\Endmarker xdc*\n\\Name DEPRECATED xdc...xdc* - Cross Reference - DC Target Refs\n\\Description Cross-reference target reference(s), Deuterocanon only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker rq\n\\Endmarker rq*\n\\Name rq...rq* - Cross Reference - Inline Quotation References\n\\Description A cross-reference indicating the source text for the preceding quotation.\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 10\n\\Italic\n\n# Other Special Text\n\n\\Marker qt\n\\Endmarker qt*\n\\Name qt...qt* - Special Text - Quoted Text - OT in NT\n\\Description For Old Testament quoted text appearing in the New Testament (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker nd\n\\Endmarker nd*\n\\Name nd...nd* - Special Text - Name of Deity\n\\Description For name of deity (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker tl\n\\Endmarker tl*\n\\Name tl...tl* - Special Text - Transliterated Word\n\\Description For transliterated words\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable nonvernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker dc\n\\Endmarker dc*\n\\Name dc...dc* - Special Text - Deuterocanonical/LXX Additions\n\\Description Deuterocanonical/LXX additions or insertions in the Protocanonical text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\Italic\n\n\\Marker bk\n\\Endmarker bk*\n\\Name bk...bk* - Special Text - Quoted book title\n\\Description For the quoted name of a book\n\\OccursUnder imt imt1 imt2 imt3 imt4 imte imte1 imte2 is is1 is2 ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sig\n\\Endmarker sig*\n\\Name sig...sig* - Special Text - Author's Signature (Epistles)\n\\Description For the signature of the author of an Epistle\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker pn\n\\Endmarker pn*\n\\Name pn...pn* - Special Text - Proper Name\n\\Description For a proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Underline\n\n\\Marker png\n\\Endmarker png*\n\\Name png...png* - Special Text - Geographic Proper Name\n\\Description For a geographic proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker addpn\n\\Endmarker addpn*\n\\Name DEPRECATED addpn...addpn* - Special Text for Chinese\n\\Description For chinese words to be dot underline & underline\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\\Underline\n\n\\Marker wj\n\\Endmarker wj*\n\\Name wj...wj* - Special Text - Words of Jesus\n\\Description For marking the words of Jesus\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Color 255\n#!\\ColorName highcon red\n\n\\Marker k\n\\Endmarker k*\n\\Name k...k* - Special Text - Keyword\n\\Description For a keyword\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker sls\n\\Endmarker sls*\n\\Name sls...sls* - Special Text - Secondary Language or Text Source\n\\Description To represent where the original text is in a secondary language or from an alternate text source\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ord\n\\Endmarker ord*\n\\Name ord...ord* - Special Text - Ordinal number text portion\n\\Description For the text portion of an ordinal number\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker add\n\\Endmarker add*\n\\Name add...add* - Special Text - Translational Addition\n\\Description For a translational addition to the text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\n\\Marker lit\n\\Name lit - Special Text - Liturgical note\n\\Description For a comment or note inserted for liturgical use\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\\Bold\n\n# Character Styling\n\n\\Marker no\n\\Endmarker no*\n\\Name no...no* - Character - Normal Text\n\\Description A character style, use normal text\n\\OccursUnder is ip ipi im imi ili ili1 ili2 imq ipq iex iq iot io1 io2 io3 io4 s s1 s2 s3 NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker it\n\\Endmarker it*\n\\Name it...it* - Character - Italic Text\n\\Description A character style, use italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker bd\n\\Endmarker bd*\n\\Name bd...bd* - Character - Bold Text\n\\Description A character style, use bold text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker bdit\n\\Endmarker bdit*\n\\Name bdit...bdit* - Character - BoldItalic Text\n\\Description A character style, use bold + italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker em\n\\Endmarker em*\n\\Name em...em* - Character - Emphasized Text\n\\Description A character style, use emphasized text style\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sc\n\\Endmarker sc*\n\\Name sc...sc* - Character - Small Caps\n\\Description A character style, for small capitalization text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Smallcaps\n\n\\Marker sup\n\\Endmarker sup*\n\\Name sup...sup* - Character - Superscript\n\\Description A character style, for superscript text. Typically for use in critical edition footnotes.\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Breaks\n\n\\Marker pb\n\\Name pb - Break - Page Break\n\\Description Page Break used for new reader portions and children's bibles where content is controlled by the page\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable\n\\StyleType Paragraph\n\\FontSize 12\n\n# Special Features\n\n\\Marker fig\n\\Endmarker fig*\n\\Name fig...fig* - Auxiliary - Figure/Illustration/Map\n\\Description Illustration [Columns to span, height, filename, caption text]\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes src size ref ?alt ?loc ?copy\n\n\\Marker jmp\n\\Endmarker jmp*\n\\Name jmp...jmp* - Link text\n\\Description For associating linking attributes to a span of text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType Other\n\\StyleType Character\n\\Color 16711680\n#!\\ColorName highcon blue\n\\Underline\n#!\\Attributes ?link-href ?link-id ?link-title\n\n\\Marker pro\n\\Endmarker pro*\n\\Name DEPRECATED pro...pro* - Special Text - CJK Pronunciation\n\\Description For indicating pronunciation in CJK texts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType Other\n\\TextProperties Nonpublishable\n\\StyleType Character\n\\FontSize 10\n\n\\Marker rb\n\\Endmarker rb*\n\\Name rb...rb* - Special Text - Ruby Glossing\n\\Description Most often used to provide a reading / pronunciation guide in ideographic scripts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#!\\Attributes gloss\n\n# Peripheral References\n\n\\Marker w\n\\Endmarker w*\n\\Name w...w* - Peripheral Ref - Wordlist Entry\n\\Description A wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?lemma ?strong ?srcloc\n\n\\Marker wh\n\\Endmarker wh*\n\\Name wh...wh* - Peripheral Ref - Hebrew Wordlist Entry\n\\Description A Hebrew wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wg\n\\Endmarker wg*\n\\Name wg...wg* - Peripheral Ref - Greek Wordlist Entry\n\\Description A Greek Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wa\n\\Endmarker wa*\n\\Name wa...wa* - Peripheral Ref - Aramaic Wordlist Entry\n\\Description An Aramaic Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ndx\n\\Endmarker ndx*\n\\Name ndx...ndx* - Peripheral Ref - Subject Index Entry \n\\Description A subject index text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Peripheral Materials\n# Content Division Marker\n\n\\Marker periph\n\\Name periph - Peripherals - Content Division Marker\n\\Description Peripheral content division marker which should be followed by an additional division argument/title.\n\\TextType Section\n\\TextProperties paragraph nonpublishable vernacular\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\SpaceBefore 16\n\\SpaceAfter 4\n\\Color 33023\n#!\\ColorName orange\n\n# Additional peripheral material extensions to existing USFM markup.\n\n\\Marker p1\n\\Name p1 - Periph - Front/Back Matter Paragraph Level 1\n\\Description Front or back matter text paragraph, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker p2\n\\Name p2 - Periph - Front/Back Matter Paragraph Level 2\n\\Description Front or back matter text paragraph, level 2 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/4 inch first line indent\n\\LeftMargin .125\n\n\\Marker k1\n\\Name k1 - Periph - Concordance Keyword Level 1\n\\Description Concordance main entry text or keyword, level 1\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker k2\n\\Name k2 - Periph - Concordance Keyword Level 2\n\\Description Concordance main entry text or keyword, level 2\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker xtSee\n\\Endmarker xtSee*\n\\Name xtSee - Concordance and Names Index - Alternate Entry Target Reference\n\\Description Concordance and Names Index markup for an alternate entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker xtSeeAlso\n\\Endmarker xtSeeAlso*\n\\Name xtSeeAlso - Concordance and Names Index - Additional Entry Target Reference\n\\Description Concordance and Names Index markup for an additional entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Milestones - these are not compatible with USFM2, so whole entries are preceded with #!\n\n#!\\Marker qt-s\n#!\\Endmarker qt-e\n#!\\Name Quotation start/end milestone\n#!\\Description Quotation start/end milestone, level 1 (if single level)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt1-s\n#!\\Endmarker qt1-e\n#!\\Name Quotation start/end milestone - Level 1\n#!\\Description Quotation start/end milestone, level 1 (if multiple levels)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt2-s\n#!\\Endmarker qt2-e\n#!\\Name Quotation start/end milestone - Level 2\n#!\\Description Quotation start/end milestone, level 2\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt3-s\n#!\\Endmarker qt3-e\n#!\\Name Quotation start/end milestone - Level 3\n#!\\Description Quotation start/end milestone, level 3\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt4-s\n#!\\Endmarker qt4-e\n#!\\Name Quotation start/end milestone - Level 4\n#!\\Description Quotation start/end milestone, level 4\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt5-s\n#!\\Endmarker qt5-e\n#!\\Name Quotation start/end milestone - Level 5\n#!\\Description Quotation start/end milestone, level 5\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker ts-s\n#!\\Endmarker ts-e\n#!\\Name Translator's section start/end milestone\n#!\\Description Translator's section start/end milestone\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?sid ?eid\n\n# Other special text elements specified in USFM\n#   ~ = fixed (no-break) space\n#   // = discretionary line break\n\n# Obsolete, deprecated, or no longer officially part of USFM.\n# These markers may have existed in earlier resource and stylesheet revisions.\n\n\\Marker ph\n\\Name DEPRECATED ph - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph1\n\\Name DEPRECATED ph1 - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph2\n\\Name DEPRECATED ph2 - Paragraph - Hanging Indent - Level 2\n\\Description Paragraph text, with level 2 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 1/2 inch indent, 3/4 inch wrap\n\\FontSize 12\n\n\\Marker ph3\n\\Name DEPRECATED ph3 - Paragraph - Hanging Indent - Level 3\n\\Description Paragraph text, with level 3 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\\FirstLineIndent -.25  # 3/4 inch indent, 1 inch wrap\n\\FontSize 12\n\n\\Marker phi\n\\Name DEPRECATED phi - Paragraph - Indented - Hanging Indent\n\\Description Paragraph text, indented with hanging indent\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\n\\Marker tr1\n\\Name DEPRECATED tr1 - Table - Row - Level 1\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker tr2\n\\Name DEPRECATED tr2 - Table - Row - Level 2\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker ps\n\\Name DEPRECATED ps - Paragraph - No Break with Next Paragraph\n\\Description Paragraph text, no break with next paragraph text at chapter boundary\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker psi\n\\Name DEPRECATED psi - Paragraph - Indented - No Break with Next\n\\Description Paragraph text, indented, with no break with next paragraph text (at chapter boundary)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\\FontSize 12\n\n\\Marker fs\n\\Endmarker fs*\n\\Name DEPRECATED fs - Footnote - Footnote Summary\n\\Description A summary text for the concept/idea/quotation from the scripture translation for which the note is being provided.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker wr\n\\Endmarker wr*\n\\Name DEPRECATED wr...wr* - Auxiliary - Wordlist/Glossary Reference \n\\Description A Wordlist text item\n\\OccursUnder ms s lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr qd tc1 tc2 tc3 tc4 f fe NEST\n\\TextProperties publishable vernacular\n\\TextType VerseText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n# 2.0x peripheral markup (replaced with \\periph + Content Division Title/Argument)\n\n\\Marker pub\n\\Name DEPRECATED pub Peripherals - Front Matter Publication Data\n\\Description Front matter publication data\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker toc\n\\Name DEPRECATED toc Peripherals - Front Matter Table of Contents\n\\Description Front matter table of contents\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pref\n\\Name DEPRECATED pref Peripherals - Front Matter Preface\n\\Description Front matter preface\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker intro\n\\Name DEPRECATED intro Peripherals - Front Matter Introduction\n\\Description Front matter introduction\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker conc\n\\Name DEPRECATED conc Peripherals - Back Matter Concordance\n\\Description Back matter concordance\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker glo\n\\Name DEPRECATED glo Peripherals - Back Matter Glossary\n\\Description Back matter glossary\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker idx\n\\Name DEPRECATED idx Peripherals - Back Matter Index\n\\Description Back matter index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker maps\n\\Name DEPRECATED maps Peripherals - Back Matter Map Index\n\\Description Back matter map index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker cov\n\\Name DEPRECATED cov Peripherals - Other - Cover\n\\Description Other peripheral materials - cover\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker spine\n\\Name DEPRECATED spine Peripherals - Other - Spine\n\\Description Other peripheral materials - spine\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pubinfo\n\\Name DEPRECATED pubinfo - Publication - Information\n\\Description Publication information - Lang,Credit,Version,Copies,Publisher,Id,Logo\n\\OccursUnder id ide\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Concordance/Names Index Tools - special sfms for use in Publishing Assistant\n\n\\Marker zpa-xb\n\\Endmarker zpa-xb*\n\\Name zpa-xb - Periph - Book\n\\Description Book Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-xc\n\\Endmarker zpa-xc*\n\\Name zpa-xc - Periph - Chapter\n\\Description Chapter Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker zpa-xv\n\\Endmarker zpa-xv*\n\\Name zpa-xv - Periph - Verse\n\\Description Verse Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-d\n\\Endmarker zpa-d*\n\\Name zpa-d - Periph - Description\n\\Description Description\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n";
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
