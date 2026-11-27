import { parseDriveFolderId } from "@/lib/film/drive";
import { gameAccess, requireManage, filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { getFilmWatches, watchFolder } from "@/lib/film/db";
import { checkDriveFolder, FilmError, runWatcherNow } from "@/lib/film/server";

/** POST { folder } → watch a Drive folder; new videos import automatically. Staff only. */
export async function POST(request: Request, ctx: RouteContext<"/api/film/games/[gid]/watches">) {
  try {
    const { gid } = await ctx.params;
    if (!UUID_RE.test(gid)) throw new FilmError("Game not found.", 404);
    const body = (await request.json().catch(() => ({}))) as { folder?: string };
    const folderId = parseDriveFolderId(body.folder ?? "");
    if (!folderId) throw new FilmError("That doesn't look like a Google Drive folder link.");

    const access = await gameAccess(gid);
    requireManage(access);
    const folder = await checkDriveFolder(folderId);
    await watchFolder(access.supabase, gid, folderId, folder.name);
    // Pick up anything already in the folder right away; the schedule covers the rest.
    await runWatcherNow().catch((err) => console.error(err));
    return Response.json({ watches: await getFilmWatches(access.supabase, gid) });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
