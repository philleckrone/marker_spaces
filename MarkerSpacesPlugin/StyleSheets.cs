using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace MarkerSpaces
{
    /// <summary>
    /// usfm.sty merged field by field with the project's custom.sty, as MarkerSpace.py does
    /// (_parse_sty / _merge_sty): keyed by marker code, field names lowercased.
    /// </summary>
    public sealed class StyleSheets
    {
        public readonly Dictionary<string, Dictionary<string, string>> Markers =
            new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        public string UsfmPath;
        public int UsfmCount;
        public string CustomPath;
        public int CustomCount;

        public Dictionary<string, string> Get(string marker)
        {
            Dictionary<string, string> f;
            return marker != null && Markers.TryGetValue(marker, out f) ? f : null;
        }

        /// <summary>True when usfm.sty was not found above the project, so the built-in copy was used.</summary>
        public bool UsedBuiltIn;

        /// <summary>
        /// usfm.sty from the folder above the project (where MarkerSpace.py looks), otherwise the
        /// built-in copy (3.0.11, as Project Checker does); custom.sty from the project folder.
        /// </summary>
        public static StyleSheets Load(string projectDirectory)
        {
            var s = new StyleSheets();
            var usfm = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            if (projectDirectory != null)
            {
                string parent = Path.GetDirectoryName(projectDirectory.TrimEnd('\\', '/'));
                if (parent != null)
                {
                    string path = Path.Combine(parent, "usfm.sty");
                    usfm = Parse(path);
                    if (usfm.Count > 0) s.UsfmPath = path;
                }
            }
            if (usfm.Count == 0)
            {
                using (Stream st = typeof(StyleSheets).Assembly.GetManifestResourceStream("MarkerSpaces.usfm.sty"))
                using (var ms = new MemoryStream())
                {
                    if (st != null)
                    {
                        st.CopyTo(ms);
                        usfm = ParseText(Decode(ms.ToArray()));
                        s.UsedBuiltIn = usfm.Count > 0;
                    }
                }
            }
            s.UsfmCount = usfm.Count;

            var custom = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            if (projectDirectory != null)
            {
                s.CustomPath = Path.Combine(projectDirectory, "custom.sty");
                custom = Parse(s.CustomPath);
            }
            s.CustomCount = custom.Count;

            foreach (var kv in usfm)
                s.Markers[kv.Key] = new Dictionary<string, string>(kv.Value, StringComparer.Ordinal);
            foreach (var kv in custom)
            {
                Dictionary<string, string> target;
                if (!s.Markers.TryGetValue(kv.Key, out target))
                {
                    target = new Dictionary<string, string>(StringComparer.Ordinal);
                    s.Markers[kv.Key] = target;
                }
                foreach (var f in kv.Value) target[f.Key] = f.Value;
            }
            return s;
        }

        /// <summary>_parse_sty: an empty result when the file is missing or unreadable.</summary>
        public static Dictionary<string, Dictionary<string, string>> Parse(string path)
        {
            var entries = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return entries;
            byte[] data;
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var ms = new MemoryStream())
                {
                    fs.CopyTo(ms);
                    data = ms.ToArray();
                }
            }
            catch (Exception)
            {
                return entries;
            }
            return ParseText(Decode(data));
        }

        /// <summary>decode('utf-8-sig'), falling back to the ANSI code page.</summary>
        private static string Decode(byte[] data)
        {
            int start = data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF ? 3 : 0;
            try
            {
                return new UTF8Encoding(false, true).GetString(data, start, data.Length - start);
            }
            catch (DecoderFallbackException)
            {
                return Encoding.Default.GetString(data);
            }
        }

        /// <summary>
        /// A \Marker line opens an entry; any other \Field value line sets that field on the current
        /// entry. Blank lines, # comments and lines not starting with a backslash are skipped.
        /// </summary>
        public static Dictionary<string, Dictionary<string, string>> ParseText(string text)
        {
            var entries = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            Dictionary<string, string> current = null;
            foreach (string raw in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || !line.StartsWith("\\")) continue;
                string rest = line.Substring(1);
                int ws = 0;
                while (ws < rest.Length && !char.IsWhiteSpace(rest[ws])) ws++;
                string field = rest.Substring(0, ws);
                if (field.Length == 0) continue;
                string value = rest.Substring(ws).Trim();
                if (field == "Marker")
                {
                    if (!entries.TryGetValue(value, out current))
                    {
                        current = new Dictionary<string, string>(StringComparer.Ordinal);
                        entries[value] = current;
                    }
                }
                else if (current != null)
                {
                    current[field.ToLowerInvariant()] = value;
                }
            }
            return entries;
        }
    }
}
