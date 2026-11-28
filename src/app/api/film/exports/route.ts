import { isScorebugPosition } from "@/components/overlay/ScorebugBar";
import { filmErrorResponse, gameAccess, UUID_RE } from "@/lib/film/access";
import { getFilmCamera } from "@/lib/film/db";
import { requestExport } from "@/lib/film/exports";
import { FilmError } from "@/lib/film/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST { cameraId, playId? | clipId?, overlay } → a download cut of that play
 * or clip from that camera, started (or reused). Anyone on the team.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      cameraId?: string;
      playId?: number;
      clipId?: string;
      overlay?: boolean;
      position?: string;
    };
    if (!body.cameraId || !UUID_RE.test(body.cameraId)) throw new FilmError("Pick a camera.");
    if (body.clipId !== undefined && !UUID_RE.test(String(body.clipId))) throw new FilmError("Clip not found.", 404);
    if (body.playId !== undefined && !Number.isSafeInteger(body.playId)) throw new FilmError("Play not found.", 404);
    const camera = await getFilmCamera(await createClient(), body.cameraId);
    if (!camera) throw new FilmError("Camera not found.", 404);
    const access = await gameAccess(camera.game_id);
    const created = await requestExport(access, {
      camera,
      playId: body.playId,
      clipId: body.clipId,
      overlay: Boolean(body.overlay),
      position: isScorebugPosition(body.position) ? body.position : "bottom-left",
    });
    return Response.json({ export: created });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
