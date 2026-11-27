import { describe, it, expect } from "vitest";
import {
  addPlay,
  adjustScore,
  endHalf,
  handleInterceptionDetails,
  isMarker,
  markGameCompleted,
  rebuildGame,
  recordPenalty,
  recordPointAfter,
  replayTimeline,
  undoLastPlay,
} from "../game-engine";
import { gameFumbleStats, gameSackStats, playerStatsWithDerived } from "../derived-stats";
import { enforcedYards, findPenalty, penaltiesFor, penaltyLabel } from "../penalties";
import type { GameState, PlayData } from "../types";
import { makeGameState, PLAYER_DB, PLAYER_QB, PLAYER_RB, PLAYER_WR } from "./helpers";

const pass = (yards: number, o: Partial<PlayData> = {}): PlayData => ({
  possession: "team",
  playType: "pass",
  yards,
  complete: true,
  passer: PLAYER_QB.id,
  receiver: PLAYER_WR.id,
  ...o,
});
const run = (yards: number, o: Partial<PlayData> = {}): PlayData => ({
  possession: "team",
  playType: "run",
  yards,
  rusher: PLAYER_RB.id,
  ...o,
});
const oppPass = (yards: number, o: Partial<PlayData> = {}): PlayData => ({
  possession: "opponent",
  playType: "pass",
  yards,
  complete: true,
  ...o,
});

/** The parts of a game the rebuild must reproduce. */
function summary(g: GameState) {
  return {
    score: g.score,
    possession: g.possession,
    half: g.half,
    down: g.down,
    yardsToGo: g.yardsToGo,
    lineOfScrimmage: g.lineOfScrimmage,
    stats: g.stats,
    playerStats: g.playerStats,
    completed: g.completed,
    result: g.result,
    plays: g.plays.length,
  };
}

/** A realistic game: drives, a TD and try, a penalty, a pick, a half, a punt. */
function recordedGame(): GameState {
  let g = makeGameState({ firstPossession: "team" });
  g = addPlay(g, pass(8));
  g = addPlay(g, run(6)); // first down past the 17
  g = recordPenalty(g, { yards: 5, onOffense: true, lossOfDown: false, penaltyCode: "off_false_start" });
  g = addPlay(g, pass(0, { complete: false }));
  g = addPlay(g, pass(36, { touchdown: true }));
  g = recordPointAfter(g, { type: 2, success: true }); // 8-0
  g = addPlay(g, oppPass(10, { flagPull: true, defender: PLAYER_DB.id }));
  g = addPlay(g, oppPass(-3, { sack: true, sackType: "player", flagPull: true, defender: PLAYER_DB.id }));
  g = addPlay(g, oppPass(0, { complete: false, interception: true, defender: PLAYER_DB.id }));
  g = handleInterceptionDetails(g, false, 22);
  g = addPlay(g, run(4, { fumble: "dead" }));
  g = endHalf(g, "opponent");
  g = addPlay(g, oppPass(0, { sack: true, sackType: "coverage" }));
  g = addPlay(g, { possession: "opponent", playType: "run", yards: 7, fumble: "lost", defender: PLAYER_DB.id });
  g = adjustScore(g, "opponent", 1);
  g = addPlay(g, run(3));
  g = addPlay(g, run(0));
  g = addPlay(g, run(0));
  g = addPlay(g, { possession: "team", playType: "punt", isPunt: true, yards: 0 });
  return markGameCompleted(g);
}

