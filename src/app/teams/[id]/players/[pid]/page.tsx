import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computePlayerSeasonStats,
  getGames,
  getPlayer,
  getSeasons,
  getTeam,
} from "@/lib/db";
import type { Game, PlayerStats, Season } from "@/lib/types";
import { makeEmptyPlayerStats } from "@/lib/game-engine";

export const dynamic = "force-dynamic";

function hasPassing(p: PlayerStats): boolean {
  return p.offense.passAttempts > 0;
}
function hasRushing(p: PlayerStats): boolean {
  return p.offense.rushAttempts > 0;
}
function hasReceiving(p: PlayerStats): boolean {
  return p.offense.receptions > 0;
}
function hasDefense(p: PlayerStats): boolean {
  return (
    p.defense.flagPulls > 0 ||
    p.defense.interceptions > 0 ||
    p.defense.tacklesForLoss > 0 ||
    p.defense.passDeflections > 0
  );
}

/**
 * Walk every completed game and accumulate stats for any playerStats entry
 * whose name+number matches. Returns the aggregated PlayerStats and the
 * matching games (for per-season breakdowns).
 */
function aggregateCareer(
  games: Game[],
  name: string,
  number: string,
): { total: PlayerStats; matchedGames: Game[] } {
  const total = makeEmptyPlayerStats(name, number);
  const matchedGames: Game[] = [];

  for (const g of games) {
    if (g.status !== "completed") continue;
    const gd = g.game_data;
    if (!gd?.playerStats) continue;
    const match = Object.values(gd.playerStats).find(
      (ps) => ps.name === name && ps.number === number,
    );
    if (!match) continue;
    matchedGames.push(g);
    total.offense.passAttempts += match.offense.passAttempts ?? 0;
    total.offense.completions += match.offense.completions ?? 0;
    total.offense.incompletions += match.offense.incompletions ?? 0;
    total.offense.passingYards += match.offense.passingYards ?? 0;
    total.offense.interceptions += match.offense.interceptions ?? 0;
    total.offense.rushAttempts += match.offense.rushAttempts ?? 0;
    total.offense.rushingYards += match.offense.rushingYards ?? 0;
    total.offense.receptions += match.offense.receptions ?? 0;
    total.offense.receivingYards += match.offense.receivingYards ?? 0;
    total.offense.touchdowns += match.offense.touchdowns ?? 0;
    total.defense.flagPulls += match.defense.flagPulls ?? 0;
    total.defense.interceptions += match.defense.interceptions ?? 0;
    total.defense.tacklesForLoss += match.defense.tacklesForLoss ?? 0;
    total.defense.passDeflections += match.defense.passDeflections ?? 0;
  }
  return { total, matchedGames };
}

