import { describe, it, expect } from "vitest";
import { computeSeasonStats } from "../db";
import { makeGameState, makeGame, PLAYER_QB, PLAYER_WR, DEFAULT_ROSTER } from "./helpers";
import type { Game } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inProgressGame(): Game {
  return {
    id: "game-ip",
    team_id: "team-1",
    opponent_name: "InProgress FC",
    game_date: "2026-01-10",
    status: "in_progress",
    result: null,
    game_data: makeGameState({ score: { team: 14, opponent: 7 } }),
  };
}

// ===========================================================================
// Empty and single-game cases
// ===========================================================================

describe("computeSeasonStats — empty / no games", () => {
  it("returns all-zero stats for an empty array", () => {
    const stats = computeSeasonStats([]);
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.ties).toBe(0);
    expect(stats.totalPointsFor).toBe(0);
    expect(stats.totalPointsAgainst).toBe(0);
    expect(stats.offense.passAttempts).toBe(0);
    expect(stats.defense.flagPulls).toBe(0);
    expect(Object.keys(stats.playerStats)).toHaveLength(0);
  });
});

describe("computeSeasonStats — single completed win", () => {
  it("records 1 win, correct points", () => {
    const games = [makeGame("win", 20, 7)];
    const stats = computeSeasonStats(games);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.ties).toBe(0);
    expect(stats.totalPointsFor).toBe(20);
    expect(stats.totalPointsAgainst).toBe(7);
  });
});

describe("computeSeasonStats — single completed loss", () => {
  it("records 1 loss", () => {
    const games = [makeGame("loss", 6, 14)];
    const stats = computeSeasonStats(games);
    expect(stats.losses).toBe(1);
    expect(stats.wins).toBe(0);
  });
});

// ===========================================================================
// In-progress game exclusion
// ===========================================================================

describe("computeSeasonStats — in-progress game exclusion", () => {
  it("excludes in-progress games from all totals", () => {
    const games = [makeGame("win", 14, 0), inProgressGame()];
    const stats = computeSeasonStats(games);
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.totalPointsFor).toBe(14);
  });

  it("returns zero stats when all games are in-progress", () => {
    const stats = computeSeasonStats([inProgressGame()]);
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.wins).toBe(0);
  });
});

// ===========================================================================
// Multi-game aggregation
// ===========================================================================

describe("computeSeasonStats — multiple completed games", () => {
  it("sums wins, losses, and points correctly", () => {
    const games = [
      makeGame("win", 20, 7),
      makeGame("loss", 6, 14),
      makeGame("win", 14, 6),
    ];
    const stats = computeSeasonStats(games);
    expect(stats.gamesPlayed).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.totalPointsFor).toBe(40);
    expect(stats.totalPointsAgainst).toBe(27);
  });

  it("includes ties in record", () => {
    const games = [makeGame("win", 14, 7), makeGame("tie", 7, 7)];
    const stats = computeSeasonStats(games);
    expect(stats.wins).toBe(1);
    expect(stats.ties).toBe(1);
    expect(stats.losses).toBe(0);
  });
});

// ===========================================================================
// Offense and defense stat aggregation
// ===========================================================================

describe("computeSeasonStats — offense stat aggregation", () => {
  it("sums passing yards across games", () => {
    const game1 = makeGame("win", 14, 0, {
      stats: {
        offense: {
          passAttempts: 10,
          completions: 7,
          passingYards: 120,
          rushAttempts: 5,
          rushingYards: 40,
          firstDowns: 8,
          touchdowns: 2,
          totalPlays: 15,
          interceptions: 1,
        },
        defense: { flagPulls: 0, interceptions: 0, forcedPunts: 0, turnoversOnDowns: 0 },
      },
    });
    const game2 = makeGame("win", 20, 0, {
      stats: {
        offense: {
          passAttempts: 12,
          completions: 9,
          passingYards: 150,
          rushAttempts: 8,
          rushingYards: 60,
          firstDowns: 10,
          touchdowns: 3,
          totalPlays: 20,
          interceptions: 0,
        },
        defense: { flagPulls: 0, interceptions: 0, forcedPunts: 0, turnoversOnDowns: 0 },
      },
    });
    const stats = computeSeasonStats([game1, game2]);
    expect(stats.offense.passAttempts).toBe(22);
    expect(stats.offense.completions).toBe(16);
    expect(stats.offense.passingYards).toBe(270);
    expect(stats.offense.rushAttempts).toBe(13);
    expect(stats.offense.rushingYards).toBe(100);
    expect(stats.offense.touchdowns).toBe(5);
    expect(stats.offense.totalPlays).toBe(35);
    expect(stats.offense.interceptions).toBe(1);
  });
});

