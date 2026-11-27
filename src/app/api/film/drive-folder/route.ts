import { parseDriveFolderId } from "@/lib/film/drive";
import { gameAccess, requireManage, filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { checkDriveFolder, FilmError, listDriveFolder } from "@/lib/film/server";
import { getFilmCameras } from "@/lib/film/db";

/** POST { gameId, folder } → the video files in a shared Drive folder. Staff only. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { gameId?: string; folder?: string };
    if (!body.gameId || !UUID_RE.test(body.gameId)) throw new FilmError("Missing game.");
    const folderId = parseDriveFolderId(body.folder ?? "");
    if (!folderId) throw new FilmError("That doesn't look like a Google Drive folder link.");

    const access = await gameAccess(body.gameId);
    requireManage(access);

    const folder = await checkDriveFolder(folderId);
    const existing = await getFilmCameras(access.supabase, body.gameId);
    const imported = new Set(existing.map((c) => c.drive_file_id).filter((id): id is string => Boolean(id)));
    const files = await listDriveFolder(folderId, imported);
    return Response.json({ folderName: folder.name, files });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
