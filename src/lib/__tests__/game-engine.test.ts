import { describe, it, expect } from "vitest";
import {
  addPlay,
  recordPointAfter,
  recordPenalty,
  handleInterceptionDetails,
  endHalf,
  startOvertime,
  handleOvertimeConversion,
  adjustScore,
  undoLastPlay,
  markGameCompleted,
  triggerOvertimeSetup,
  calculateYardsToFirstDown,
  getFirstDownTargetLine,
} from "../game-engine";
import {
  makeGameState,
  PLAYER_QB,
  PLAYER_WR,
  PLAYER_RB,
  PLAYER_DB,
} from "./helpers";

// ---------------------------------------------------------------------------
// Helper shortcuts
// ---------------------------------------------------------------------------

function passPlay(yards: number, opts: Record<string, unknown> = {}) {
  return {
    possession: "team" as const,
    playType: "pass" as const,
    yards,
    complete: true,
    passer: PLAYER_QB.id,
    receiver: PLAYER_WR.id,
    ...opts,
  };
}

function runPlay(yards: number, opts: Record<string, unknown> = {}) {
  return {
    possession: "team" as const,
    playType: "run" as const,
    yards,
    rusher: PLAYER_RB.id,
    ...opts,
  };
}

function opponentRunPlay(yards: number, opts: Record<string, unknown> = {}) {
  return {
    possession: "opponent" as const,
    playType: "run" as const,
    yards,
    ...opts,
  };
}

// ===========================================================================
// First-down utility functions
// ===========================================================================

describe("calculateYardsToFirstDown", () => {
  it("returns yards to the next zone line from the 5", () => {
    expect(calculateYardsToFirstDown(5, null)).toBe(12); // 17 - 5
  });

  it("returns yards to 34 when LOS is in zone 2", () => {
    expect(calculateYardsToFirstDown(20, null)).toBe(14); // 34 - 20
  });

  it("returns yards to goal when in zone 3", () => {
    expect(calculateYardsToFirstDown(40, null)).toBe(11); // 51 - 40
  });

  it("returns 0 when already at end zone", () => {
    expect(calculateYardsToFirstDown(51, null)).toBe(0);
  });

  it("sticky: preserves existing target when LOS has not crossed it", () => {
    // LOS at 10, target set to 17 → 7 yards to go, not recalculated
    expect(calculateYardsToFirstDown(10, 17)).toBe(7);
  });

  it("sticky: ignores stale target when LOS has crossed it (null recalc)", () => {
    // LOS at 20 already past target 17 → recalculates to 34 zone
    expect(calculateYardsToFirstDown(20, 17)).toBe(14); // 34 - 20
  });
});

describe("getFirstDownTargetLine", () => {
  it("returns 17 for LOS 5", () => {
    expect(getFirstDownTargetLine(5, null)).toBe(17);
  });

  it("returns 34 for LOS in zone 2", () => {
    expect(getFirstDownTargetLine(20, null)).toBe(34);
  });

  it("returns 51 for LOS in zone 3", () => {
    expect(getFirstDownTargetLine(40, null)).toBe(51);
  });

  it("sticky: returns existing target when LOS has not crossed it", () => {
    expect(getFirstDownTargetLine(10, 17)).toBe(17);
  });
});

// ===========================================================================
// First-down system via addPlay
// ===========================================================================

