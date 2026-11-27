import type { SupabaseClient } from "@supabase/supabase-js";
import { WATCH_DAYS, type FilmCamera, type FilmWatch } from "./types";

const CAMERA_COLUMNS =
  "id, game_id, team_id, name, position, source, drive_file_id, source_name, size_bytes, " +
  "original_path, proxy_path, thumb_path, status, progress, error, recorded_start_at, " +
  "duration_ms, width, height, fps, nudge_ms, created_at, updated_at";

export async function getFilmCameras(supabase: SupabaseClient, gameId: string): Promise<FilmCamera[]> {
  const { data, error } = await supabase
    .from("rr_film_cameras")
    .select(CAMERA_COLUMNS)
    .eq("game_id", gameId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as FilmCamera[];
}

export async function getFilmCamera(supabase: SupabaseClient, id: string): Promise<FilmCamera | null> {
  const { data, error } = await supabase.from("rr_film_cameras").select(CAMERA_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as FilmCamera) ?? null;
}

export interface NewDriveCamera {
  driveFileId: string;
  name: string;
  sourceName: string;
  size: number | null;
}

/** Inserts Drive cameras (staff only, enforced by RLS). */
export async function createDriveCameras(
  supabase: SupabaseClient,
  gameId: string,
  startPosition: number,
  cameras: NewDriveCamera[],
): Promise<FilmCamera[]> {
  const { data, error } = await supabase
    .from("rr_film_cameras")
    .insert(
      cameras.map((c, i) => ({
        game_id: gameId,
        name: c.name,
        position: startPosition + i,
        source: "drive",
        drive_file_id: c.driveFileId,
        source_name: c.sourceName,
        size_bytes: c.size,
      })),
    )
    .select(CAMERA_COLUMNS);
  if (error) throw error;
  return (data ?? []) as unknown as FilmCamera[];
}

export async function renameFilmCamera(supabase: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await supabase.from("rr_film_cameras").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function deleteFilmCameraRow(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("rr_film_cameras").delete().eq("id", id);
  if (error) throw error;
}

const WATCH_COLUMNS =
  "id, game_id, folder_id, folder_name, active, expires_at, last_checked_at, last_error, imported_count, created_at";

export async function getFilmWatches(supabase: SupabaseClient, gameId: string): Promise<FilmWatch[]> {
  const { data, error } = await supabase
    .from("rr_film_watches")
    .select(WATCH_COLUMNS)
    .eq("game_id", gameId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as FilmWatch[];
}

function watchExpiry(): string {
  return new Date(Date.now() + WATCH_DAYS * 86_400_000).toISOString();
}

/** Starts watching a folder for a game, or restarts an earlier watch of it. Staff only (RLS). */
export async function watchFolder(
  supabase: SupabaseClient,
  gameId: string,
  folderId: string,
  folderName: string,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("rr_film_watches")
    .select("id")
    .eq("game_id", gameId)
    .eq("folder_id", folderId)
    .maybeSingle();
  if (error) throw error;
  const result = existing
    ? await supabase
        .from("rr_film_watches")
        .update({ active: true, expires_at: watchExpiry(), folder_name: folderName })
        .eq("id", existing.id)
    : await supabase
        .from("rr_film_watches")
        .insert({ game_id: gameId, folder_id: folderId, folder_name: folderName, expires_at: watchExpiry() });
  if (result.error) throw result.error;
}

/** Pauses or resumes a watch; resuming runs it for another WATCH_DAYS. Staff only (RLS). */
export async function setWatchActive(supabase: SupabaseClient, id: string, active: boolean): Promise<FilmWatch | null> {
  const { data, error } = await supabase
    .from("rr_film_watches")
    .update(active ? { active, expires_at: watchExpiry() } : { active })
    .eq("id", id)
    .select(WATCH_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as FilmWatch) ?? null;
}
