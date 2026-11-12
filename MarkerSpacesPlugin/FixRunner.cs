using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace MarkerSpaces
{
    public sealed class FixReport
    {
        /// <summary>Book code and number of problems fixed, in book order.</summary>
        public readonly List<KeyValuePair<string, int>> Fixed = new List<KeyValuePair<string, int>>();
        public readonly List<string> NoPermission = new List<string>();
        public readonly List<string> Busy = new List<string>();
        public readonly List<string> Failed = new List<string>();
        /// <summary>Chapters whose text changed after the scan, so they were left alone.</summary>
        public readonly List<string> Changed = new List<string>();
        public readonly List<string> Backups = new List<string>();
        public string HistoryError;
        /// <summary>True when no history point could be made, so nothing was changed.</summary>
        public bool Stopped;

        public int Total
        {
            get { return Fixed.Sum(kv => kv.Value); }
        }

        public int BooksChanged
        {
            get { return Fixed.Count; }
        }
    }

    /// <summary>
    /// Applies the ticked fixes the way Paratext treats edits: chapters the user may edit are
    /// changed, the others are left alone and reported. Only chapters that change are written.
    /// </summary>
    public sealed class FixRunner
    {
        private readonly IBookSource source;
        private readonly MarkerSpaceScanner scanner;
        private readonly Dictionary<long, bool> canEdit = new Dictionary<long, bool>();

        /// <summary>Message for a chapter Paratext accepted but did not store as written (set from Strings).</summary>
        public string NotSavedText = "not saved";

        public FixRunner(IBookSource source, MarkerSpaceScanner scanner)
        {
            this.source = source;
            this.scanner = scanner;
        }

        public bool CanEdit(int bookNum, int chapter)
        {
            long key = bookNum * 10000L + chapter;
            bool result;
            if (!canEdit.TryGetValue(key, out result))
            {
                try { result = source.CanEdit(bookNum, chapter); }
                catch (Exception) { result = false; }
                canEdit[key] = result;
            }
            return result;
        }

        /// <summary>True when the user may edit no book of the project at all.</summary>
        public bool NoPermissionAtAll()
        {
            foreach (BookId book in source.Books)
                if (CanEdit(book.Number, 0)) return false;
            return true;
        }

        /// <summary>The number of books with a fixable chosen problem the user may edit.</summary>
        public int BooksToChange(IEnumerable<SpaceIssue> chosen)
        {
            return chosen.Where(i => i.CanFix && CanEdit(i.Book.Number, i.Chapter))
                .Select(i => i.Book.Number).Distinct().Count();
        }

        /// <summary>
        /// Fixes the chosen problems in every chapter the user may edit. Each changed book is first
        /// saved whole as Backup_BOOK_time.bak (UTF-8). historyMessage is first recorded as a
        /// project history point; if that fails, nothing is changed (report.Stopped).
        /// </summary>
        public FixReport Run(IEnumerable<SpaceIssue> chosen, string historyMessage)
        {
            var report = new FixReport();
            // Book -> chapter -> problems, in book and chapter order.
            var byBook = new SortedDictionary<int, SortedDictionary<int, List<SpaceIssue>>>();
            var books = new Dictionary<int, BookId>();
            foreach (SpaceIssue issue in chosen)
            {
                if (!issue.CanFix) continue;
                SortedDictionary<int, List<SpaceIssue>> chapters;
                if (!byBook.TryGetValue(issue.Book.Number, out chapters))
                {
                    chapters = new SortedDictionary<int, List<SpaceIssue>>();
                    byBook[issue.Book.Number] = chapters;
                    books[issue.Book.Number] = issue.Book;
                }
                List<SpaceIssue> list;
                if (!chapters.TryGetValue(issue.Chapter, out list))
                {
                    list = new List<SpaceIssue>();
                    chapters[issue.Chapter] = list;
                }
                list.Add(issue);
            }

            // Chapters the user may not edit are reported, never written.
            var editable = new List<KeyValuePair<BookId, List<int>>>();
            foreach (var kv in byBook)
            {
                BookId book = books[kv.Key];
                var yes = kv.Value.Keys.Where(c => CanEdit(book.Number, c)).ToList();
                var no = kv.Value.Keys.Where(c => !CanEdit(book.Number, c)).ToList();
                if (no.Count > 0)
                    report.NoPermission.Add(yes.Count == 0 ? book.Code : book.Code + " " + string.Join(", ", no.Select(c => c.ToString()).ToArray()));
                if (yes.Count > 0) editable.Add(new KeyValuePair<BookId, List<int>>(book, yes));
            }
            if (editable.Count == 0) return report;

            // A history point is required: without one nothing is changed.
            string historyError;
            bool made;
            try { made = source.MakeHistoryPoint(historyMessage, out historyError); }
            catch (Exception ex)
            {
                made = false;
                historyError = ex.Message;
            }
            if (!made)
            {
                report.HistoryError = historyError ?? "";
                report.Stopped = true;
                return report;
            }

            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            foreach (var plan in editable)
            {
                BookId book = plan.Key;
                string backupError;
                string backup = SaveBackup(book, stamp, out backupError);
                if (backup == null)
                {
                    report.Failed.Add(book.Code + ": " + backupError);
                    continue;
                }

                int fixedCount = 0;
                var busy = new List<int>();
                var changedSinceScan = new List<int>();
                foreach (int chapter in plan.Value)
                {
                    List<SpaceIssue> issues = byBook[book.Number][chapter];
                    string old = ReadChapter(book.Number, chapter);
                    if (old == null || old != issues[0].ChapterText)
                    {
                        changedSinceScan.Add(chapter);
                        continue;
                    }
                    string text = MarkerSpaceScanner.Apply(old, issues.SelectMany(i => i.Edits));
                    if (text == old) continue;

                    string error;
                    WriteOutcome outcome = source.WriteChapter(book.Number, chapter, text, out error);
                    if (outcome == WriteOutcome.Written)
                    {
                        // Paratext normalizes what it stores: when the stored text differs from what
                        // was written, make sure it holds no more problems than the written text.
                        string now = ReadChapter(book.Number, chapter);
                        if (now != null && now != text && CountFixable(book, chapter, now) > CountFixable(book, chapter, text))
                        {
                            report.Failed.Add(book.Code + " " + chapter + ": " + NotSavedText);
                            continue;
                        }
                        fixedCount += issues.Count;
                    }
                    else if (outcome == WriteOutcome.NoPermission)
                        report.NoPermission.Add(book.Code + " " + chapter);
                    else if (outcome == WriteOutcome.Busy)
                        busy.Add(chapter);
                    else
                        report.Failed.Add(book.Code + " " + chapter + ": " + error);
                }
                if (busy.Count > 0)
                    report.Busy.Add(book.Code + " " + string.Join(", ", busy.Select(c => c.ToString()).ToArray()));
                if (changedSinceScan.Count > 0)
                    report.Changed.Add(book.Code + " " + string.Join(", ", changedSinceScan.Select(c => c.ToString()).ToArray()));
                if (fixedCount > 0)
                {
                    report.Fixed.Add(new KeyValuePair<string, int>(book.Code, fixedCount));
                    report.Backups.Add(backup);
                }
                else
                {
                    try { File.Delete(backup); }
                    catch (Exception) { }
                }
            }
            return report;
        }

        private string ReadChapter(int bookNum, int chapter)
        {
            string text = source.GetChapter(bookNum, chapter);
            if (text == null && chapter == 1) text = source.GetBook(bookNum);
            return text;
        }

        private int CountFixable(BookId book, int chapter, string text)
        {
            return scanner.ScanChapter(book, chapter, text).Count(i => i.CanFix);
        }

        private string SaveBackup(BookId book, string stamp, out string error)
        {
            error = null;
            try
            {
                string text = source.GetBook(book.Number);
                if (text == null)
                {
                    error = "empty book";
                    return null;
                }
                string dir = source.BackupDirectory;
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "Backup_" + book.Code + "_" + stamp + ".bak");
                File.WriteAllText(path, text, new UTF8Encoding(false));
                return path;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }
    }
}
