// CSV generation for game and season exports.
//
// Uses v3's array-of-arrays approach (cleaner than string concatenation) but
// includes the full set of stats from app.jsx (TFL, pass deflections, etc.)
// and the season-export totals.

import type { Game, GameState, PlayerStats, SeasonStats } from "./types";

type Row = (string | number)[];

function escapeCell(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: Row[]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

function playerLabel(p: PlayerStats): string {
  return `#${p.number} ${p.name}`;
}

// ---------- Per-game CSV ----------

export function generateGameCSV(
  game: Pick<Game, "opponent_name" | "game_date"> & {
    teamName?: string;
    game_data: GameState;
  },
): string {
  const gd = game.game_data;
  const teamName = game.teamName ?? gd.teamName ?? "Team";
  const opponent = game.opponent_name ?? gd.opponentName ?? "Opponent";
  const playerStats = Object.values(gd.playerStats ?? {});

  const rows: Row[] = [
    ["Flag Football Game Stats"],
    ["Date", new Date(game.game_date).toLocaleDateString()],
    ["Teams", `${teamName} vs ${opponent}`],
    ["Final Score", `${gd.score.team} - ${gd.score.opponent}`],
    [],
    ["TEAM STATS - OFFENSE"],
    ["Total Plays", gd.stats.offense.totalPlays],
    ["First Downs", gd.stats.offense.firstDowns],
    ["Touchdowns", gd.stats.offense.touchdowns],
    ["Pass Attempts", gd.stats.offense.passAttempts],
    ["Completions", gd.stats.offense.completions],
    ["Passing Yards", gd.stats.offense.passingYards],
    ["Rush Attempts", gd.stats.offense.rushAttempts],
    ["Rushing Yards", gd.stats.offense.rushingYards],
    [
      "Total Yards",
      gd.stats.offense.passingYards + gd.stats.offense.rushingYards,
    ],
    [],
    ["TEAM STATS - DEFENSE"],
    ["Flag Pulls", gd.stats.defense.flagPulls],
    ["Interceptions", gd.stats.defense.interceptions],
    ["Forced Punts", gd.stats.defense.forcedPunts ?? 0],
    ["Turnovers on Downs", gd.stats.defense.turnoversOnDowns ?? 0],
  ];

  const passers = playerStats.filter((p) => p.offense.passAttempts > 0);
  if (passers.length) {
    rows.push([], ["PLAYER STATS - PASSING"]);
    rows.push(["Player", "ATT", "CMP", "YDS", "TD", "INT"]);
    passers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.passAttempts,
        p.offense.completions,
        p.offense.passingYards,
        p.offense.touchdowns,
        p.offense.interceptions,
      ]),
    );
  }

  const rushers = playerStats.filter((p) => p.offense.rushAttempts > 0);
  if (rushers.length) {
    rows.push([], ["PLAYER STATS - RUSHING"]);
    rows.push(["Player", "ATT", "YDS", "TD"]);
    rushers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.rushAttempts,
        p.offense.rushingYards,
        p.offense.touchdowns,
      ]),
    );
  }

  const receivers = playerStats.filter((p) => p.offense.receptions > 0);
  if (receivers.length) {
    rows.push([], ["PLAYER STATS - RECEIVING"]);
    rows.push(["Player", "REC", "YDS", "TD"]);
    receivers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.receptions,
        p.offense.receivingYards,
        p.offense.touchdowns,
      ]),
    );
  }

  const defenders = playerStats.filter(
    (p) =>
      p.defense.flagPulls > 0 ||
      p.defense.interceptions > 0 ||
      p.defense.tacklesForLoss > 0 ||
      p.defense.passDeflections > 0,
  );
  if (defenders.length) {
    rows.push([], ["PLAYER STATS - DEFENSE"]);
    rows.push(["Player", "Tackles", "TFL", "INT", "PD"]);
    defenders.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.defense.flagPulls,
        p.defense.tacklesForLoss,
        p.defense.interceptions,
        p.defense.passDeflections,
      ]),
    );
  }

  return rowsToCsv(rows);
}

// ---------- Season CSV ----------

export function generateSeasonCSV(
  teamName: string,
  stats: SeasonStats,
): string {
  const rows: Row[] = [
    [`${teamName} Season Statistics`],
    [
      "Record",
      `${stats.wins}-${stats.losses}${stats.ties > 0 ? `-${stats.ties}` : ""}`,
    ],
    ["Games Played", stats.gamesPlayed],
    ["Points For", stats.totalPointsFor],
    ["Points Against", stats.totalPointsAgainst],
    [],
    ["TEAM OFFENSE"],
    ["Total Plays", stats.offense.totalPlays],
    ["First Downs", stats.offense.firstDowns],
    ["Touchdowns", stats.offense.touchdowns],
    ["Pass Attempts", stats.offense.passAttempts],
    ["Completions", stats.offense.completions],
    ["Passing Yards", stats.offense.passingYards],
    ["Rush Attempts", stats.offense.rushAttempts],
    ["Rushing Yards", stats.offense.rushingYards],
    [
      "Total Yards",
      stats.offense.passingYards + stats.offense.rushingYards,
    ],
    [],
    ["TEAM DEFENSE"],
    ["Flag Pulls", stats.defense.flagPulls],
    ["Interceptions", stats.defense.interceptions],
    ["Forced Punts", stats.defense.forcedPunts],
    ["Turnovers on Downs", stats.defense.turnoversOnDowns],
  ];

  const players = Object.values(stats.playerStats);

  const passers = players.filter((p) => p.offense.passAttempts > 0);
  if (passers.length) {
    rows.push([], ["SEASON LEADERS - PASSING"]);
    rows.push(["Player", "ATT", "CMP", "YDS", "TD", "INT"]);
    passers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.passAttempts,
        p.offense.completions,
        p.offense.passingYards,
        p.offense.touchdowns,
        p.offense.interceptions,
      ]),
    );
  }

  const rushers = players.filter((p) => p.offense.rushAttempts > 0);
  if (rushers.length) {
    rows.push([], ["SEASON LEADERS - RUSHING"]);
    rows.push(["Player", "ATT", "YDS", "TD"]);
    rushers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.rushAttempts,
        p.offense.rushingYards,
        p.offense.touchdowns,
      ]),
    );
  }

  const receivers = players.filter((p) => p.offense.receptions > 0);
  if (receivers.length) {
    rows.push([], ["SEASON LEADERS - RECEIVING"]);
    rows.push(["Player", "REC", "YDS", "TD"]);
    receivers.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.offense.receptions,
        p.offense.receivingYards,
        p.offense.touchdowns,
      ]),
    );
  }

  const defenders = players.filter(
    (p) =>
      p.defense.flagPulls > 0 ||
      p.defense.interceptions > 0 ||
      p.defense.tacklesForLoss > 0 ||
      p.defense.passDeflections > 0,
  );
  if (defenders.length) {
    rows.push([], ["SEASON LEADERS - DEFENSE"]);
    rows.push(["Player", "Tackles", "TFL", "INT", "PD"]);
    defenders.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.defense.flagPulls,
        p.defense.tacklesForLoss,
        p.defense.interceptions,
        p.defense.passDeflections,
      ]),
    );
  }

  return rowsToCsv(rows);
}
