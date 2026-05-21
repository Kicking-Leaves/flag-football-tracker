import { describe, it, expect } from "vitest";
import { generateGameCSV, generateSeasonCSV } from "../csv";
import { makeGameState, PLAYER_QB, PLAYER_WR, PLAYER_DB, DEFAULT_ROSTER } from "./helpers";
import type { SeasonStats, PlayerStats } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStats(name: string, number: string, overrides: Partial<PlayerStats> = {}): PlayerStats {
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
      ...(overrides.offense ?? {}),
    },
    defense: {
      flagPulls: 0,
      interceptions: 0,
      tacklesForLoss: 0,
      passDeflections: 0,
      ...(overrides.defense ?? {}),
    },
  };
}

function makeGameInput(overrides: Record<string, unknown> = {}) {
  const gameData = makeGameState({
    teamName: "Snappers",
    score: { team: 14, opponent: 7 },
    ...overrides,
  });
  return {
    opponent_name: "Blitz FC",
    game_date: "2026-05-10",
    teamName: "Snappers",
    game_data: gameData,
  };
}

function makeSeasonStats(overrides: Partial<SeasonStats> = {}): SeasonStats {
  return {
    gamesPlayed: 5,
    wins: 3,
    losses: 2,
    ties: 0,
    totalPointsFor: 80,
    totalPointsAgainst: 60,
    offense: {
      passAttempts: 50,
      completions: 35,
      passingYards: 420,
      rushAttempts: 30,
      rushingYards: 180,
      firstDowns: 40,
      touchdowns: 12,
      totalPlays: 80,
      interceptions: 3,
    },
    defense: {
      flagPulls: 60,
      interceptions: 5,
      forcedPunts: 8,
      turnoversOnDowns: 3,
    },
    playerStats: {},
    ...overrides,
  };
}

// ===========================================================================
// generateGameCSV
// ===========================================================================

describe("generateGameCSV — header and score", () => {
  it("contains team name", () => {
    const csv = generateGameCSV(makeGameInput());
    expect(csv).toContain("Snappers");
  });

  it("contains opponent name", () => {
    const csv = generateGameCSV(makeGameInput());
    expect(csv).toContain("Blitz FC");
  });

  it("contains final score", () => {
    const csv = generateGameCSV(makeGameInput());
    expect(csv).toContain("14");
    expect(csv).toContain("7");
    // Score row specifically
    expect(csv).toContain("Final Score");
  });

  it("contains TEAM STATS - OFFENSE section", () => {
    const csv = generateGameCSV(makeGameInput());
    expect(csv).toContain("TEAM STATS - OFFENSE");
  });

  it("contains TEAM STATS - DEFENSE section", () => {
    const csv = generateGameCSV(makeGameInput());
    expect(csv).toContain("TEAM STATS - DEFENSE");
  });
});

describe("generateGameCSV — player stats sections", () => {
  it("includes PLAYER STATS - PASSING section when passers exist", () => {
    const playerStats = {
      [PLAYER_QB.id]: makePlayerStats(PLAYER_QB.name, PLAYER_QB.number, {
        offense: { passAttempts: 8, completions: 5, incompletions: 3, passingYards: 100, interceptions: 0, touchdowns: 1, rushAttempts: 0, rushingYards: 0, receptions: 0, receivingYards: 0 },
      }),
    };
    const csv = generateGameCSV(makeGameInput({ playerStats }));
    expect(csv).toContain("PLAYER STATS - PASSING");
    expect(csv).toContain(PLAYER_QB.name);
  });

  it("includes PLAYER STATS - DEFENSE section when defenders have stats", () => {
    const playerStats = {
      [PLAYER_DB.id]: makePlayerStats(PLAYER_DB.name, PLAYER_DB.number, {
        defense: { flagPulls: 3, interceptions: 1, tacklesForLoss: 1, passDeflections: 0 },
      }),
    };
    const csv = generateGameCSV(makeGameInput({ playerStats }));
    expect(csv).toContain("PLAYER STATS - DEFENSE");
    expect(csv).toContain(PLAYER_DB.name);
  });

  it("skips PLAYER STATS - PASSING section when no passers", () => {
    // playerStats is empty (no pass attempts)
    const csv = generateGameCSV(makeGameInput({ playerStats: {} }));
    expect(csv).not.toContain("PLAYER STATS - PASSING");
  });

  it("skips PLAYER STATS - RUSHING section when no rushers", () => {
    const csv = generateGameCSV(makeGameInput({ playerStats: {} }));
    expect(csv).not.toContain("PLAYER STATS - RUSHING");
  });

  it("skips PLAYER STATS - DEFENSE section when no defenders have stats", () => {
    const csv = generateGameCSV(makeGameInput({ playerStats: {} }));
    expect(csv).not.toContain("PLAYER STATS - DEFENSE");
  });

  it("does not throw when game has no playerStats key", () => {
    const input = {
      opponent_name: "Empty FC",
      game_date: "2026-05-10",
      game_data: {
        ...makeGameState(),
        playerStats: {},
      },
    };
    expect(() => generateGameCSV(input)).not.toThrow();
  });

  it("includes receiving section for receivers", () => {
    const playerStats = {
      [PLAYER_WR.id]: makePlayerStats(PLAYER_WR.name, PLAYER_WR.number, {
        offense: { receptions: 4, receivingYards: 60, touchdowns: 1, passAttempts: 0, completions: 0, incompletions: 0, passingYards: 0, interceptions: 0, rushAttempts: 0, rushingYards: 0 },
      }),
    };
    const csv = generateGameCSV(makeGameInput({ playerStats }));
    expect(csv).toContain("PLAYER STATS - RECEIVING");
    expect(csv).toContain(PLAYER_WR.name);
  });
});

