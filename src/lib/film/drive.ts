// Pure helpers for importing film from Google Drive (safe on client and server).

/**
 * Pulls a Drive folder id out of whatever the coach pasted: a folder link
 * (drive.google.com/drive/folders/<id>, …/u/0/folders/<id>, ?id=<id>) or a bare id.
 */
export function parseDriveFolderId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromPath = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text);
  if (fromPath) return fromPath[1];
  try {
    const url = new URL(text);
    if (/(^|\.)google\.com$/.test(url.hostname)) {
      const id = url.searchParams.get("id");
      if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return id;
    }
    return null;
  } catch {
    return /^[A-Za-z0-9_-]{10,}$/.test(text) ? text : null;
  }
}

/** True for files we can import as camera film. */
export function isVideoFile(file: { name: string; mimeType?: string | null }): boolean {
  if (file.mimeType?.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v)$/i.test(file.name);
}

/** A starting camera name from the file name, e.g. "MEVO_Sideline_0042.MP4" → "MEVO Sideline 0042". */
export function suggestCameraName(fileName: string, index: number): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const name = base || `Camera ${index + 1}`;
  return name.length > 60 ? name.slice(0, 60).trim() : name;
}

export interface DriveVideo {
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  /** Already imported into this game. */
  imported: boolean;
}