describe("addPlay — first-down progression", () => {
  it("crossing the first-down marker resets down to 1 and advances target", () => {
    const state = makeGameState({ lineOfScrimmage: 5, firstDownTarget: 17, down: 1 });
    // 13 yards from LOS 5 → new LOS 18, which crosses 17
    const next = addPlay(state, passPlay(13));
    expect(next.down).toBe(1);
    expect(next.firstDownTarget).toBe(34);
    expect(next.lineOfScrimmage).toBe(18);
  });

  it("not crossing first-down marker increments down", () => {
    const state = makeGameState({ lineOfScrimmage: 5, firstDownTarget: 17, down: 1 });
    const next = addPlay(state, passPlay(5));
    expect(next.down).toBe(2);
    expect(next.lineOfScrimmage).toBe(10);
    expect(next.firstDownTarget).toBe(17); // sticky — unchanged
  });

  it("4th down failure switches possession and resets down to 1", () => {
    const state = makeGameState({ lineOfScrimmage: 10, firstDownTarget: 17, down: 4 });
    const next = addPlay(state, passPlay(2)); // 12 yards total, doesn't cross 17
    expect(next.down).toBe(1);
    expect(next.possession).toBe("opponent");
  });

  it("4th down failure credits defense.turnoversOnDowns when opponent fails", () => {
    const state = makeGameState({
      possession: "opponent",
      lineOfScrimmage: 10,
      firstDownTarget: 17,
      down: 4,
    });
    const next = addPlay(state, { ...opponentRunPlay(2) });
    expect(next.stats.defense.turnoversOnDowns).toBe(1);
    expect(next.possession).toBe("team");
  });

  it("negative yard play does not move first-down target backwards (sticky)", () => {
    const state = makeGameState({ lineOfScrimmage: 14, firstDownTarget: 17, down: 2 });
    const next = addPlay(state, passPlay(-4)); // new LOS 10, still below 17
    expect(next.firstDownTarget).toBe(17); // must NOT recalculate downward
    expect(next.yardsToGo).toBe(7); // 17 - 10
    expect(next.down).toBe(3);
  });

  it("penalty pushing LOS back does not move first-down target backwards", () => {
    // Start on 2nd down, LOS 14, target 17
    const state = makeGameState({ lineOfScrimmage: 14, firstDownTarget: 17, down: 2 });
    // 5-yard penalty on offense moves LOS back to 9
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: false });
    expect(next.firstDownTarget).toBe(17); // sticky — must not drop to 17 via recalc at LOS 9
    expect(next.yardsToGo).toBe(8); // 17 - 9
  });
});

// ===========================================================================
// Scoring
// ===========================================================================

describe("addPlay — scoring", () => {
  it("touchdown increments team score by 6", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(20, { touchdown: true }));
    expect(next.score.team).toBe(6);
    expect(next.score.opponent).toBe(0);
  });

  it("touchdown for opponent increments opponent score by 6", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, opponentRunPlay(10, { touchdown: true }));
    expect(next.score.opponent).toBe(6);
    expect(next.score.team).toBe(0);
  });

  it("safety by team awards 2 points to opponent", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(-10, { safety: true }));
    expect(next.score.opponent).toBe(2);
    expect(next.score.team).toBe(0);
    expect(next.lineOfScrimmage).toBe(5); // reset
    expect(next.down).toBe(1);
  });

  it("safety by opponent awards 2 points to team", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, opponentRunPlay(-5, { safety: true }));
    expect(next.score.team).toBe(2);
    expect(next.score.opponent).toBe(0);
  });
});

describe("recordPointAfter — 1pt", () => {
  it("always succeeds and adds 1 to scoring team", () => {
    const state = makeGameState({ score: { team: 6, opponent: 0 } });
    const next = recordPointAfter(state, { type: 1, success: false }); // success flag ignored for 1pt
    expect(next.score.team).toBe(7);
    expect(next.possession).toBe("opponent"); // switched
    expect(next.lineOfScrimmage).toBe(5);
    expect(next.down).toBe(1);
  });

  it("opponent 1pt PAT adds 1 to opponent", () => {
    const state = makeGameState({
      possession: "opponent",
      score: { team: 0, opponent: 6 },
    });
    const next = recordPointAfter(state, { type: 1, success: false });
    expect(next.score.opponent).toBe(7);
    expect(next.possession).toBe("team");
  });
});

describe("recordPointAfter — 2pt", () => {
  it("success adds 2 and switches possession", () => {
    const state = makeGameState({ score: { team: 6, opponent: 0 } });
    const next = recordPointAfter(state, { type: 2, success: true });
    expect(next.score.team).toBe(8);
    expect(next.possession).toBe("opponent");
  });

  it("failure adds 0 and switches possession", () => {
    const state = makeGameState({ score: { team: 6, opponent: 0 } });
    const next = recordPointAfter(state, { type: 2, success: false });
    expect(next.score.team).toBe(6); // unchanged
    expect(next.possession).toBe("opponent");
  });
});

