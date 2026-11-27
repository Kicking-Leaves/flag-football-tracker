// CSV generation for game and season exports.
//
// Uses v3's array-of-arrays approach (cleaner than string concatenation) but
// includes the full set of stats from app.jsx (TFL, pass deflections, etc.)
// and the season-export totals.

import type {
  DefenseStats,
  FumbleStats,
  Game,
  GameState,
  OffenseStats,
  Play,
  PlayerStats,
  Possession,
  SackStats,
  SeasonScope,
  SeasonStats,
} from "./types";
import { GAME_TYPE_LABELS, SEASON_SCOPE_LABELS, inSeasonScope } from "./types";
import {
  gameFumbleStats,
  gameSackStats,
  isCoverageSack,
  isPlayerSack,
  playerStatsWithDerived,
} from "./derived-stats";
import { penaltyLabel } from "./penalties";
import { isMarker } from "./game-engine";

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

// ---------- Shared sections ----------

function teamStatRows(
  offense: OffenseStats,
  defense: DefenseStats,
  sacks: SackStats,
  fumbles: FumbleStats,
  heading = "TEAM STATS - ",
): Row[] {
  return [
    [`${heading}OFFENSE`],
    ["Total Plays", offense.totalPlays],
    ["First Downs", offense.firstDowns],
    ["Touchdowns", offense.touchdowns],
    ["Pass Attempts", offense.passAttempts],
    ["Completions", offense.completions],
    ["Passing Yards", offense.passingYards],
    ["Rush Attempts", offense.rushAttempts],
    ["Rushing Yards", offense.rushingYards],
    ["Total Yards", offense.passingYards + offense.rushingYards],
    ["Interceptions Thrown", offense.interceptions ?? 0],
    ["Sacked (Player Sacks Allowed)", sacks.sackedAllowed],
    ["Coverage Sacks Allowed", sacks.coverageSacksAllowed],
    ["Fumbles", fumbles.fumbles],
    ["Fumbles Lost", fumbles.fumblesLost],
    [],
    [`${heading}DEFENSE`],
    ["Flag Pulls", defense.flagPulls],
    ["Interceptions", defense.interceptions],
    ["Player Sacks", sacks.playerSacks],
    ["Coverage Sacks", sacks.coverageSacks],
    ["Total Sacks", sacks.playerSacks + sacks.coverageSacks],
    ["Fumble Recoveries", fumbles.recoveries],
    ["Forced Punts", defense.forcedPunts ?? 0],
    ["Turnovers on Downs", defense.turnoversOnDowns ?? 0],
  ];
}

function playerStatRows(players: PlayerStats[], heading = "PLAYER STATS - "): Row[] {
  const rows: Row[] = [];

  const passers = players.filter((p) => p.offense.passAttempts > 0);
  if (passers.length) {
    rows.push([], [`${heading}PASSING`]);
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
    rows.push([], [`${heading}RUSHING`]);
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
    rows.push([], [`${heading}RECEIVING`]);
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
      p.defense.passDeflections > 0 ||
      (p.defense.sacks ?? 0) > 0 ||
      (p.defense.fumbleRecoveries ?? 0) > 0,
  );
  if (defenders.length) {
    rows.push([], [`${heading}DEFENSE`]);
    rows.push(["Player", "Tackles", "TFL", "Sacks", "INT", "PD", "FR"]);
    defenders.forEach((p) =>
      rows.push([
        playerLabel(p),
        p.defense.flagPulls,
        p.defense.tacklesForLoss,
        p.defense.sacks ?? 0,
        p.defense.interceptions,
        p.defense.passDeflections,
        p.defense.fumbleRecoveries ?? 0,
      ]),
    );
  }

  return rows;
}

// ---------- Per-game CSV ----------