describe("computeSeasonStats — defense stat aggregation", () => {
  it("sums defense stats across games", () => {
    const game1 = makeGame("win", 14, 0, {
      stats: {
        offense: { passAttempts: 0, completions: 0, passingYards: 0, rushAttempts: 0, rushingYards: 0, firstDowns: 0, touchdowns: 0, totalPlays: 0, interceptions: 0 },
        defense: { flagPulls: 5, interceptions: 2, forcedPunts: 1, turnoversOnDowns: 1 },
      },
    });
    const game2 = makeGame("win", 20, 0, {
      stats: {
        offense: { passAttempts: 0, completions: 0, passingYards: 0, rushAttempts: 0, rushingYards: 0, firstDowns: 0, touchdowns: 0, totalPlays: 0, interceptions: 0 },
        defense: { flagPulls: 8, interceptions: 1, forcedPunts: 2, turnoversOnDowns: 0 },
      },
    });
    const stats = computeSeasonStats([game1, game2]);
    expect(stats.defense.flagPulls).toBe(13);
    expect(stats.defense.interceptions).toBe(3);
    expect(stats.defense.forcedPunts).toBe(3);
    expect(stats.defense.turnoversOnDowns).toBe(1);
  });
});

// ===========================================================================
// Player stat aggregation
// ===========================================================================

describe("computeSeasonStats — player stat aggregation", () => {
  it("aggregates player passing yards across games", () => {
    const gameDataWith = (passingYards: number) => ({
      roster: DEFAULT_ROSTER,
      playerStats: {
        [PLAYER_QB.id]: {
          name: PLAYER_QB.name,
          number: PLAYER_QB.number,
          offense: {
            passAttempts: 5,
            completions: 4,
            incompletions: 1,
            passingYards,
            interceptions: 0,
            rushAttempts: 0,
            rushingYards: 0,
            receptions: 0,
            receivingYards: 0,
            touchdowns: 1,
          },
          defense: { flagPulls: 0, interceptions: 0, tacklesForLoss: 0, passDeflections: 0 },
        },
        [PLAYER_WR.id]: {
          name: PLAYER_WR.name,
          number: PLAYER_WR.number,
          offense: {
            passAttempts: 0,
            completions: 0,
            incompletions: 0,
            passingYards: 0,
            interceptions: 0,
            rushAttempts: 0,
            rushingYards: 0,
            receptions: 4,
            receivingYards: passingYards,
            touchdowns: 1,
          },
          defense: { flagPulls: 0, interceptions: 0, tacklesForLoss: 0, passDeflections: 0 },
        },
      },
    });

    const game1 = makeGame("win", 14, 0, gameDataWith(80));
    const game2 = makeGame("win", 20, 7, gameDataWith(120));
    const stats = computeSeasonStats([game1, game2]);

    expect(stats.playerStats[PLAYER_QB.id]).toBeDefined();
    expect(stats.playerStats[PLAYER_QB.id].offense.passingYards).toBe(200);
    expect(stats.playerStats[PLAYER_QB.id].offense.passAttempts).toBe(10);
    expect(stats.playerStats[PLAYER_QB.id].offense.completions).toBe(8);
    expect(stats.playerStats[PLAYER_QB.id].offense.touchdowns).toBe(2);

    expect(stats.playerStats[PLAYER_WR.id].offense.receptions).toBe(8);
    expect(stats.playerStats[PLAYER_WR.id].offense.receivingYards).toBe(200);
  });

  it("insertion order does not affect totals (rebuildSeasonStats idempotency)", () => {
    const gameDataWith = (passingYards: number) => ({
      playerStats: {
        [PLAYER_QB.id]: {
          name: PLAYER_QB.name,
          number: PLAYER_QB.number,
          offense: {
            passAttempts: 3,
            completions: 2,
            incompletions: 1,
            passingYards,
            interceptions: 0,
            rushAttempts: 0,
            rushingYards: 0,
            receptions: 0,
            receivingYards: 0,
            touchdowns: 0,
          },
          defense: { flagPulls: 0, interceptions: 0, tacklesForLoss: 0, passDeflections: 0 },
        },
      },
    });

    const g1 = makeGame("win", 14, 0, gameDataWith(60));
    const g2 = makeGame("win", 7, 0, gameDataWith(40));
    const g3 = makeGame("loss", 0, 14, gameDataWith(30));

    const statsAsc = computeSeasonStats([g1, g2, g3]);
    const statsDesc = computeSeasonStats([g3, g2, g1]);
    const statsMixed = computeSeasonStats([g2, g3, g1]);

    const yards = (s: typeof statsAsc) => s.playerStats[PLAYER_QB.id].offense.passingYards;
    expect(yards(statsAsc)).toBe(130);
    expect(yards(statsDesc)).toBe(130);
    expect(yards(statsMixed)).toBe(130);
  });

  it("player missing from one game still accumulates from other games", () => {
    // game1 has QB stats; game2 has no playerStats entry for QB
    const game1 = makeGame("win", 14, 0, {
      playerStats: {
        [PLAYER_QB.id]: {
          name: PLAYER_QB.name,
          number: PLAYER_QB.number,
          offense: {
            passAttempts: 5, completions: 3, incompletions: 2, passingYards: 75,
            interceptions: 0, rushAttempts: 0, rushingYards: 0,
            receptions: 0, receivingYards: 0, touchdowns: 1,
          },
          defense: { flagPulls: 0, interceptions: 0, tacklesForLoss: 0, passDeflections: 0 },
        },
      },
    });
    const game2 = makeGame("win", 7, 0, { playerStats: {} });
    const stats = computeSeasonStats([game1, game2]);
    expect(stats.playerStats[PLAYER_QB.id].offense.passingYards).toBe(75);
  });
});
