import { filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { FilmError, signedReadUrl } from "@/lib/film/server";
import { EXPORT_COLUMNS, type FilmExport } from "@/lib/film/types";
import { createClient } from "@/lib/supabase/server";

/**
 * GET → a download cut's status. With ?download=1 and the cut ready, redirects
 * to a private link that saves the file. Anyone on the team (RLS).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/film/exports/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new FilmError("Download not found.", 404);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("rr_film_exports")
      .select(`${EXPORT_COLUMNS}, team_id, path`)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new FilmError("Download not found.", 404);
    const { team_id: teamId, path, ...row } = data as FilmExport & { team_id: string; path: string | null };

    if (new URL(request.url).searchParams.get("download") === "1") {
      if (row.status !== "ready" || !path) throw new FilmError("This download isn't ready yet.", 409);
      if (Date.parse(row.expires_at) < Date.now()) throw new FilmError("This download has expired. Make it again.", 410);
      const url = await signedReadUrl(path, { teamId, gameId: row.game_id }, { minutes: 60, downloadName: row.file_name });
      return Response.redirect(url, 302);
    }
    return Response.json({ export: row });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
