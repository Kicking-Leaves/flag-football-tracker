import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole, getTeam } from "@/lib/db";
import { can } from "@/lib/permissions";
import { generateGameCSV, generatePlayByPlayCSV } from "@/lib/csv";
import StatsTable, {
  defenseRows,
  passingRows,
  receivingRows,
  rushingRows,
} from "@/components/game/StatsTable";
import CSVExport from "@/components/game/CSVExport";
import GameTypePicker from "@/components/game/GameTypePicker";
import { GAME_TYPE_LABELS, countsForSeason } from "@/lib/types";
import { gameFumbleStats, gameSackStats, playerStatsWithDerived } from "@/lib/derived-stats";

export const dynamic = "force-dynamic";

export default async function GameStatsPage({
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
  if (!team || !game || !role) notFound();
  const canScore = can(role, "scoreGame");
  const canExport = can(role, "exportStats");
  if (game.team_id !== teamId) notFound();

  const gd = game.game_data;
  const playerStats = Object.values(playerStatsWithDerived(gd));
  const sacks = gameSackStats(gd).team;
  const fumbles = gameFumbleStats(gd).team;
  const gameType = game.game_type ?? "regular";

  const csv = generateGameCSV({
    teamName: team.name,
    opponent_name: game.opponent_name,
    game_date: game.game_date,
    game_type: gameType,
    game_data: gd,
  });
  const fileBase = `${team.name}_vs_${game.opponent_name}_${new Date(game.game_date)
    .toISOString()
    .slice(0, 10)}`;
  const filename = `${fileBase}.csv`;
  const playByPlayCsv = generatePlayByPlayCSV({
    teamName: team.name,
    opponent_name: game.opponent_name,
    game_data: gd,
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-24">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link
            href={`/teams/${teamId}`}
            className="text-sm text-purple-100 underline"
          >
            ← {team.name}
          </Link>
          <h2 className="mt-2 text-3xl font-bold">Game Statistics</h2>
          <p className="text-lg">
            {team.name} vs {game.opponent_name}
          </p>
          <p className="mt-3 text-4xl font-bold">
            {gd.score.team} - {gd.score.opponent}
          </p>
          <p className="mt-1 text-sm text-purple-100">
            {new Date(game.game_date).toLocaleDateString()} ·{" "}
            {game.status === "completed"
              ? `Result: ${game.result?.toUpperCase()}`
              : game.status === "scheduled"
                ? "Not started"
                : "In progress"}
          </p>
          {canScore ? (
            <GameTypePicker gameId={gameId} value={gameType} />
          ) : (
            <p className="mt-1 text-sm font-semibold text-purple-100">
              {GAME_TYPE_LABELS[gameType]}
            </p>
          )}
          {!countsForSeason(game) && (
            <p className="mt-1 text-xs text-purple-100">
              Scrimmage stats don&apos;t count toward season stats.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/teams/${teamId}/games/${gameId}/plays`}
              className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-bold text-purple-700 shadow"
            >
              Play-by-play
            </Link>
            <Link
              href={`/teams/${teamId}/games/${gameId}/film`}
              className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-bold text-purple-700 shadow"
            >
              Film
            </Link>
          </div>
        </div>

        {/* Team offense */}
        <section className="mb-4 rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="mb-4 text-xl font-bold text-gray-800">Team Offense</h3>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total Plays" value={gd.stats.offense.totalPlays} />
            <Stat label="1st Downs" value={gd.stats.offense.firstDowns} />
            <Stat
              label="Touchdowns"
              value={gd.stats.offense.touchdowns}
              accent
            />
            <Stat label="Pass Yards" value={gd.stats.offense.passingYards} />
            <Stat label="Rush Yards" value={gd.stats.offense.rushingYards} />
            <Stat
              label="Total Yards"
              value={
                gd.stats.offense.passingYards + gd.stats.offense.rushingYards
              }
              accent
            />
            <Stat
              label="Pass Att / Cmp"
              value={`${gd.stats.offense.completions}/${gd.stats.offense.passAttempts}`}
            />
            <Stat label="Rush Att" value={gd.stats.offense.rushAttempts} />
            <Stat label="Sacked" value={sacks.sackedAllowed} />
            <Stat
              label="Coverage Sacks Allowed"
              value={sacks.coverageSacksAllowed}
            />
            <Stat label="Fumbles / Lost" value={`${fumbles.fumbles}/${fumbles.fumblesLost}`} />
          </div>
        </section>

        {/* Team defense */}
        <section className="mb-4 rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="mb-4 text-xl font-bold text-gray-800">Team Defense</h3>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Flag Pulls" value={gd.stats.defense.flagPulls} />
            <Stat
              label="Interceptions"
              value={gd.stats.defense.interceptions}
            />
            <Stat label="Player Sacks" value={sacks.playerSacks} />
            <Stat label="Coverage Sacks" value={sacks.coverageSacks} />
            <Stat label="Fumble Recoveries" value={fumbles.recoveries} />
            <Stat label="Forced Punts" value={gd.stats.defense.forcedPunts} />
            <Stat
              label="Turnovers on Downs"
              value={gd.stats.defense.turnoversOnDowns}
            />
          </div>
        </section>

        {/* Player tables */}
        <StatsTable
          title="Passing"
          headers={["Player", "CMP", "ATT", "YDS", "TD", "INT"]}
          rows={passingRows(playerStats)}
        />
        <StatsTable
          title="Rushing"
          headers={["Player", "ATT", "YDS", "TD"]}
          rows={rushingRows(playerStats)}
        />
        <StatsTable
          title="Receiving"
          headers={["Player", "REC", "YDS", "TD"]}
          rows={receivingRows(playerStats)}
        />
        <StatsTable
          title="Defense"
          headers={["Player", "Tackles", "TFL", "Sacks", "INT", "PD", "FR"]}
          rows={defenseRows(playerStats)}
        />

        {canExport && (
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="mb-4 text-xl font-bold text-gray-800">Export</h3>
          <CSVExport
            csv={csv}
            filename={filename}
            emailSubject={`Game Stats: ${team.name} vs ${game.opponent_name}`}
            emailBody={`Final: ${team.name} ${gd.score.team} - ${game.opponent_name} ${gd.score.opponent}\nDate: ${new Date(game.game_date).toLocaleDateString()}\n\n`}
          />
          <p className="mb-2 mt-5 text-sm text-gray-600">
            Play-by-play with the time each play was recorded, for lining up
            with video.
          </p>
          <CSVExport
            csv={playByPlayCsv}
            filename={`${fileBase}_play-by-play.csv`}
            emailSubject={`Play-by-Play: ${team.name} vs ${game.opponent_name}`}
            emailBody={`Play-by-play: ${team.name} vs ${game.opponent_name}\n\n${playByPlayCsv}`}
            downloadLabel="Download Play-by-Play"
            emailLabel="Email Play-by-Play"
          />
        </section>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          {canScore && (
            <Link
              href={`/teams/${teamId}/games/${gameId}`}
              className="rounded-xl bg-gray-700 py-3 text-center font-bold text-white shadow"
            >
              {game.status === "in_progress"
                ? "Back to Game"
                : game.status === "scheduled"
                  ? "Start Scoring"
                  : "Edit Game"}
            </Link>
          )}
          <Link
            href={`/teams/${teamId}`}
            className="rounded-xl bg-blue-600 py-3 text-center font-bold text-white shadow"
          >
            Team Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        accent
          ? "border-2 border-green-500 bg-gradient-to-r from-blue-50 to-green-50"
          : "bg-gray-50"
      }`}
    >
      <p className="text-sm font-semibold text-gray-600">{label}</p>
      <p
        className={`text-3xl font-bold ${
          accent ? "text-green-600" : "text-gray-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
