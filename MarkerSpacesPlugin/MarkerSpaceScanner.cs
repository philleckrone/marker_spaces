using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace MarkerSpaces
{
    /// <summary>The kinds of problem, as in the CMS check MarkerSpace.py (its codes in brackets).</summary>
    public enum IssueKind
    {
        MissingSpaceBeforeOpen,     // A
        SpaceBeforeOpen,            // B: \f and \x, which attach to the word before
        SpaceBeforeClose,           // C
        MissingSpaceAfterClose,     // D
        SpaceBeforePunctuation,     // E
        SpaceAfterClose,            // F: footnote or cross-reference set to precede the text
        MissingSpaceBeforeNoClose,  // markers that take no closing marker (\v, \ft, ...)
        SpaceBeforePipe,            // \w word |lemma\w*
        Unclosed,                   // report only
        UnexpectedClose,            // report only
    }

    /// <summary>Replace Length characters at Start with Insert.</summary>
    public sealed class TextEdit
    {
        public readonly int Start;
        public readonly int Length;
        public readonly string Insert;

        public TextEdit(int start, int length, string insert)
        {
            Start = start;
            Length = length;
            Insert = insert ?? "";
        }

        public int End
        {
            get { return Start + Length; }
        }
    }

    /// <summary>One problem found in one chapter, with the edits that fix it (none = report only).</summary>
    public sealed class SpaceIssue
    {
        public BookId Book;
        public int Chapter;
        /// <summary>The verse as written after \v ("3", "3-4"), or "-" before the first verse.</summary>
        public string Verse;
        public IssueKind Kind;
        /// <summary>The marker (nd, f) for opening-marker problems, the closing marker (nd*) otherwise.</summary>
        public string Shown;
        /// <summary>The marker the problem belongs to (nd for both \nd and \nd*).</summary>
        public string Marker;
        public int Start;
        public int End;
        public readonly List<TextEdit> Edits = new List<TextEdit>();
        /// <summary>The chapter text the offsets refer to.</summary>
        public string ChapterText;
        /// <summary>Ticked in the window.</summary>
        public bool Selected;

        public bool CanFix
        {
            get { return Edits.Count > 0; }
        }

        public string Reference
        {
            get { return Book.Code + " " + Chapter + ":" + Verse; }
        }

        /// <summary>The first verse number, for going to the verse (0 when there is none).</summary>
        public int VerseNumber
        {
            get
            {
                int n = 0;
                foreach (char c in Verse)
                {
                    if (c < '0' || c > '9') break;
                    n = n * 10 + (c - '0');
                }
                return n;
            }
        }

        /// <summary>The CMS check's code for the kind (A-F, or a name), used by the tests.</summary>
        public string Code
        {
            get { return MarkerSpaceScanner.Code(Kind); }
        }
    }

    /// <summary>
    /// The checks of CMS/marker_space/MarkerSpace.py, ported from Project Checker's MarkerSpaceCheck
    /// (which is diffed against the original script), with an edit attached to each fixable problem.
    /// </summary>
    public sealed class MarkerSpaceScanner
    {
        private static readonly HashSet<string> TPrefixKeep = new HashSet<string> { "tl", "ts-s", "ts-e" };
        private static readonly Regex VerseRe = new Regex(@"\\v\s+(\d+(?:[,-]\d+)*)\s*", RegexOptions.CultureInvariant);
        private static readonly Regex NextCloseMarkerRe = new Regex(@"\G\\\+?[a-zA-Z][a-zA-Z0-9]*\*", RegexOptions.CultureInvariant);
        private static readonly Regex NoteSpanRe = new Regex(@"\\f\s.*?\\f\*|\\x\s.*?\\x\*", RegexOptions.CultureInvariant | RegexOptions.Singleline);
        private static readonly Regex MarkerSpaceRe = new Regex(
            @"\\\+?[a-zA-Z][a-zA-Z0-9]*\*?(?:[\s~]+\d+(?:[,-]\d+)*)?[\s~]+", RegexOptions.CultureInvariant);
        private static readonly string ClosingPunct = ",.;:!?)]}" + new string(new char[] {
            (char)0x2026, (char)0x00BB, (char)0x201D, (char)0x2019, (char)0x203A });

        private readonly List<string> exclude, noClose, noteContext, extraSpacing, noSpaceBefore;
        private readonly bool footnotePrecedes, xrefPrecedes;
        /// <summary>Character marker -> bare closing marker (nd -> nd*), in the CMS check's order.</summary>
        private readonly List<KeyValuePair<string, string>> charMarkers = new List<KeyValuePair<string, string>>();
        private readonly List<KeyValuePair<string, string>> noCloseEnd = new List<KeyValuePair<string, string>>();
        private readonly Dictionary<string, Regex> openRes = new Dictionary<string, Regex>();
        private readonly Dictionary<string, Regex> closeRes = new Dictionary<string, Regex>();
        private readonly Dictionary<string, Regex> noCloseRes = new Dictionary<string, Regex>();
        private readonly Dictionary<string, Regex> noCloseOpenRes = new Dictionary<string, Regex>();
        private readonly Regex noSpaceBeforeRe;

        public MarkerSpaceScanner(ScanOptions options, StyleSheets sty)
        {
            exclude = Names(options.ExcludeMarkers);
            noClose = Names(options.NoCloseMarkers);
            noteContext = Names(options.NoCloseInNoteMarkers);
            extraSpacing = Names(options.ExtraSpacingMarkers);
            noSpaceBefore = Names(options.NoSpaceBeforeMarkers);
            footnotePrecedes = options.FootnotePrecedesText;
            if (footnotePrecedes) noSpaceBefore.Remove("f");
            xrefPrecedes = options.CrossReferencesPrecedeText;
            if (xrefPrecedes) noSpaceBefore.Remove("x");

            var chars = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var kv in sty.Markers)
            {
                string st;
                if (!kv.Value.TryGetValue("styletype", out st) || st.Trim().ToLowerInvariant() != "character") continue;
                if (exclude.Contains(kv.Key) || noClose.Contains(kv.Key) || IsIgnoredTMarker(kv.Key)) continue;
                Add(chars, kv.Key, ResolveEndmarker(kv.Key, kv.Value));
            }
            foreach (string m in noteContext)
            {
                if (exclude.Contains(m) || IsIgnoredTMarker(m)) continue;
                if (!chars.ContainsKey(m)) Add(chars, m, ResolveEndmarker(m, sty.Get(m)));
            }
            foreach (string m in extraSpacing)
            {
                if (exclude.Contains(m) || noClose.Contains(m) || noteContext.Contains(m) || IsIgnoredTMarker(m)) continue;
                if (!chars.ContainsKey(m)) Add(chars, m, ResolveEndmarker(m, sty.Get(m)));
            }
            foreach (string m in noClose)
            {
                if (IsIgnoredTMarker(m)) continue;
                noCloseEnd.Add(new KeyValuePair<string, string>(m, ResolveEndmarker(m, sty.Get(m))));
            }

            // Every known marker name, so that \f is not taken for the start of \ft.
            var all = new HashSet<string>(sty.Markers.Keys, StringComparer.Ordinal);
            all.UnionWith(chars.Keys);
            all.UnionWith(noCloseEnd.Select(kv => kv.Key));
            all.UnionWith(exclude);
            all.UnionWith(noClose);
            all.UnionWith(noteContext);
            all.UnionWith(extraSpacing);
            all.UnionWith(noSpaceBefore);

            foreach (var kv in charMarkers)
            {
                openRes[kv.Key] = OpenMarkerRegex(kv.Key, all);
                closeRes[kv.Key] = new Regex(MarkerPattern(kv.Value, null), RegexOptions.CultureInvariant);
            }
            foreach (var kv in noCloseEnd)
            {
                noCloseRes[kv.Key] = new Regex(MarkerPattern(kv.Value, null), RegexOptions.CultureInvariant);
                if (!exclude.Contains(kv.Key)) noCloseOpenRes[kv.Key] = OpenMarkerRegex(kv.Key, all);
            }
            if (noSpaceBefore.Count > 0)
                noSpaceBeforeRe = new Regex(@"\G\\\+?(?:" + string.Join("|", noSpaceBefore.Select(Regex.Escape).ToArray()) + @")\b",
                    RegexOptions.CultureInvariant);
        }

        private void Add(Dictionary<string, string> chars, string marker, string endmarker)
        {
            chars[marker] = endmarker;
            charMarkers.Add(new KeyValuePair<string, string>(marker, endmarker));
        }

        /// <summary>The option's marker names, without backslashes, in first-seen order.</summary>
        private static List<string> Names(string raw)
        {
            var list = new List<string>();
            foreach (string m in (raw ?? "").Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
            {
                string n = m.TrimStart('\\');
                if (n.Length > 0 && !list.Contains(n)) list.Add(n);
            }
            return list;
        }

        /// <summary>Table and similar \t markers are skipped, except \tl and \ts-s/\ts-e.</summary>
        private static bool IsIgnoredTMarker(string marker)
        {
            return marker.ToLowerInvariant().StartsWith("t", StringComparison.Ordinal) && !TPrefixKeep.Contains(marker);
        }

        private static string ResolveEndmarker(string marker, Dictionary<string, string> fields)
        {
            string v;
            string[] end = (fields != null && fields.TryGetValue("endmarker", out v) ? v : "")
                .Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            return end.Length > 0 ? end[0] : marker + "*";
        }

        /// <summary>\bare or \+bare, not followed by the rest of a longer known marker name.</summary>
        private static string MarkerPattern(string bare, ICollection<string> allNames)
        {
            string lookahead = "";
            if (allNames != null)
            {
                var ext = allNames.Where(m => m != bare && m.StartsWith(bare, StringComparison.Ordinal))
                    .Select(m => Regex.Escape(m.Substring(bare.Length))).ToArray();
                if (ext.Length > 0) lookahead = "(?!" + string.Join("|", ext) + ")";
            }
            return @"\\\+?" + Regex.Escape(bare) + lookahead;
        }

        /// <summary>An opening marker: not the start of a longer marker name, and not the closing marker.</summary>
        private static Regex OpenMarkerRegex(string marker, ICollection<string> allNames)
        {
            return new Regex(MarkerPattern(marker, allNames) + @"(?!\*)", RegexOptions.CultureInvariant);
        }

        // ------------------------------------------------------------ character tests

        /// <summary>Unicode punctuation, except the backslash that starts a marker.</summary>
        public static bool IsPunct(char c)
        {
            return c != '\\' && char.IsPunctuation(c);
        }

        /// <summary>White space, or '~' (Paratext's non-breaking space).</summary>
        public static bool IsSpace(char c)
        {
            return char.IsWhiteSpace(c) || c == '~';
        }

        private static bool IsInlineSpace(char c)
        {
            return c == ' ' || c == '\t' || c == '~';
        }

        public static bool IsClosingPunct(char c)
        {
            return ClosingPunct.IndexOf(c) >= 0;
        }

        /// <summary>After the marker's own space, its content starts with closing punctuation ("\ft .").</summary>
        private static bool ContentStartsWithClosingPunct(string text, int contentStart)
        {
            int n = text.Length, k = contentStart;
            while (k < n && IsSpace(text[k])) k++;
            return k < n && IsClosingPunct(text[k]);
        }

        /// <summary>Start of the run of spaces that ends at pos, never going back to limit or before.</summary>
        private static int SpaceRunStart(string text, int pos, int limit)
        {
            int k = pos;
            while (k > limit && k > 0 && IsSpace(text[k - 1])) k--;
            return k;
        }

        // ------------------------------------------------------------ scanning

        /// <summary>The problems in one chapter, in text order.</summary>
        public List<SpaceIssue> ScanChapter(BookId book, int chapter, string text)
        {
            var issues = new List<SpaceIssue>();
            if (string.IsNullOrEmpty(text)) return issues;
            int n = text.Length;

            var versePos = new List<KeyValuePair<int, string>>();
            foreach (Match vm in VerseRe.Matches(text))
                versePos.Add(new KeyValuePair<int, string>(vm.Index + vm.Length, vm.Groups[1].Value));
            Func<int, string> verseAt = delegate(int offset)
            {
                string label = null;
                foreach (var p in versePos)
                {
                    if (p.Key <= offset) label = p.Value;
                    else break;
                }
                return label ?? "-";
            };
            Func<IssueKind, string, string, int, int, int, SpaceIssue> make =
                delegate(IssueKind kind, string marker, string shown, int refPos, int start, int end)
                {
                    var issue = new SpaceIssue();
                    issue.Book = book;
                    issue.Chapter = chapter;
                    issue.Verse = verseAt(refPos);
                    issue.Kind = kind;
                    issue.Marker = marker;
                    issue.Shown = shown;
                    issue.Start = start;
                    issue.End = end;
                    issue.ChapterText = text;
                    issues.Add(issue);
                    return issue;
                };

            var noteSpans = new List<KeyValuePair<int, int>>();
            if (noteContext.Count > 0)
                foreach (Match m in NoteSpanRe.Matches(text)) noteSpans.Add(new KeyValuePair<int, int>(m.Index, m.Index + m.Length));
            var markerSpaceEnds = new HashSet<int>();
            if (noSpaceBefore.Count > 0)
                foreach (Match m in MarkerSpaceRe.Matches(text)) markerSpaceEnds.Add(m.Index + m.Length);

            foreach (var kv in charMarkers)
            {
                string marker = kv.Key, endmarker = kv.Value;
                Regex openRe = openRes[marker], closeRe = closeRes[marker];
                bool skipInNotes = noteContext.Contains(marker);

                // Pair each opening marker with the first closing marker before the next opening one.
                var opens = new List<Match>();
                foreach (Match m in openRe.Matches(text)) opens.Add(m);
                if (opens.Count == 0) continue;
                List<Match> closes = null;
                if (endmarker.IndexOf('\\') < 0)
                {
                    closes = new List<Match>();
                    foreach (Match cm in closeRe.Matches(text)) closes.Add(cm);
                }
                int ci = 0;
                for (int idx = 0; idx < opens.Count; idx++)
                {
                    Match m = opens[idx];
                    int nextOpen = idx + 1 < opens.Count ? opens[idx + 1].Index : n;
                    Match close;
                    if (closes != null)
                    {
                        while (ci < closes.Count && closes[ci].Index < m.Index + m.Length) ci++;
                        close = ci < closes.Count ? closes[ci] : Match.Empty;
                    }
                    else close = closeRe.Match(text, m.Index + m.Length);

                    if (!close.Success || close.Index >= nextOpen)
                    {
                        // \xt inside a footnote or cross-reference needs no closing marker.
                        bool skip = false;
                        if (skipInNotes)
                            foreach (var sp in noteSpans)
                                if (sp.Key <= m.Index && m.Index < sp.Value) { skip = true; break; }
                        if (!skip) make(IssueKind.Unclosed, marker, marker, m.Index, m.Index, m.Index + m.Length);
                        continue;
                    }

                    int os = m.Index, oe = m.Index + m.Length, cs = close.Index, ce = close.Index + close.Length;
                    bool invertOpen = noSpaceBefore.Contains(marker);
                    bool invertClose = (footnotePrecedes && marker == "f") || (xrefPrecedes && marker == "x");
                    CheckPair(text, marker, endmarker, os, oe, cs, ce, invertOpen, invertClose, markerSpaceEnds, make);

                    if (marker == "w")
                    {
                        int pipe = cs > oe ? text.IndexOf('|', oe, cs - oe) : -1;
                        if (pipe > oe && IsSpace(text[pipe - 1]))
                        {
                            SpaceIssue issue = make(IssueKind.SpaceBeforePipe, marker, marker, os, pipe - 1, pipe + 1);
                            int k = SpaceRunStart(text, pipe, oe + 1);
                            if (k < pipe) issue.Edits.Add(new TextEdit(k, pipe - k, ""));
                        }
                    }
                }
            }

            foreach (var kv in noCloseEnd)
            {
                foreach (Match m in noCloseRes[kv.Key].Matches(text))
                    make(IssueKind.UnexpectedClose, kv.Key, kv.Value, m.Index, m.Index, m.Index + m.Length);
            }

            foreach (var kv in noCloseOpenRes)
            {
                foreach (Match m in kv.Value.Matches(text))
                {
                    int hs = m.Index, he = m.Index + m.Length;
                    if (hs == 0) continue;
                    char before = text[hs - 1];
                    if (IsSpace(before) || IsPunct(before) || ContentStartsWithClosingPunct(text, he)) continue;
                    SpaceIssue issue = make(IssueKind.MissingSpaceBeforeNoClose, kv.Key, kv.Key, hs, hs, he);
                    issue.Edits.Add(new TextEdit(hs, 0, " "));
                }
            }

            issues.Sort(delegate(SpaceIssue a, SpaceIssue b)
            {
                int c = a.Start.CompareTo(b.Start);
                return c != 0 ? c : a.Kind.CompareTo(b.Kind);
            });
            return issues;
        }

        /// <summary>
        /// _check_pair: the spacing around one \marker ... \marker* pair, each problem with its fix.
        /// </summary>
        private void CheckPair(string text, string marker, string endmarker, int os, int oe, int cs, int ce,
            bool invertOpen, bool invertClose, HashSet<int> markerSpaceEnds,
            Func<IssueKind, string, string, int, int, int, SpaceIssue> make)
        {
            int n = text.Length;
            SpaceIssue issue;

            if (os > 0)
            {
                char beforeOpen = text[os - 1];
                if (invertOpen)
                {
                    // B: \f or \x attaches to the word before it. A space right after another
                    // marker's own space (\v 21 \f ...) is not a problem.
                    if (IsSpace(beforeOpen) && !markerSpaceEnds.Contains(os))
                    {
                        issue = make(IssueKind.SpaceBeforeOpen, marker, marker, os, os, oe);
                        int k = SpaceRunStart(text, os, 0);
                        issue.Edits.Add(new TextEdit(k, os - k, ""));
                    }
                }
                else if (!IsSpace(beforeOpen) && !IsPunct(beforeOpen) && !ContentStartsWithClosingPunct(text, oe))
                {
                    // A
                    issue = make(IssueKind.MissingSpaceBeforeOpen, marker, marker, os, os, oe);
                    issue.Edits.Add(new TextEdit(os, 0, " "));
                }
            }

            if (cs > 0 && IsSpace(text[cs - 1]))
            {
                // C: the space moves outside the closing marker, unless one is already there
                // or the closing marker needs none after it.
                issue = make(IssueKind.SpaceBeforeClose, marker, endmarker, os, cs, ce);
                int k = SpaceRunStart(text, cs, oe + 1);
                if (k < cs)
                {
                    issue.Edits.Add(new TextEdit(k, cs - k, ""));
                    if (!invertClose && NeedsSpaceAfter(text, ce))
                        issue.Edits.Add(new TextEdit(ce, 0, " "));
                }
            }

            if (ce < n)
            {
                char afterClose = text[ce];
                if (IsInlineSpace(afterClose))
                {
                    int k = ce;
                    while (k < n && IsInlineSpace(text[k])) k++;
                    if (k < n && IsClosingPunct(text[k]))
                    {
                        // E
                        issue = make(IssueKind.SpaceBeforePunctuation, marker, endmarker, os, cs, ce);
                        issue.Edits.Add(new TextEdit(ce, k - ce, ""));
                    }
                    else if (invertClose && k < n && !IsPunct(text[k]))
                    {
                        // F
                        issue = make(IssueKind.SpaceAfterClose, marker, endmarker, os, cs, ce);
                        issue.Edits.Add(new TextEdit(ce, k - ce, ""));
                    }
                }
                else if (!invertClose && NeedsSpaceAfter(text, ce))
                {
                    // D
                    issue = make(IssueKind.MissingSpaceAfterClose, marker, endmarker, os, cs, ce);
                    issue.Edits.Add(new TextEdit(ce, 0, " "));
                }
            }
        }

        /// <summary>
        /// Check D's test: the closing marker ending at ce is glued to a word or marker. Punctuation,
        /// a footnote or cross-reference caller, or another closing marker right after it is normal.
        /// </summary>
        private bool NeedsSpaceAfter(string text, int ce)
        {
            if (ce >= text.Length) return false;
            char c = text[ce];
            if (IsSpace(c) || IsPunct(c)) return false;
            if (c == '\\' && ((noSpaceBeforeRe != null && noSpaceBeforeRe.Match(text, ce).Success)
                || NextCloseMarkerRe.Match(text, ce).Success))
                return false;
            return true;
        }

        public static string Code(IssueKind kind)
        {
            switch (kind)
            {
                case IssueKind.MissingSpaceBeforeOpen: return "A";
                case IssueKind.SpaceBeforeOpen: return "B";
                case IssueKind.SpaceBeforeClose: return "C";
                case IssueKind.MissingSpaceAfterClose: return "D";
                case IssueKind.SpaceBeforePunctuation: return "E";
                case IssueKind.SpaceAfterClose: return "F";
                case IssueKind.MissingSpaceBeforeNoClose: return "NoCloseSpace";
                case IssueKind.SpaceBeforePipe: return "WPipe";
                case IssueKind.Unclosed: return "Unclosed";
                default: return "Unexpected";
            }
        }

        // ------------------------------------------------------------ applying fixes

        /// <summary>
        /// Applies edits to text. The same insertion at the same place is made once (the space that
        /// a "space before \nd*" fix moves out is the space a "missing space after \nd*" fix adds);
        /// overlapping deletions are joined; an insertion inside a deleted stretch is dropped.
        /// </summary>
        public static string Apply(string text, IEnumerable<TextEdit> edits)
        {
            var deletes = new List<int[]>();
            var inserts = new SortedDictionary<int, string>();
            foreach (TextEdit e in edits)
            {
                if (e.Length > 0) deletes.Add(new[] { e.Start, e.End });
                if (e.Insert.Length > 0)
                {
                    string existing;
                    if (!inserts.TryGetValue(e.Start, out existing) || existing != e.Insert)
                        inserts[e.Start] = existing == null ? e.Insert : existing + e.Insert;
                }
            }
            deletes.Sort((a, b) => a[0].CompareTo(b[0]));
            var merged = new List<int[]>();
            foreach (int[] d in deletes)
            {
                if (merged.Count > 0 && d[0] <= merged[merged.Count - 1][1])
                    merged[merged.Count - 1][1] = Math.Max(merged[merged.Count - 1][1], d[1]);
                else merged.Add(new[] { d[0], d[1] });
            }

            var sb = new StringBuilder(text.Length + inserts.Count);
            int pos = 0, di = 0;
            foreach (int at in inserts.Keys.Concat(new[] { int.MaxValue }))
            {
                // Copy up to the next insertion point, skipping deleted stretches.
                int stop = Math.Min(at, text.Length);
                while (pos < stop)
                {
                    while (di < merged.Count && merged[di][1] <= pos) di++;
                    if (di < merged.Count && merged[di][0] <= pos)
                    {
                        pos = Math.Min(merged[di][1], text.Length);
                        continue;
                    }
                    int next = di < merged.Count ? Math.Min(merged[di][0], stop) : stop;
                    sb.Append(text, pos, next - pos);
                    pos = next;
                }
                if (at == int.MaxValue) break;
                bool insideDelete = merged.Any(d => d[0] < at && at < d[1]);
                if (!insideDelete && at <= text.Length) sb.Append(inserts[at]);
            }
            return sb.ToString();
        }
    }
}
