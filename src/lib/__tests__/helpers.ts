// Test helper factory for GameState. Each test starts from a clean, known state
// and only overrides what it needs.

import type { GameState, PlayerStats, RosterEntry } from "../types";

export const PLAYER_QB: RosterEntry = { id: "p1", name: "Alice", number: "1" };
export const PLAYER_WR: RosterEntry = { id: "p2", name: "Bob", number: "12" };
export const PLAYER_RB: RosterEntry = { id: "p3", name: "Carol", number: "23" };
export const PLAYER_DB: RosterEntry = { id: "p4", name: "Dave", number: "34" };

export const DEFAULT_ROSTER: RosterEntry[] = [PLAYER_QB, PLAYER_WR, PLAYER_RB, PLAYER_DB];

function makeEmptyPlayerStats(name: string, number: string): PlayerStats {
  return {
    name,
    number,
    offense: {
      passAttempts: 0,
      completions: 0,
      incompletions: 0,
      passingYards: 0,
      interceptions: 0,
      rushAttempts: 0,
      rushingYards: 0,
      receptions: 0,
      receivingYards: 0,
      touchdowns: 0,
    },
    defense: {
      flagPulls: 0,
      interceptions: 0,
      tacklesForLoss: 0,
      passDeflections: 0,
    },
  };
}

/** Returns a valid GameState with sensible defaults. Override only what the test needs. */
export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const roster = overrides.roster ?? DEFAULT_ROSTER;

  const playerStats: Record<string, PlayerStats> = {};
  roster.forEach((p) => {
    playerStats[p.id] = makeEmptyPlayerStats(p.name, p.number);
  });

  return {
    teamName: "Snappers",
    opponentName: "Blitz FC",
    roster,
    score: { team: 0, opponent: 0 },
    possession: "team",
    half: 1,
    down: 1,
    yardsToGo: 12,
    lineOfScrimmage: 5,
    firstDownTarget: 17,
    plays: [],
    playerStats,
    stats: {
      offense: {
        passAttempts: 0,
        completions: 0,
        passingYards: 0,
        rushAttempts: 0,
        rushingYards: 0,
        firstDowns: 0,
        touchdowns: 0,
        totalPlays: 0,
        interceptions: 0,
      },
      defense: {
        flagPulls: 0,
        interceptions: 0,
        forcedPunts: 0,
        turnoversOnDowns: 0,
      },
    },
    isOvertime: false,
    overtimeRound: 0,
    overtimeFirstOffense: null,
    completed: false,
    ...overrides,
    // If overrides include roster, always regenerate playerStats unless caller
    // also provided explicit playerStats.
    playerStats: overrides.playerStats ?? playerStats,
  };
}

/** Convenience: build a minimal completed Game row for computeSeasonStats tests. */
export function makeGame(
  result: "win" | "loss" | "tie",
  scoreFor: number,
  scoreAgainst: number,
  gameData: Partial<GameState> = {},
) {
  return {
    id: `game-${Math.random()}`,
    team_id: "team-1",
    opponent_name: "Opp",
    game_date: "2026-01-01",
    status: "completed" as const,
    result,
    game_data: makeGameState({
      score: { team: scoreFor, opponent: scoreAgainst },
      ...gameData,
    }),
  };
}
