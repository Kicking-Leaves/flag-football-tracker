// Pure game-engine functions for the flag-football tracker.
//
// All functions take a GameState and return a new GameState. No React, no
// Supabase, no side effects. The reducer in src/hooks/useGameReducer.ts is
// the only thing that calls into these.
//
// Business logic preserved from app.jsx (sticky first-down target,
// pass/run/defense stat tracking, penalty handling, interception flow) and
// from flag-football-tracker-v3.jsx (overtime conversion round tracking).

import type {
  GameState,
  Play,
  PlayData,
  PlayerStats,
  PointAfterData,
  PenaltyData,
  OTConversionData,
  Possession,
  RosterEntry,
  TryPoints,
} from "./types";

// ---------- Constants ----------

// WIAA field: 50 yards goal line to goal line, measured from the offense's
// own goal line. The two zones to gain sit 17 yards from each end zone (the
// offense's 17 and 33); the third "line" is the goal line itself.
export const FIELD_MIN = 0;
export const FIELD_MAX = 50;
export const FIRST_DOWN_LINES = [17, 33, 50] as const;

/** Spot (yards from the goal line) each try is run from: 1pt 5, 2pt 10, 3pt 17. */
export const TRY_SPOT: Record<TryPoints, number> = { 1: 5, 2: 10, 3: 17 };

// ---------- Factory helpers ----------

