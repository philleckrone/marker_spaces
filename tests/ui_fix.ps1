<#
.SYNOPSIS
  Drives the Marker Spaces window (in the test host, on copies of tests\fixtures\fixproject)
  with UI Automation, using pretend edit rights:
    1. Only MAT 2 editable: the warning is shown, "Tick all shown" ticks only the 3 problems in
       chapter 2, Fix + Yes changes chapter 2 only and lists MAT 1 as not permitted.
    2. All editable: the Problem filter shows only "Space before a closing marker"; ticking one
       row and fixing changes only that verse; "Also show problems that must be fixed by hand"
       adds the 3 by-hand rows; double-clicking a row asks Paratext to go to its verse.
    3. Options: excluding \nd and saving rescans without the \nd problems and writes
       local\MarkerSpaces\settings.xml.
    4. The history point is refused (MS_NOHISTORY=1): Fix stops with the history message and
       no file changes.
    5. Books (on a copy of TestProject\PDT15): by default the non-Bible books (CNC, XXA...) are
       not examined; choosing None + New Testament in the book chooser examines only the NT, is
       saved in settings.xml and is kept when the window is opened again.
  Saves screenshots (English on a copy of TestProject\PDT15, Spanish and French on the fixture)
  next to the temp copies. Exit code 0 = all passed.
