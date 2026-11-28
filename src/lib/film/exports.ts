// Server-only: turns a download request (camera + play or clip) into a cut of
// that camera's original, reusing an earlier identical cut when there is one.

import { getGame, getTeam } from "@/lib/db";
import type { GameState } from "@/lib/types";
import type { GameAccess } from "./access";
import { getFilmClips, getTeamPlayWindow } from "./db";
import { FilmError, startFilmJob } from "./server";
import {
  buildClipItems,
  buildPlayItems,
  cameraBaseMs,
  cutRange,
  exportFileName,
  overlaySegments,
  scorebugTimeline,
  type OverlaySegment,
} from "./sync";
import { EXPORT_COLUMNS, type FilmCamera, type FilmExport } from "./types";

export interface ExportRequest {
  camera: FilmCamera;
  playId?: number;
  clipId?: string;
  overlay: boolean;
}

/** In-flight cuts older than this are assumed lost (e.g. the job never started). */
const STALE_MS = 20 * 60_000;
/** Per person, per hour, to keep one person from running up the bill. */
const HOURLY_LIMIT = 30;

/** JSON with object keys sorted, so jsonb from Postgres compares equal to what we built. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export async function requestExport(access: GameAccess, req: ExportRequest): Promise<FilmExport> {
  const { supabase } = access;
  const { camera } = req;
  if (camera.status !== "ready" || !camera.original_path) {
    throw new FilmError("This camera isn't ready yet.");
  }

  const [game, team, window, clips] = await Promise.all([
    getGame(supabase, camera.game_id),
    getTeam(supabase, camera.team_id),
    getTeamPlayWindow(supabase, camera.team_id),
    getFilmClips(supabase, camera.game_id),
  ]);
  if (!game || !team) throw new FilmError("Game not found.", 404);
  const state = game.game_data as GameState;
  const plays = state?.plays ?? [];

  let range: { startAt: number; endAt: number; label: string };
  if (req.playId !== undefined) {
    const item = buildPlayItems(plays, clips, window.preRollS, window.postRollS).find((p) => p.id === req.playId);
    if (!item) throw new FilmError("That play has no logged time, so it can't be found on film.", 404);
    range = { startAt: item.startAt, endAt: item.endAt, label: item.label };
  } else if (req.clipId) {
    const item = buildClipItems(clips).find((c) => c.id === req.clipId);
    if (!item) throw new FilmError("Clip not found.", 404);
    range = { startAt: item.startAt, endAt: item.endAt, label: item.title };
  } else {
    throw new FilmError("Pick a play or a clip to download.");
  }

  const base = cameraBaseMs(camera, plays);
  const cut = base === null ? null : cutRange(camera, base, range.startAt, range.endAt);
  if (!cut) throw new FilmError(`${camera.name} didn't record this part of the game.`);

  const segments: OverlaySegment[] | null = req.overlay
    ? overlaySegments(scorebugTimeline(state, team.name, game.opponent_name), cut.startAt, cut.endAt)
    : null;

  // Reuse a finished (or recent, still running) identical cut.
  const { data: existing, error: findError } = await supabase
    .from("rr_film_exports")
    .select(`${EXPORT_COLUMNS}, overlay_segments, updated_at`)
    .eq("camera_id", camera.id)
    .eq("start_ms", cut.startMs)
    .eq("end_ms", cut.endMs)
    .eq("overlay", req.overlay)
    .in("status", ["queued", "processing", "ready"])
    .gt("expires_at", new Date(Date.now() + 3_600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (findError) throw findError;
  const reuse = (existing ?? []).find(
    (e) =>
      (e.status === "ready" || Date.now() - Date.parse(e.updated_at) < STALE_MS) &&
      (!req.overlay || canonical(e.overlay_segments) === canonical(segments)),
  );
  if (reuse) {
    const row: Record<string, unknown> = { ...reuse };
    delete row.overlay_segments;
    delete row.updated_at;
    return row as unknown as FilmExport;
  }

  const { count, error: countError } = await supabase
    .from("rr_film_exports")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", access.user.id)
    .gt("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if (countError) throw countError;
  if ((count ?? 0) >= HOURLY_LIMIT) {
    throw new FilmError(`You've made ${HOURLY_LIMIT} downloads in the last hour. Try again a little later.`, 429);
  }

  const { data: created, error: insertError } = await supabase
    .from("rr_film_exports")
    .insert({
      camera_id: camera.id,
      start_ms: cut.startMs,
      end_ms: cut.endMs,
      overlay: req.overlay,
      overlay_segments: segments,
      file_name: exportFileName({
        gameDate: game.game_date,
        opponent: game.opponent_name,
        label: range.label,
        camera: camera.name,
        overlay: req.overlay,
      }),
    })
    .select(EXPORT_COLUMNS)
    .single();
  if (insertError) throw insertError;

  await startFilmJob("export", created.id);
  return created as FilmExport;
}
