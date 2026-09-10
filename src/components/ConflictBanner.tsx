import { useT } from "../lib/i18n";
import { noteName, openNote } from "../lib/obsidian";
import { NoteIcon } from "./Icons";

type Props = {
  conflicts: string[];
  vault: string;
  busy: boolean;
  onKeep: () => void;
  onOverwrite: () => void;
};

/**
 * Shown when a sync found its own block changed in the vault and left the note
 * alone rather than write over the change.
 *
 * It sits above every screen and stays until it is answered: this is the one
 * situation where the app knows it is out of step with the vault, and letting
 * that scroll past is how an edit gets lost the next time round.
 */
export function ConflictBanner({ conflicts, vault, busy, onKeep, onOverwrite }: Props) {
  const t = useT();
  if (!conflicts.length) return null;

  return (
    <section className="conflicts" role="alert">
      <p className="conflict-lead">
        {conflicts.length === 1
          ? t("A note was edited in your vault, so Tempo left it alone.")
          : t("{n} notes were edited in your vault, so Tempo left them alone.", {
              n: conflicts.length,
            })}
      </p>

      <ul className="conflict-list">
        {conflicts.map((path) => (
          <li key={path}>
            {/* The folder can be truncated; the note name is what identifies
                it, so that half never is. */}
            <span className="conflict-path">
              <span className="conflict-folder">{path.slice(0, path.lastIndexOf("/") + 1)}</span>
              <span className="conflict-name">{noteName(path)}</span>
            </span>
            {vault.trim() && (
              <button
                className="in-obsidian"
                aria-label={t("Open in Obsidian")}
                title={t("Open in Obsidian")}
                onClick={() => openNote(vault, noteName(path))}
              >
                <NoteIcon />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={onKeep}>
          {t("Keep edits")}
        </button>
        <button className="btn" disabled={busy} onClick={onOverwrite}>
          {t("Overwrite")}
        </button>
      </div>
      <p className="help">
        {t("Keeping them leaves the vault as it is — until that day changes again.")}
      </p>
    </section>
  );
}