#>
param([string]$ExePath = '')
$ErrorActionPreference = 'Stop'
if (-not $ExePath) { $ExePath = Join-Path $PSScriptRoot 'TestHost\bin\Release\MarkerSpacesTestHost.exe' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

$repo = Split-Path (Split-Path $PSScriptRoot)
$fixture = Join-Path $PSScriptRoot 'fixtures\fixproject'
$tmp = Join-Path $env:TEMP ('marker_spaces_ui_' + [guid]::NewGuid().ToString('N'))
$failures = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $script:failures++ }
}
function NewProject([string]$name) {
    $dir = Join-Path $tmp $name
    New-Item -ItemType Directory -Force $dir | Out-Null
    Copy-Item (Join-Path $fixture '*.SFM') $dir
    return $dir
}
function FileText([string]$dir) { return [IO.File]::ReadAllText((Join-Path $dir '41MATTEST.SFM'), [Text.Encoding]::UTF8) }
function FindByName($root, [string]$name, $type) {
    $c1 = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $name)
    $c2 = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)
    return $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition($c1, $c2)))
}
function FindById($root, [string]$id) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $id)
    return $root.FindFirst($TS::Descendants, $c)
}
Add-Type -Namespace MS -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, int msg, System.IntPtr w, System.IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int SendMessage(System.IntPtr h, int msg, int w, System.Text.StringBuilder l);
[DllImport("user32.dll")] public static extern int SendMessage(System.IntPtr h, int msg, int w, int l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, System.IntPtr extra);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetParent(System.IntPtr h);
[DllImport("user32.dll")] public static extern int GetDlgCtrlID(System.IntPtr h);
'@ -ErrorAction SilentlyContinue
function ElementByName($win, [string]$name) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $name)
    return $win.FindFirst($TS::Descendants, $c)
}
# WinForms buttons and check boxes: click them with BM_CLICK.
function ClickByName($win, [string]$name) {
    $el = ElementByName $win $name
    if (-not $el) { throw "no control named $name" }
    [MS.U]::PostMessage([IntPtr]$el.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 600
}
# WinForms gives UI Automation window handles, not control names, as ids: controls are found by their text.
function Counts($win) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)
    foreach ($e in $win.FindAll($TS::Descendants, $c)) {
        if ($e.Current.Name -match 'problem\(s\) shown|problema\(s\) mostrado|^Scanning|^Revisando') { return $e.Current.Name }
    }
    return ''
}
function FixButton($win) {
    foreach ($e in $win.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($e.Current.Name -match '^(Fix ticked problems|Corregir los problemas marcados|Corriger les probl.mes coch.s) \(') { return $e }
    }
    return $null
}
function ClickButton($win, [string]$name) {
    $el = FindByName $win $name $CT::Pane
    if (-not $el) { $el = FindByName $win $name $CT::Button }
    if (-not $el) { throw "no button $name" }
    [MS.U]::PostMessage([IntPtr]$el.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 800
}
function TextStartingWith($win, [string]$prefix) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)
    foreach ($e in $win.FindAll($TS::Descendants, $c)) { if ($e.Current.Name.StartsWith($prefix)) { return $e.Current.Name } }
    return ''
}
function CellValue($win, [string]$name) {
    $el = ElementByName $win $name
    if (-not $el) { return $null }
    return $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
}
function SetValue($el, [string]$value) {
    $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($value)
    Start-Sleep -Milliseconds 400
}
# Picks the drop-down item that starts with the given text. WinForms does not expose the items
# to UI Automation: select it with CB_FINDSTRING/CB_SETCURSEL and tell the form with CBN_SELCHANGE.
function ChooseItem($win, [string]$comboName, [string]$prefix) {
    $combo = FindByName $win $comboName $CT::ComboBox
    $h = [IntPtr]$combo.Current.NativeWindowHandle
    $index = [MS.U]::SendMessage($h, 0x014C, -1, [Text.StringBuilder]$prefix)
    if ($index -lt 0) { throw "no item $prefix in $comboName" }
    [MS.U]::SendMessage($h, 0x014E, $index, 0) | Out-Null
    $id = [MS.U]::GetDlgCtrlID($h)
    [MS.U]::SendMessage([MS.U]::GetParent($h), 0x0111, ((1 -shl 16) -bor ($id -band 0xFFFF)), $h.ToInt32()) | Out-Null
    Start-Sleep -Milliseconds 600
}
# A real mouse click (or double-click) in the middle of an element.
function MouseClick($win, $el, [int]$times) {
    [MS.U]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
    $r = $el.Current.BoundingRectangle
    [MS.U]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
    for ($i = 0; $i -lt $times; $i++) {
        [MS.U]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); [MS.U]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 60
    }
    Start-Sleep -Milliseconds 600
}
function ElementByPrefix($win, [string]$prefix) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Pane)
    foreach ($e in $win.FindAll($TS::Descendants, $c)) { if ($e.Current.Name.StartsWith($prefix)) { return $e } }
    return $null
}
function RowCount($win) {
    $n = 0
    while (ElementByName $win ('Reference Row ' + $n)) { $n++ }
    return $n
}
# The results box: the only multi-line WinForms EDIT control shown (an unnamed pane to UI Automation).
function ResultsText($win) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Pane)
    foreach ($e in $win.FindAll($TS::Descendants, $c)) {
        $h = [IntPtr]$e.Current.NativeWindowHandle
        if ($h -eq [IntPtr]::Zero) { continue }
        $cls = New-Object System.Text.StringBuilder 256
        [MS.U]::GetClassName($h, $cls, 256) | Out-Null
        if ($cls.ToString() -notmatch 'EDIT') { continue }
        $len = [MS.U]::SendMessage($h, 0x000E, 0, 0)
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [MS.U]::SendMessage($h, 0x000D, $len + 1, $sb) | Out-Null
        return $sb.ToString()
    }
    return ''
}
# The EDIT controls shown, in window order (with the options shown: the 5 option boxes, then the results).
function EditBoxes($win) {
    $list = @()
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Pane)
    foreach ($e in $win.FindAll($TS::Descendants, $c)) {
        $h = [IntPtr]$e.Current.NativeWindowHandle
        if ($h -eq [IntPtr]::Zero) { continue }
        $cls = New-Object System.Text.StringBuilder 256
        [MS.U]::GetClassName($h, $cls, 256) | Out-Null
        if ($cls.ToString() -match 'EDIT') { $list += $h }
    }
    return ,$list
}
function GetText([IntPtr]$h) {
    $len = [MS.U]::SendMessage($h, 0x000E, 0, 0)
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [MS.U]::SendMessage($h, 0x000D, $len + 1, $sb) | Out-Null
    return $sb.ToString()
}
function SetText([IntPtr]$h, [string]$text) {
    [MS.U]::SendMessage($h, 0x000C, 0, [Text.StringBuilder]$text) | Out-Null
    Start-Sleep -Milliseconds 300
}
function StartHost([string]$dir, [string]$spec, [string]$lang, [switch]$Big) {
    $bak = Join-Path $dir 'backups'
    $hostArgs = '"form" "' + $dir + '" "' + $spec + '" "' + $lang + '" "' + $bak + '"'
    $p = Start-Process -FilePath $ExePath -ArgumentList $hostArgs -PassThru -RedirectStandardOutput (Join-Path $dir 'stdout.txt')
    $win = $null
    for ($i = 0; $i -lt 60 -and -not $win; $i++) {
        Start-Sleep -Milliseconds 500; $p.Refresh()
        # The main window handle can first be a passing helper window: wait for the form's title.
        if ($p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -match '^(Marker Spaces|Espacios de marcadores|Espaces autour des marqueurs) ') {
            $win = $AE::FromHandle($p.MainWindowHandle)
        }
    }
    if (-not $win) { throw 'window did not appear' }
    # With tens of thousands of rows, UI Automation searches time out: wait for the scan (run
    # on the UI thread when the window is shown) by waiting until the window is idle.
    if ($Big) { $p.WaitForInputIdle(300000) | Out-Null; Start-Sleep -Milliseconds 1500; return @($p, $win) }
    # The scan runs when the window is shown; the counts line reads "Scanning ..." until it is done.
    for ($i = 0; $i -lt 240; $i++) {
        Start-Sleep -Milliseconds 500
        $n = Counts $win
        if ($n -and -not $n.StartsWith('Scanning') -and -not $n.StartsWith('Revisando')) { break }
    }
    Start-Sleep -Milliseconds 500
    return @($p, $win)
}
function WaitWindow($win, [string]$title) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300
        $w = FindByName $AE::RootElement $title $CT::Window
        if (-not $w) { $w = FindByName $win $title $CT::Window }
        if ($w) { return $w }
    }
    return $null
}
function ConfirmFix($win, [string]$title) {
    [MS.U]::PostMessage([IntPtr](FixButton $win).Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $confirm = WaitWindow $win $title
    Check ($confirm -ne $null) 'confirmation shown'
    ClickByName $confirm 'Yes'
    $results = ''
    for ($i = 0; $i -lt 40 -and -not $results; $i++) { Start-Sleep -Milliseconds 500; $results = ResultsText $win }
    Start-Sleep -Milliseconds 800
    return $results
}
function Screenshot($win, [string]$path) {
    $r = $win.Current.BoundingRectangle
    $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
    $bmp.Save($path)
    $g.Dispose(); $bmp.Dispose()
}
function Stop($p) { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit() } }

