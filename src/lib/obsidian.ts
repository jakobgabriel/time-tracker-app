import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * A link straight into the vault.
 *
 * Obsidian resolves `file` by note name when it is unambiguous, so this needs
 * only the note's name — no mirroring of vault folder structure, which the
 * WebDAV path would not tell us anyway.
 */
export function noteUrl(vault: string, note: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault.trim())}&file=${encodeURIComponent(note)}`;
}

/** Opens a note in Obsidian. Fails quietly: the app is not always installed. */
export async function openNote(vault: string, note: string): Promise<boolean> {
  if (!vault.trim()) return false;
  try {
    await openUrl(noteUrl(vault, note));
    return true;
  } catch {
    return false;
  }
}
