import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computePlayerSeasonStats, getGames, getPlayer, getTeam } from "@/lib/db";
import type { PlayerStats } from "@/lib/types";

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

  const [team, player, games] = await Promise.all([
    getTeam(supabase, teamId),
    getPlayer(supabase, playerId),
    getGames(supabase, teamId),
  ]);

  if (!team || !player) notFound();
  if (player.team_id !== teamId) notFound();

  const { total, lines } = computePlayerSeasonStats(
    games,
    player.id,
    player.name,
    player.number,
  );

  const showPassing = hasPassing(total);
  const showRushing = hasRushing(total);
  const showReceiving = hasReceiving(total);
  const showDefense = hasDefense(total);
  const gamesPlayed = lines.filter((l) => l.stats !== null).length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-12">
      <div className="mx-auto max-w-3xl p-6">
        {/* Header / profile card */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <Link
            href={`/teams/${teamId}/roster`}
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

        {/* Season totals */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-gray-800">
            Season Stats ({gamesPlayed} {gamesPlayed === 1 ? "game" : "games"})
          </h2>

          {!showPassing &&
          !showRushing &&
          !showReceiving &&
          !showDefense ? (
            <p className="text-sm text-gray-500">
              No stats recorded yet for this player.
            </p>
          ) : (
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
          )}
        </section>

        {/* Per-game log */}
        <section className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-gray-800">
            Game Log
          </h2>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">
              No completed games yet.
            </p>
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