try {
    # 1. Only chapter 2 editable.
    $dir = NewProject 'partial'
    $before = FileText $dir
    $p, $win = StartHost $dir 'MAT:2' 'en'
    Check ($win.Current.Name -eq 'Marker Spaces 1.2 - partial') ('title: ' + $win.Current.Name)
    Check ((TextStartingWith $win 'Some problems are in chapters you cannot edit') -ne '') 'partial: warning shown'
    Check ((FindByName $win 'Books: 1 of 1...' $CT::Pane) -ne $null) 'partial: Books button shows 1 of 1'
    Check ((Counts $win) -eq '17 problem(s) shown, 3 can be fixed, 0 ticked in all.') ('partial: counts ' + (Counts $win))
    Check ((CellValue $win 'Permission Row 0') -eq 'cannot edit') 'partial: row 0 marked cannot edit'
    Check (-not (FixButton $win).Current.IsEnabled) 'partial: Fix disabled before ticking'
    ClickButton $win 'Tick all shown'
    Check ((FixButton $win).Current.Name -eq 'Fix ticked problems (3)') ('partial: ' + (FixButton $win).Current.Name)
    $results = ConfirmFix $win 'Fix marker spaces'
    Write-Host $results
    Check ($results -match 'Fixed: 3 problem\(s\) in 1 book\(s\)') 'partial: 3 fixed'
    $after = FileText $dir
    Check ($after.Substring(0, $after.IndexOf('\c 2')) -eq $before.Substring(0, $before.IndexOf('\c 2'))) 'partial: chapter 1 unchanged'
    Check ($after.Contains("\v 1 El \nd Se" + [char]0xF1 + "or\nd* dijo.`n\v 2 \it palabra\it*.")) 'partial: chapter 2 fixed'
    Check ((Counts $win) -eq '14 problem(s) shown, 0 can be fixed, 0 ticked in all.') ('partial: after rescan ' + (Counts $win))
    Check (@(Get-ChildItem (Join-Path $dir 'backups') -Filter 'Backup_MAT_*.bak').Count -eq 1) 'partial: one .bak backup'
    Stop $p

    # 2. All editable: filter, tick one row, by-hand rows, go to verse.
    $dir = NewProject 'filter'
    $p, $win = StartHost $dir 'ALL' 'en'
    Check ((Counts $win) -eq '17 problem(s) shown, 17 can be fixed, 0 ticked in all.') ('filter: counts ' + (Counts $win))
    ChooseItem $win 'Problem:' 'Space before a closing marker'
    Check ((RowCount $win) -eq 5) ('filter: 5 "space before a closing marker" rows, got ' + (RowCount $win))
    Check ((CellValue $win 'Problem Row 0') -eq 'Unwanted space before \nd*') 'filter: row 0 message'
    Check ((CellValue $win 'Reference Row 0') -eq 'MAT 1:1') 'filter: row 0 is MAT 1:1'
    Check ((CellValue $win 'After fix Row 0').Contains('Se' + [char]0xF1 + 'or\nd*' + [char]0xB7 + 'dijo')) ('filter: preview ' + (CellValue $win 'After fix Row 0'))
    # A real click on the check box; Windows may refuse the focus to a test window, so try again.
    for ($try = 0; $try -lt 4 -and (FixButton $win).Current.Name -ne 'Fix ticked problems (1)'; $try++) {
        MouseClick $win (ElementByName $win 'Fix Row 0') 1
    }
    Check ((FixButton $win).Current.Name -eq 'Fix ticked problems (1)') ('filter: ' + (FixButton $win).Current.Name)
    ChooseItem $win 'Marker:' '\nd'
    Check ((RowCount $win) -eq 5) 'filter: marker filter \nd keeps 5 rows'
    ClickButton $win 'Also show problems that must be fixed by hand (unclosed or unexpected closing markers)'
    ChooseItem $win 'Problem:' '(all)'
    ChooseItem $win 'Marker:' '(all)'
    Check ((Counts $win) -eq '20 problem(s) shown, 17 can be fixed, 1 ticked in all.') ('filter: by-hand rows shown ' + (Counts $win))
    $byHand = $false
    for ($i = 0; $i -lt (RowCount $win); $i++) { if ((CellValue $win ('After fix Row ' + $i)) -eq '(fix by hand)') { $byHand = $true } }
    Check $byHand 'filter: a by-hand row says (fix by hand)'
    MouseClick $win (ElementByName $win 'Reference Row 5') 2
    MouseClick $win (ElementByName $win 'Reference Row 5') 2
    $results = ConfirmFix $win 'Fix marker spaces'
    Check ($results -match 'Fixed: 1 problem\(s\) in 1 book\(s\)') 'filter: 1 fixed'
    $after = FileText $dir
    Check ($after.Contains("\v 1 El \nd Se" + [char]0xF1 + "or\nd* dijo.`n\v 2 El \nd Dios \nd* dijo.")) 'filter: only MAT 1:1 changed'
    ClickButton $win 'Close'
    Start-Sleep -Milliseconds 1000
    $out = Get-Content (Join-Path $dir 'stdout.txt') -Raw
    Check ($out -match 'GOTO MAT 1:4') ('filter: double-click went to the verse: ' + $out.Trim())
    Stop $p

    # 3. Options: exclude \nd, save, rescan.
    $dir = NewProject 'options'
    $p, $win = StartHost $dir 'ALL' 'en'
    ClickButton $win 'Options...'
    $boxes = EditBoxes $win
    Check ($boxes.Count -eq 6) ('options: 5 option boxes and the results box, got ' + $boxes.Count)
    Check ((GetText $boxes[1]) -eq 'v fk fp fq fqa ft fr xk xo xq') 'options: default NoCloseMarkers shown'
    SetText $boxes[0] 'nd'
    ClickButton $win 'Save options and scan again'
    Start-Sleep -Milliseconds 1000
    Check ((Counts $win) -eq '7 problem(s) shown, 7 can be fixed, 0 ticked in all.') ('options: \nd excluded ' + (Counts $win))
    $settings = Join-Path $dir 'local\MarkerSpaces\settings.xml'
    Check ((Test-Path $settings) -and ((Get-Content $settings -Raw) -match '<ExcludeMarkers>nd</ExcludeMarkers>')) 'options: settings.xml saved'
    Stop $p
    $p, $win = StartHost $dir 'ALL' 'en'
    Check ((Counts $win) -eq '7 problem(s) shown, 7 can be fixed, 0 ticked in all.') 'options: kept when reopened'
    Stop $p

    # 4. The history point is refused: nothing may change.
    $dir = NewProject 'nohistory'
    $before = FileText $dir
    $env:MS_NOHISTORY = '1'
    try { $p, $win = StartHost $dir 'ALL' 'en' } finally { Remove-Item Env:MS_NOHISTORY }
    ClickButton $win 'Tick all shown'
    [MS.U]::PostMessage([IntPtr](FixButton $win).Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $confirm = WaitWindow $win 'Fix marker spaces'
    ClickByName $confirm 'Yes'
    $stopBox = WaitWindow $win 'Marker Spaces'
    Check ($stopBox -ne $null) 'nohistory: message shown'
    if ($stopBox) { ClickByName $stopBox 'OK' }
    Start-Sleep -Milliseconds 500
    Check ((ResultsText $win) -match 'Could not add a point to the project history, so nothing was changed') 'nohistory: results say nothing was changed'
    Check ((FileText $dir) -eq $before) 'nohistory: file unchanged'
    Check (-not (Test-Path (Join-Path $dir 'backups'))) 'nohistory: no backups made'
    Stop $p

    # 5. Choosing the books, on a copy of PDT15.
    $dir = Join-Path $tmp 'PDT15'
    New-Item -ItemType Directory -Force $dir | Out-Null
    Get-ChildItem (Join-Path $repo 'TestProject\PDT15') -Filter '*PDT15.SFM' | Copy-Item -Destination $dir
    $p, $win = StartHost $dir 'ALL' 'en'
    $books = ElementByPrefix $win 'Books: '
    Check ($books.Current.Name -match '^Books: (\d+) of (\d+)\.\.\.$' -and [int]$Matches[1] -lt [int]$Matches[2]) ('books: non-Bible books left out by default: ' + $books.Current.Name)
    $defaultCounts = Counts $win
    Check ($defaultCounts -match '^(\d+) problem' -and [int]$Matches[1] -lt 1000) ('books: no concordance rows by default: ' + $defaultCounts)
    [MS.U]::PostMessage([IntPtr]$books.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $chooser = WaitWindow $win 'Books to examine'
    Check ($chooser -ne $null) 'books: chooser shown'
    ClickButton $chooser 'None'
    ClickButton $chooser 'New Testament'
    ClickButton $chooser 'OK'
    Start-Sleep -Milliseconds 1500
    $books = ElementByPrefix $win 'Books: '
    Check ($books.Current.Name -match '^Books: 27 of ') ('books: only the NT chosen: ' + $books.Current.Name)
    $nt = $true
    for ($i = 0; $i -lt (RowCount $win); $i++) {
        $book = (CellValue $win ('Reference Row ' + $i)).Substring(0, 3)
        if (@('MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV') -notcontains $book) { $nt = $false }
    }
    Check $nt ('books: only NT rows (' + (Counts $win) + ')')
    $settings = Get-Content (Join-Path $dir 'local\MarkerSpaces\settings.xml') -Raw
    Check ($settings -match '<ExcludedBooks>GEN EXO ' -and $settings -notmatch 'ExcludedBooks>[^<]*MAT') 'books: choice saved in settings.xml'
    Stop $p
    $p, $win = StartHost $dir 'ALL' 'en'
    Check ((ElementByPrefix $win 'Books: ').Current.Name -match '^Books: 27 of ') 'books: choice kept when reopened'
    Stop $p
    Remove-Item (Join-Path $dir 'local') -Recurse -Force

    # Screenshots: English on the copy of PDT15, Spanish and French on the fixture.
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p, $win = StartHost $dir 'ALL' 'en' -Big
    Write-Host ('PDT15 opened and scanned in ' + [int]$sw.Elapsed.TotalSeconds + ' s')
    ChooseItem $win 'Problem:' 'Space before a closing marker'
    $p.WaitForInputIdle(60000) | Out-Null
    Screenshot $win (Join-Path $tmp 'window_en.png')
    Stop $p
    $dir = NewProject 'es'
    $p, $win = StartHost $dir 'MAT:2' 'es'
    Check ((FixButton $win).Current.Name -eq 'Corregir los problemas marcados (0)') 'es: Spanish button text'
    Check ((FindByName $win 'Libros: 1 de 1...' $CT::Pane) -ne $null) 'es: Spanish Books button'
    Check ((CellValue $win 'Problema Row 0') -eq 'Espacio no deseado antes de \nd*') ('es: Spanish message ' + (CellValue $win 'Problema Row 0'))
    Screenshot $win (Join-Path $tmp 'window_es.png')
    Stop $p
    $dir = NewProject 'fr'
    $p, $win = StartHost $dir 'MAT:2' 'fr'
    Check ((FixButton $win).Current.Name -eq ('Corriger les probl' + [char]0x00E8 + 'mes coch' + [char]0x00E9 + 's (0)')) 'fr: French button text'
    Check ((FindByName $win 'Livres : 1 sur 1...' $CT::Pane) -ne $null) 'fr: French Books button'
    $frCell = 'Probl' + [char]0x00E8 + 'me Row 0'
    Check ((CellValue $win $frCell) -eq 'Espace superflue avant \nd*') ('fr: French message ' + (CellValue $win $frCell))
    Screenshot $win (Join-Path $tmp 'window_fr.png')
    Stop $p
}
finally {
    Write-Host "Files and screenshots: $tmp"
}
if ($failures) { Write-Host "$failures check(s) failed"; exit 1 }
Write-Host 'All checks passed'
exit 0
