import { gameAccess, requireManage, filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { getFilmCamera } from "@/lib/film/db";
import { FilmError, startFilmJob } from "@/lib/film/server";
import { createClient } from "@/lib/supabase/server";

/** POST → re-run a failed camera: re-copy if the copy never finished, else re-process. Staff only. */
export async function POST(_request: Request, ctx: RouteContext<"/api/film/cameras/[id]/retry">) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new FilmError("Camera not found.", 404);
    const camera = await getFilmCamera(await createClient(), id);
    if (!camera) throw new FilmError("Camera not found.", 404);
    const access = await gameAccess(camera.game_id);
    requireManage(access);
    if (camera.status !== "failed") throw new FilmError("This camera isn't in a failed state.");
    await startFilmJob(camera.original_path ? "process" : "import", camera.id);
    return Response.json({ ok: true });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
