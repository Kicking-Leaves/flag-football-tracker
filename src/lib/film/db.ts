import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLIP_COLUMNS,
  EXPORT_COLUMNS,
  WATCH_DAYS,
  type FilmCamera,
  type FilmClip,
  type FilmExport,
  type FilmWatch,
} from "./types";
import { DEFAULT_POST_ROLL_S, DEFAULT_PRE_ROLL_S } from "./sync";

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

export async function setFilmCameraNudge(supabase: SupabaseClient, id: string, nudgeMs: number): Promise<void> {
  const { error } = await supabase.from("rr_film_cameras").update({ nudge_ms: nudgeMs }).eq("id", id);
  if (error) throw error;
}

export async function deleteFilmCameraRow(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("rr_film_cameras").delete().eq("id", id);
  if (error) throw error;
}

const WATCH_COLUMNS =
  "id, game_id, folder_id, folder_name, active, expires_at, last_checked_at, last_error, imported_count, source, created_at";

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

export interface TeamFilmInbox {
  inboxId: string;
  folderName: string | null;
  folderId: string;
  code: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Recent game folders for this team, plus any whose team code didn't match. */
  folders: {
    id: string;
    folder_name: string;
    status: "matched" | "unmatched";
    reason: string | null;
    game_id: string | null;
    team_id: string | null;
    updated_at: string;
  }[];
}

/** The film inbox linked to a team, if any (Woodinville teams for now). */
export async function getTeamFilmInbox(supabase: SupabaseClient, teamId: string): Promise<TeamFilmInbox | null> {
  const { data: link, error } = await supabase
    .from("rr_film_inbox_teams")
    .select("code, rr_film_inboxes(id, folder_id, folder_name, last_checked_at, last_error)")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw error;
  const inbox = (link as unknown as {
    code: string;
    rr_film_inboxes: { id: string; folder_id: string; folder_name: string | null; last_checked_at: string | null; last_error: string | null } | null;
  } | null);
  if (!inbox?.rr_film_inboxes) return null;
  const { data: folders, error: foldersError } = await supabase
    .from("rr_film_inbox_folders")
    .select("id, folder_name, status, reason, game_id, team_id, updated_at")
    .eq("inbox_id", inbox.rr_film_inboxes.id)
    .or(`team_id.eq.${teamId},team_id.is.null`)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (foldersError) throw foldersError;
  return {
    inboxId: inbox.rr_film_inboxes.id,
    folderId: inbox.rr_film_inboxes.folder_id,
    folderName: inbox.rr_film_inboxes.folder_name,
    code: inbox.code,
    lastCheckedAt: inbox.rr_film_inboxes.last_checked_at,
    lastError: inbox.rr_film_inboxes.last_error,
    folders: (folders ?? []) as TeamFilmInbox["folders"],
  };
}

// ---------- Clips and downloads ----------

export async function getFilmClips(supabase: SupabaseClient, gameId: string): Promise<FilmClip[]> {
  const { data, error } = await supabase
    .from("rr_film_clips")
    .select(CLIP_COLUMNS)
    .eq("game_id", gameId)
    .order("start_at");
  if (error) throw error;
  return (data ?? []) as FilmClip[];
}

/** Download cuts that haven't expired, newest first. */
export async function getFilmExports(supabase: SupabaseClient, gameId: string): Promise<FilmExport[]> {
  const { data, error } = await supabase
    .from("rr_film_exports")
    .select(EXPORT_COLUMNS)
    .eq("game_id", gameId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as FilmExport[];
}

/** The team's play window: seconds before and after a play's logged time. */
export async function getTeamPlayWindow(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{ preRollS: number; postRollS: number }> {
  const { data, error } = await supabase
    .from("rr_teams")
    .select("film_pre_roll_s, film_post_roll_s")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw error;
  return {
    preRollS: data?.film_pre_roll_s ?? DEFAULT_PRE_ROLL_S,
    postRollS: data?.film_post_roll_s ?? DEFAULT_POST_ROLL_S,
  };
}
