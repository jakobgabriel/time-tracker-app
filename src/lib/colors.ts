/**
 * A stable colour per project, derived from its name.
 *
 * Deriving beats storing: the same project looks the same on every device and
 * after any sync, and there is no colour picker to maintain. The palette
 * deliberately avoids purple and stays legible on both themes.
 */
const PALETTE = [
  "#c3f53c", // lime — the app accent
  "#4dd4e8", // cyan
  "#f5b93c", // amber
  "#ff7a66", // coral
  "#3ddc97", // mint
  "#5aa9f5", // sky
  "#d9c46a", // sand
  "#7fd14a", // grass
];

export function projectColor(project: string): string {
  const name = project.trim().toLowerCase();
  if (!name) return PALETTE[0];
  // FNV-1a: tiny, stable, and spreads similar names apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