describe("rebuildGame", () => {
  it("reproduces a recorded game exactly", () => {
    const g = recordedGame();
    expect(summary(rebuildGame(g))).toEqual(summary(g));
  });

  it("keeps each entry's id and time", () => {
    const g = recordedGame();
    const rebuilt = rebuildGame(g);
    expect(rebuilt.plays.map((p) => [p.id, p.recordedAt])).toEqual(g.plays.map((p) => [p.id, p.recordedAt]));
  });

  it("rebuilds older games that didn't log the half or their first possession", () => {
    const g = recordedGame();
    const legacy: GameState = {
      ...g,
      firstPossession: undefined,
      // Older games had no markers (and no score changes in the log).
      plays: g.plays.filter((p) => !isMarker(p)),
      score: { team: g.score.team, opponent: g.score.opponent - 1 },
    };
    const rebuilt = rebuildGame(legacy);
    expect(rebuilt.half).toBe(2);
    expect(rebuilt.score).toEqual(legacy.score);
    expect(rebuilt.stats).toEqual(g.stats);
    expect(rebuilt.completed).toBe(true);
  });

  it("an edit to one play updates the score, field and stats after it", () => {
    const g = recordedGame();
    const i = g.plays.findIndex((p) => p.touchdown);
    const edited = g.plays.slice();
    edited[i] = { ...edited[i], touchdown: false, yards: 20 }; // not a TD after all
    // The try after it no longer makes sense; drop it.
    edited.splice(i + 1, 1);
    const rebuilt = rebuildGame(g, edited);
    expect(rebuilt.score.team).toBe(0);
    expect(rebuilt.stats.offense.touchdowns).toBe(0);
    expect(rebuilt.playerStats[PLAYER_WR.id].offense.receivingYards).toBe(8 + 20);
    expect(rebuilt.result).toBe("loss");
  });

  it("deleting a play recalculates everything", () => {
    const g = recordedGame();
    const i = g.plays.findIndex((p) => p.interception);
    const rebuilt = rebuildGame(g, g.plays.filter((_, j) => j !== i));
    expect(rebuilt.stats.defense.interceptions).toBe(0);
    expect(rebuilt.playerStats[PLAYER_DB.id].defense.interceptions).toBe(0);
  });

  it("undo removes the last entry, including score changes and the end of a half", () => {
    let g = makeGameState({ firstPossession: "team" });
    g = addPlay(g, run(5));
    g = endHalf(g, "opponent");
    expect(g.half).toBe(2);
    g = adjustScore(g, "team", 2);
    expect(g.score.team).toBe(2);
    g = undoLastPlay(g);
    expect(g.score.team).toBe(0);
    g = undoLastPlay(g);
    expect(g.half).toBe(1);
    expect(g.possession).toBe("team");
  });

  it("timeline gives the score after each entry", () => {
    const g = recordedGame();
    const t = replayTimeline(g);
    expect(t).toHaveLength(g.plays.length);
    expect(t[t.length - 1].score).toEqual(g.score);
  });
});

describe("sacks as a pass outcome", () => {
  it("coverage sack: ball stays, down counts, no attempt and no yards", () => {
    let g = makeGameState();
    g = addPlay(g, pass(9, { sack: true, sackType: "coverage" }));
    expect(g.lineOfScrimmage).toBe(5);
    expect(g.down).toBe(2);
    expect(g.stats.offense.passAttempts).toBe(0);
    expect(g.stats.offense.totalPlays).toBe(1);
    expect(g.plays[0].yards).toBe(0);
    expect(gameSackStats(g).team.coverageSacksAllowed).toBe(1);
  });

  it("player sack: ball spotted at the loss, not a pass attempt", () => {
    let g = addPlay(makeGameState(), run(10));
    g = addPlay(g, pass(-4, { sack: true, sackType: "player", receiver: PLAYER_WR.id }));
    expect(g.lineOfScrimmage).toBe(11);
    expect(g.stats.offense.passAttempts).toBe(0);
    expect(g.plays[1].receiver).toBeNull();
    expect(gameSackStats(g).team.sackedAllowed).toBe(1);
  });

  it("legacy coverage_sack plays still count", () => {
    const g = addPlay(makeGameState({ possession: "opponent" }), {
      possession: "opponent",
      playType: "coverage_sack",
      yards: 0,
    });
    expect(gameSackStats(g).team.coverageSacks).toBe(1);
  });
});

