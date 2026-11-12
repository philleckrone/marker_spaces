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