export function generateGameCSV(
  game: Pick<Game, "opponent_name" | "game_date" | "game_type"> & {
    teamName?: string;
    game_data: GameState;
  },
): string {
  const gd = game.game_data;
  const teamName = game.teamName ?? gd.teamName ?? "Team";
  const opponent = game.opponent_name ?? gd.opponentName ?? "Opponent";
  const players = Object.values(playerStatsWithDerived(gd));

  const rows: Row[] = [
    ["Flag Football Game Stats"],
    ["Date", new Date(game.game_date).toLocaleDateString()],
    ["Game Type", GAME_TYPE_LABELS[game.game_type ?? "regular"]],
    ["Teams", `${teamName} vs ${opponent}`],
    ["Final Score", `${gd.score.team} - ${gd.score.opponent}`],
    [],
    ...teamStatRows(gd.stats.offense, gd.stats.defense, gameSackStats(gd).team, gameFumbleStats(gd).team),
    ...playerStatRows(players),
  ];

  return rowsToCsv(rows);
}

// ---------- Play-by-play CSV ----------

export function describePlayType(p: Play): string {
  if (p.isOvertimeConversion) return `OT ${p.attempt ?? ""}-pt try`.trim();
  if (p.isPointAfter) return p.attempt === 1 ? "PAT (automatic 1)" : `${p.attempt}-pt try`;
  switch (p.playType) {
    case "pass":
      return isCoverageSack(p) ? "Coverage sack" : isPlayerSack(p) ? "Pass (sack)" : "Pass";
    case "run":
      return "Run";
    case "punt":
      return "Punt";
    case "coverage_sack":
      return "Coverage sack";
    case "penalty": {
      const name = penaltyLabel(p);
      return name ? `Penalty: ${name}` : "Penalty";
    }
    case "half_end":
      return "End of 1st half";
    case "overtime_start":
      return "Overtime";
    case "score_adjustment":
      return "Score change";
    default:
      return p.playType;
  }
}

export function describeResult(
  p: Play,
  names: { team: string; opponent: string } = { team: "Team", opponent: "Opponent" },
): string {
  const side = (s?: Possession) => (s === "team" ? names.team : s === "opponent" ? names.opponent : "");
  if (p.isPointAfter || p.isOvertimeConversion) {
    return p.success ? "Good" : "No good";
  }
  if (p.playType === "half_end") return `${side(p.possession)} receives`;
  if (p.playType === "overtime_start") return `${side(p.possession)} goes first`;
  if (p.playType === "score_adjustment") {
    const pts = p.points ?? 0;
    return `${side(p.possession)} ${pts >= 0 ? "+" : ""}${pts}`;
  }
  if (p.playType === "penalty") {
    const on = p.onOffense ? "on offense" : "on defense";
    const yds = `${Math.abs(p.yards ?? 0)} yds`;
    if (p.automaticFirstDown) return `${yds} ${on}, automatic 1st down`;
    return p.lossOfDown ? `${yds} ${on}, loss of down` : `${yds} ${on}`;
  }
  if (isCoverageSack(p)) return "7-second count, down counts";
  const parts: string[] = [];
  if (p.playType === "pass" && !p.sack) parts.push(p.complete ? "Complete" : "Incomplete");
  if (isPlayerSack(p)) parts.push("Sack");
  if (p.interception) parts.push(p.interceptionReturnTD ? "Interception (returned for TD)" : "Interception");
  if (p.fumble) parts.push(p.fumble === "lost" ? "Fumble, caught by defense" : "Fumble, dead at the spot");
  if (p.touchdown) parts.push("Touchdown");
  if (p.safety) parts.push("Safety");
  if (p.firstDown && !p.touchdown) parts.push("First down");
  if (p.flagPull && !isPlayerSack(p)) parts.push("Flag pull");
  if (p.passDeflection) parts.push("Pass deflection");
  return parts.join("; ");
}

/**
 * One row per recorded entry (plays, penalties, tries) in the order they were
 * recorded, with the scorer's wall-clock time for lining up against video.
 * Down / To Go / Ball On are the situation before the snap, except penalty
 * rows, which carry the situation after enforcement.
 */
