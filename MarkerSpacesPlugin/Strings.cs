using System;

namespace MarkerSpaces
{
    /// <summary>
    /// The window's text in English, Spanish or French, picked from Paratext's interface language.
    /// Keep this file ASCII: run tools\asciify_cs.py after typing accented letters.
    /// </summary>
    public sealed class Strings
    {
        /// <summary>The tool's version: shown in the window title and reported to Paratext.</summary>
        public const string ToolVersion = "1.3";

        public string MenuText;
        public string Title;
        public string Description;
        public string ProjectLabel;
        public string Intro;
        public string Scanning;
        public string StyleInfo;
        public string NotFound;
        public string BuiltIn;
        public string NotPresent;
        public string OptionsShow;
        public string OptionsHide;
        public string OptExclude;
        public string OptNoClose;
        public string OptNoCloseInNote;
        public string OptExtraSpacing;
        public string OptNoSpaceBefore;
        public string OptFootnotePrecedes;
        public string OptXrefPrecedes;
        public string OptionsHint;
        public string SaveRescan;
        public string Defaults;
        public string FilterKind;
        public string FilterMarker;
        public string All;
        public string ShowReportOnly;
        public string Counts;
        public string NoProblems;
        public string ColFix;
        public string ColRef;
        public string ColProblem;
        public string ColCurrent;
        public string ColAfter;
        public string ColCannot;
        public string CannotEdit;
        public string ByHand;
        public string GoToHint;
        public string SelectShown;
        public string ClearShown;
        public string FixButton;
        public string Rescan;
        public string Close;
        public string NothingSelected;
        public string ConfirmTitle;
        public string Confirm;
        public string HistoryMessage;
        public string ResultsLabel;
        public string ResFixed;
        public string ResTotal;
        public string ResNothing;
        public string ResNoPermission;
        public string ResBusy;
        public string ResFailed;
        public string ResChanged;
        public string ResBackups;
        public string NotSaved;
        public string NoPermissionProject;
        public string SomeNotEditable;
        public string OpenProjectFirst;
        public string Error;
        public string HistoryNotRecorded;
        public string HistoryNoFolder;
        public string HistoryStopped;
        public string SettingsNotSaved;
        public string BooksButton;
        public string BooksTitle;
        public string BooksIntro;
        public string BooksAll;
        public string BooksNone;
        public string BooksBible;
        public string BooksOT;
        public string BooksNT;
        public string BooksDC;
        public string BooksOther;
        public string BooksNoneChosen;
        public string Ok;
        public string Cancel;

        // One name per kind, for the filter, and one message per kind, for the rows.
        public string[] KindNames;
        public string[] Messages;

        public static Strings For(string locale)
        {
            string lang = string.IsNullOrEmpty(locale) ? "" : locale.ToLowerInvariant();
            if (lang.StartsWith("es", StringComparison.Ordinal)) return Spanish();
            if (lang.StartsWith("fr", StringComparison.Ordinal)) return French();
            return English();
        }

        public string KindName(IssueKind kind)
        {
            return KindNames[(int)kind];
        }

        /// <summary>The row's message, as in the CMS check's results list.</summary>
        public string Message(SpaceIssue issue)
        {
            return string.Format(Messages[(int)issue.Kind], issue.Shown, issue.Marker);
        }

