using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace MarkerSpaces
{
    /// <summary>
    /// Lists every marker spacing problem of a project, one row per problem, and fixes the ticked
    /// ones in the chapters the user may edit.
    /// </summary>
    public sealed class MarkerSpacesForm : Form
    {
        private sealed class Choice
        {
            public readonly string Text;
            public readonly object Value;

            public Choice(string text, object value)
            {
                Text = text;
                Value = value;
            }

            public override string ToString()
            {
                return Text;
            }
        }

        private static readonly Color Red = Color.FromArgb(0x8A, 0x1C, 0x00);

        private readonly IBookSource source;
        private readonly Strings s;
        private ScanOptions options;
        private MarkerSpaceScanner scanner;
        private FixRunner runner;
        private List<SpaceIssue> issues = new List<SpaceIssue>();
        private List<SpaceIssue> shown = new List<SpaceIssue>();
        private readonly Dictionary<SpaceIssue, string[]> previews = new Dictionary<SpaceIssue, string[]>();
        /// <summary>True while the filters are being refilled (no refresh then).</summary>
        private bool filling;

        private readonly Label lblProject = new Label();
        private readonly Label lblIntro = new Label();
        private readonly Label lblStyles = new Label();
        private readonly Button btnOptions = new Button();
        private readonly Button btnBooks = new Button();
        /// <summary>True after "Restore defaults" until the options are saved: the book choice goes back to the default too.</summary>
        private bool booksToDefault;
        private readonly TableLayoutPanel optionsPanel = new TableLayoutPanel();
        private readonly TextBox txtExclude = new TextBox();
        private readonly TextBox txtNoClose = new TextBox();
        private readonly TextBox txtNoCloseInNote = new TextBox();
        private readonly TextBox txtExtraSpacing = new TextBox();
        private readonly TextBox txtNoSpaceBefore = new TextBox();
        private readonly CheckBox chkFootnotePrecedes = new CheckBox();
        private readonly CheckBox chkXrefPrecedes = new CheckBox();
        private readonly Button btnSaveOptions = new Button();
        private readonly Button btnDefaults = new Button();
        private readonly ComboBox cboKind = new ComboBox();
        private readonly ComboBox cboMarker = new ComboBox();
        private readonly CheckBox chkReportOnly = new CheckBox();
        private readonly Label lblWarning = new Label();
        private readonly DataGridView grid = new DataGridView();
        private readonly Label lblCounts = new Label();
        private readonly Button btnTick = new Button();
        private readonly Button btnUntick = new Button();
        private readonly Button btnFix = new Button();
        private readonly Button btnRescan = new Button();
        private readonly Button btnClose = new Button();
        private readonly Label lblResults = new Label();
        private readonly TextBox txtResults = new TextBox();

        public MarkerSpacesForm(IBookSource source, Strings strings)
        {
            this.source = source;
            s = strings;
            options = ScanOptions.Load(ScanOptions.SettingsPath(LocalDirectory));
            BuildLayout();
            ShowOptions(options);
            Shown += delegate { Rescan(); };
        }

        /// <summary>&lt;project&gt;\local\MarkerSpaces, or null when the project folder is unknown.</summary>
        private string LocalDirectory
        {
            get
            {
                string dir = source.ProjectDirectory;
                return dir == null ? null : Path.Combine(Path.Combine(dir, "local"), "MarkerSpaces");
            }
        }

        // ------------------------------------------------------------ layout

        private void BuildLayout()
        {
            Text = s.Title + " " + Strings.ToolVersion + " - " + source.ProjectName;
            Name = "MarkerSpacesForm";
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Segoe UI", 9f);
            ClientSize = new Size(1150, 760);
            MinimumSize = new Size(760, 500);
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;

            var table = new TableLayoutPanel();
            table.Dock = DockStyle.Fill;
            table.Padding = new Padding(10);
            table.ColumnCount = 1;
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            for (int i = 0; i < 11; i++) table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.RowStyles[6] = new RowStyle(SizeType.Percent, 68f);
            table.RowStyles[10] = new RowStyle(SizeType.Percent, 32f);

            lblProject.AutoSize = true;
            lblProject.Font = new Font(Font.FontFamily, 11f, FontStyle.Bold);
            lblProject.Text = string.Format(s.ProjectLabel, source.ProjectName);
            lblProject.Margin = new Padding(3, 0, 3, 4);

            ConfigureWrappingLabel(lblIntro, table);
            lblIntro.Text = s.Intro;

            // Stylesheets used, and the button that shows the options.
            var styleRow = new FlowLayoutPanel();
            styleRow.AutoSize = true;
            styleRow.WrapContents = true;
            styleRow.Margin = new Padding(0, 4, 0, 0);
            lblStyles.AutoSize = true;
            lblStyles.ForeColor = SystemColors.GrayText;
            lblStyles.Name = "Styles";
            lblStyles.Margin = new Padding(3, 6, 12, 0);
            SetupButton(btnOptions, s.OptionsShow, "Options");
            btnOptions.Click += delegate
            {
                optionsPanel.Visible = !optionsPanel.Visible;
                btnOptions.Text = optionsPanel.Visible ? s.OptionsHide : s.OptionsShow;
            };
            SetupButton(btnBooks, string.Format(s.BooksButton, 0, source.Books.Count), "Books");
            btnBooks.Click += delegate { ChooseBooks(); };
            styleRow.Controls.Add(btnBooks);
            styleRow.Controls.Add(btnOptions);
            styleRow.Controls.Add(lblStyles);

            BuildOptionsPanel(table);

            // Filters.
            var filters = new FlowLayoutPanel();
            filters.AutoSize = true;
            filters.WrapContents = true;
            filters.Margin = new Padding(0, 8, 0, 2);
            filters.Controls.Add(FilterLabel(s.FilterKind));
            cboKind.Name = "KindFilter";
            cboKind.DropDownStyle = ComboBoxStyle.DropDownList;
            cboKind.Width = 380;
            cboKind.Margin = new Padding(3, 3, 16, 3);
            cboKind.SelectedIndexChanged += delegate { if (!filling) { FillMarkerFilter(); ApplyFilter(); } };
            filters.Controls.Add(cboKind);
            filters.Controls.Add(FilterLabel(s.FilterMarker));
            cboMarker.Name = "MarkerFilter";
            cboMarker.DropDownStyle = ComboBoxStyle.DropDownList;
            cboMarker.Width = 130;
            cboMarker.Margin = new Padding(3, 3, 16, 3);
            cboMarker.SelectedIndexChanged += delegate { if (!filling) ApplyFilter(); };
            filters.Controls.Add(cboMarker);
            chkReportOnly.AutoSize = true;
            chkReportOnly.Name = "ShowReportOnly";
            chkReportOnly.Text = s.ShowReportOnly;
            chkReportOnly.Margin = new Padding(3, 6, 3, 3);
            chkReportOnly.CheckedChanged += delegate { FillFilters(); ApplyFilter(); };
            filters.Controls.Add(chkReportOnly);

            ConfigureWrappingLabel(lblWarning, table);
            lblWarning.ForeColor = Red;
            lblWarning.Font = new Font(Font, FontStyle.Bold);
            lblWarning.Name = "Warning";
            lblWarning.Visible = false;

            BuildGrid();

            lblCounts.AutoSize = true;
            lblCounts.Name = "Counts";
            lblCounts.Margin = new Padding(3, 4, 3, 2);

            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.WrapContents = false;
            buttons.Margin = new Padding(0, 6, 0, 6);
            SetupButton(btnTick, s.SelectShown, "TickShown");
            SetupButton(btnUntick, s.ClearShown, "UntickShown");
            SetupButton(btnFix, string.Format(s.FixButton, 0), "Fix");
            btnFix.Font = new Font(Font, FontStyle.Bold);
            SetupButton(btnRescan, s.Rescan, "Rescan");
            SetupButton(btnClose, s.Close, "Close");
            buttons.Controls.Add(btnTick);
            buttons.Controls.Add(btnUntick);
            buttons.Controls.Add(btnFix);
            buttons.Controls.Add(btnRescan);
            buttons.Controls.Add(btnClose);
            btnTick.Click += delegate { TickShown(true); };
            btnUntick.Click += delegate { TickShown(false); };
            btnFix.Click += delegate { FixTicked(); };
            btnRescan.Click += delegate { Rescan(); };
            btnClose.Click += delegate { Close(); };
            CancelButton = btnClose;

            ConfigureWrappingLabel(lblResults, table);
            lblResults.Font = new Font(Font, FontStyle.Bold);
            lblResults.Text = s.ResultsLabel;
            lblResults.Margin = new Padding(3, 4, 3, 2);

            txtResults.Multiline = true;
            txtResults.ReadOnly = true;
            txtResults.ScrollBars = ScrollBars.Both;
            txtResults.WordWrap = false;
            txtResults.Dock = DockStyle.Fill;
            txtResults.Name = "Results";
            txtResults.AccessibleName = s.ResultsLabel.Split(':')[0];
            txtResults.BackColor = SystemColors.Window;

            table.Controls.Add(lblProject, 0, 0);
            table.Controls.Add(lblIntro, 0, 1);
            table.Controls.Add(styleRow, 0, 2);
            table.Controls.Add(optionsPanel, 0, 3);
            table.Controls.Add(filters, 0, 4);
            table.Controls.Add(lblWarning, 0, 5);
            table.Controls.Add(grid, 0, 6);
            table.Controls.Add(lblCounts, 0, 7);
            table.Controls.Add(buttons, 0, 8);
            table.Controls.Add(lblResults, 0, 9);
            table.Controls.Add(txtResults, 0, 10);
            Controls.Add(table);
        }

        private static Label FilterLabel(string text)
        {
            var l = new Label();
            l.AutoSize = true;
            l.Text = text;
            l.Margin = new Padding(3, 7, 0, 3);
            return l;
        }

        private void BuildOptionsPanel(TableLayoutPanel table)
        {
            optionsPanel.Name = "OptionsPanel";
            optionsPanel.AutoSize = true;
            optionsPanel.Dock = DockStyle.Top;
            optionsPanel.ColumnCount = 2;
            optionsPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            optionsPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            optionsPanel.BackColor = Color.FromArgb(0xF3, 0xF3, 0xF3);
            optionsPanel.Padding = new Padding(6);
            optionsPanel.Margin = new Padding(3, 4, 3, 2);
            optionsPanel.Visible = false;

            AddOption(s.OptExclude, txtExclude, "OptExclude");
            AddOption(s.OptNoClose, txtNoClose, "OptNoClose");
            AddOption(s.OptNoCloseInNote, txtNoCloseInNote, "OptNoCloseInNote");
            AddOption(s.OptExtraSpacing, txtExtraSpacing, "OptExtraSpacing");
            AddOption(s.OptNoSpaceBefore, txtNoSpaceBefore, "OptNoSpaceBefore");
            foreach (CheckBox c in new[] { chkFootnotePrecedes, chkXrefPrecedes })
            {
                c.AutoSize = true;
                c.Margin = new Padding(3, 4, 3, 0);
                optionsPanel.Controls.Add(c);
                optionsPanel.SetColumnSpan(c, 2);
            }
            chkFootnotePrecedes.Text = s.OptFootnotePrecedes;
            chkFootnotePrecedes.Name = "OptFootnotePrecedes";
            chkXrefPrecedes.Text = s.OptXrefPrecedes;
            chkXrefPrecedes.Name = "OptXrefPrecedes";

            var hint = new Label();
            hint.AutoSize = true;
            hint.ForeColor = SystemColors.GrayText;
            hint.Text = s.OptionsHint;
            hint.Margin = new Padding(3, 6, 3, 2);
            optionsPanel.Controls.Add(hint);
            optionsPanel.SetColumnSpan(hint, 2);

            var row = new FlowLayoutPanel();
            row.AutoSize = true;
            row.Margin = new Padding(0, 4, 0, 0);
            SetupButton(btnSaveOptions, s.SaveRescan, "SaveOptions");
            SetupButton(btnDefaults, s.Defaults, "Defaults");
            btnSaveOptions.Click += delegate { SaveOptionsAndRescan(); };
            btnDefaults.Click += delegate
            {
                ShowOptions(new ScanOptions());
                booksToDefault = true;
            };
            row.Controls.Add(btnSaveOptions);
            row.Controls.Add(btnDefaults);
            optionsPanel.Controls.Add(row);
            optionsPanel.SetColumnSpan(row, 2);
        }

        private void AddOption(string label, TextBox box, string name)
        {
            var l = new Label();
            l.AutoSize = true;
            l.Text = label;
            l.Margin = new Padding(3, 6, 8, 2);
            box.Name = name;
            box.AccessibleName = label;
            box.Dock = DockStyle.Fill;
            box.Margin = new Padding(3, 3, 3, 2);
            optionsPanel.Controls.Add(l);
            optionsPanel.Controls.Add(box);
        }

        private static void ConfigureWrappingLabel(Label label, TableLayoutPanel table)
        {
            label.AutoSize = true;
            label.Margin = new Padding(3, 2, 3, 2);
            label.MaximumSize = new Size(1100, 0);
            table.SizeChanged += delegate { label.MaximumSize = new Size(Math.Max(200, table.ClientSize.Width - 30), 0); };
        }

        private static void SetupButton(Button b, string text, string name)
        {
            b.Text = text;
            b.Name = name;
            b.AutoSize = true;
            b.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            b.Padding = new Padding(8, 2, 8, 2);
            b.Margin = new Padding(0, 0, 8, 0);
        }

        private void BuildGrid()
        {
            grid.Name = "Problems";
            grid.Dock = DockStyle.Fill;
            grid.VirtualMode = true;
            grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false;
            grid.AllowUserToResizeRows = false;
            grid.RowHeadersVisible = false;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.MultiSelect = false;
            grid.BackgroundColor = SystemColors.Window;
            grid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize;

            var check = new DataGridViewCheckBoxColumn();
            check.Name = "Fix";
            check.HeaderText = s.ColFix;
            check.Width = 60;
            check.SortMode = DataGridViewColumnSortMode.NotSortable;
            grid.Columns.Add(check);
            AddTextColumn("Reference", s.ColRef, 95);
            AddTextColumn("Problem", s.ColProblem, 290);
            AddTextColumn("Now", s.ColCurrent, 300);
            AddTextColumn("After", s.ColAfter, 300);
            AddTextColumn("Permission", s.ColCannot, 95);
            grid.Columns["After"].AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            grid.Columns["Permission"].DefaultCellStyle.ForeColor = Red;

            grid.CellValueNeeded += OnCellValueNeeded;
            grid.CellValuePushed += OnCellValuePushed;
            grid.CellFormatting += OnCellFormatting;
            // A problem that must be fixed by hand, or is in a chapter the user may not edit, cannot be ticked.
            grid.CellBeginEdit += delegate(object sender, DataGridViewCellCancelEventArgs e)
            {
                if (e.RowIndex >= 0 && e.RowIndex < shown.Count && !CanTick(shown[e.RowIndex])) e.Cancel = true;
            };
            // Commit a tick at once, so the counts and the Fix button follow it.
            grid.CurrentCellDirtyStateChanged += delegate
            {
                if (grid.IsCurrentCellDirty) grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
            };
            grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex < 0 || e.RowIndex >= shown.Count || grid.Columns[e.ColumnIndex].Name == "Fix") return;
                SpaceIssue issue = shown[e.RowIndex];
                try { source.GoTo(issue.Book.Number, issue.Chapter, issue.VerseNumber); }
                catch (Exception) { }
            };
            grid.DataError += delegate(object sender, DataGridViewDataErrorEventArgs e) { e.ThrowException = false; };
        }

        private void AddTextColumn(string name, string header, int width)
        {
            var col = new DataGridViewTextBoxColumn();
            col.Name = name;
            col.HeaderText = header;
            col.Width = width;
            col.ReadOnly = true;
            col.SortMode = DataGridViewColumnSortMode.NotSortable;
            grid.Columns.Add(col);
        }

        private bool CanTick(SpaceIssue issue)
        {
            return issue.CanFix && runner != null && runner.CanEdit(issue.Book.Number, issue.Chapter);
        }

        private string[] PreviewOf(SpaceIssue issue)
        {
            string[] p;
            if (!previews.TryGetValue(issue, out p))
            {
                string now, after;
                ProjectScan.Preview(issue, out now, out after);
                p = new[] { now, after };
                previews[issue] = p;
            }
            return p;
        }

        private void OnCellValueNeeded(object sender, DataGridViewCellValueEventArgs e)
        {
            if (e.RowIndex < 0 || e.RowIndex >= shown.Count) return;
            SpaceIssue issue = shown[e.RowIndex];
            switch (grid.Columns[e.ColumnIndex].Name)
            {
                case "Fix": e.Value = issue.Selected; break;
                case "Reference": e.Value = issue.Reference; break;
                case "Problem": e.Value = s.Message(issue); break;
                case "Now": e.Value = PreviewOf(issue)[0]; break;
                case "After": e.Value = issue.CanFix ? PreviewOf(issue)[1] : s.ByHand; break;
                case "Permission":
                    e.Value = issue.CanFix && !runner.CanEdit(issue.Book.Number, issue.Chapter) ? s.CannotEdit : "";
                    break;
            }
        }

        private void OnCellValuePushed(object sender, DataGridViewCellValueEventArgs e)
        {
            if (e.RowIndex < 0 || e.RowIndex >= shown.Count || grid.Columns[e.ColumnIndex].Name != "Fix") return;
            SpaceIssue issue = shown[e.RowIndex];
            issue.Selected = CanTick(issue) && e.Value is bool && (bool)e.Value;
            UpdateCounts();
        }

        private void OnCellFormatting(object sender, DataGridViewCellFormattingEventArgs e)
        {
            if (e.RowIndex < 0 || e.RowIndex >= shown.Count) return;
            SpaceIssue issue = shown[e.RowIndex];
            if (!CanTick(issue) && grid.Columns[e.ColumnIndex].Name != "Permission")
                e.CellStyle.ForeColor = SystemColors.GrayText;
        }

        // ------------------------------------------------------------ options

        private void ShowOptions(ScanOptions o)
        {
            txtExclude.Text = o.ExcludeMarkers;
            txtNoClose.Text = o.NoCloseMarkers;
            txtNoCloseInNote.Text = o.NoCloseInNoteMarkers;
            txtExtraSpacing.Text = o.ExtraSpacingMarkers;
            txtNoSpaceBefore.Text = o.NoSpaceBeforeMarkers;
            chkFootnotePrecedes.Checked = o.FootnotePrecedesText;
            chkXrefPrecedes.Checked = o.CrossReferencesPrecedeText;
        }

        private ScanOptions ReadOptions()
        {
            var o = new ScanOptions();
            o.ExcludeMarkers = txtExclude.Text.Trim();
            o.NoCloseMarkers = txtNoClose.Text.Trim();
            o.NoCloseInNoteMarkers = txtNoCloseInNote.Text.Trim();
            o.ExtraSpacingMarkers = txtExtraSpacing.Text.Trim();
            o.NoSpaceBeforeMarkers = txtNoSpaceBefore.Text.Trim();
            o.FootnotePrecedesText = chkFootnotePrecedes.Checked;
            o.CrossReferencesPrecedeText = chkXrefPrecedes.Checked;
            o.ExcludedBooks = booksToDefault ? null : options.ExcludedBooks;
            return o;
        }

        private void SaveOptionsAndRescan()
        {
            options = ReadOptions();
            booksToDefault = false;
            SaveOptions();
            Rescan();
        }

        /// <summary>The book chooser; OK saves the choice for the project and scans again.</summary>
        private void ChooseBooks()
        {
            using (var dialog = new BookChooserForm(source.Books, options.IsExcluded, s))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                options.ExcludedBooks = dialog.ExcludedBooks;
            }
            SaveOptions();
            Rescan();
        }

        private void SaveOptions()
        {
            string path = ScanOptions.SettingsPath(LocalDirectory);
            if (path != null)
            {
                try { options.Save(path); }
                catch (Exception ex)
                {
                    MessageBox.Show(this, string.Format(s.SettingsNotSaved, ex.Message), s.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }

        // ------------------------------------------------------------ scanning and filters

        private static string Key(SpaceIssue i)
        {
            return i.Book.Number + ":" + i.Chapter + ":" + i.Start + ":" + (int)i.Kind + ":" + i.Marker;
        }

        private void Rescan()
        {
            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            lblCounts.Text = string.Format(s.Scanning, source.ProjectName);
            lblCounts.Refresh();
            try
            {
                // Ticks survive a rescan for problems still in the same place.
                var ticked = new HashSet<string>(issues.Where(i => i.Selected).Select(Key));
                StyleSheets sty = StyleSheets.Load(source.ProjectDirectory);
                lblStyles.Text = string.Format(s.StyleInfo,
                    sty.UsedBuiltIn ? s.BuiltIn : sty.UsfmPath ?? s.NotFound, sty.UsfmCount,
                    sty.CustomCount > 0 ? sty.CustomPath : s.NotPresent, sty.CustomCount);
                scanner = new MarkerSpaceScanner(options, sty);
                runner = new FixRunner(source, scanner);
                runner.NotSavedText = s.NotSaved;
                issues = ProjectScan.Scan(source, scanner, b => !options.IsExcluded(b));
                btnBooks.Text = string.Format(s.BooksButton, source.Books.Count(b => !options.IsExcluded(b)), source.Books.Count);
                previews.Clear();
                foreach (SpaceIssue i in issues)
                    i.Selected = ticked.Contains(Key(i)) && CanTick(i);
                FillFilters();
                ApplyFilter();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, string.Format(s.Error, ex.Message), s.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                Cursor.Current = old;
                UpdateCounts();
            }
        }

        private IEnumerable<SpaceIssue> Eligible
        {
            get { return issues.Where(i => i.CanFix || chkReportOnly.Checked); }
        }

        /// <summary>The problem kinds found (with counts), keeping the current choice when it is still there.</summary>
        private void FillFilters()
        {
            filling = true;
            object kind = cboKind.SelectedItem is Choice ? ((Choice)cboKind.SelectedItem).Value : null;
            cboKind.Items.Clear();
            cboKind.Items.Add(new Choice(s.All, null));
            foreach (var g in Eligible.GroupBy(i => i.Kind).OrderBy(g => g.Key))
                cboKind.Items.Add(new Choice(s.KindName(g.Key) + " (" + g.Count() + ")", g.Key));
            cboKind.SelectedIndex = 0;
            for (int i = 1; i < cboKind.Items.Count; i++)
                if (kind != null && kind.Equals(((Choice)cboKind.Items[i]).Value)) cboKind.SelectedIndex = i;
            filling = false;
            FillMarkerFilter();
        }

        private void FillMarkerFilter()
        {
            filling = true;
            object marker = cboMarker.SelectedItem is Choice ? ((Choice)cboMarker.SelectedItem).Value : null;
            cboMarker.Items.Clear();
            cboMarker.Items.Add(new Choice(s.All, null));
            foreach (var g in ByKind(Eligible).GroupBy(i => i.Marker).OrderBy(g => g.Key, StringComparer.Ordinal))
                cboMarker.Items.Add(new Choice("\\" + g.Key + " (" + g.Count() + ")", g.Key));
            cboMarker.SelectedIndex = 0;
            for (int i = 1; i < cboMarker.Items.Count; i++)
                if (marker != null && marker.Equals(((Choice)cboMarker.Items[i]).Value)) cboMarker.SelectedIndex = i;
            filling = false;
        }

        private IEnumerable<SpaceIssue> ByKind(IEnumerable<SpaceIssue> list)
        {
            var c = cboKind.SelectedItem as Choice;
            if (c == null || c.Value == null) return list;
            var kind = (IssueKind)c.Value;
            return list.Where(i => i.Kind == kind);
        }

        private void ApplyFilter()
        {
            var m = cboMarker.SelectedItem as Choice;
            IEnumerable<SpaceIssue> list = ByKind(Eligible);
            if (m != null && m.Value != null)
            {
                string marker = (string)m.Value;
                list = list.Where(i => i.Marker == marker);
            }
            grid.EndEdit();
            shown = list.ToList();
            grid.RowCount = 0;
            grid.RowCount = shown.Count;
            grid.Invalidate();
            UpdateWarning();
            UpdateCounts();
        }

        private void UpdateWarning()
        {
            bool anyBlocked = issues.Any(i => i.CanFix && !runner.CanEdit(i.Book.Number, i.Chapter));
            if (issues.Count == 0)
                ShowWarning(s.NoProblems, SystemColors.ControlText);
            else if (anyBlocked && !issues.Any(CanTick) && runner.NoPermissionAtAll())
                ShowWarning(string.Format(s.NoPermissionProject, source.ProjectName), null);
            else if (anyBlocked)
                ShowWarning(s.SomeNotEditable, null);
            else
                lblWarning.Visible = false;
        }

        private void ShowWarning(string text, Color? color)
        {
            lblWarning.Text = text;
            lblWarning.ForeColor = color.HasValue ? color.Value : Red;
            lblWarning.Visible = true;
        }

        private void UpdateCounts()
        {
            int ticked = issues.Count(i => i.Selected);
            lblCounts.Text = string.Format(s.Counts, shown.Count, shown.Count(CanTick), ticked);
            btnFix.Text = string.Format(s.FixButton, ticked);
            btnFix.Enabled = ticked > 0;
            bool anyTickable = shown.Any(CanTick);
            btnTick.Enabled = btnUntick.Enabled = anyTickable;
        }

        private void TickShown(bool value)
        {
            grid.EndEdit();
            foreach (SpaceIssue i in shown)
                i.Selected = value && CanTick(i);
            grid.Invalidate();
            UpdateCounts();
        }

        // ------------------------------------------------------------ fixing

        private void FixTicked()
        {
            grid.EndEdit();
            List<SpaceIssue> chosen = issues.Where(i => i.Selected && CanTick(i)).ToList();
            if (chosen.Count == 0)
            {
                MessageBox.Show(this, s.NothingSelected, s.Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string question = string.Format(s.Confirm, chosen.Count, runner.BooksToChange(chosen), source.BackupDirectory);
            if (MessageBox.Show(this, question, s.ConfirmTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return;

            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            FixReport report;
            try
            {
                report = runner.Run(chosen, string.Format(s.HistoryMessage, chosen.Count));
            }
            catch (Exception ex)
            {
                Cursor.Current = old;
                MessageBox.Show(this, string.Format(s.Error, ex.Message), s.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Cursor.Current = old;
            if (report.Stopped)
            {
                // No history point, so nothing was changed: say so and leave the list as it is.
                string stopped = string.Format(s.HistoryStopped, report.HistoryError);
                txtResults.Text = stopped.Replace("\r\n", "\n").Replace("\n", "\r\n");
                MessageBox.Show(this, stopped, s.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            txtResults.Text = FormatReport(report);
            Rescan();
        }

        private string FormatReport(FixReport report)
        {
            var sb = new StringBuilder();
            foreach (var kv in report.Fixed)
                sb.AppendLine(string.Format(s.ResFixed, kv.Key, kv.Value));
            if (report.Fixed.Count > 0)
                sb.AppendLine(string.Format(s.ResTotal, report.Total, report.BooksChanged));
            else
                sb.AppendLine(s.ResNothing);
            if (report.NoPermission.Count > 0)
                sb.AppendLine(string.Format(s.ResNoPermission, string.Join(", ", report.NoPermission.ToArray())));
            if (report.Busy.Count > 0)
                sb.AppendLine(string.Format(s.ResBusy, string.Join(", ", report.Busy.ToArray())));
            if (report.Changed.Count > 0)
                sb.AppendLine(string.Format(s.ResChanged, string.Join(", ", report.Changed.ToArray())));
            foreach (string f in report.Failed)
                sb.AppendLine(string.Format(s.ResFailed, f));
            if (report.Backups.Count > 0)
                sb.AppendLine(string.Format(s.ResBackups, source.BackupDirectory));
            return sb.ToString().Replace("\r\n", "\n").Replace("\n", "\r\n");
        }
    }
}
