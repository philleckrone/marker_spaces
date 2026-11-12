using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace MarkerSpaces
{
    /// <summary>Scans every chapter of a project, and shows a problem's text before and after its fix.</summary>
    public static class ProjectScan
    {
        private static readonly Regex ChapterRe = new Regex(@"\\c[ \t]+(\d+)", RegexOptions.CultureInvariant);

        private const char Dot = (char)0x00B7;        // a space that is removed or added
        private const char Pilcrow = (char)0x00B6;    // a line break that is removed
        private const char Ellipsis = (char)0x2026;
        private const char Placeholder = (char)0x0001;
        private const int Context = 25;

        /// <summary>
        /// The problems in every chapter, in book and chapter order. Each chapter is read on its own,
        /// as it is written back (chapter 1 starts with \id); a book without \c is one chapter.
        /// Books for which include returns false are not read at all.
        /// </summary>
        public static List<SpaceIssue> Scan(IBookSource source, MarkerSpaceScanner scanner, Func<BookId, bool> include)
        {
            var issues = new List<SpaceIssue>();
            foreach (BookId book in source.Books)
            {
                if (include != null && !include(book)) continue;
                string bookText = source.GetBook(book.Number);
                if (string.IsNullOrEmpty(bookText)) continue;
                var chapters = new List<int>();
                foreach (Match m in ChapterRe.Matches(bookText))
                {
                    int c;
                    if (int.TryParse(m.Groups[1].Value, out c) && !chapters.Contains(c)) chapters.Add(c);
                }
                if (!chapters.Contains(1)) chapters.Insert(0, 1);
                foreach (int chapter in chapters)
                {
                    string text = source.GetChapter(book.Number, chapter);
                    if (text == null && chapter == 1) text = bookText;
                    if (text == null) continue;
                    issues.AddRange(scanner.ScanChapter(book, chapter, text));
                }
            }
            return issues;
        }

        /// <summary>
        /// The text around the problem now and after its fix. Line breaks show as spaces; a space or
        /// line break the fix removes shows as a dot (or a pilcrow), and a space it adds as a dot.
        /// "after" is empty for a problem that must be fixed by hand.
        /// </summary>
        public static void Preview(SpaceIssue issue, out string now, out string after)
        {
            string text = issue.ChapterText;
            int a = issue.Start, b = issue.End;
            if (issue.CanFix)
            {
                a = issue.Edits.Min(e => e.Start);
                b = issue.Edits.Max(e => e.End);
            }
            int ws = Math.Max(0, a - Context), we = Math.Min(text.Length, b + Context);
            string slice = text.Substring(ws, we - ws);
            string prefix = ws > 0 ? Ellipsis.ToString() : "";
            string suffix = we < text.Length ? Ellipsis.ToString() : "";

            var removed = new bool[slice.Length];
            foreach (TextEdit e in issue.Edits)
                for (int i = Math.Max(e.Start, ws); i < Math.Min(e.End, we); i++) removed[i - ws] = true;
            var sb = new StringBuilder();
            for (int i = 0; i < slice.Length; i++)
                Render(sb, slice[i], removed[i]);
            now = prefix + sb.ToString().Trim() + suffix;

            if (!issue.CanFix)
            {
                after = "";
                return;
            }
            string fixedSlice = MarkerSpaceScanner.Apply(slice,
                issue.Edits.Select(e => new TextEdit(e.Start - ws, e.Length, e.Insert.Length > 0 ? new string(Placeholder, e.Insert.Length) : "")));
            sb.Length = 0;
            foreach (char c in fixedSlice)
            {
                if (c == Placeholder) sb.Append(Dot);
                else Render(sb, c, false);
            }
            after = prefix + sb.ToString().Trim() + suffix;
        }

        private static void Render(StringBuilder sb, char c, bool removed)
        {
            if (removed)
            {
                if (c == '\n') sb.Append(Pilcrow);
                else if (c == '\r') { }
                else if (c == ' ' || c == '\t') sb.Append(Dot);
                else sb.Append(c);
                return;
            }
            if (c == '\r') return;
            sb.Append(c == '\n' || c == '\t' ? ' ' : c);
        }
    }
}
