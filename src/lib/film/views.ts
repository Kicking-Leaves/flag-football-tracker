// Server-only: attaches short-lived links to cameras for the browser.

import type { FilmCamera, FilmCameraView } from "./types";
import { filmConfig, signedReadUrl } from "./server";

export async function toCameraViews(cameras: FilmCamera[]): Promise<FilmCameraView[]> {
  const configured = Boolean(filmConfig());
  return Promise.all(
    cameras.map(async (c) => ({
      ...c,
      thumbUrl:
        configured && c.thumb_path
          ? await signedReadUrl(c.thumb_path, { teamId: c.team_id, gameId: c.game_id }, { minutes: 120 }).catch(() => null)
          : null,
    })),
  );
}
