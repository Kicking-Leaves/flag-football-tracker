import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilmCamera } from "./types";

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