// ===========================================================================
// Possession and game flow
// ===========================================================================

describe("addPlay — punt", () => {
  it("team punt switches possession and resets LOS to 5", () => {
    const state = makeGameState({ lineOfScrimmage: 20, down: 3 });
    const next = addPlay(state, {
      possession: "team",
      playType: "punt",
      yards: 0,
    });
    expect(next.possession).toBe("opponent");
    expect(next.lineOfScrimmage).toBe(5);
    expect(next.down).toBe(1);
  });

  it("opponent punt increments defense.forcedPunts", () => {
    // Note: forcedPunts is credited when opponent punts (we forced them off the field)
    // BUT the code checks: if g.possession !== "team" → forcedPunts++
    // At the time of the punt call, possession is already "opponent".
    // Wait — checking engine code: at punt time, possession is still "opponent",
    // and the check is `if (g.possession !== "team")`. So that IS opponent → forcedPunts++.
    const state = makeGameState({ possession: "opponent", lineOfScrimmage: 12, down: 4 });
    const next = addPlay(state, {
      possession: "opponent",
      playType: "punt",
      yards: 0,
    });
    expect(next.stats.defense.forcedPunts).toBe(1);
    expect(next.possession).toBe("team");
  });
});

describe("addPlay — interception", () => {
  it("sets awaitingInterceptionInfo and interceptionTeam", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(5, { interception: true, complete: false }));
    expect(next.awaitingInterceptionInfo).toBe(true);
    expect(next.interceptionTeam).toBe("opponent");
  });

  it("opponent interception sets interceptionTeam to team", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, {
      possession: "opponent",
      playType: "pass",
      yards: 0,
      complete: false,
      interception: true,
      defender: PLAYER_DB.id,
    });
    expect(next.interceptionTeam).toBe("team");
  });
});

describe("handleInterceptionDetails", () => {
  it("interception returned for TD gives 6 points to intercepting team", () => {
    const state = makeGameState({
      awaitingInterceptionInfo: true,
      interceptionTeam: "opponent",
    });
    const next = handleInterceptionDetails(state, true, 0);
    expect(next.score.opponent).toBe(6);
    expect(next.awaitingInterceptionInfo).toBeUndefined();
    expect(next.possession).toBe("opponent");
  });

  it("interception no-TD places ball at specified field position", () => {
    const state = makeGameState({
      awaitingInterceptionInfo: true,
      interceptionTeam: "opponent",
    });
    const next = handleInterceptionDetails(state, false, 25);
    expect(next.lineOfScrimmage).toBe(25);
    expect(next.down).toBe(1);
    expect(next.possession).toBe("opponent");
    expect(next.awaitingInterceptionInfo).toBeUndefined();
  });

  it("team interception no-TD gives possession to team at field position", () => {
    const state = makeGameState({
      possession: "opponent",
      awaitingInterceptionInfo: true,
      interceptionTeam: "team",
    });
    const next = handleInterceptionDetails(state, false, 30);
    expect(next.possession).toBe("team");
    expect(next.lineOfScrimmage).toBe(30);
    expect(next.down).toBe(1);
  });
});

describe("endHalf", () => {
  it("transitions half 1 to half 2 with correct possession", () => {
    const state = makeGameState({ half: 1 });
    const next = endHalf(state, "opponent");
    expect(next.half).toBe(2);
    expect(next.possession).toBe("opponent");
    expect(next.down).toBe(1);
    expect(next.lineOfScrimmage).toBe(5);
  });

  it("is idempotent on half 2 (no-op)", () => {
    const state = makeGameState({ half: 2 });
    const next = endHalf(state, "team");
    expect(next.half).toBe(2); // unchanged
  });
});

