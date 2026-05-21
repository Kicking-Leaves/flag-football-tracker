import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeSeasonStats,
  getGames,
  getPlayers,
  getTeam,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TeamDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const team = await getTeam(supabase, id);
  if (!team) notFound();

  const [players, games] = await Promise.all([
    getPlayers(supabase, id),
    getGames(supabase, id),
  ]);
  const season = computeSeasonStats(games);
  const completedGames = games.filter((g) => g.status === "completed");
  const inProgressGames = games.filter((g) => g.status === "in_progress");

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link href="/" className="text-sm text-green-100 underline">
            ← All teams
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{team.name}</h1>
          {season.gamesPlayed > 0 && (
            <p className="mt-1 text-2xl font-bold text-yellow-300">
              {season.wins}-{season.losses}
              {season.ties > 0 ? `-${season.ties}` : ""} · {season.gamesPlayed}{" "}
              games
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              href={`/teams/${id}/roster`}
              className="rounded-xl bg-white py-3 text-center font-bold text-green-700 shadow-lg"
            >
              Roster ({players.length})
            </Link>
            <Link
              href={`/teams/${id}/games/new`}
              className="rounded-xl bg-yellow-400 py-3 text-center font-bold text-gray-900 shadow-lg"
            >
              + New Game
            </Link>
          </div>
        </div>

        {/* Season summary */}
        {season.gamesPlayed > 0 && (
          <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              Season Summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Points For" value={season.totalPointsFor} />
              <Stat label="Points Against" value={season.totalPointsAgainst} />
              <Stat
                label="Total Yards"
                value={
                  season.offense.passingYards + season.offense.rushingYards
                }
              />
              <Stat label="Touchdowns" value={season.offense.touchdowns} />
            </div>
          </section>
        )}

        {/* In-progress games (resume) */}
        {inProgressGames.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              In Progress
            </h2>
            <div className="space-y-3">
              {inProgressGames.map((g) => (
                <Link
                  key={g.id}
                  href={`/teams/${id}/games/${g.id}`}
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

        {/* Game history */}
        <section>
          <h2 className="mb-4 text-xl font-bold text-gray-800">Game History</h2>
          {completedGames.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center shadow">
              <p className="text-gray-500">No completed games yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedGames.map((g) => {
                const teamScore = g.game_data.score?.team ?? 0;
                const oppScore = g.game_data.score?.opponent ?? 0;
                const win = teamScore > oppScore;
                const loss = teamScore < oppScore;
                return (
                  <Link
                    key={g.id}
                    href={`/teams/${id}/games/${g.id}/stats`}
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