describe("generateGameCSV — CSV format", () => {
  it("output is valid CSV (no unclosed quotes)", () => {
    const csv = generateGameCSV(makeGameInput());
    // Each line should have balanced quotes
    const lines = csv.split("\n");
    lines.forEach((line) => {
      const quoteCount = (line.match(/"/g) ?? []).length;
      expect(quoteCount % 2).toBe(0);
    });
  });

  it("output contains multiple comma-separated lines", () => {
    const csv = generateGameCSV(makeGameInput());
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThan(5);
  });

  it("player label format is #number name", () => {
    const playerStats = {
      [PLAYER_QB.id]: makePlayerStats(PLAYER_QB.name, PLAYER_QB.number, {
        offense: { passAttempts: 5, completions: 3, incompletions: 2, passingYards: 50, interceptions: 0, touchdowns: 0, rushAttempts: 0, rushingYards: 0, receptions: 0, receivingYards: 0 },
      }),
    };
    const csv = generateGameCSV(makeGameInput({ playerStats }));
    expect(csv).toContain(`#${PLAYER_QB.number} ${PLAYER_QB.name}`);
  });
});

describe("generateGameCSV — escaping", () => {
  it("escapes commas in team names — wraps full cell in quotes", () => {
    const input = {
      ...makeGameInput(),
      teamName: "Lions, Tigers",
    };
    const csv = generateGameCSV(input);
    // The Teams cell contains "Lions, Tigers vs Blitz FC" — the whole cell gets quoted.
    expect(csv).toContain('"Lions, Tigers vs Blitz FC"');
  });
});

// ===========================================================================
// generateSeasonCSV
// ===========================================================================

describe("generateSeasonCSV — structure", () => {
  it("contains team name in header", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats());
    expect(csv).toContain("Snappers");
  });

  it("contains win-loss record", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats());
    expect(csv).toContain("3-2");
  });

  it("contains TEAM OFFENSE and TEAM DEFENSE sections", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats());
    expect(csv).toContain("TEAM OFFENSE");
    expect(csv).toContain("TEAM DEFENSE");
  });

  it("contains points for and against", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats());
    expect(csv).toContain("80");
    expect(csv).toContain("60");
  });

  it("includes tie in record when ties > 0", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats({ wins: 2, losses: 1, ties: 1 }));
    expect(csv).toContain("2-1-1");
  });

  it("omits tie from record when ties === 0", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats({ wins: 3, losses: 2, ties: 0 }));
    expect(csv).toContain("3-2");
    // Should not have trailing -0
    expect(csv).not.toContain("3-2-0");
  });

  it("includes SEASON LEADERS - PASSING when passers exist", () => {
    const playerStats = {
      [PLAYER_QB.id]: makePlayerStats(PLAYER_QB.name, PLAYER_QB.number, {
        offense: { passAttempts: 20, completions: 14, incompletions: 6, passingYards: 220, interceptions: 2, touchdowns: 3, rushAttempts: 0, rushingYards: 0, receptions: 0, receivingYards: 0 },
      }),
    };
    const csv = generateSeasonCSV("Snappers", makeSeasonStats({ playerStats }));
    expect(csv).toContain("SEASON LEADERS - PASSING");
    expect(csv).toContain(PLAYER_QB.name);
  });

  it("does not throw when playerStats is empty", () => {
    expect(() => generateSeasonCSV("Snappers", makeSeasonStats({ playerStats: {} }))).not.toThrow();
  });

  it("does not include SEASON LEADERS sections when no player stats", () => {
    const csv = generateSeasonCSV("Snappers", makeSeasonStats({ playerStats: {} }));
    expect(csv).not.toContain("SEASON LEADERS - PASSING");
    expect(csv).not.toContain("SEASON LEADERS - RUSHING");
    expect(csv).not.toContain("SEASON LEADERS - DEFENSE");
  });
});