describe("triggerOvertimeSetup / markGameCompleted", () => {
  it("triggerOvertimeSetup sets awaitingOvertimeSetup", () => {
    const state = makeGameState({ score: { team: 14, opponent: 14 } });
    const next = triggerOvertimeSetup(state);
    expect(next.awaitingOvertimeSetup).toBe(true);
  });

  it("markGameCompleted marks win when team leads", () => {
    const state = makeGameState({ score: { team: 20, opponent: 14 } });
    const next = markGameCompleted(state);
    expect(next.completed).toBe(true);
    expect(next.result).toBe("win");
  });

  it("markGameCompleted marks loss when opponent leads", () => {
    const state = makeGameState({ score: { team: 6, opponent: 12 } });
    const next = markGameCompleted(state);
    expect(next.result).toBe("loss");
  });

  it("markGameCompleted marks tie on equal score", () => {
    const state = makeGameState({ score: { team: 7, opponent: 7 } });
    const next = markGameCompleted(state);
    expect(next.result).toBe("tie");
  });
});

// ===========================================================================
// Overtime (WIAA rules)
// ===========================================================================

describe("startOvertime", () => {
  it("sets isOvertime, half=OT, overtimeRound=1, awaitingOvertimeConversion", () => {
    const state = makeGameState({ awaitingOvertimeSetup: true });
    const next = startOvertime(state, "team");
    expect(next.isOvertime).toBe(true);
    expect(next.half).toBe("OT");
    expect(next.overtimeRound).toBe(1);
    expect(next.overtimeFirstOffense).toBe("team");
    expect(next.possession).toBe("team");
    expect(next.awaitingOvertimeConversion).toBe(true);
    expect(next.awaitingOvertimeSetup).toBeUndefined();
  });
});

describe("handleOvertimeConversion", () => {
  it("first team conversion switches possession to opponent", () => {
    const state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "team",
      possession: "team",
      awaitingOvertimeConversion: true,
    });
    const next = handleOvertimeConversion(state, { type: 1, success: true });
    expect(next.possession).toBe("opponent");
    expect(next.awaitingOvertimeConversion).toBe(true);
    expect(next.score.team).toBe(1);
  });

  it("both teams convert, scores still tied → new round, same first offense team", () => {
    // Team converts: round 1 play for "team"
    let state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "team",
      possession: "team",
      score: { team: 6, opponent: 6 },
      awaitingOvertimeConversion: true,
    });
    state = handleOvertimeConversion(state, { type: 1, success: true }); // team +1 → 7
    // Opponent converts to tie it again
    state = handleOvertimeConversion(state, { type: 1, success: true }); // opp +1 → 7
    expect(state.score.team).toBe(7);
    expect(state.score.opponent).toBe(7);
    expect(state.overtimeRound).toBe(2);
    expect(state.possession).toBe("team"); // same first offense team
    expect(state.awaitingOvertimeConversion).toBe(true);
  });

  it("both teams attempt, one is ahead → game completed with correct result", () => {
    let state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "team",
      possession: "team",
      score: { team: 6, opponent: 6 },
      awaitingOvertimeConversion: true,
    });
    state = handleOvertimeConversion(state, { type: 2, success: true }); // team +2 → 8
    state = handleOvertimeConversion(state, { type: 1, success: false }); // opp 0 → 6
    expect(state.completed).toBe(true);
    expect(state.result).toBe("win");
    expect(state.awaitingOvertimeConversion).toBeUndefined();
  });

  it("OT conversion failure adds 0 points", () => {
    const state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "team",
      possession: "team",
      score: { team: 6, opponent: 6 },
      awaitingOvertimeConversion: true,
    });
    const next = handleOvertimeConversion(state, { type: 2, success: false });
    expect(next.score.team).toBe(6); // unchanged
  });

  it("OT 1pt success adds exactly 1 point", () => {
    const state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "opponent",
      possession: "opponent",
      score: { team: 6, opponent: 6 },
      awaitingOvertimeConversion: true,
    });
    const next = handleOvertimeConversion(state, { type: 1, success: true });
    expect(next.score.opponent).toBe(7);
  });

  it("OT 2pt success adds exactly 2 points", () => {
    const state = makeGameState({
      isOvertime: true,
      half: "OT",
      overtimeRound: 1,
      overtimeFirstOffense: "team",
      possession: "team",
      score: { team: 6, opponent: 6 },
      awaitingOvertimeConversion: true,
    });
    const next = handleOvertimeConversion(state, { type: 2, success: true });
    expect(next.score.team).toBe(8);
  });
});