export default async function PlayerStatsPage({
  params,
}: {
  params: Promise<{ id: string; pid: string }>;
}) {
  const { id: teamId, pid: playerId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [team, player, allGames, seasons] = await Promise.all([
    getTeam(supabase, teamId),
    getPlayer(supabase, playerId),
    getGames(supabase, teamId),
    getSeasons(supabase, teamId),
  ]);

  if (!team || !player) notFound();
  if (player.team_id !== teamId) notFound();

  // Find the player's season (if assigned).
  const playerSeason: Season | null = player.season_id
    ? (seasons.find((s) => s.id === player.season_id) ?? null)
    : null;

  // Single-season stats (by ID — exact attribution from this player record).
  const { total: seasonTotal, lines } = computePlayerSeasonStats(
    playerSeason ? allGames.filter((g) => g.season_id === playerSeason.id) : allGames,
    player.id,
    player.name,
    player.number,
  );

  // Career stats (across every season on this team, matched by name+number).
  const { total: careerTotal, matchedGames } = aggregateCareer(
    allGames,
    player.name,
    player.number,
  );

  // Per-season career breakdown: group matched games by season.
  const seasonBuckets = new Map<
    string,
    { season: Season | null; games: Game[]; total: PlayerStats }
  >();
  for (const g of matchedGames) {
    const key = g.season_id ?? "__legacy__";
    if (!seasonBuckets.has(key)) {
      const s =
        g.season_id != null
          ? (seasons.find((sn) => sn.id === g.season_id) ?? null)
          : null;
      seasonBuckets.set(key, {
        season: s,
        games: [],
        total: makeEmptyPlayerStats(player.name, player.number),
      });
    }
    const bucket = seasonBuckets.get(key)!;
    bucket.games.push(g);
    const ps = Object.values(g.game_data?.playerStats ?? {}).find(
      (p) => p.name === player.name && p.number === player.number,
    );
    if (!ps) continue;
    bucket.total.offense.passAttempts += ps.offense.passAttempts ?? 0;
    bucket.total.offense.completions += ps.offense.completions ?? 0;
    bucket.total.offense.passingYards += ps.offense.passingYards ?? 0;
    bucket.total.offense.rushAttempts += ps.offense.rushAttempts ?? 0;
    bucket.total.offense.rushingYards += ps.offense.rushingYards ?? 0;
    bucket.total.offense.receptions += ps.offense.receptions ?? 0;
    bucket.total.offense.receivingYards += ps.offense.receivingYards ?? 0;
    bucket.total.offense.touchdowns += ps.offense.touchdowns ?? 0;
    bucket.total.offense.interceptions += ps.offense.interceptions ?? 0;
    bucket.total.defense.flagPulls += ps.defense.flagPulls ?? 0;
    bucket.total.defense.interceptions += ps.defense.interceptions ?? 0;
    bucket.total.defense.tacklesForLoss += ps.defense.tacklesForLoss ?? 0;
    bucket.total.defense.passDeflections += ps.defense.passDeflections ?? 0;
  }
  const orderedBuckets = Array.from(seasonBuckets.values()).sort((a, b) => {
    const ay = a.season?.year ?? -Infinity;
    const by = b.season?.year ?? -Infinity;
    return by - ay;
  });

  const showCareerPassing = hasPassing(careerTotal);
  const showCareerRushing = hasRushing(careerTotal);
  const showCareerReceiving = hasReceiving(careerTotal);
  const showCareerDefense = hasDefense(careerTotal);
  const seasonGamesPlayed = lines.filter((l) => l.stats !== null).length;
  const careerGamesPlayed = matchedGames.length;

  const rosterBackHref = playerSeason
    ? `/teams/${teamId}/roster?season=${playerSeason.id}`
    : `/teams/${teamId}/roster`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-12">
      <div className="mx-auto max-w-3xl p-6">
        {/* Header / profile card */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <Link
            href={rosterBackHref}
            className="text-sm text-blue-100 underline"
          >
            ← Roster
          </Link>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-yellow-300">
              #{player.number}
            </span>
            <h1 className="text-3xl font-bold">{player.name}</h1>
          </div>
          <div className="mt-2 space-y-1 text-sm text-blue-100">
            <p>
              {team.name}
              {playerSeason ? ` · ${playerSeason.displayName}` : ""}
            </p>
            {player.graduation_year && (
              <p>Class of {player.graduation_year}</p>
            )}
            {(player.position_offense || player.position_defense) && (
              <p>
                {player.position_offense ?? "—"} (Off) ·{" "}
                {player.position_defense ?? "—"} (Def)
              </p>
            )}
            {!player.active && (
              <p className="font-semibold text-orange-200">Inactive</p>
            )}
          </div>
          {player.notes && (
            <p className="mt-3 rounded-lg bg-white/10 p-3 text-sm">
              {player.notes}
            </p>
          )}
        </div>

        {/* Season totals (this player record's season) */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-gray-800">
            {playerSeason
              ? `${playerSeason.displayName} Stats`
              : "Season Stats"}{" "}
            ({seasonGamesPlayed}{" "}
            {seasonGamesPlayed === 1 ? "game" : "games"})
          </h2>

          {!hasPassing(seasonTotal) &&
          !hasRushing(seasonTotal) &&
          !hasReceiving(seasonTotal) &&
          !hasDefense(seasonTotal) ? (
            <p className="text-sm text-gray-500">
              No stats recorded yet for this season.
            </p>
          ) : (
            <StatGrid total={seasonTotal} />
          )}
        </section>

        {/* Career totals across the team's history */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-gray-800">
            Career Stats ({careerGamesPlayed}{" "}
            {careerGamesPlayed === 1 ? "game" : "games"})
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Aggregates every completed game on {team.name} where #{player.number}{" "}
            {player.name} appeared.
          </p>
          {!showCareerPassing &&
          !showCareerRushing &&
          !showCareerReceiving &&
          !showCareerDefense ? (
            <p className="text-sm text-gray-500">No career stats yet.</p>
          ) : (
            <StatGrid total={careerTotal} />
          )}
        </section>

        {/* Per-season career breakdown */}
        {orderedBuckets.length > 1 && (
          <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-gray-800">
              Per-Season Breakdown
            </h2>
            <div className="space-y-3">
              {orderedBuckets.map((bucket, idx) => (
                <div
                  key={bucket.season?.id ?? `legacy-${idx}`}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                >
                  <p className="mb-2 font-bold text-gray-800">
                    {bucket.season?.displayName ?? "(unassigned games)"} ·{" "}
                    {bucket.games.length}{" "}
                    {bucket.games.length === 1 ? "game" : "games"}
                  </p>
                  <p className="text-xs text-gray-600">
                    {summarizeLine(bucket.total)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Per-game log for the player's current season */}
        <section className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-gray-800">Game Log</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">No completed games yet.</p>
          ) : (
            <div className="space-y-3">
              {lines.map(({ game, stats }) => {
                const teamScore = game.game_data?.score?.team ?? 0;
                const oppScore = game.game_data?.score?.opponent ?? 0;
                const win = teamScore > oppScore;
                const loss = teamScore < oppScore;
                return (
                  <Link
                    key={game.id}
                    href={`/teams/${teamId}/games/${game.id}/stats`}
                    className="block rounded-xl border border-gray-100 bg-gray-50 p-4 transition hover:bg-blue-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500">
                          {new Date(game.game_date).toLocaleDateString()}
                        </p>
                        <p className="font-bold text-gray-800">
                          vs {game.opponent_name}
                        </p>
                        {stats ? (
                          <p className="mt-1 text-xs text-gray-600">
                            {summarizeLine(stats)}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs italic text-gray-400">
                            Did not record stats
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-bold ${
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
                          {win ? "W" : loss ? "L" : "T"}
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

function StatGrid({ total }: { total: PlayerStats }) {
  const showPassing = hasPassing(total);
  const showRushing = hasRushing(total);
  const showReceiving = hasReceiving(total);
  const showDefense = hasDefense(total);

  return (
    <div className="space-y-4">
      {showPassing && (
        <StatGroup
          title="Passing"
          items={[
            ["Att", total.offense.passAttempts],
            ["Cmp", total.offense.completions],
            ["Yds", total.offense.passingYards],
            ["TD", total.offense.touchdowns],
            ["INT", total.offense.interceptions],
          ]}
        />
      )}
      {showRushing && (
        <StatGroup
          title="Rushing"
          items={[
            ["Att", total.offense.rushAttempts],
            ["Yds", total.offense.rushingYards],
          ]}
        />
      )}
      {showReceiving && (
        <StatGroup
          title="Receiving"
          items={[
            ["Rec", total.offense.receptions],
            ["Yds", total.offense.receivingYards],
          ]}
        />
      )}
      {showDefense && (
        <StatGroup
          title="Defense"
          items={[
            ["Flag Pulls", total.defense.flagPulls],
            ["INT", total.defense.interceptions],
            ["TFL", total.defense.tacklesForLoss],
            ["PD", total.defense.passDeflections],
          ]}
        />
      )}
    </div>
  );
}

function StatGroup({
  title,
  items,
}: {
  title: string;
  items: [string, number][];
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-800">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Build a short one-line summary of a player's stat line for a single game. */
function summarizeLine(s: PlayerStats): string {
  const parts: string[] = [];
  if (s.offense.passAttempts > 0) {
    parts.push(
      `${s.offense.completions}/${s.offense.passAttempts} ${s.offense.passingYards} yds`,
    );
  }
  if (s.offense.rushAttempts > 0) {
    parts.push(
      `${s.offense.rushAttempts} car / ${s.offense.rushingYards} yds`,
    );
  }
  if (s.offense.receptions > 0) {
    parts.push(
      `${s.offense.receptions} rec / ${s.offense.receivingYards} yds`,
    );
  }
  if (s.offense.touchdowns > 0) {
    parts.push(`${s.offense.touchdowns} TD`);
  }
  const defParts: string[] = [];
  if (s.defense.flagPulls > 0) defParts.push(`${s.defense.flagPulls} flags`);
  if (s.defense.interceptions > 0)
    defParts.push(`${s.defense.interceptions} INT`);
  if (s.defense.tacklesForLoss > 0)
    defParts.push(`${s.defense.tacklesForLoss} TFL`);
  if (s.defense.passDeflections > 0)
    defParts.push(`${s.defense.passDeflections} PD`);
  if (defParts.length > 0) parts.push(defParts.join(", "));
  return parts.length > 0 ? parts.join(" · ") : "No stats this game";
}
