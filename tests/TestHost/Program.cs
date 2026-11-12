using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using MarkerSpaces;

namespace MarkerSpacesTests
{
    /// <summary>
    /// Test host for the Marker Spaces plugin code, run on a folder of SFM files (the folder is the
    /// "project folder": usfm.sty from the folder above it, custom.sty and local\MarkerSpaces\settings.xml in it):
    ///   TestHost scan FOLDER                       one line per problem
    ///   TestHost preview FOLDER                    reference, code, now and after for each problem
    ///   TestHost fix FOLDER CODES|All EDITSPEC BACKUPDIR
    ///   TestHost form FOLDER EDITSPEC LANG BACKUPDIR
    /// CODES: comma-separated CMS codes (A,C,D,E,B,F,NoCloseSpace,WPipe). EDITSPEC: ALL, NONE, or e.g. MAT,PSA:2-3.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("usage: TestHost scan|preview|fix|form FOLDER ...");
                return 2;
            }
            // A WinExe has no console to set an encoding on: write UTF-8 to whatever stdout is.
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            Console.SetOut(stdout);
            string folder = args[1];
            switch (args[0])
            {
                case "scan":
                {
                    var source = new FolderBookSource(folder, "TEST", "ALL", null);
                    foreach (SpaceIssue i in Scan(source))
                        Console.WriteLine(string.Join("\t", new[] {
                            i.Book.Code, i.Chapter.ToString(), i.Verse, i.Code, i.Marker, i.Shown,
                            i.Start.ToString(), i.End.ToString(), Edits(i) }));
                    return 0;
                }
                case "preview":
                {
                    var source = new FolderBookSource(folder, "TEST", "ALL", null);
                    foreach (SpaceIssue i in Scan(source))
                    {
                        string now, after;
                        ProjectScan.Preview(i, out now, out after);
                        Console.WriteLine(i.Reference + "\t" + i.Code + "\t" + now + "\t" + after);
                    }
                    return 0;
                }
                case "fix":
                {
                    var source = new FolderBookSource(folder, "TEST", args[3], args[4]);
                    MarkerSpaceScanner scanner;
                    List<SpaceIssue> issues = Scan(source, out scanner);
                    var codes = args[2].Equals("All", StringComparison.OrdinalIgnoreCase)
                        ? null : new HashSet<string>(args[2].Split(','));
                    var runner = new FixRunner(source, scanner);
                    // Tick what the window would let the user tick.
                    List<SpaceIssue> chosen = issues.Where(i => i.CanFix && (codes == null || codes.Contains(i.Code))
                        && runner.CanEdit(i.Book.Number, i.Chapter)).ToList();
                    // Also pass the ones the window would not allow, to test that they are refused.
                    List<SpaceIssue> blocked = issues.Where(i => i.CanFix && (codes == null || codes.Contains(i.Code))
                        && !runner.CanEdit(i.Book.Number, i.Chapter)).ToList();
                    FixReport report = runner.Run(chosen.Concat(blocked), "test history point");
                    Console.WriteLine("CHOSEN {0} BLOCKED {1}", chosen.Count, blocked.Count);
                    foreach (var kv in report.Fixed)
                        Console.WriteLine("FIXED {0} {1}", kv.Key, kv.Value);
                    Console.WriteLine("TOTAL {0} BOOKS {1}", report.Total, report.BooksChanged);
                    Console.WriteLine("STOPPED " + report.Stopped + " " + (report.HistoryError ?? ""));
                    Console.WriteLine("NOPERMISSION " + string.Join(", ", report.NoPermission.ToArray()));
                    Console.WriteLine("BUSY " + string.Join(", ", report.Busy.ToArray()));
                    Console.WriteLine("CHANGED " + string.Join(", ", report.Changed.ToArray()));
                    Console.WriteLine("FAILED " + string.Join(" | ", report.Failed.ToArray()));
                    Console.WriteLine("HISTORY " + string.Join(" | ", source.HistoryPoints.ToArray()));
                    Console.WriteLine("WRITES " + string.Join(", ", source.Writes.ToArray()));
                    Console.WriteLine("BACKUPS " + string.Join(", ", report.Backups.Select(Path.GetFileName).ToArray()));
                    return 0;
                }
                case "form":
                {
                    var source = new FolderBookSource(folder, Path.GetFileName(Path.GetFullPath(folder).TrimEnd('\\')), args[2], args[4]);
                    Application.EnableVisualStyles();
                    var form = new MarkerSpacesForm(source, Strings.For(args[3]));
                    // So the UI test can check that double-clicking a row asks Paratext to go to the verse.
                    form.FormClosed += delegate { Console.WriteLine("GOTO " + string.Join(", ", source.GoTos.ToArray())); };
                    Application.Run(form);
                    return 0;
                }
            }
            Console.Error.WriteLine("unknown mode " + args[0]);
            return 2;
        }

        private static List<SpaceIssue> Scan(IBookSource source)
        {
            MarkerSpaceScanner scanner;
            return Scan(source, out scanner);
        }

        private static List<SpaceIssue> Scan(IBookSource source, out MarkerSpaceScanner scanner)
        {
            string local = Path.Combine(Path.Combine(source.ProjectDirectory, "local"), "MarkerSpaces");
            ScanOptions options = ScanOptions.Load(ScanOptions.SettingsPath(local));
            scanner = new MarkerSpaceScanner(options, StyleSheets.Load(source.ProjectDirectory));
            // The saved book choice, as in the plugin; MS_ALLBOOKS=1 examines every book (for the
            // comparison with Project Checker, without writing settings into real project folders).
            if (Environment.GetEnvironmentVariable("MS_ALLBOOKS") == "1") return ProjectScan.Scan(source, scanner, null);
            return ProjectScan.Scan(source, scanner, b => !options.IsExcluded(b));
        }

        private static string Edits(SpaceIssue i)
        {
            return string.Join(";", i.Edits.Select(e => e.Start + ":" + e.Length + ":" + e.Insert.Replace(" ", "_")).ToArray());
        }
    }
}
