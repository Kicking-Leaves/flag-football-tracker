import { gameAccess, requireManage, filmErrorResponse, UUID_RE } from "@/lib/film/access";
import { createDriveCameras, deleteFilmCameraRow, getFilmCameras, getFilmWatches, type NewDriveCamera } from "@/lib/film/db";
import { FilmError, startFilmJob } from "@/lib/film/server";
import { toCameraViews } from "@/lib/film/views";

const MAX_CAMERAS = 8;

/** GET → the game's cameras (with thumbnail links) and watched folders. Anyone on the team. */
export async function GET(_request: Request, ctx: RouteContext<"/api/film/games/[gid]/cameras">) {
  try {
    const { gid } = await ctx.params;
    if (!UUID_RE.test(gid)) throw new FilmError("Game not found.", 404);
    const access = await gameAccess(gid);
    const [cameras, watches] = await Promise.all([
      getFilmCameras(access.supabase, gid),
      getFilmWatches(access.supabase, gid),
    ]);
    return Response.json({ cameras: await toCameraViews(cameras), watches });
  } catch (err) {
    return filmErrorResponse(err);
  }
}

/** POST { cameras: [{ driveFileId, name, sourceName, size }] } → import from Drive. Staff only. */
export async function POST(request: Request, ctx: RouteContext<"/api/film/games/[gid]/cameras">) {
  try {
    const { gid } = await ctx.params;
    if (!UUID_RE.test(gid)) throw new FilmError("Game not found.", 404);
    const access = await gameAccess(gid);
    requireManage(access);

    const body = (await request.json().catch(() => ({}))) as { cameras?: NewDriveCamera[] };
    const picked = (body.cameras ?? [])
      .filter((c) => c && typeof c.driveFileId === "string" && /^[A-Za-z0-9_-]{10,}$/.test(c.driveFileId))
      .map((c) => ({
        driveFileId: c.driveFileId,
        name: String(c.name ?? "").trim().slice(0, 60) || "Camera",
        sourceName: String(c.sourceName ?? "").slice(0, 255),
        size: typeof c.size === "number" && c.size > 0 ? c.size : null,
      }));
    if (picked.length === 0) throw new FilmError("Pick at least one video to import.");

    const existing = await getFilmCameras(access.supabase, gid);
    if (existing.length + picked.length > MAX_CAMERAS) {
      throw new FilmError(`A game can have up to ${MAX_CAMERAS} cameras.`);
    }
    const created = await createDriveCameras(access.supabase, gid, existing.length, picked);

    // Start one worker per camera; if a start fails, remove that camera so the
    // coach can try again rather than leaving it stuck "waiting".
    const failed: string[] = [];
    await Promise.all(
      created.map(async (c) => {
        try {
          await startFilmJob("import", c.id);
        } catch (err) {
          console.error(err);
          failed.push(c.name);
          await deleteFilmCameraRow(access.supabase, c.id).catch(() => {});
        }
      }),
    );
    if (failed.length === created.length) throw new FilmError("Couldn't start the import. Please try again.", 502);
    return Response.json({ started: created.length - failed.length, failed });
  } catch (err) {
    return filmErrorResponse(err);
  }
}
