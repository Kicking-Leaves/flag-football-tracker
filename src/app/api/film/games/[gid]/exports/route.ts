import { filmErrorResponse, gameAccess, UUID_RE } from "@/lib/film/access";
import { getFilmExports } from "@/lib/film/db";
import { FilmError } from "@/lib/film/server";

/** GET → the game's download cuts that haven't expired. Anyone on the team. */
export async function GET(_request: Request, ctx: RouteContext<"/api/film/games/[gid]/exports">) {
  try {
    const { gid } = await ctx.params;
    if (!UUID_RE.test(gid)) throw new FilmError("Game not found.", 404);
    const access = await gameAccess(gid);
    return Response.json({ exports: await getFilmExports(access.supabase, gid) });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
