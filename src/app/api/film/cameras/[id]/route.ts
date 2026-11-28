import { gameAccess, requireManage, filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { deleteFilmCameraRow, getFilmCamera, renameFilmCamera, setFilmCameraNudge } from "@/lib/film/db";
import { deleteFilmObjects, filmConfig, FilmError } from "@/lib/film/server";
import { createClient } from "@/lib/supabase/server";
import { isFilmInProgress } from "@/lib/film/types";

async function loadForManage(id: string) {
  if (!UUID_RE.test(id)) throw new FilmError("Camera not found.", 404);
  const camera = await getFilmCamera(await createClient(), id);
  if (!camera) throw new FilmError("Camera not found.", 404);
  const access = await gameAccess(camera.game_id);
  requireManage(access);
  return { camera, access };
}

/** Two days either way covers any camera clock or time zone mix-up. */
const MAX_NUDGE_MS = 2 * 86_400_000;

/** PATCH { name } → rename a camera; PATCH { nudgeMs } → save its sync. Staff only. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/film/cameras/[id]">) {
  try {
    const { id } = await ctx.params;
    const { access } = await loadForManage(id);
    const body = (await request.json().catch(() => ({}))) as { name?: string; nudgeMs?: number };
    if (body.nudgeMs !== undefined) {
      const nudge = Math.round(Number(body.nudgeMs));
      if (!Number.isFinite(nudge) || Math.abs(nudge) > MAX_NUDGE_MS) throw new FilmError("That sync is too far off.");
      await setFilmCameraNudge(access.supabase, id, nudge);
      return Response.json({ ok: true, nudgeMs: nudge });
    }
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) throw new FilmError("Give the camera a name.");
    await renameFilmCamera(access.supabase, id, name);
    return Response.json({ ok: true });
  } catch (err) {
    return filmErrorResponse(err);
  }
}

/** DELETE → remove a camera and its stored files. Staff only. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/film/cameras/[id]">) {
  try {
    const { id } = await ctx.params;
    const { camera, access } = await loadForManage(id);
    if (isFilmInProgress(camera.status)) {
      throw new FilmError("Wait for this camera to finish (or fail) before deleting it.");
    }
    if (filmConfig()) {
      await deleteFilmObjects([camera.original_path, camera.proxy_path, camera.thumb_path], {
        teamId: camera.team_id,
        gameId: camera.game_id,
      });
    }
    await deleteFilmCameraRow(access.supabase, id);
    return Response.json({ ok: true });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
