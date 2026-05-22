import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeSeasonStats,
  getGames,
  getSeasons,
  getTeam,
} from "@/lib/db";
import type { Season } from "@/lib/types";
import NewSeasonForm from "./NewSeasonForm";
import SeasonRowActions from "./SeasonRowActions";

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

  const seasons = await getSeasons(supabase, id);

  // For each season compute its record in parallel.
  const seasonCards = await Promise.all(
    seasons.map(async (s) => {
      const games = await getGames(supabase, id, s.id);
      const stats = computeSeasonStats(games);
      return { season: s, stats, totalGames: games.length };
    }),
  );

  // Detect any legacy games (no season_id) so the user knows about them.
  const allGames = await getGames(supabase, id);
  const legacyGames = allGames.filter((g) => !g.season_id);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link href="/" className="text-sm text-green-100 underline">
            ← All teams
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{team.name}</h1>
          <p className="mt-1 text-sm text-green-100">
            {seasons.length} {seasons.length === 1 ? "season" : "seasons"}
          </p>
        </div>

        <section className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">Seasons</h2>
          </div>

          <NewSeasonForm teamId={id} existingYears={seasons.map((s) => s)} />

          {seasonCards.length === 0 ? (
            <div className="mt-4 rounded-xl bg-white p-8 text-center shadow">
              <p className="text-gray-500">
                No seasons yet. Create one above to start tracking games.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {seasonCards.map(({ season, stats, totalGames }) => (
                <SeasonCard
                  key={season.id}
                  teamId={id}
                  season={season}
                  wins={stats.wins}
                  losses={stats.losses}
                  ties={stats.ties}
                  gamesPlayed={stats.gamesPlayed}
                  totalGames={totalGames}
                />
              ))}
            </ul>
          )}
        </section>

        {legacyGames.length > 0 && (
          <section className="rounded-2xl bg-yellow-50 p-5 shadow">
            <h3 className="text-sm font-bold text-yellow-900">
              {legacyGames.length} game{legacyGames.length === 1 ? "" : "s"} not
              yet assigned to a season
            </h3>
            <p className="mt-1 text-xs text-yellow-800">
              These games were created before seasons existed and remain
              accessible from individual game pages.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

interface SeasonCardProps {
  teamId: string;
  season: Season;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  totalGames: number;
}

function SeasonCard({
  teamId,
  season,
  wins,
  losses,
  ties,
  gamesPlayed,
  totalGames,
}: SeasonCardProps) {
  const record =
    gamesPlayed > 0
      ? `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}`
      : null;
  return (
    <li className="overflow-hidden rounded-xl bg-white shadow-lg transition hover:shadow-xl">
      <Link
        href={`/teams/${teamId}/seasons/${season.id}`}
        className="block p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-gray-800">
                {season.displayName}
              </h3>
              {season.is_active && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold uppercase text-green-700">
                  Active
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {totalGames} {totalGames === 1 ? "game" : "games"} ·{" "}
              {gamesPlayed} completed
            </p>
          </div>
          {record && (
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-800">{record}</p>
            </div>
          )}
        </div>
      </Link>
      {!season.is_active && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-2">
          <SeasonRowActions seasonId={season.id} teamId={teamId} />
        </div>
      )}
    </li>
  );
}
