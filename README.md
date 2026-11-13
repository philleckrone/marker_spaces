# Marker Spaces

*This page is the English user guide, [MarkerSpaces_UserGuide.rtf](plugin/MarkerSpaces_UserGuide.rtf). The guide is also available in Spanish ([MarkerSpaces_UserGuide_sp.rtf](plugin/MarkerSpaces_UserGuide_sp.rtf)) and French ([MarkerSpaces_UserGuide_fr.rtf](plugin/MarkerSpaces_UserGuide_fr.rtf)).*

## Purpose

Marker Spaces is a Paratext plugin. It finds spacing mistakes around markers (the same problems as the "Report of Marker spaces" custom check) and lets you choose which ones to fix. Like Paratext itself, it changes only the chapters you have permission to edit.

It checks every character marker in usfm.sty and the project's custom.sty (\nd, \add, \w, \tl, ...), footnotes (\f) and cross-references (\x):

- Missing space before an opening marker: "del\nd SEÑOR\nd\*" becomes "del \nd SEÑOR\nd\*".
- Space before \f or \x, which attach to the word before them: "hijo. \f + ..." becomes "hijo.\f + ...".
- Space before a closing marker: "\nd Dios \nd\*" becomes "\nd Dios\nd\*". When nothing separates the closing marker from the next word ("\nd Señor \nd\*dijo"), the space is moved outside: "\nd Señor\nd\* dijo".
- Missing space after a closing marker: "\bd negrita\bd\*texto" becomes "\bd negrita\bd\* texto".
- Space before punctuation after a closing marker: "\it palabra\it\* ." becomes "\it palabra\it\*.".
- Space after \x\* (or \f\*) when the note comes before the word it belongs to: "\x\*·palabra" becomes "\x\*palabra".
- Missing space before \v, \ft, \fr and similar markers: "\fr 1:9\ft" becomes "\fr 1:9 \ft".
- Space before | in \w...\w\*: "\w palabra |lema\w\*" becomes "\w palabra|lema\w\*".

Unclosed markers and closing markers on markers that take none (for example \fq\*) are listed too, but they must be fixed by hand.

"\~" (Paratext's non-breaking space) counts as a space everywhere.

## Installing

1. Download Install_Phils_tools.exe from the Paratext_Plugins folder. If your browser warns about the file, choose to keep it.

2. Close Paratext.

3. Double-click Install_Phils_tools.exe. If Windows says it protected your PC, click "More info", then "Run anyway" (the installer is not signed yet).

4. Tick Marker Spaces and click "Install / update ticked". It installs into every Paratext 9 on the computer. If Windows asks for permission, click Yes. The same window updates the plugin later (its status then says "Update available") or removes it ("Remove ticked"), and its "User guide" button opens this guide.

## How to use

1. Open the project in a Scripture window and choose Tools > Marker Spaces...

2. The window scans the chosen books (see CHOOSING BOOKS below) and lists one row per problem: the reference, the problem, the text now and the text after the fix. In the "Now" and "After fix" columns a dot (·) marks the space that is removed or added. Nothing is changed yet.

3. Use "Problem" and "Marker" to show only one kind of problem or one marker. Tick "Also show problems that must be fixed by hand" to see the unclosed and unexpected closing markers as well.

4. Double-click a row to go to that verse in Paratext. The window stays open beside Paratext.

5. Tick the problems to fix. "Tick all shown" and "Untick all shown" work on the rows shown. Rows in chapters you may not edit are grey and marked "cannot edit"; they cannot be ticked.

6. Click "Fix ticked problems" and answer Yes.

## Choosing books

The "Books: 66 of 79..." button shows how many of the project's books are examined. Click it to choose them: tick the books to examine, or use the buttons All, None, Bible books, Old Testament, New Testament, Deuterocanon and Other books. Books that are not ticked are not read at all, so they show no problems and are never changed. Click OK: the choice is saved for this project and the books are scanned again.

Until you choose, the Bible books are examined (Old Testament, New Testament and Deuterocanon). The other books are left out: front and back matter (FRT, BAK, OTH, INT), the glossary and indexes (GLO, TDX, NDX), the concordance (CNC) and the extra books XXA to XXG. "Restore defaults" in the options also goes back to this choice.

## What happens when you fix

1. A point is added to the project history ("Marker Spaces: before fixing ..."). If Paratext cannot record it (for example because the project is in use), nothing is changed and the window says so.

2. Each book that will change is saved whole as Backup_BOOK_date-time.bak in the project's local\MarkerSpaces folder, which Send/Receive does not share.

3. Only the ticked problems are changed, and only spaces: no letters or markers are added or removed. Each chapter is written on its own, and only if you may edit it.

4. If the text of a chapter changed after the scan (for example you edited it in Paratext), that chapter is left alone and listed: click "Scan again" and try again.

5. The results box lists what was fixed in each book, and anything not changed. The list is then scanned again.

## Options

Click "Options..." to change what is checked. The options are those of the custom check, and are saved for this project (in local\MarkerSpaces\settings.xml). Click "Save options and scan again" to use them.

- Marker codes to exclude: markers that follow a different spacing rule in this project (for example: w rq).
- Markers that do not require a closing marker: v fk fp fq fqa ft fr xk xo xq by default.
- Markers that do not require a closing marker only inside a footnote/cross-reference: xt by default.
- Extra markers to check for spacing: f x by default.
- Markers that should have NO space before them: f x by default.
- Footnote precedes text: tick it if footnotes come before the word they belong to.
- Cross-references occur before word: ticked by default; untick it if cross-references follow the word, attached to it.
