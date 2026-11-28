import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole, getTeam } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getFilmCameras, getFilmWatches } from "@/lib/film/db";
import { filmConfig, filmShareEmail } from "@/lib/film/server";
import { toCameraViews } from "@/lib/film/views";
import FilmManager from "./FilmManager";

export const dynamic = "force-dynamic";

export default async function GameFilmPage({
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

  const [cameraRows, watches] = await Promise.all([
    getFilmCameras(supabase, gameId),
    getFilmWatches(supabase, gameId),
  ]);
  const cameras = await toCameraViews(cameraRows);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-24">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link href={`/teams/${teamId}/games/${gameId}/stats`} className="text-sm text-purple-100 underline">
            ← Game stats
          </Link>
          <h2 className="mt-2 text-3xl font-bold">Film</h2>
          <p className="text-lg">
            {team.name} vs {game.opponent_name}
          </p>
          <p className="mt-1 text-sm text-purple-100">{new Date(game.game_date).toLocaleDateString()}</p>
          {cameras.some((c) => c.status === "ready") && (
            <Link
              href={`/teams/${teamId}/games/${gameId}/film/watch`}
              className="mt-4 inline-block rounded-lg bg-white px-4 py-2 font-semibold text-purple-700 shadow hover:bg-purple-50"
            >
              ▶ Watch film
            </Link>
          )}
        </div>

        <FilmManager
          gameId={gameId}
          initialCameras={cameras}
          initialWatches={watches}
          canManage={can(role, "manageTeam")}
          configured={Boolean(filmConfig())}
          shareEmail={filmShareEmail()}
        />
      </div>
    </main>
  );
}