        public static Strings English()
        {
            var s = new Strings();
            s.MenuText = "Marker Spaces...";
            s.Title = "Marker Spaces";
            s.Description = "Finds spacing problems around character markers, footnotes and cross-references (for example \"\\nd Dios \\nd*\" or \"word\\nd\") and fixes the ones you tick, in the books you may edit.";
            s.ProjectLabel = "Project: {0}";
            s.Intro = "These are the spacing problems found around markers. Tick the ones to fix, then click Fix. " +
                "The \"After fix\" column shows the change; a dot (\u00B7) marks a space that is removed or added. " +
                "Double-click a row to go to the verse in Paratext.";
            s.Scanning = "Scanning {0}...";
            s.StyleInfo = "usfm.sty: {0} ({1} markers)    custom.sty: {2} ({3} markers)";
            s.NotFound = "not found";
            s.BuiltIn = "built-in copy (version 3.0.11)";
            s.NotPresent = "none";
            s.OptionsShow = "Options...";
            s.OptionsHide = "Hide options";
            s.OptExclude = "Marker codes to exclude";
            s.OptNoClose = "Markers that do not require a closing marker";
            s.OptNoCloseInNote = "Markers that do not require a closing marker only inside a footnote/cross-reference";
            s.OptExtraSpacing = "Extra markers to check for spacing";
            s.OptNoSpaceBefore = "Markers that should have NO space before them";
            s.OptFootnotePrecedes = "Footnote precedes text";
            s.OptXrefPrecedes = "Cross-references occur before word";
            s.OptionsHint = "Marker codes are separated by spaces, without backslashes (for example: w rq). The options are saved for this project.";
            s.SaveRescan = "Save options and scan again";
            s.Defaults = "Restore defaults";
            s.FilterKind = "Problem:";
            s.FilterMarker = "Marker:";
            s.All = "(all)";
            s.ShowReportOnly = "Also show problems that must be fixed by hand (unclosed or unexpected closing markers)";
            s.Counts = "{0} problem(s) shown, {1} can be fixed, {2} ticked in all.";
            s.NoProblems = "No marker spacing problems were found.";
            s.ColFix = "Fix";
            s.ColRef = "Reference";
            s.ColProblem = "Problem";
            s.ColCurrent = "Now";
            s.ColAfter = "After fix";
            s.ColCannot = "Permission";
            s.CannotEdit = "cannot edit";
            s.ByHand = "(fix by hand)";
            s.GoToHint = "Double-click a row to go to the verse.";
            s.SelectShown = "Tick all shown";
            s.ClearShown = "Untick all shown";
            s.FixButton = "Fix ticked problems ({0})";
            s.Rescan = "Scan again";
            s.Close = "Close";
            s.NothingSelected = "Tick at least one problem to fix.";
            s.ConfirmTitle = "Fix marker spaces";
            s.Confirm = "Fix {0} problem(s) in {1} book(s) you can edit?\n\n" +
                "A point is first added to the project history, and each changed book is saved as a .bak file in:\n{2}";
            s.HistoryMessage = "Marker Spaces: before fixing {0} spacing problem(s)";
            s.ResultsLabel = "Results: after you click Fix, the changes made (and anything not changed) are listed here.";
            s.ResFixed = "{0}: {1} problem(s) fixed";
            s.ResTotal = "Fixed: {0} problem(s) in {1} book(s).";
            s.ResNothing = "Nothing was changed.";
            s.ResNoPermission = "Not changed, because you do not have permission to edit: {0}";
            s.ResBusy = "Not changed, because the text is in use (finish editing it, then try again): {0}";
            s.ResFailed = "Could not change: {0}";
            s.ResChanged = "Not changed, because the text changed after the scan (scan again, then try again): {0}";
            s.ResBackups = "Backups of the changed books are in: {0}";
            s.NotSaved = "Paratext did not save all the fixes";
            s.NoPermissionProject = "You do not have permission to edit the {0} project, so these problems cannot be fixed here.";
            s.SomeNotEditable = "Some problems are in chapters you cannot edit. They cannot be ticked.";
            s.OpenProjectFirst = "Open a project in a Scripture window first, then choose Marker Spaces...";
            s.Error = "Marker Spaces could not finish:\n{0}";
            s.HistoryNotRecorded = "Paratext did not record the history point (the project may be in use)";
            s.HistoryNoFolder = "the project folder or its history (.hg) was not found";
            s.HistoryStopped = "Could not add a point to the project history, so nothing was changed: {0}\n\nFinish or close any editing in this project, then try again.";
            s.SettingsNotSaved = "The options could not be saved: {0}";
            s.BooksButton = "Books: {0} of {1}...";
            s.BooksTitle = "Books to examine";
            s.BooksIntro = "Tick the books to examine. Unticked books are not read at all. The choice is saved for this project.";
            s.BooksAll = "All";
            s.BooksNone = "None";
            s.BooksBible = "Bible books";
            s.BooksOT = "Old Testament";
            s.BooksNT = "New Testament";
            s.BooksDC = "Deuterocanon";
            s.BooksOther = "Other books";
            s.BooksNoneChosen = "Tick at least one book.";
            s.Ok = "OK";
            s.Cancel = "Cancel";
            s.KindNames = new[]
            {
                "Missing space before an opening marker",
                "Space before \\f or \\x",
                "Space before a closing marker",
                "Missing space after a closing marker",
                "Space before punctuation after a closing marker",
                "Space after a closing marker (note precedes text)",
                "Missing space before \\v, \\ft, \\fr, ...",
                "Space before | in \\w",
                "Unclosed marker",
                "Unexpected closing marker",
            };
            s.Messages = new[]
            {
                "Missing space before \\{0}",
                "Unwanted space before \\{0}",
                "Unwanted space before \\{0}",
                "Missing space after \\{0}",
                "Unwanted space before punctuation after \\{0}",
                "Unwanted space after \\{0} (precedes text)",
                "Missing space before \\{0}",
                "Unwanted space before | in \\w...\\w* (produces a double space)",
                "Unclosed \\{0} (no matching \\{0}* found)",
                "Unexpected \\{0} (\\{1} is not normally closed)",
            };
            return s;
        }