export function makeEmptyPlayerStats(name: string, number: string): PlayerStats {
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

export function makeInitialGameState(
  roster: RosterEntry[],
  firstPossession: Possession = "team",
  teamName?: string,
  opponentName?: string,
): GameState {
  const playerStats: Record<string, PlayerStats> = {};
  roster.forEach((p) => {
    playerStats[p.id] = makeEmptyPlayerStats(p.name, p.number);
  });

  return {
    teamName,
    opponentName,
    roster,
    score: { team: 0, opponent: 0 },
    possession: firstPossession,
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
  };
}

// ---------- First-down logic (app.jsx — STICKY target) ----------

/**
 * Sticky variant from app.jsx. If currentTarget is set and the LOS hasn't
 * crossed it yet, keep returning the same target. This prevents the first-down
 * marker from moving backward on penalties or negative plays.
 */
export function calculateYardsToFirstDown(
  los: number,
  currentTarget: number | null | undefined,
): number {
  if (currentTarget && los < currentTarget) {
    return currentTarget - los;
  }
  if (los >= 50) return 0;
  if (los >= 33) return 50 - los;
  if (los >= 17) return 33 - los;
  return 17 - los;
}

export function getFirstDownTargetLine(
  los: number,
  currentTarget: number | null | undefined,
): number {
  if (currentTarget && los < currentTarget) {
    return currentTarget;
  }
  if (los >= 33) return 50;
  if (los >= 17) return 33;
  return 17;
}

// ---------- Utilities ----------

/**
 * ISO 8601 timestamp in the device's local time with its UTC offset, e.g.
 * "2026-11-21T19:04:32.120-08:00". Keeping the offset (rather than UTC) means
 * the scorer's wall-clock time survives even when exports are built on a
 * server in another time zone.
 */
export function localIsoTimestamp(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`
  );
}

/** Recording metadata stamped on every play row. */
function recordMeta(g: GameState): Pick<Play, "recordedAt" | "half"> {
  return { recordedAt: localIsoTimestamp(), half: g.half };
}

function clone<T>(state: T): T {
  // structuredClone is available in Node 18+ / all modern browsers.
  return structuredClone(state);
}

function flipPossession(p: Possession): Possession {
  return p === "team" ? "opponent" : "team";
}

// ---------- Plays ----------

/**
 * Record a regular play (pass, run, or punt). Mirrors addPlay in app.jsx,
 * including the sticky first-down target behavior on negative yardage.
 */
export function addPlay(state: GameState, playData: PlayData): GameState {
  const g = clone(state);

  // Snapshot before mutating so the play row records pre-play state for undo.
  const stateBeforePlay = {
    down: g.down,
    yardsToGo: g.yardsToGo,
    lineOfScrimmage: g.lineOfScrimmage,
    firstDownTarget: g.firstDownTarget,
  };

  const play: Play = {
    id: Date.now(),
    ...playData,
    ...stateBeforePlay,
    ...recordMeta(g),
  };
  g.plays.push(play);

  // --- Stat tracking ---
  if (playData.possession === "team") {
    if (playData.playType === "pass") {
      g.stats.offense.passAttempts++;
      g.stats.offense.totalPlays++;
      if (playData.complete) {
        g.stats.offense.completions++;
        g.stats.offense.passingYards += playData.yards;
      }
      if (playData.passer && g.playerStats[playData.passer]) {
        const p = g.playerStats[playData.passer];
        p.offense.passAttempts++;
        if (playData.complete) {
          p.offense.completions++;
          p.offense.passingYards += playData.yards;
        } else {
          p.offense.incompletions++;
        }
        if (playData.interception) p.offense.interceptions++;
        if (playData.touchdown) p.offense.touchdowns++;
      }
      if (playData.complete && playData.receiver && g.playerStats[playData.receiver]) {
        const r = g.playerStats[playData.receiver];
        r.offense.receptions++;
        r.offense.receivingYards += playData.yards;
        if (playData.touchdown) r.offense.touchdowns++;
      }
    } else if (playData.playType === "run") {
      g.stats.offense.rushAttempts++;
      g.stats.offense.rushingYards += playData.yards;
      g.stats.offense.totalPlays++;
      if (playData.rusher && g.playerStats[playData.rusher]) {
        const r = g.playerStats[playData.rusher];
        r.offense.rushAttempts++;
        r.offense.rushingYards += playData.yards;
        if (playData.touchdown) r.offense.touchdowns++;
      }
    } else if (playData.playType === "coverage_sack") {
      // WIAA 7-second count expired: no yards, no player stats, down counts.
      g.stats.offense.totalPlays++;
    }
    if (playData.firstDown) g.stats.offense.firstDowns++;
    if (playData.touchdown) {
      g.stats.offense.touchdowns++;
      g.score.team += 6;
    }
    if (playData.interception) g.stats.offense.interceptions++;
  } else {
    // Opponent has possession — we track our defense.
    if (playData.touchdown) g.score.opponent += 6;

    if (playData.flagPull && playData.defender && g.playerStats[playData.defender]) {
      const d = g.playerStats[playData.defender];
      d.defense.flagPulls++;
      g.stats.defense.flagPulls++;
      if (playData.yards < 0) d.defense.tacklesForLoss++;
    }
    if (playData.interception && playData.defender && g.playerStats[playData.defender]) {
      g.playerStats[playData.defender].defense.interceptions++;
      g.stats.defense.interceptions++;
    }
    if (playData.passDeflection && playData.defender && g.playerStats[playData.defender]) {
      g.playerStats[playData.defender].defense.passDeflections++;
    }
  }

  // --- Special outcomes ---
  if (playData.safety) {
    if (playData.possession === "team") g.score.opponent += 2;
    else g.score.team += 2;
    g.possession = playData.possession;
    g.down = 1;
    g.lineOfScrimmage = 5;
    g.yardsToGo = 12;
    g.firstDownTarget = 17;
    return g;
  }

  if (playData.touchdown) {
    // Field state stays put; UI will switch to "point after" mode.
    return g;
  }

  if (playData.interception) {
    g.awaitingInterceptionInfo = true;
    g.interceptionTeam = flipPossession(playData.possession);
    return g;
  }

  if (playData.isPunt || playData.playType === "punt") {
    if (g.possession !== "team") {
      g.stats.defense.forcedPunts = (g.stats.defense.forcedPunts || 0) + 1;
    }
    g.possession = flipPossession(g.possession);
    g.down = 1;
    g.lineOfScrimmage = 5;
    g.yardsToGo = 12;
    g.firstDownTarget = 17;
    return g;
  }

  // --- Normal field progression ---
  const newLOS = Math.max(FIELD_MIN, Math.min(FIELD_MAX, g.lineOfScrimmage + playData.yards));
  g.lineOfScrimmage = newLOS;

  const currentTarget = g.firstDownTarget || getFirstDownTargetLine(newLOS, null);
  const crossedTarget = newLOS >= currentTarget;

  if (crossedTarget || playData.firstDown) {
    g.down = 1;
    g.firstDownTarget = getFirstDownTargetLine(newLOS, null);
    g.yardsToGo = calculateYardsToFirstDown(newLOS, g.firstDownTarget);
    if (!playData.firstDown) g.stats.offense.firstDowns++;
    // Ensure the stored play record reflects that a first down was earned so
    // undoLastPlay can correctly reverse the stat. Without this, auto-detected
    // first downs (crossedTarget) leak past undo because lastPlay.firstDown
    // is falsy.
    play.firstDown = true;
  } else {
    g.down++;
    if (g.down > 4) {
      const wasScoringTeam = g.possession === "team";
      g.possession = flipPossession(g.possession);
      g.down = 1;
      g.firstDownTarget = getFirstDownTargetLine(newLOS, null);
      g.yardsToGo = calculateYardsToFirstDown(newLOS, g.firstDownTarget);
      if (!wasScoringTeam) {
        g.stats.defense.turnoversOnDowns = (g.stats.defense.turnoversOnDowns || 0) + 1;
      }
    } else {
      g.firstDownTarget = currentTarget;
      g.yardsToGo = calculateYardsToFirstDown(newLOS, currentTarget);
    }
  }

  return g;
}

/**
 * Point after touchdown. WIAA: the 1pt is automatic; the 2pt (from the 10)
 * and 3pt (from the 17) tries can fail.
 * After the point after, possession switches and ball returns to the 5.
 */
export function recordPointAfter(state: GameState, data: PointAfterData): GameState {
  const g = clone(state);
  const success = data.type === 1 ? true : data.success;
  if (success) {
    if (g.possession === "team") g.score.team += data.type;
    else g.score.opponent += data.type;
  }

  g.plays.push({
    ...recordMeta(g),
    id: Date.now(),
    playType: "point_after",
    possession: g.possession,
    yards: 0,
    isPointAfter: true,
    attempt: data.type,
    success,
    points: success ? data.type : 0,
    passer: data.playType === "pass" ? data.passer ?? null : null,
    receiver: data.playType === "pass" && success ? data.receiver ?? null : null,
    rusher: data.playType === "run" ? data.rusher ?? null : null,
    down: 0,
    yardsToGo: 0,
    lineOfScrimmage: TRY_SPOT[data.type],
  });

  // Possession switches after PAT.
  g.possession = flipPossession(g.possession);
  g.down = 1;
  g.lineOfScrimmage = 5;
  g.yardsToGo = 12;
  g.firstDownTarget = 17;
  return g;
}

/**
 * Penalty. Preserves the sticky first-down target — recalculating it on a
 * penalty was the bug in v3 that app.jsx fixed.
 */
export function recordPenalty(state: GameState, data: PenaltyData): GameState {
  const g = clone(state);
  // Offense at the time of the foul (a loss of down on 4th can flip it below).
  const offense = g.possession;
  const penaltyAmount = data.onOffense ? -data.yards : data.yards;
  const newLOS = Math.max(FIELD_MIN, Math.min(FIELD_MAX, g.lineOfScrimmage + penaltyAmount));
  g.lineOfScrimmage = newLOS;

  const preservedTarget = g.firstDownTarget || getFirstDownTargetLine(newLOS, null);
  g.firstDownTarget = preservedTarget;
  g.yardsToGo = calculateYardsToFirstDown(newLOS, preservedTarget);

  if (data.lossOfDown) {
    g.down++;
    if (g.down > 4) {
      g.possession = flipPossession(g.possession);
      g.down = 1;
      g.firstDownTarget = getFirstDownTargetLine(newLOS, null);
      g.yardsToGo = calculateYardsToFirstDown(newLOS, g.firstDownTarget);
    }
  }
  // Else replay the down (no change to down number).

  g.plays.push({
    ...recordMeta(g),
    id: Date.now(),
    playType: "penalty",
    possession: offense,
    yards: penaltyAmount,
    onOffense: data.onOffense,
    lossOfDown: data.lossOfDown,
    down: g.down,
    yardsToGo: g.yardsToGo,
    lineOfScrimmage: g.lineOfScrimmage,
    firstDownTarget: g.firstDownTarget,
  });

  return g;
}

/** Resolve a pending interception: either TD on the return, or set field position. */
export function handleInterceptionDetails(
  state: GameState,
  isTD: boolean,
  fieldPos: number,
): GameState {
  const g = clone(state);
  delete g.awaitingInterceptionInfo;
  const intTeam = g.interceptionTeam ?? flipPossession(g.possession);
  g.possession = intTeam;
  delete g.interceptionTeam;

  if (isTD) {
    if (g.possession === "team") g.score.team += 6;
    else g.score.opponent += 6;
    const intPlay = g.plays[g.plays.length - 1];
    if (intPlay?.interception) intPlay.interceptionReturnTD = true;
    // Keep possession — UI will prompt for point after.
  } else {
    g.down = 1;
    g.lineOfScrimmage = Math.max(FIELD_MIN, Math.min(FIELD_MAX, fieldPos));
    g.firstDownTarget = getFirstDownTargetLine(g.lineOfScrimmage, null);
    g.yardsToGo = calculateYardsToFirstDown(g.lineOfScrimmage, g.firstDownTarget);
  }
  return g;
}

/** End the first half. nextPossession receives the ball in the 2nd half. */
export function endHalf(state: GameState, nextPossession: Possession): GameState {
  const g = clone(state);
  if (g.half === 1) {
    g.half = 2;
    g.possession = nextPossession;
    g.down = 1;
    g.lineOfScrimmage = 5;
    g.yardsToGo = 12;
    g.firstDownTarget = 17;
  }
  return g;
}

/** Triggered when a tied game ends regulation. */
export function startOvertime(state: GameState, firstOffense: Possession): GameState {
  const g = clone(state);
  delete g.awaitingOvertimeSetup;
  g.isOvertime = true;
  g.half = "OT";
  g.overtimeRound = 1;
  g.overtimeFirstOffense = firstOffense;
  g.possession = firstOffense;
  g.awaitingOvertimeConversion = true;
  return g;
}

/**
 * WIAA-style overtime conversion: each attempt is one of 1pt (pass only) from
 * the 5, 2pt from the 10, or 3pt from the 17.
 * Same team starts on offense each round. Both teams must attempt per round.
 * Game ends as soon as one team is ahead after both have attempted.
 *
 * This is v3's handleOvertimeConversion, which correctly tracks rounds via the
 * play history rather than a brittle "second possession" flag.
 */
export function handleOvertimeConversion(
  state: GameState,
  data: OTConversionData,
): GameState {
  const g = clone(state);

  if (data.success) {
    if (g.possession === "team") g.score.team += data.type;
    else g.score.opponent += data.type;
  }

  g.plays.push({
    ...recordMeta(g),
    id: Date.now(),
    playType: "point_after",
    possession: g.possession,
    yards: 0,
    isOvertimeConversion: true,
    overtimeRound: g.overtimeRound,
    attempt: data.type,
    success: data.success,
    points: data.success ? data.type : 0,
    down: 0,
    yardsToGo: 0,
    lineOfScrimmage: TRY_SPOT[data.type],
  });

  // After the play is recorded, check whether both teams have attempted in
  // the current OT round.
  const roundPlays = g.plays.filter(
    (p) => p.isOvertimeConversion && p.overtimeRound === g.overtimeRound,
  );
  const teamDone = roundPlays.some((p) => p.possession === "team");
  const oppDone = roundPlays.some((p) => p.possession === "opponent");

  if (teamDone && oppDone) {
    if (g.score.team !== g.score.opponent) {
      // Game over.
      delete g.awaitingOvertimeConversion;
      g.completed = true;
      g.result = g.score.team > g.score.opponent ? "win" : "loss";
    } else {
      // Tied — new round, same team starts on offense.
      g.overtimeRound++;
      g.possession = g.overtimeFirstOffense ?? "team";
      g.awaitingOvertimeConversion = true;
    }
  } else {
    // Switch to the other team for their attempt.
    g.possession = flipPossession(g.possession);
    g.awaitingOvertimeConversion = true;
  }

  return g;
}

/** Manual score adjustment in settings. */
export function adjustScore(
  state: GameState,
  team: Possession,
  amount: number,
): GameState {
  const g = clone(state);
  if (team === "team") g.score.team = Math.max(0, g.score.team + amount);
  else g.score.opponent = Math.max(0, g.score.opponent + amount);
  return g;
}

/**
 * Undo the last play. Reverses stats AND restores the field state captured
 * in the play's pre-play snapshot.
 */
export function undoLastPlay(state: GameState): GameState {
  const g = clone(state);
  if (!g.plays.length) return g;

  const lastPlay = g.plays[g.plays.length - 1];

  if (lastPlay.playType === "penalty") {
    g.plays.pop();
    if (g.plays.length > 0) {
      const prev = g.plays[g.plays.length - 1];
      g.down = prev.down;
      g.yardsToGo = prev.yardsToGo;
      g.lineOfScrimmage = prev.lineOfScrimmage;
      if (prev.firstDownTarget) g.firstDownTarget = prev.firstDownTarget;
    }
    return g;
  }

  // Tries (after a TD, or in OT) carry no field snapshot worth restoring: take
  // the points back and return to the "awaiting try" state for the same team.
  if (lastPlay.isPointAfter || lastPlay.isOvertimeConversion) {
    g.plays.pop();
    const scorer = lastPlay.possession ?? flipPossession(g.possession);
    const pts = lastPlay.points ?? 0;
    if (scorer === "team") g.score.team = Math.max(0, g.score.team - pts);
    else g.score.opponent = Math.max(0, g.score.opponent - pts);
    g.possession = scorer;

    if (lastPlay.isOvertimeConversion) {
      g.overtimeRound = lastPlay.overtimeRound ?? g.overtimeRound;
      g.awaitingOvertimeConversion = true;
      g.completed = false;
      delete g.result;
    } else {
      // Back to just after the scoring play, which left the field state put.
      const scoringPlay = g.plays[g.plays.length - 1];
      if (scoringPlay) {
        g.down = scoringPlay.down || 1;
        g.yardsToGo = scoringPlay.yardsToGo;
        g.lineOfScrimmage = scoringPlay.lineOfScrimmage;
        if (scoringPlay.firstDownTarget) g.firstDownTarget = scoringPlay.firstDownTarget;
      }
    }
    return g;
  }

  g.plays.pop();

  // Possession goes back to whoever had the ball for this snap — punts,
  // safeties, turnovers on downs, and interceptions all flip it.
  if (lastPlay.possession) g.possession = lastPlay.possession;
  delete g.awaitingInterceptionInfo;
  delete g.interceptionTeam;

  // Restore field state from the snapshot stored in the play row.
  g.down = lastPlay.down || 1;
  g.yardsToGo = lastPlay.yardsToGo;
  g.lineOfScrimmage = lastPlay.lineOfScrimmage;
  g.firstDownTarget =
    lastPlay.firstDownTarget ||
    getFirstDownTargetLine(lastPlay.lineOfScrimmage, null);

  // Reverse stat tracking.
  if (lastPlay.playType === "pass" && lastPlay.possession === "team") {
    g.stats.offense.passAttempts = Math.max(0, g.stats.offense.passAttempts - 1);
    g.stats.offense.totalPlays = Math.max(0, g.stats.offense.totalPlays - 1);
    if (lastPlay.complete) {
      g.stats.offense.completions = Math.max(0, g.stats.offense.completions - 1);
      g.stats.offense.passingYards = Math.max(
        0,
        g.stats.offense.passingYards - (lastPlay.yards || 0),
      );
    }
    if (lastPlay.passer && g.playerStats[lastPlay.passer]) {
      const p = g.playerStats[lastPlay.passer];
      p.offense.passAttempts = Math.max(0, p.offense.passAttempts - 1);
      if (lastPlay.complete) {
        p.offense.completions = Math.max(0, p.offense.completions - 1);
        p.offense.passingYards = Math.max(0, p.offense.passingYards - (lastPlay.yards || 0));
      } else {
        p.offense.incompletions = Math.max(0, p.offense.incompletions - 1);
      }
      if (lastPlay.interception)
        p.offense.interceptions = Math.max(0, p.offense.interceptions - 1);
    }
    if (lastPlay.complete && lastPlay.receiver && g.playerStats[lastPlay.receiver]) {
      const r = g.playerStats[lastPlay.receiver];
      r.offense.receptions = Math.max(0, r.offense.receptions - 1);
      r.offense.receivingYards = Math.max(0, r.offense.receivingYards - (lastPlay.yards || 0));
    }
  } else if (lastPlay.playType === "coverage_sack" && lastPlay.possession === "team") {
    g.stats.offense.totalPlays = Math.max(0, g.stats.offense.totalPlays - 1);
  } else if (lastPlay.playType === "run" && lastPlay.possession === "team") {
    g.stats.offense.rushAttempts = Math.max(0, g.stats.offense.rushAttempts - 1);
    g.stats.offense.rushingYards = Math.max(0, g.stats.offense.rushingYards - (lastPlay.yards || 0));
    g.stats.offense.totalPlays = Math.max(0, g.stats.offense.totalPlays - 1);
    if (lastPlay.rusher && g.playerStats[lastPlay.rusher]) {
      const r = g.playerStats[lastPlay.rusher];
      r.offense.rushAttempts = Math.max(0, r.offense.rushAttempts - 1);
      r.offense.rushingYards = Math.max(0, r.offense.rushingYards - (lastPlay.yards || 0));
    }
  }

  if (lastPlay.touchdown) {
    if (lastPlay.possession === "team") {
      g.score.team = Math.max(0, g.score.team - 6);
      g.stats.offense.touchdowns = Math.max(0, g.stats.offense.touchdowns - 1);
      if (lastPlay.passer && g.playerStats[lastPlay.passer])
        g.playerStats[lastPlay.passer].offense.touchdowns = Math.max(
          0,
          g.playerStats[lastPlay.passer].offense.touchdowns - 1,
        );
      if (lastPlay.receiver && g.playerStats[lastPlay.receiver])
        g.playerStats[lastPlay.receiver].offense.touchdowns = Math.max(
          0,
          g.playerStats[lastPlay.receiver].offense.touchdowns - 1,
        );
      if (lastPlay.rusher && g.playerStats[lastPlay.rusher])
        g.playerStats[lastPlay.rusher].offense.touchdowns = Math.max(
          0,
          g.playerStats[lastPlay.rusher].offense.touchdowns - 1,
        );
    } else {
      g.score.opponent = Math.max(0, g.score.opponent - 6);
    }
  }

  if (lastPlay.safety) {
    // Safety scores 2 for the defense.
    if (lastPlay.possession === "team") g.score.opponent = Math.max(0, g.score.opponent - 2);
    else g.score.team = Math.max(0, g.score.team - 2);
  }

  if (lastPlay.interceptionReturnTD) {
    if (lastPlay.possession === "team") g.score.opponent = Math.max(0, g.score.opponent - 6);
    else g.score.team = Math.max(0, g.score.team - 6);
  }

  if (lastPlay.possession === "opponent") {
    if (lastPlay.playType === "punt" || lastPlay.isPunt) {
      g.stats.defense.forcedPunts = Math.max(0, (g.stats.defense.forcedPunts || 0) - 1);
    } else if (
      lastPlay.down === 4 &&
      !lastPlay.firstDown &&
      !lastPlay.touchdown &&
      !lastPlay.interception &&
      !lastPlay.safety
    ) {
      g.stats.defense.turnoversOnDowns = Math.max(
        0,
        (g.stats.defense.turnoversOnDowns || 0) - 1,
      );
    }
  }

  if (lastPlay.firstDown && lastPlay.possession === "team") {
    g.stats.offense.firstDowns = Math.max(0, g.stats.offense.firstDowns - 1);
  }

  if (lastPlay.flagPull && lastPlay.defender && g.playerStats[lastPlay.defender]) {
    const d = g.playerStats[lastPlay.defender];
    d.defense.flagPulls = Math.max(0, d.defense.flagPulls - 1);
    g.stats.defense.flagPulls = Math.max(0, g.stats.defense.flagPulls - 1);
    if ((lastPlay.yards || 0) < 0 && d.defense.tacklesForLoss > 0) {
      d.defense.tacklesForLoss = Math.max(0, d.defense.tacklesForLoss - 1);
    }
  }
  if (lastPlay.interception && lastPlay.defender && g.playerStats[lastPlay.defender]) {
    const d = g.playerStats[lastPlay.defender];
    d.defense.interceptions = Math.max(0, d.defense.interceptions - 1);
    g.stats.defense.interceptions = Math.max(0, g.stats.defense.interceptions - 1);
  }
  if (lastPlay.passDeflection && lastPlay.defender && g.playerStats[lastPlay.defender]) {
    const d = g.playerStats[lastPlay.defender];
    d.defense.passDeflections = Math.max(0, d.defense.passDeflections - 1);
  }

  return g;
}

/**
 * Mark a game as completed and stamp its result, based on the current score.
 */
export function markGameCompleted(state: GameState): GameState {
  const g = clone(state);
  g.completed = true;
  if (g.score.team > g.score.opponent) g.result = "win";
  else if (g.score.team < g.score.opponent) g.result = "loss";
  else g.result = "tie";
  return g;
}

/**
 * Detect "regulation ended tied" — UI calls this when the user taps End Game
 * after the 2nd half. Returns a state that flags the OT setup dialog.
 */
export function triggerOvertimeSetup(state: GameState): GameState {
  const g = clone(state);
  g.awaitingOvertimeSetup = true;
  return g;
}
