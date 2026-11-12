using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

namespace MarkerSpaces
{
    /// <summary>
    /// The options of the CMS check MarkerSpace.cms (same names and defaults, except MaxExamples,
    /// which only limited the HTML report). Saved per project in
    /// &lt;project&gt;\local\MarkerSpaces\settings.xml, which Send/Receive does not share.
    /// </summary>
    public sealed class ScanOptions
    {
        public const string DefaultNoClose = "v fk fp fq fqa ft fr xk xo xq";
        public const string DefaultNoCloseInNote = "xt";
        public const string DefaultExtraSpacing = "f x";
        public const string DefaultNoSpaceBefore = "f x";

        public string ExcludeMarkers = "";
        public string NoCloseMarkers = DefaultNoClose;
        public string NoCloseInNoteMarkers = DefaultNoCloseInNote;
        public string ExtraSpacingMarkers = DefaultExtraSpacing;
        public string NoSpaceBeforeMarkers = DefaultNoSpaceBefore;
        public bool FootnotePrecedesText = false;
        public bool CrossReferencesPrecedeText = true;
        /// <summary>
        /// Codes of the books not to examine, separated by spaces; null when none were saved, so
        /// the default (OtherBooks) applies. An empty string examines every book.
        /// </summary>
        public string ExcludedBooks = null;

        /// <summary>Books that are not Bible text: front and back matter, extras, glossary, concordance.</summary>
        public static readonly HashSet<string> OtherBooks = new HashSet<string>(
            "FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG".Split(' '), StringComparer.OrdinalIgnoreCase);

        public static bool IsBibleBook(string code)
        {
            return !OtherBooks.Contains(code);
        }

        /// <summary>Whether a book is left out of the scan: the saved choice, otherwise every non-Bible book.</summary>
        public bool IsExcluded(BookId book)
        {
            if (ExcludedBooks == null) return !IsBibleBook(book.Code);
            foreach (string code in ExcludedBooks.Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
                if (string.Equals(code, book.Code, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public ScanOptions Clone()
        {
            return (ScanOptions)MemberwiseClone();
        }

        public static string SettingsPath(string localDirectory)
        {
            return localDirectory == null ? null : Path.Combine(localDirectory, "settings.xml");
        }

        /// <summary>The saved options, or the defaults when there are none (or they cannot be read).</summary>
        public static ScanOptions Load(string path)
        {
            var o = new ScanOptions();
            if (path == null || !File.Exists(path)) return o;
            try
            {
                var doc = new XmlDocument();
                // No DTD processing and nothing fetched from outside the file.
                using (XmlReader r = XmlReader.Create(path, new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null }))
                    doc.Load(r);
                XmlElement root = doc.DocumentElement;
                o.ExcludeMarkers = Text(root, "ExcludeMarkers", o.ExcludeMarkers);
                o.NoCloseMarkers = Text(root, "NoCloseMarkers", o.NoCloseMarkers);
                o.NoCloseInNoteMarkers = Text(root, "NoCloseInNoteMarkers", o.NoCloseInNoteMarkers);
                o.ExtraSpacingMarkers = Text(root, "ExtraSpacingMarkers", o.ExtraSpacingMarkers);
                o.NoSpaceBeforeMarkers = Text(root, "NoSpaceBeforeMarkers", o.NoSpaceBeforeMarkers);
                o.FootnotePrecedesText = Text(root, "FootnotePrecedesText", o.FootnotePrecedesText ? "Yes" : "No") == "Yes";
                o.CrossReferencesPrecedeText = Text(root, "CrossReferencesPrecedeText", o.CrossReferencesPrecedeText ? "Yes" : "No") == "Yes";
                o.ExcludedBooks = Text(root, "ExcludedBooks", null);
            }
            catch (Exception)
            {
                return new ScanOptions();
            }
            return o;
        }

        private static string Text(XmlElement root, string name, string fallback)
        {
            XmlNode node = root != null ? root.SelectSingleNode(name) : null;
            return node != null ? node.InnerText.Trim() : fallback;
        }

        public void Save(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var settings = new XmlWriterSettings();
            settings.Indent = true;
            settings.Encoding = new UTF8Encoding(false);
            using (XmlWriter w = XmlWriter.Create(path, settings))
            {
                w.WriteStartElement("MarkerSpacesSettings");
                w.WriteElementString("ExcludeMarkers", ExcludeMarkers ?? "");
                w.WriteElementString("NoCloseMarkers", NoCloseMarkers ?? "");
                w.WriteElementString("NoCloseInNoteMarkers", NoCloseInNoteMarkers ?? "");
                w.WriteElementString("ExtraSpacingMarkers", ExtraSpacingMarkers ?? "");
                w.WriteElementString("NoSpaceBeforeMarkers", NoSpaceBeforeMarkers ?? "");
                w.WriteElementString("FootnotePrecedesText", FootnotePrecedesText ? "Yes" : "No");
                w.WriteElementString("CrossReferencesPrecedeText", CrossReferencesPrecedeText ? "Yes" : "No");
                if (ExcludedBooks != null) w.WriteElementString("ExcludedBooks", ExcludedBooks);
                w.WriteEndElement();
            }
        }
    }
}