        public static Strings Spanish()
        {
            var s = new Strings();
            s.MenuText = "Espacios de marcadores...";
            s.Title = "Espacios de marcadores";
            s.Description = "Encuentra problemas de espaciado alrededor de marcadores de caracteres, notas al pie y referencias cruzadas (por ejemplo \"\\nd Dios \\nd*\" o \"palabra\\nd\") y corrige los que usted marque, en los libros que puede editar.";
            s.ProjectLabel = "Proyecto: {0}";
            s.Intro = "Estos son los problemas de espaciado encontrados alrededor de los marcadores. Marque los que desea corregir y haga clic en Corregir. " +
                "La columna \"Despu\u00E9s\" muestra el cambio; un punto (\u00B7) indica un espacio que se quita o se agrega. " +
                "Haga doble clic en una fila para ir al vers\u00EDculo en Paratext.";
            s.Scanning = "Revisando {0}...";
            s.StyleInfo = "usfm.sty: {0} ({1} marcadores)    custom.sty: {2} ({3} marcadores)";
            s.NotFound = "no encontrado";
            s.BuiltIn = "copia incorporada (versi\u00F3n 3.0.11)";
            s.NotPresent = "ninguno";
            s.OptionsShow = "Opciones...";
            s.OptionsHide = "Ocultar opciones";
            s.OptExclude = "C\u00F3digos de marcador a excluir";
            s.OptNoClose = "Marcadores que no requieren un marcador de cierre";
            s.OptNoCloseInNote = "Marcadores que no requieren un marcador de cierre solo dentro de una nota al pie/referencia cruzada";
            s.OptExtraSpacing = "Marcadores adicionales para verificar el espaciado";
            s.OptNoSpaceBefore = "Marcadores que NO deben tener espacio antes";
            s.OptFootnotePrecedes = "La nota precede al texto";
            s.OptXrefPrecedes = "Las referencias cruzadas ocurren antes de la palabra";
            s.OptionsHint = "Los c\u00F3digos de marcador se separan con espacios, sin barra invertida (por ejemplo: w rq). Las opciones se guardan para este proyecto.";
            s.SaveRescan = "Guardar opciones y revisar de nuevo";
            s.Defaults = "Restaurar valores predeterminados";
            s.FilterKind = "Problema:";
            s.FilterMarker = "Marcador:";
            s.All = "(todos)";
            s.ShowReportOnly = "Mostrar tambi\u00E9n los problemas que hay que corregir a mano (marcadores sin cerrar o cierres inesperados)";
            s.Counts = "{0} problema(s) mostrado(s), {1} se pueden corregir, {2} marcado(s) en total.";
            s.NoProblems = "No se encontraron problemas de espaciado en los marcadores.";
            s.ColFix = "Corregir";
            s.ColRef = "Referencia";
            s.ColProblem = "Problema";
            s.ColCurrent = "Ahora";
            s.ColAfter = "Despu\u00E9s";
            s.ColCannot = "Permiso";
            s.CannotEdit = "no puede editar";
            s.ByHand = "(corregir a mano)";
            s.GoToHint = "Haga doble clic en una fila para ir al vers\u00EDculo.";
            s.SelectShown = "Marcar todos los mostrados";
            s.ClearShown = "Desmarcar todos los mostrados";
            s.FixButton = "Corregir los problemas marcados ({0})";
            s.Rescan = "Revisar de nuevo";
            s.Close = "Cerrar";
            s.NothingSelected = "Marque al menos un problema para corregir.";
            s.ConfirmTitle = "Corregir espacios de marcadores";
            s.Confirm = "\u00BFCorregir {0} problema(s) en {1} libro(s) que usted puede editar?\n\n" +
                "Primero se agrega un punto al historial del proyecto, y cada libro cambiado se guarda como archivo .bak en:\n{2}";
            s.HistoryMessage = "Espacios de marcadores: antes de corregir {0} problema(s) de espaciado";
            s.ResultsLabel = "Resultados: despu\u00E9s de hacer clic en Corregir, aqu\u00ED se muestran los cambios hechos (y lo que no se cambi\u00F3).";
            s.ResFixed = "{0}: {1} problema(s) corregido(s)";
            s.ResTotal = "Corregido: {0} problema(s) en {1} libro(s).";
            s.ResNothing = "No se cambi\u00F3 nada.";
            s.ResNoPermission = "No se cambiaron, porque usted no tiene permiso para editar: {0}";
            s.ResBusy = "No se cambiaron, porque el texto est\u00E1 en uso (termine de editarlo y vuelva a intentarlo): {0}";
            s.ResFailed = "No se pudo cambiar: {0}";
            s.ResChanged = "No se cambiaron, porque el texto cambi\u00F3 despu\u00E9s de la revisi\u00F3n (revise de nuevo y vuelva a intentarlo): {0}";
            s.ResBackups = "Las copias de seguridad de los libros cambiados est\u00E1n en: {0}";
            s.NotSaved = "Paratext no guard\u00F3 todas las correcciones";
            s.NoPermissionProject = "Usted no tiene permiso para editar el proyecto {0}, as\u00ED que estos problemas no se pueden corregir aqu\u00ED.";
            s.SomeNotEditable = "Algunos problemas est\u00E1n en cap\u00EDtulos que usted no puede editar. No se pueden marcar.";
            s.OpenProjectFirst = "Abra primero un proyecto en una ventana de Escritura y luego elija Espacios de marcadores...";
            s.Error = "Espacios de marcadores no pudo terminar:\n{0}";
            s.HistoryNotRecorded = "Paratext no registr\u00F3 el punto del historial (puede que el proyecto est\u00E9 en uso)";
            s.HistoryNoFolder = "no se encontr\u00F3 la carpeta del proyecto o su historial (.hg)";
            s.HistoryStopped = "No se pudo agregar un punto al historial del proyecto, as\u00ED que no se cambi\u00F3 nada: {0}\n\nTermine o cierre cualquier edici\u00F3n en este proyecto y vuelva a intentarlo.";
            s.SettingsNotSaved = "No se pudieron guardar las opciones: {0}";
            s.BooksButton = "Libros: {0} de {1}...";
            s.BooksTitle = "Libros a revisar";
            s.BooksIntro = "Marque los libros que desea revisar. Los libros sin marcar no se leen. La selecci\u00F3n se guarda para este proyecto.";
            s.BooksAll = "Todos";
            s.BooksNone = "Ninguno";
            s.BooksBible = "Libros de la Biblia";
            s.BooksOT = "Antiguo Testamento";
            s.BooksNT = "Nuevo Testamento";
            s.BooksDC = "Deuterocan\u00F3nicos";
            s.BooksOther = "Otros libros";
            s.BooksNoneChosen = "Marque al menos un libro.";
            s.Ok = "Aceptar";
            s.Cancel = "Cancelar";
            s.KindNames = new[]
            {
                "Falta espacio antes de un marcador de apertura",
                "Espacio antes de \\f o \\x",
                "Espacio antes de un marcador de cierre",
                "Falta espacio despu\u00E9s de un marcador de cierre",
                "Espacio antes de puntuaci\u00F3n despu\u00E9s de un marcador de cierre",
                "Espacio despu\u00E9s de un marcador de cierre (la nota precede al texto)",
                "Falta espacio antes de \\v, \\ft, \\fr, ...",
                "Espacio antes de | en \\w",
                "Marcador sin cerrar",
                "Marcador de cierre inesperado",
            };
            s.Messages = new[]
            {
                "Falta espacio antes de \\{0}",
                "Espacio no deseado antes de \\{0}",
                "Espacio no deseado antes de \\{0}",
                "Falta espacio despu\u00E9s de \\{0}",
                "Espacio no deseado antes de la puntuaci\u00F3n despu\u00E9s de \\{0}",
                "Espacio no deseado despu\u00E9s de \\{0} (precede al texto)",
                "Falta espacio antes de \\{0}",
                "Espacio no deseado antes de | en \\w...\\w* (produce un espacio doble)",
                "\\{0} sin cerrar (no se encontr\u00F3 \\{0}*)",
                "\\{0} inesperado (\\{1} normalmente no se cierra)",
            };
            return s;
        }