// ===========================================================================
// Stat tracking
// ===========================================================================

describe("addPlay — pass stat tracking", () => {
  it("completion credits passer attempts + completions + yards", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(12));
    const qb = next.playerStats[PLAYER_QB.id];
    expect(qb.offense.passAttempts).toBe(1);
    expect(qb.offense.completions).toBe(1);
    expect(qb.offense.passingYards).toBe(12);
    expect(qb.offense.incompletions).toBe(0);
  });

  it("completion credits receiver receptions + yards", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(8));
    const wr = next.playerStats[PLAYER_WR.id];
    expect(wr.offense.receptions).toBe(1);
    expect(wr.offense.receivingYards).toBe(8);
  });

  it("incompletion credits passer attempt + incompletion, no receiver stats", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(0, { complete: false, receiver: PLAYER_WR.id }));
    const qb = next.playerStats[PLAYER_QB.id];
    expect(qb.offense.passAttempts).toBe(1);
    expect(qb.offense.incompletions).toBe(1);
    expect(qb.offense.completions).toBe(0);
    const wr = next.playerStats[PLAYER_WR.id];
    expect(wr.offense.receptions).toBe(0);
    expect(wr.offense.receivingYards).toBe(0);
  });

  it("TD pass credits passer TD and receiver TD", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(15, { touchdown: true }));
    expect(next.playerStats[PLAYER_QB.id].offense.touchdowns).toBe(1);
    expect(next.playerStats[PLAYER_WR.id].offense.touchdowns).toBe(1);
  });

  it("pass interception credits passer interceptions", () => {
    const state = makeGameState();
    const next = addPlay(state, passPlay(0, { interception: true, complete: false }));
    expect(next.playerStats[PLAYER_QB.id].offense.interceptions).toBe(1);
    expect(next.stats.offense.interceptions).toBe(1);
  });

  it("team offense stats accumulate correctly across multiple passes", () => {
    let state = makeGameState();
    state = addPlay(state, passPlay(10));
    state = addPlay(state, passPlay(7));
    expect(state.stats.offense.passAttempts).toBe(2);
    expect(state.stats.offense.completions).toBe(2);
    expect(state.stats.offense.passingYards).toBe(17);
    expect(state.stats.offense.totalPlays).toBe(2);
  });
});

describe("addPlay — run stat tracking", () => {
  it("run credits rusher attempts + yards", () => {
    const state = makeGameState();
    const next = addPlay(state, runPlay(6));
    const rb = next.playerStats[PLAYER_RB.id];
    expect(rb.offense.rushAttempts).toBe(1);
    expect(rb.offense.rushingYards).toBe(6);
  });

  it("run TD credits rusher TD", () => {
    const state = makeGameState();
    const next = addPlay(state, runPlay(12, { touchdown: true }));
    expect(next.playerStats[PLAYER_RB.id].offense.touchdowns).toBe(1);
    expect(next.stats.offense.touchdowns).toBe(1);
  });

  it("team rush stats aggregate correctly", () => {
    let state = makeGameState();
    state = addPlay(state, runPlay(3));
    state = addPlay(state, runPlay(5));
    expect(state.stats.offense.rushAttempts).toBe(2);
    expect(state.stats.offense.rushingYards).toBe(8);
  });
});

