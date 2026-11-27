import { filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { setWatchActive } from "@/lib/film/db";
import { FilmError, runWatcherNow } from "@/lib/film/server";
import { createClient } from "@/lib/supabase/server";

/** PATCH { active } → pause or resume a watch. Staff only (enforced by RLS). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/film/watches/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new FilmError("Watch not found.", 404);
    const body = (await request.json().catch(() => ({}))) as { active?: boolean };
    if (typeof body.active !== "boolean") throw new FilmError("Say whether to pause or resume.");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new FilmError("Please sign in.", 401);
    // RLS lets only the team's admins and coaches update; anyone else gets no row back.
    const watch = await setWatchActive(supabase, id, body.active);
    if (!watch) throw new FilmError("Only admins and coaches can change this.", 403);
    if (body.active) await runWatcherNow().catch((err) => console.error(err));
    return Response.json({ watch });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
