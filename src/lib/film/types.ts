export type FilmCameraStatus = "queued" | "importing" | "processing" | "ready" | "failed";

/** A camera recording for one game (rr_film_cameras). */
export interface FilmCamera {
  id: string;
  game_id: string;
  team_id: string;
  name: string;
  position: number;
  source: "drive" | "upload";
  drive_file_id: string | null;
  source_name: string | null;
  size_bytes: number | null;
  original_path: string | null;
  proxy_path: string | null;
  thumb_path: string | null;
  status: FilmCameraStatus;
  progress: number;
  error: string | null;
  recorded_start_at: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  nudge_ms: number;
  created_at: string;
  updated_at: string;
}

/** A Drive folder the watcher checks for new camera files (rr_film_watches). */
export interface FilmWatch {
  id: string;
  game_id: string;
  folder_id: string;
  folder_name: string | null;
  active: boolean;
  expires_at: string;
  last_checked_at: string | null;
  last_error: string | null;
  imported_count: number;
  created_at: string;
}

/** How long a watch runs before stopping on its own. */
export const WATCH_DAYS = 7;

/** A camera plus short-lived links the browser can load directly. */
export interface FilmCameraView extends FilmCamera {
  thumbUrl: string | null;
}

export const FILM_STATUS_LABELS: Record<FilmCameraStatus, string> = {
  queued: "Waiting to start",
  importing: "Copying from Drive",
  processing: "Making review copy",
  ready: "Ready",
  failed: "Failed",
};

/** Still working: the Film tab keeps checking for progress. */
export function isFilmInProgress(status: FilmCameraStatus): boolean {
  return status === "queued" || status === "importing" || status === "processing";
}

/** "1:32:05" / "4:07" */
export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "18.2 GB" */
export function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