describe("fumbles", () => {
  it("dead at the spot: the ball is spotted at the yards", () => {
    const g = addPlay(makeGameState(), run(6, { fumble: "dead" }));
    expect(g.possession).toBe("team");
    expect(g.lineOfScrimmage).toBe(11);
    expect(g.down).toBe(2);
    expect(gameFumbleStats(g).team).toEqual({ fumbles: 1, fumblesLost: 0, recoveries: 0 });
  });

  it("caught by the defense: change of possession at the spot, from their goal line", () => {
    let g = addPlay(makeGameState(), run(15)); // 1st down at the 20
    g = addPlay(g, run(5, { fumble: "lost" })); // fumbled at our 25
    expect(g.possession).toBe("opponent");
    expect(g.lineOfScrimmage).toBe(25);
    expect(g.down).toBe(1);
    expect(gameFumbleStats(g).team.fumblesLost).toBe(1);
  });

  it("our defense catching their fumble credits the defender", () => {
    const g = addPlay(makeGameState({ possession: "opponent" }), {
      possession: "opponent",
      playType: "run",
      yards: 3,
      fumble: "lost",
      defender: PLAYER_DB.id,
    });
    expect(g.possession).toBe("team");
    expect(g.lineOfScrimmage).toBe(42);
    expect(playerStatsWithDerived(g)[PLAYER_DB.id].defense.fumbleRecoveries).toBe(1);
  });

  it("runs can't be intercepted, and incomplete passes can't be fumbled", () => {
    let g = addPlay(makeGameState(), run(2, { interception: true }));
    expect(g.awaitingInterceptionInfo).toBeUndefined();
    g = addPlay(g, pass(0, { complete: false, fumble: "lost" }));
    expect(g.possession).toBe("team");
    expect(g.plays[1].fumble).toBeUndefined();
  });
});

describe("penalties", () => {
  it("defensive automatic first down", () => {
    let g = addPlay(makeGameState(), run(2)); // 2nd and 10 at the 7
    g = recordPenalty(g, { yards: 5, onOffense: false, lossOfDown: false, automaticFirstDown: true, penaltyCode: "def_pi" });
    expect(g.down).toBe(1);
    expect(g.lineOfScrimmage).toBe(12);
    expect(g.plays[1].penaltyCode).toBe("def_pi");
  });

  it("yardage that reaches the line to gain is a first down", () => {
    let g = addPlay(makeGameState(), run(10)); // 2nd and 2 at the 15
    g = recordPenalty(g, { yards: 5, onOffense: false, lossOfDown: false });
    expect(g.down).toBe(1);
    expect(g.firstDownTarget).toBe(33);
  });

  it("half the distance to the goal", () => {
    expect(enforcedYards(10, "offense", 12)).toEqual({ yards: 6, halfDistance: true });
    expect(enforcedYards(5, "offense", 12)).toEqual({ yards: 5, halfDistance: false });
    expect(enforcedYards(10, "defense", 44)).toEqual({ yards: 3, halfDistance: true });
  });

  it("has WIAA penalties for both sides, with names for logged entries", () => {
    expect(penaltiesFor("offense").length).toBeGreaterThan(10);
    expect(penaltiesFor("defense").every((p) => p.side === "defense")).toBe(true);
    expect(findPenalty("def_pi")?.automaticFirstDown).toBe(true);
    expect(findPenalty("off_flag_guarding")?.lossOfDown).toBe(true);
    expect(penaltyLabel({ penaltyCode: "other", penaltyName: "Illegal helmet" })).toBe("Illegal helmet");
    expect(penaltyLabel({})).toBeNull();
  });
});

describe("pick-six", () => {
  it("rebuild keeps the return TD and the try by the intercepting team", () => {
    let g = makeGameState({ firstPossession: "team" });
    g = addPlay(g, pass(0, { complete: false, interception: true }));
    g = handleInterceptionDetails(g, true, 0);
    g = recordPointAfter(g, { type: 2, success: true });
    expect(g.score).toEqual({ team: 0, opponent: 8 });
    expect(summary(rebuildGame(g))).toEqual(summary(g));
  });
});