        public static Strings French()
        {
            var s = new Strings();
            s.MenuText = "Espaces autour des marqueurs...";
            s.Title = "Espaces autour des marqueurs";
            s.Description = "Trouve les probl\u00E8mes d'espacement autour des marqueurs de caract\u00E8res, des notes de bas de page et des r\u00E9f\u00E9rences crois\u00E9es (par exemple \"\\nd Dieu \\nd*\" ou \"mot\\nd\") et corrige ceux que vous cochez, dans les livres que vous pouvez modifier.";
            s.ProjectLabel = "Projet : {0}";
            s.Intro = "Voici les probl\u00E8mes d'espacement trouv\u00E9s autour des marqueurs. Cochez ceux \u00E0 corriger, puis cliquez sur Corriger. " +
                "La colonne \"Apr\u00E8s correction\" montre le changement ; un point (\u00B7) indique une espace supprim\u00E9e ou ajout\u00E9e. " +
                "Double-cliquez sur une ligne pour aller au verset dans Paratext.";
            s.Scanning = "Analyse de {0}...";
            s.StyleInfo = "usfm.sty : {0} ({1} marqueurs)    custom.sty : {2} ({3} marqueurs)";
            s.NotFound = "introuvable";
            s.BuiltIn = "copie int\u00E9gr\u00E9e (version 3.0.11)";
            s.NotPresent = "aucun";
            s.OptionsShow = "Options...";
            s.OptionsHide = "Masquer les options";
            s.OptExclude = "Codes de marqueurs \u00E0 exclure";
            s.OptNoClose = "Marqueurs qui n'exigent pas de marqueur de fermeture";
            s.OptNoCloseInNote = "Marqueurs qui n'exigent pas de marqueur de fermeture seulement dans une note de bas de page/r\u00E9f\u00E9rence crois\u00E9e";
            s.OptExtraSpacing = "Autres marqueurs dont l'espacement est \u00E0 v\u00E9rifier";
            s.OptNoSpaceBefore = "Marqueurs qui ne doivent PAS \u00EAtre pr\u00E9c\u00E9d\u00E9s d'une espace";
            s.OptFootnotePrecedes = "La note pr\u00E9c\u00E8de le texte";
            s.OptXrefPrecedes = "Les r\u00E9f\u00E9rences crois\u00E9es se trouvent avant le mot";
            s.OptionsHint = "Les codes de marqueurs sont s\u00E9par\u00E9s par des espaces, sans barre oblique inverse (par exemple : w rq). Les options sont enregistr\u00E9es pour ce projet.";
            s.SaveRescan = "Enregistrer les options et analyser de nouveau";
            s.Defaults = "R\u00E9tablir les valeurs par d\u00E9faut";
            s.FilterKind = "Probl\u00E8me :";
            s.FilterMarker = "Marqueur :";
            s.All = "(tous)";
            s.ShowReportOnly = "Afficher aussi les probl\u00E8mes \u00E0 corriger \u00E0 la main (marqueurs non ferm\u00E9s ou fermetures inattendues)";
            s.Counts = "{0} probl\u00E8me(s) affich\u00E9(s), {1} corrigeable(s), {2} coch\u00E9(s) au total.";
            s.NoProblems = "Aucun probl\u00E8me d'espacement autour des marqueurs n'a \u00E9t\u00E9 trouv\u00E9.";
            s.ColFix = "Corriger";
            s.ColRef = "R\u00E9f\u00E9rence";
            s.ColProblem = "Probl\u00E8me";
            s.ColCurrent = "Actuel";
            s.ColAfter = "Apr\u00E8s correction";
            s.ColCannot = "Autorisation";
            s.CannotEdit = "non modifiable";
            s.ByHand = "(\u00E0 corriger \u00E0 la main)";
            s.GoToHint = "Double-cliquez sur une ligne pour aller au verset.";
            s.SelectShown = "Cocher toutes les lignes affich\u00E9es";
            s.ClearShown = "D\u00E9cocher toutes les lignes affich\u00E9es";
            s.FixButton = "Corriger les probl\u00E8mes coch\u00E9s ({0})";
            s.Rescan = "Analyser de nouveau";
            s.Close = "Fermer";
            s.NothingSelected = "Cochez au moins un probl\u00E8me \u00E0 corriger.";
            s.ConfirmTitle = "Corriger les espaces autour des marqueurs";
            s.Confirm = "Corriger {0} probl\u00E8me(s) dans {1} livre(s) que vous pouvez modifier ?\n\n" +
                "Un point est d'abord ajout\u00E9 \u00E0 l'historique du projet, et chaque livre modifi\u00E9 est enregistr\u00E9 dans un fichier .bak dans :\n{2}";
            s.HistoryMessage = "Espaces autour des marqueurs : avant de corriger {0} probl\u00E8me(s) d'espacement";
            s.ResultsLabel = "R\u00E9sultats : apr\u00E8s un clic sur Corriger, les changements effectu\u00E9s (et ce qui n'a pas \u00E9t\u00E9 chang\u00E9) sont list\u00E9s ici.";
            s.ResFixed = "{0} : {1} probl\u00E8me(s) corrig\u00E9(s)";
            s.ResTotal = "Corrig\u00E9 : {0} probl\u00E8me(s) dans {1} livre(s).";
            s.ResNothing = "Rien n'a \u00E9t\u00E9 chang\u00E9.";
            s.ResNoPermission = "Non chang\u00E9, car vous n'avez pas l'autorisation de modifier : {0}";
            s.ResBusy = "Non chang\u00E9, car le texte est en cours d'utilisation (terminez la modification, puis r\u00E9essayez) : {0}";
            s.ResFailed = "Impossible de changer : {0}";
            s.ResChanged = "Non chang\u00E9, car le texte a chang\u00E9 apr\u00E8s l'analyse (analysez de nouveau, puis r\u00E9essayez) : {0}";
            s.ResBackups = "Les copies de sauvegarde des livres modifi\u00E9s se trouvent dans : {0}";
            s.NotSaved = "Paratext n'a pas enregistr\u00E9 toutes les corrections";
            s.NoPermissionProject = "Vous n'avez pas l'autorisation de modifier le projet {0}, donc ces probl\u00E8mes ne peuvent pas \u00EAtre corrig\u00E9s ici.";
            s.SomeNotEditable = "Certains probl\u00E8mes se trouvent dans des chapitres que vous ne pouvez pas modifier. Ils ne peuvent pas \u00EAtre coch\u00E9s.";
            s.OpenProjectFirst = "Ouvrez d'abord un projet dans une fen\u00EAtre de texte biblique, puis choisissez Espaces autour des marqueurs...";
            s.Error = "Espaces autour des marqueurs n'a pas pu terminer :\n{0}";
            s.HistoryNotRecorded = "Paratext n'a pas enregistr\u00E9 le point d'historique (le projet est peut-\u00EAtre en cours d'utilisation)";
            s.HistoryNoFolder = "le dossier du projet ou son historique (.hg) est introuvable";
            s.HistoryStopped = "Impossible d'ajouter un point \u00E0 l'historique du projet, donc rien n'a \u00E9t\u00E9 chang\u00E9 : {0}\n\nTerminez ou fermez toute modification en cours dans ce projet, puis r\u00E9essayez.";
            s.SettingsNotSaved = "Impossible d'enregistrer les options : {0}";
            s.BooksButton = "Livres : {0} sur {1}...";
            s.BooksTitle = "Livres \u00E0 analyser";
            s.BooksIntro = "Cochez les livres \u00E0 analyser. Les livres non coch\u00E9s ne sont pas lus du tout. Le choix est enregistr\u00E9 pour ce projet.";
            s.BooksAll = "Tous";
            s.BooksNone = "Aucun";
            s.BooksBible = "Livres de la Bible";
            s.BooksOT = "Ancien Testament";
            s.BooksNT = "Nouveau Testament";
            s.BooksDC = "Deut\u00E9rocanoniques";
            s.BooksOther = "Autres livres";
            s.BooksNoneChosen = "Cochez au moins un livre.";
            s.Ok = "OK";
            s.Cancel = "Annuler";
            s.KindNames = new[]
            {
                "Espace manquante avant un marqueur d'ouverture",
                "Espace avant \\f ou \\x",
                "Espace avant un marqueur de fermeture",
                "Espace manquante apr\u00E8s un marqueur de fermeture",
                "Espace avant la ponctuation apr\u00E8s un marqueur de fermeture",
                "Espace apr\u00E8s un marqueur de fermeture (la note pr\u00E9c\u00E8de le texte)",
                "Espace manquante avant \\v, \\ft, \\fr, ...",
                "Espace avant | dans \\w",
                "Marqueur non ferm\u00E9",
                "Marqueur de fermeture inattendu",
            };
            s.Messages = new[]
            {
                "Espace manquante avant \\{0}",
                "Espace superflue avant \\{0}",
                "Espace superflue avant \\{0}",
                "Espace manquante apr\u00E8s \\{0}",
                "Espace superflue avant la ponctuation apr\u00E8s \\{0}",
                "Espace superflue apr\u00E8s \\{0} (pr\u00E9c\u00E8de le texte)",
                "Espace manquante avant \\{0}",
                "Espace superflue avant | dans \\w...\\w* (produit une double espace)",
                "\\{0} non ferm\u00E9 (aucun \\{0}* correspondant)",
                "\\{0} inattendu (\\{1} n'est normalement pas ferm\u00E9)",
            };
            return s;
        }
    }
}
