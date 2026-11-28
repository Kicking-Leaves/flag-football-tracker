import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole, getTeam } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getFilmCameras, getFilmClips, getFilmExports, getTeamPlayWindow } from "@/lib/film/db";
import { filmConfig, signedReadUrl } from "@/lib/film/server";
import type { FilmPlayableCamera } from "@/lib/film/types";
import FilmReview from "./FilmReview";

export const dynamic = "force-dynamic";

/** Long enough to watch a whole game in one sitting. */
const VIDEO_LINK_MINUTES = 12 * 60;

export default async function WatchFilmPage({
  params,
}: {
  params: Promise<{ id: string; gid: string }>;
}) {
  const { id: teamId, gid: gameId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [team, game, role] = await Promise.all([
    getTeam(supabase, teamId),
    getGame(supabase, gameId),
    getMyTeamRole(supabase, teamId, user.id),
  ]);
  if (!team || !game || !role || game.team_id !== teamId) notFound();

  const [cameraRows, clips, exports, playWindow] = await Promise.all([
    getFilmCameras(supabase, gameId),
    getFilmClips(supabase, gameId),
    getFilmExports(supabase, gameId),
    getTeamPlayWindow(supabase, teamId),
  ]);

  const owner = { teamId, gameId };
  const cameras: FilmPlayableCamera[] = filmConfig()
    ? (
        await Promise.all(
          cameraRows
            .filter((c) => c.status === "ready" && c.proxy_path && c.duration_ms)
            .map(async (c) => {
              try {
                return {
                  id: c.id,
                  name: c.name,
                  videoUrl: await signedReadUrl(c.proxy_path!, owner, { minutes: VIDEO_LINK_MINUTES }),
                  thumbUrl: c.thumb_path ? await signedReadUrl(c.thumb_path, owner, { minutes: VIDEO_LINK_MINUTES }) : null,
                  recorded_start_at: c.recorded_start_at,
                  duration_ms: c.duration_ms!,
                  nudge_ms: c.nudge_ms,
                  width: c.width,
                  height: c.height,
                };
              } catch (err) {
                console.error(err);
                return null;
              }
            }),
        )
      ).filter((c): c is FilmPlayableCamera => c !== null)
    : [];

  const playerNames: Record<string, string> = {};
  for (const [id, p] of Object.entries(game.game_data?.playerStats ?? {})) {
    playerNames[id] = p.number ? `#${p.number} ${p.name}` : p.name;
  }

  return (
    <main className="min-h-screen bg-gray-950 pb-24 text-white">
      <div className="mx-auto max-w-6xl p-3 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Link href={`/teams/${teamId}/games/${gameId}/film`} className="text-sm text-gray-400 underline">
              ← Film
            </Link>
            <h1 className="text-xl font-bold sm:text-2xl">
              {team.name} vs {game.opponent_name}
            </h1>
          </div>
          <p className="text-sm text-gray-400">{new Date(game.game_date).toLocaleDateString()}</p>
        </div>

        {cameras.length === 0 ? (
          <div className="rounded-xl bg-gray-900 p-6 text-gray-300">
            <p>No film is ready to watch yet.</p>
            <Link href={`/teams/${teamId}/games/${gameId}/film`} className="mt-2 inline-block text-blue-400 underline">
              Import film for this game
            </Link>
          </div>
        ) : (
          <FilmReview
            gameId={gameId}
            teamId={teamId}
            teamName={team.name}
            opponentName={game.opponent_name}
            state={game.game_data}
            cameras={cameras}
            initialClips={clips}
            initialExports={exports}
            initialWindow={playWindow}
            playerNames={playerNames}
            canSync={can(role, "manageTeam")}
            canClip={can(role, "scoreGame")}
          />
        )}
      </div>
    </main>
  );
}