describe("addPlay — defense stat tracking", () => {
  it("flag pull on opponent play credits correct defender", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, opponentRunPlay(5, {
      flagPull: true,
      defender: PLAYER_DB.id,
    }));
    expect(next.playerStats[PLAYER_DB.id].defense.flagPulls).toBe(1);
    expect(next.stats.defense.flagPulls).toBe(1);
  });

  it("negative yard play with flag pull credits tackle for loss", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, opponentRunPlay(-3, {
      flagPull: true,
      defender: PLAYER_DB.id,
    }));
    expect(next.playerStats[PLAYER_DB.id].defense.tacklesForLoss).toBe(1);
  });

  it("positive yard play with flag pull does NOT credit tackle for loss", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, opponentRunPlay(4, {
      flagPull: true,
      defender: PLAYER_DB.id,
    }));
    expect(next.playerStats[PLAYER_DB.id].defense.tacklesForLoss).toBe(0);
  });

  it("interception credits defender interceptions", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, {
      possession: "opponent",
      playType: "pass",
      yards: 0,
      complete: false,
      interception: true,
      defender: PLAYER_DB.id,
    });
    expect(next.playerStats[PLAYER_DB.id].defense.interceptions).toBe(1);
    expect(next.stats.defense.interceptions).toBe(1);
  });

  it("pass deflection credits correct defender", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, {
      possession: "opponent",
      playType: "pass",
      yards: 0,
      complete: false,
      passDeflection: true,
      defender: PLAYER_DB.id,
    });
    expect(next.playerStats[PLAYER_DB.id].defense.passDeflections).toBe(1);
  });

  it("team defense stats aggregate correctly across plays", () => {
    let state = makeGameState({ possession: "opponent" });
    state = addPlay(state, opponentRunPlay(3, { flagPull: true, defender: PLAYER_DB.id }));
    state = addPlay(state, opponentRunPlay(2, { flagPull: true, defender: PLAYER_DB.id }));
    expect(state.stats.defense.flagPulls).toBe(2);
    expect(state.playerStats[PLAYER_DB.id].defense.flagPulls).toBe(2);
  });

  it("forced punt (opponent punts) increments defense.forcedPunts", () => {
    const state = makeGameState({ possession: "opponent" });
    const next = addPlay(state, {
      possession: "opponent",
      playType: "punt",
      yards: 0,
    });
    expect(next.stats.defense.forcedPunts).toBe(1);
  });

  it("turnover on downs (opponent 4th down failure) increments defense.turnoversOnDowns", () => {
    const state = makeGameState({
      possession: "opponent",
      down: 4,
      lineOfScrimmage: 10,
      firstDownTarget: 17,
    });
    const next = addPlay(state, opponentRunPlay(2));
    expect(next.stats.defense.turnoversOnDowns).toBe(1);
    expect(next.possession).toBe("team");
  });
});

// ===========================================================================
// Penalties
// ===========================================================================

describe("recordPenalty", () => {
  it("offensive penalty moves LOS back by penalty yards", () => {
    const state = makeGameState({ lineOfScrimmage: 14, firstDownTarget: 17 });
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: false });
    expect(next.lineOfScrimmage).toBe(9);
  });

  it("defensive penalty moves LOS forward by penalty yards", () => {
    const state = makeGameState({ lineOfScrimmage: 10, firstDownTarget: 17 });
    const next = recordPenalty(state, { yards: 5, onOffense: false, lossOfDown: false });
    expect(next.lineOfScrimmage).toBe(15);
  });

  it("loss of down increments down number", () => {
    const state = makeGameState({ down: 2 });
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: true });
    expect(next.down).toBe(3);
  });

  it("loss of down on 4th down switches possession", () => {
    const state = makeGameState({ down: 4, lineOfScrimmage: 12, firstDownTarget: 17 });
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: true });
    expect(next.possession).toBe("opponent");
    expect(next.down).toBe(1);
  });

  it("non-loss-of-down penalty does NOT change down", () => {
    const state = makeGameState({ down: 2 });
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: false });
    expect(next.down).toBe(2); // replay the down
  });
});

// ===========================================================================
// Undo
// ===========================================================================