export function generatePlayByPlayCSV(
  game: Pick<Game, "opponent_name"> & { teamName?: string; game_data: GameState },
): string {
  const gd = game.game_data;
  const teamName = game.teamName ?? gd.teamName ?? "Team";
  const opponent = game.opponent_name ?? gd.opponentName ?? "Opponent";
  const players = gd.playerStats ?? {};
  const who = (id?: string | null) => {
    if (!id) return "";
    const p = players[id];
    return p ? playerLabel(p) : "";
  };

  const nameOf = (side?: Possession) =>
    side === "team" ? teamName : side === "opponent" ? opponent : "";
  const other = (side?: Possession): Possession | undefined =>
    side === "team" ? "opponent" : side === "opponent" ? "team" : undefined;
  /** Who scored on this entry and how much, e.g. "Eagles +6". */
  const scoring = (p: Play): string => {
    const parts: string[] = [];
    const add = (side: Possession | undefined, pts: number) => {
      if (side && pts) parts.push(`${nameOf(side)} +${pts}`);
    };
    if (p.isPointAfter || p.isOvertimeConversion) add(p.possession, p.points ?? 0);
    if (p.playType === "score_adjustment" && p.points) {
      parts.push(`${nameOf(p.possession)} ${p.points > 0 ? "+" : ""}${p.points}`);
    }
    if (p.touchdown) add(p.possession, 6);
    if (p.safety) add(other(p.possession), 2);
    if (p.interceptionReturnTD) add(other(p.possession), 6);
    return parts.join("; ");
  };

  const rows: Row[] = [
    [
      "#",
      "Recorded At",
      "Clock Time",
      "Half",
      "Offense",
      "Down",
      "To Go",
      "Ball On",
      "Type",
      "Yards",
      "Result",
      "Scoring",
      "Passer",
      "Receiver",
      "Rusher",
      "Defender",
    ],
  ];

  gd.plays.forEach((p, i) => {
    const isTry = p.isPointAfter || p.isOvertimeConversion || isMarker(p);
    rows.push([
      i + 1,
      p.recordedAt ?? "",
      // "2026-11-21T19:04:32.120-08:00" → "19:04:32"
      p.recordedAt ? p.recordedAt.slice(11, 19) : "",
      p.half === "OT" ? "OT" : p.half ? String(p.half) : "",
      isMarker(p) ? "" : nameOf(p.possession),
      isTry ? "" : p.down || "",
      isTry ? "" : p.yardsToGo ?? "",
      p.lineOfScrimmage ?? "",
      describePlayType(p),
      isTry ? "" : p.yards,
      describeResult(p, { team: teamName, opponent }),
      scoring(p),
      who(p.passer),
      who(p.receiver),
      who(p.rusher),
      who(p.defender),
    ]);
  });

  return rowsToCsv(rows);
}

// ---------- Season CSV ----------

/**
 * Season totals (team and player) for one scope: regular season, postseason,
 * or full season (both). Scrimmages are never included. Pass the season's
 * games to list the ones the totals cover.
 */
export function generateSeasonCSV(
  teamName: string,
  stats: SeasonStats,
  opts: { seasonName?: string; scope?: SeasonScope; games?: Game[] } = {},
): string {
  const scope = opts.scope ?? "full";
  const title = [teamName, opts.seasonName].filter(Boolean).join(" ");
  const rows: Row[] = [
    [`${title} Season Statistics`],
    ["Covers", SEASON_SCOPE_LABELS[scope]],
    [
      "Record",
      `${stats.wins}-${stats.losses}${stats.ties > 0 ? `-${stats.ties}` : ""}`,
    ],
    ["Games Played", stats.gamesPlayed],
    ["Points For", stats.totalPointsFor],
    ["Points Against", stats.totalPointsAgainst],
    ["Note", "Scrimmages are not included."],
    [],
    ...teamStatRows(stats.offense, stats.defense, stats.sacks, stats.fumbles, "TEAM "),
    ...playerStatRows(Object.values(stats.playerStats), "SEASON LEADERS - "),
  ];

  const games = (opts.games ?? [])
    .filter((g) => g.status === "completed" && inSeasonScope(g, scope))
    .sort((a, b) => new Date(a.game_date).getTime() - new Date(b.game_date).getTime());
  if (games.length) {
    rows.push([], ["GAMES"]);
    rows.push(["Date", "Opponent", "Type", "Score", "Result"]);
    games.forEach((g) =>
      rows.push([
        new Date(g.game_date).toLocaleDateString(),
        g.opponent_name,
        GAME_TYPE_LABELS[g.game_type ?? "regular"],
        `${g.game_data?.score?.team ?? 0} - ${g.game_data?.score?.opponent ?? 0}`,
        g.result ? g.result.toUpperCase() : "",
      ]),
    );
  }

  return rowsToCsv(rows);
}
