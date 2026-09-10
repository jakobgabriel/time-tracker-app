import { createContext, useContext, type ReactNode } from "react";

export type Lang = "en" | "de";

/**
 * Keyed by the English string itself, so anything not translated falls back to
 * English instead of showing a key. `{name}` placeholders are filled from the
 * second argument.
 */
const DE: Record<string, string> = {
  // shell
  Tempo: "Tempo",
  Insights: "Auswertung",
  History: "Verlauf",
  Settings: "Einstellungen",
  Track: "Zeit",
  today: "heute",

  // track
  Start: "Start",
  "Tap to stop": "Zum Stoppen tippen",
  "Tap to start — or pick a project below": "Zum Starten tippen — oder ein Projekt wählen",
  "{done} of {goal}": "{done} von {goal}",
  "{done} of {goal} — goal reached": "{done} von {goal} — Ziel erreicht",
  since: "seit",
  discard: "verwerfen",
  "Started five minutes earlier": "Fünf Minuten früher begonnen",
  "Started five minutes later": "Fünf Minuten später begonnen",
  "What are you working on?": "Woran arbeitest du?",
  Projects: "Projekte",
  New: "Neu",
  "New project…": "Neues Projekt…",
  Today: "Heute",
  "Nothing tracked yet today.": "Heute noch nichts erfasst.",
  "Running for {elapsed} — forgotten?": "Läuft seit {elapsed} — vergessen?",
  "Stop at {limit}": "Bei {limit} beenden",
  "Stop now": "Jetzt beenden",
  "{tracked} tracked": "{tracked} erfasst",
  "{gaps} in gaps — tap one to fill it": "{gaps} in Lücken — zum Nachtragen antippen",
  RUNNING: "LÄUFT",
  from: "ab",
  Untitled: "Ohne Titel",

  // insights
  Week: "Woche",
  Month: "Monat",
  All: "Gesamt",
  "across {days} tracked days": "an {days} erfassten Tagen",
  "nothing tracked in the period before": "im Zeitraum davor nichts erfasst",
  "vs last week": "ggü. letzter Woche",
  "vs last month": "ggü. letztem Monat",
  "Tracked days": "Erfasste Tage",
  "Average day": "Schnitt pro Tag",
  Streak: "Serie",
  "best {n}": "Bestwert {n}",
  "Best day": "Bester Tag",
  "{n} days": "{n} Tage",
  "{n} day": "{n} Tag",
  "Nothing tracked in this range yet.": "In diesem Zeitraum noch nichts erfasst.",
  "Write the invoice note for this month": "Rechnungsnotiz für diesen Monat schreiben",
  "{share}% of {target}": "{share}% von {target}",

  // history
  "Search project, note or tag": "Projekt, Notiz oder Tag suchen",
  "Clear search": "Suche löschen",
  "Add entry": "Eintrag hinzufügen",
  "Edit entry": "Eintrag bearbeiten",
  "No history yet. Start a timer and it will show up here.":
    "Noch kein Verlauf. Starte eine Zeit, dann erscheint sie hier.",
  "Nothing matches “{query}”.": "Nichts passt zu „{query}“.",
  "{n} entries · {total} total": "{n} Einträge · {total} gesamt",
  "{n} matching entries · {total} total": "{n} passende Einträge · {total} gesamt",
  "Edit all {n} matching entries": "Alle {n} passenden Einträge bearbeiten",
  Yesterday: "Gestern",
  "Week {n}": "KW {n}",

  // entry sheet
  Project: "Projekt",
  Date: "Datum",
  From: "Von",
  To: "Bis",
  Note: "Notiz",
  Tags: "Tags",
  "Optional — ends up in the note": "Optional — landet in der Notiz",
  "Comma separated; written to Obsidian as #tags.":
    "Mit Komma getrennt; landet in Obsidian als #tags.",
  Cancel: "Abbrechen",
  Save: "Speichern",
  "Split at": "Teilen um",
  Split: "Teilen",
  "Merge with {from}–{to}": "Mit {from}–{to} zusammenführen",
  "Start this project again": "Dieses Projekt erneut starten",
  "Delete entry": "Eintrag löschen",
  "Add an end time, or stop the running timer first.":
    "Endzeit angeben oder zuerst die laufende Zeit stoppen.",
  "Save again to keep it anyway.": "Nochmal speichern, um es trotzdem zu behalten.",
  Overlaps: "Überschneidet sich mit",

  // project sheet
  Name: "Name",
  "Hourly rate": "Stundensatz",
  "Weekly target": "Wochenziel",
  hours: "Stunden",
  "Always tag with": "Immer taggen mit",
  "Pin to the top": "Nach oben heften",
  "Unpin from the top": "Nicht mehr anheften",
  "Remove from the quick list": "Aus der Schnellliste entfernen",

  // settings
  Obsidian: "Obsidian",
  Notes: "Notizen",
  Tracking: "Erfassung",
  Sync: "Abgleich",
  Backup: "Sicherung",
  "not connected": "nicht verbunden",
  "Server URL": "Server-URL",
  Username: "Benutzername",
  Password: "Passwort",
  "Folder in the vault": "Ordner im Vault",
  "Test the connection": "Verbindung testen",
  "One note per": "Eine Notiz pro",
  "Note path": "Notiz-Pfad",
  "Daily goal": "Tagesziel",
  "No goal": "Kein Ziel",
  "{n} hours": "{n} Stunden",
  "Warn about a long session": "Vor langen Sitzungen warnen",
  Never: "Nie",
  "After {n} hours": "Nach {n} Stunden",
  "Round durations": "Dauer runden",
  Exact: "Exakt",
  "{n} minutes": "{n} Minuten",
  "Split at midnight": "Um Mitternacht teilen",
  "Currency symbol": "Währungszeichen",
  "Tag for new notes": "Tag für neue Notizen",
  "Weekly summary note": "Wochennotiz",
  "A note per project": "Eine Notiz pro Projekt",
  "Link projects": "Projekte verlinken",
  "Sync when a timer stops": "Beim Stoppen abgleichen",
  "Two-way sync": "Abgleich in beide Richtungen",
  "Sync now": "Jetzt abgleichen",

  // note preview
  "Preview today's note": "Heutige Notiz ansehen",
  "Nothing tracked today — this is the empty note.":
    "Heute nichts erfasst — so sieht die leere Notiz aus.",
  "1 entry · written to": "1 Eintrag · geschrieben nach",
  "{n} entries · written to": "{n} Einträge · geschrieben nach",
  "Exactly what a sync would write, from the settings above rather than the saved ones — so a path can be checked before it puts a file somewhere unintended.":
    "Genau das, was ein Abgleich schreiben würde — aus den Einstellungen oben, nicht den gespeicherten. So lässt sich ein Pfad prüfen, bevor eine Datei an der falschen Stelle landet.",

  // review
  "1 entry needs a look": "1 Eintrag braucht einen Blick",
  "{n} entries need a look": "{n} Einträge brauchen einen Blick",
  "Overlaps another entry": "Überschneidet einen anderen Eintrag",
  "Longer than your session limit": "Länger als dein Sitzungslimit",
  "No project": "Kein Projekt",
  "No time in it": "Ohne Dauer",
  "In the future": "In der Zukunft",
  "no project": "kein Projekt",
  and: "und",
  "Show fewer": "Weniger zeigen",
  "Show all {n}": "Alle {n} zeigen",

  // sync conflicts
  "A note was edited in your vault, so Tempo left it alone.":
    "Eine Notiz wurde im Vault bearbeitet — Tempo hat sie unverändert gelassen.",
  "{n} notes were edited in your vault, so Tempo left them alone.":
    "{n} Notizen wurden im Vault bearbeitet — Tempo hat sie unverändert gelassen.",
  "Keep edits": "Behalten",
  Overwrite: "Überschreiben",
  "Keeping them leaves the vault as it is — until that day changes again.":
    "„Behalten“ lässt den Vault unverändert — bis sich dieser Tag wieder ändert.",
  "Kept the vault's version": "Vault-Fassung behalten",
  "Synced, and overwrote what was edited": "Abgeglichen und Bearbeitetes überschrieben",
  "Rewrite all": "Alles neu schreiben",
  "Export CSV": "CSV exportieren",
  "Import CSV": "CSV importieren",
  "Back up on every sync": "Bei jedem Abgleich sichern",
  "Back up": "Sichern",
  Restore: "Wiederherstellen",
  "Save changes": "Änderungen speichern",
  "All changes saved": "Alle Änderungen gespeichert",
  "on every sync": "bei jedem Abgleich",
  manual: "manuell",
  "one per day": "eine pro Tag",
  "one per month": "eine pro Monat",
  "custom path": "eigener Pfad",
  "two-way": "beidseitig",
  "{n} pinned": "{n} angeheftet",
  "{n} day(s) waiting": "{n} Tag(e) offen",
  "synced {when}": "abgeglichen {when}",
  never: "nie",
  "just now": "gerade eben",
  "{n}m ago": "vor {n} Min.",
  "{n}h ago": "vor {n} Std.",
  "{n}d ago": "vor {n} Tagen",
  Language: "Sprache",
  "Vault name": "Vault-Name",
  "Open in Obsidian": "In Obsidian öffnen",
  "Obsidian's name for the vault. With it, History gets a link straight into each day's note.":
    "Obsidians Name für den Vault. Damit bekommt der Verlauf einen Link direkt in die Notiz des Tages.",
  English: "Englisch",
  German: "Deutsch",

  // help texts
  "The WebDAV root of the account — the vault folder is added below.":
    "Die WebDAV-Wurzel des Kontos — der Vault-Ordner kommt unten dazu.",
  "Use an app password if your provider offers one.":
    "Nutze ein App-Passwort, falls dein Anbieter eines anbietet.",
  "Holds the notes, the backup and the exports. Created if it does not exist.":
    "Enthält die Notizen, die Sicherung und die Exporte. Wird bei Bedarf angelegt.",
  "Draws today's progress as a ring around the start button, and a line on the chart.":
    "Zeigt den heutigen Fortschritt als Ring um den Startknopf und als Linie im Diagramm.",
  "Applies to the note and the CSV only — your raw times stay exact.":
    "Gilt nur für Notiz und CSV — deine echten Zeiten bleiben exakt.",
  "A roll-up per ISO week.": "Eine Zusammenfassung pro Kalenderwoche.",
  "A failed sync is retried when you come back.":
    "Ein fehlgeschlagener Abgleich wird bei der Rückkehr wiederholt.",
  "Reads the vault's backup before writing, so a second device's work — and its deletions — arrive here.":
    "Liest vor dem Schreiben die Sicherung im Vault, damit die Arbeit — und die Löschungen — eines zweiten Geräts hier ankommen.",
  "A session running past midnight counts on both days.":
    "Eine Sitzung über Mitternacht zählt auf beiden Tagen.",
  "Tap a project to rename, price, tag, pin or remove it.":
    "Tippe ein Projekt an, um es umzubenennen, zu bepreisen, zu taggen, anzuheften oder zu entfernen.",
  "no goal": "kein Ziel",
  "Export writes tempo-export.csv; import reads tempo-import.csv from the same folder and adds whatever this device is missing.":
    "Export schreibt tempo-export.csv; Import liest tempo-import.csv aus demselben Ordner und ergänzt, was diesem Gerät fehlt.",
  "Keeps tempo-backup.json in the vault. No credentials are written.":
    "Hält tempo-backup.json im Vault. Zugangsdaten werden nicht geschrieben.",
  "Restoring merges the backup into this device: entries it does not have are added, nothing here is overwritten.":
    "Wiederherstellen führt die Sicherung mit diesem Gerät zusammen: Fehlende Einträge kommen dazu, nichts hier wird überschrieben.",
  "Only the block between the tempo markers is rewritten; the rest of the note stays yours.":
    "Nur der Block zwischen den tempo-Markern wird neu geschrieben; der Rest der Notiz bleibt deiner.",
  "Writes [[Acme]], so the vault builds a note per project.":
    "Schreibt [[Acme]], damit der Vault eine Notiz pro Projekt aufbaut.",
  "Projects/Acme.md gets its own log: a row per day, with totals.":
    "Projects/Acme.md bekommt ein eigenes Protokoll: eine Zeile pro Tag, mit Summen.",
  "One tap starts the clock, one tap stops it, and your hours end up in your Obsidian vault as plain Markdown.":
    "Ein Tipp startet die Uhr, ein Tipp stoppt sie, und deine Stunden landen als einfaches Markdown in deinem Obsidian-Vault.",
  "A client, a side project, \"Deep Work\" — anything.":
    "Ein Kunde, ein Nebenprojekt, „Deep Work“ — was auch immer.",
  "Tempo writes into an Obsidian vault over WebDAV. You can do this later — everything works offline until you do.":
    "Tempo schreibt über WebDAV in einen Obsidian-Vault. Das geht auch später — bis dahin funktioniert alles offline.",
  "Tempo only ever owns the block between its own markers. Anything else in the note stays yours.":
    "Tempo gehört immer nur der Block zwischen seinen eigenen Markern. Alles andere in der Notiz bleibt deins.",

  // bulk + onboarding
  "{n} entries": "{n} Einträge",
  "{n} entry": "{n} Eintrag",
  "Move to project": "In Projekt verschieben",
  "Add tags": "Tags hinzufügen",
  "Apply to {n}": "Auf {n} anwenden",
  "What will you track first?": "Was erfasst du zuerst?",
  Continue: "Weiter",
  "Your vault": "Dein Vault",
  "Skip for now": "Später einrichten",
  "How should it write?": "Wie soll geschrieben werden?",
  "Start tracking": "Los geht's",
  Test: "Testen",
};

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) : text;

export function translator(lang: Lang): Translate {
  return (text, vars) => fill(lang === "de" ? (DE[text] ?? text) : text, vars);
}

/** The device's language, used until someone picks one. */
export function detectLang(): Lang {
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("de")
    ? "de"
    : "en";
}

const Context = createContext<Translate>(translator("en"));

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <Context.Provider value={translator(lang)}>{children}</Context.Provider>;
}

export const useT = () => useContext(Context);