describe("undoLastPlay", () => {
  it("undo after a regular play reverts field position and down", () => {
    const state = makeGameState({ lineOfScrimmage: 5, firstDownTarget: 17, down: 1 });
    const after = addPlay(state, passPlay(5)); // LOS→10, down→2
    expect(after.down).toBe(2);
    const undone = undoLastPlay(after);
    expect(undone.down).toBe(1);
    expect(undone.lineOfScrimmage).toBe(5);
    expect(undone.plays).toHaveLength(0);
  });

  it("undo after TD reverts score by 6", () => {
    const state = makeGameState();
    const afterTD = addPlay(state, passPlay(20, { touchdown: true }));
    expect(afterTD.score.team).toBe(6);
    const undone = undoLastPlay(afterTD);
    expect(undone.score.team).toBe(0);
    expect(undone.stats.offense.touchdowns).toBe(0);
  });

  it("undo reverts passer stats", () => {
    const state = makeGameState();
    const after = addPlay(state, passPlay(10));
    const undone = undoLastPlay(after);
    expect(undone.playerStats[PLAYER_QB.id].offense.passAttempts).toBe(0);
    expect(undone.playerStats[PLAYER_QB.id].offense.completions).toBe(0);
    expect(undone.playerStats[PLAYER_QB.id].offense.passingYards).toBe(0);
    expect(undone.playerStats[PLAYER_WR.id].offense.receptions).toBe(0);
  });

  it("undo reverts run stats", () => {
    const state = makeGameState();
    const after = addPlay(state, runPlay(8));
    const undone = undoLastPlay(after);
    const rb = undone.playerStats[PLAYER_RB.id];
    expect(rb.offense.rushAttempts).toBe(0);
    expect(rb.offense.rushingYards).toBe(0);
    expect(undone.stats.offense.rushAttempts).toBe(0);
  });

  it("undo with empty plays array is a no-op", () => {
    const state = makeGameState();
    const undone = undoLastPlay(state);
    expect(undone.plays).toHaveLength(0);
    expect(undone.score.team).toBe(0);
  });
});

// ===========================================================================
// Score adjustment
// ===========================================================================

describe("adjustScore", () => {
  it("adds to team score", () => {
    const state = makeGameState({ score: { team: 6, opponent: 0 } });
    const next = adjustScore(state, "team", 1);
    expect(next.score.team).toBe(7);
  });

  it("subtracts from opponent score", () => {
    const state = makeGameState({ score: { team: 0, opponent: 6 } });
    const next = adjustScore(state, "opponent", -1);
    expect(next.score.opponent).toBe(5);
  });

  it("team score does not go below 0", () => {
    const state = makeGameState({ score: { team: 0, opponent: 0 } });
    const next = adjustScore(state, "team", -5);
    expect(next.score.team).toBe(0);
  });

  it("opponent score does not go below 0", () => {
    const state = makeGameState({ score: { team: 0, opponent: 0 } });
    const next = adjustScore(state, "opponent", -1);
    expect(next.score.opponent).toBe(0);
  });
});

// ===========================================================================
// Edge cases / immutability
// ===========================================================================

describe("immutability", () => {
  it("addPlay does not mutate the original state", () => {
    const state = makeGameState();
    const original = JSON.parse(JSON.stringify(state));
    addPlay(state, passPlay(10));
    expect(state).toEqual(original);
  });

  it("recordPenalty does not mutate the original state", () => {
    const state = makeGameState();
    const original = JSON.parse(JSON.stringify(state));
    recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: false });
    expect(state).toEqual(original);
  });
});

// ===========================================================================
// Boundary: field clamping
// ===========================================================================

describe("field boundary clamping", () => {
  it("LOS cannot exceed 51 (end zone)", () => {
    const state = makeGameState({ lineOfScrimmage: 45, firstDownTarget: 51 });
    const next = addPlay(state, passPlay(20)); // would go to 65 unclamped
    expect(next.lineOfScrimmage).toBe(51);
  });

  it("LOS cannot go below 0", () => {
    const state = makeGameState({ lineOfScrimmage: 3, firstDownTarget: 17 });
    const next = addPlay(state, passPlay(-10)); // would go to -7 unclamped
    expect(next.lineOfScrimmage).toBe(0);
  });
});
