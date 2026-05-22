import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeSeasonStats,
  getActiveSeason,
  getGames,
  getTeams,
} from "@/lib/db";
import LogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const teams = await getTeams(supabase);

  // For each team, pull the active season's games to surface a record summary.
  // Teams with no active season fall back to "all games" so legacy rows still
  // contribute to the headline number.
  const teamCards = await Promise.all(
    teams.map(async (t) => {
      const active = await getActiveSeason(supabase, t.id);
      const games = await getGames(supabase, t.id, active?.id ?? null);
      const season = computeSeasonStats(games);
      return { team: t, activeSeason: active, season };
    }),
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-8 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 p-8 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold">RouteRunnr</h1>
              <p className="mt-1 text-lg text-green-100">
                Flag football game tracking — WIAA Washington State Rules
              </p>
              <p className="mt-2 text-sm text-green-100">
                Signed in as {user.email}
              </p>
            </div>
            <LogoutButton />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href="/teams/new"
              className="flex items-center justify-center rounded-xl bg-white py-4 text-lg font-bold text-green-600 shadow-lg transition hover:bg-green-50"
            >
              + New Team
            </Link>
          </div>
        </div>

        <h2 className="mb-4 text-2xl font-bold text-gray-800">Your Teams</h2>

        {teamCards.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow">
            <p className="text-lg text-gray-500">
              No teams yet. Create your first team to start tracking games.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {teamCards.map(({ team, activeSeason, season }) => (
              <Link
                key={team.id}
                href={`/teams/${team.id}`}
                className="block rounded-xl bg-white p-6 shadow-lg transition hover:shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xl font-bold text-gray-800">
                      {team.name}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {activeSeason
                        ? `${activeSeason.displayName} · `
                        : "No active season · "}
                      {team.player_count ?? 0} players · {season.gamesPlayed}{" "}
                      games played
                    </p>
                  </div>
                  <div className="text-right">
                    {season.gamesPlayed > 0 && (
                      <p className="text-2xl font-bold text-gray-800">
                        {season.wins}-{season.losses}
                        {season.ties > 0 ? `-${season.ties}` : ""}
                      </p>
                    )}
                    <p className="text-sm text-gray-400">View details →</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
