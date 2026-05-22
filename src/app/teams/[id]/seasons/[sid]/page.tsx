import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeSeasonStats,
  getGames,
  getPlayers,
  getSeason,
  getTeam,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SeasonDetailPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id: teamId, sid: seasonId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [team, season] = await Promise.all([
    getTeam(supabase, teamId),
    getSeason(supabase, seasonId),
  ]);
  if (!team || !season) notFound();
  if (season.team_id !== teamId) notFound();

  const [players, games] = await Promise.all([
    getPlayers(supabase, teamId, seasonId),
    getGames(supabase, teamId, seasonId),
  ]);
  const stats = computeSeasonStats(games);
  const completedGames = games.filter((g) => g.status === "completed");
  const inProgressGames = games.filter((g) => g.status === "in_progress");

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link
            href={`/teams/${teamId}`}
            className="text-sm text-green-100 underline"
          >
            ← {team.name}
          </Link>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h1 className="text-3xl font-bold">{season.displayName}</h1>
            {season.is_active && (
              <span className="rounded-full bg-yellow-300 px-3 py-1 text-xs font-bold uppercase text-gray-900">
                Active
              </span>
            )}
          </div>
          <p className="mt-1 text-lg text-green-100">{team.name}</p>
          {stats.gamesPlayed > 0 && (
            <p className="mt-2 text-2xl font-bold text-yellow-300">
              {stats.wins}-{stats.losses}
              {stats.ties > 0 ? `-${stats.ties}` : ""} · {stats.gamesPlayed}{" "}
              games
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              href={`/teams/${teamId}/roster?season=${seasonId}`}
              className="rounded-xl bg-white py-3 text-center font-bold text-green-700 shadow-lg"
            >
              Roster ({players.length})
            </Link>
            <Link
              href={`/teams/${teamId}/games/new?season=${seasonId}`}
              className="rounded-xl bg-yellow-400 py-3 text-center font-bold text-gray-900 shadow-lg"
            >
              + New Game
            </Link>
          </div>
        </div>

        {/* Season summary */}
        {stats.gamesPlayed > 0 && (
          <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              Season Summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Points For" value={stats.totalPointsFor} />
              <Stat label="Points Against" value={stats.totalPointsAgainst} />
              <Stat
                label="Total Yards"
                value={stats.offense.passingYards + stats.offense.rushingYards}
              />
              <Stat label="Touchdowns" value={stats.offense.touchdowns} />
            </div>
          </section>
        )}

        {/* In-progress games */}
        {inProgressGames.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              In Progress
            </h2>
            <div className="space-y-3">
              {inProgressGames.map((g) => (
                <Link
                  key={g.id}
                  href={`/teams/${teamId}/games/${g.id}`}
                  className="block rounded-xl bg-white p-5 shadow-lg transition hover:shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">
                        {new Date(g.game_date).toLocaleDateString()}
                      </p>
                      <p className="text-lg font-bold text-gray-800">
                        vs {g.opponent_name}
                      </p>
                      <p className="mt-1 text-sm text-blue-600">
                        Tap to resume →
                      </p>
                    </div>
                    <p className="text-2xl font-bold">
                      {g.game_data.score?.team ?? 0} -{" "}
                      {g.game_data.score?.opponent ?? 0}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Schedule / history */}
        <section>
          <h2 className="mb-4 text-xl font-bold text-gray-800">Schedule</h2>
          {completedGames.length === 0 && inProgressGames.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center shadow">
              <p className="text-gray-500">No games yet this season.</p>
              <Link
                href={`/teams/${teamId}/games/new?season=${seasonId}`}
                className="mt-3 inline-block rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-gray-900"
              >
                + Add the first game
              </Link>
            </div>
          ) : completedGames.length === 0 ? null : (
            <div className="space-y-3">
              {completedGames.map((g) => {
                const teamScore = g.game_data.score?.team ?? 0;
                const oppScore = g.game_data.score?.opponent ?? 0;
                const win = teamScore > oppScore;
                const loss = teamScore < oppScore;
                return (
                  <Link
                    key={g.id}
                    href={`/teams/${teamId}/games/${g.id}/stats`}
                    className="block rounded-xl bg-white p-5 shadow transition hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">
                          {new Date(g.game_date).toLocaleDateString()}
                        </p>
                        <p className="text-lg font-bold text-gray-800">
                          vs {g.opponent_name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xl font-bold ${
                            win
                              ? "text-green-600"
                              : loss
                                ? "text-red-500"
                                : "text-gray-600"
                          }`}
                        >
                          {teamScore} - {oppScore}
                        </p>
                        <p className="text-xs uppercase text-gray-400">
                          {win ? "Win" : loss ? "Loss" : "Tie"}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-600">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
    </div>
  );
}
