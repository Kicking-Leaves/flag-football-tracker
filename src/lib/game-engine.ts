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
  MarkerType,
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
      sacks: 0,
      fumbleRecoveries: 0,
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
    firstPossession,
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

/** True for a pass that ended in a coverage sack (or the legacy coverage_sack type). */
export function isCoverageSack(p: Pick<Play, "playType" | "sack" | "sackType">): boolean {
  return p.playType === "coverage_sack" || (p.playType === "pass" && Boolean(p.sack) && p.sackType === "coverage");
}

/** True for a pass where the passer's flag was pulled before the throw. */
export function isPlayerSack(p: Pick<Play, "playType" | "sack" | "sackType">): boolean {
  return p.playType === "pass" && Boolean(p.sack) && p.sackType !== "coverage";
}

/** Clears outcome flags that can't go together, so the log stays consistent. */
function normalizePlayData(input: PlayData): PlayData {
  const d: PlayData = { ...input };
  if (d.playType === "coverage_sack") {
    d.playType = "pass";
    d.sack = true;
    d.sackType = "coverage";
  }
  if (d.playType !== "pass") {
    delete d.sack;
    delete d.sackType;
    delete d.complete;
    d.passer = null;
    d.receiver = null;
    d.passDeflection = false;
  }
  if (d.playType !== "run") d.rusher = null;
  if (d.playType === "run") d.interception = false;
  if (d.playType === "punt") {
    d.isPunt = true;
    d.yards = 0;
    delete d.fumble;
  }
  if (d.playType === "pass" && d.sack) {
    d.sackType = d.sackType ?? "player";
    d.complete = false;
    d.receiver = null;
    d.touchdown = false;
    d.interception = false;
    d.passDeflection = false;
    delete d.fumble;
    if (d.sackType === "coverage") {
      // 7-second count: ball back to the previous spot, down counts.
      d.yards = 0;
      d.firstDown = false;
      d.flagPull = false;
      d.defender = null;
    }
  } else {
    delete d.sack;
    delete d.sackType;
  }
  // An incomplete pass is dead when it lands; there's nothing to fumble.
  if (d.playType === "pass" && !d.complete) delete d.fumble;
  if (d.interception) delete d.fumble;
  if (d.fumble === "lost") {
    d.touchdown = false;
    d.firstDown = false;
    d.safety = false;
  }
  if (!d.fumble) delete d.fumble;
  return d;
}

/**
 * Record a regular play (pass, run, or punt). Mirrors addPlay in app.jsx,
 * including the sticky first-down target behavior on negative yardage.
 *
 * Sacks are an outcome of a pass: a player sack (flag pulled before the
 * throw, ball spotted at the yards given) or a coverage sack (7-second count,
 * ball back to the previous spot). Neither counts as a pass attempt.
 * A fumble is dead at the spot, or "lost" when the defense catches it before
 * it touches the ground and takes over there.
 */
export function addPlay(state: GameState, input: PlayData): GameState {
  const g = clone(state);
  const playData = normalizePlayData(input);
  const coverageSack = isCoverageSack(playData);
  const playerSack = isPlayerSack(playData);

  // Snapshot before mutating so the play row records pre-play state.
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
    if (playData.playType === "pass" && (coverageSack || playerSack)) {
      g.stats.offense.totalPlays++;
    } else if (playData.playType === "pass") {
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

  if (playData.fumble === "lost") {
    // The defense takes over where the ball was fumbled. Field positions are
    // measured from each offense's own goal line, so flip the spot.
    const spot = Math.max(FIELD_MIN, Math.min(FIELD_MAX, g.lineOfScrimmage + playData.yards));
    g.possession = flipPossession(g.possession);
    g.down = 1;
    g.lineOfScrimmage = Math.max(FIELD_MIN, Math.min(FIELD_MAX, FIELD_MAX - spot));
    g.firstDownTarget = getFirstDownTargetLine(g.lineOfScrimmage, null);
    g.yardsToGo = calculateYardsToFirstDown(g.lineOfScrimmage, g.firstDownTarget);
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
    // Only our offense's first downs are team stats.
    if (!playData.firstDown && playData.possession === "team") g.stats.offense.firstDowns++;
    // Record that a first down was earned so the log and stats agree.
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

  if (data.automaticFirstDown || newLOS >= preservedTarget) {
    // Automatic first down, or the yardage reached the line to gain.
    g.down = 1;
    g.firstDownTarget = getFirstDownTargetLine(newLOS, null);
    g.yardsToGo = calculateYardsToFirstDown(newLOS, g.firstDownTarget);
  } else if (data.lossOfDown) {
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
    ...(data.automaticFirstDown ? { automaticFirstDown: true } : {}),
    ...(data.penaltyCode ? { penaltyCode: data.penaltyCode } : {}),
    ...(data.penaltyName ? { penaltyName: data.penaltyName } : {}),
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

  const intPlay = g.plays[g.plays.length - 1];
  if (isTD) {
    if (g.possession === "team") g.score.team += 6;
    else g.score.opponent += 6;
    if (intPlay?.interception) intPlay.interceptionReturnTD = true;
    // Keep possession — UI will prompt for point after.
  } else {
    if (intPlay?.interception) intPlay.returnSpot = fieldPos;
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
    pushMarker(g, "half_end", nextPossession);
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
  pushMarker(g, "overtime_start", firstOffense);
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
  pushMarker(g, "score_adjustment", team, { points: amount });
  return g;
}

/**
 * Undo the last log entry (play, penalty, try, end of half, score change) by
 * rebuilding the game from the rest of the log.
 */
export function undoLastPlay(state: GameState): GameState {
  if (!state.plays.length) return clone(state);
  return rebuildGame(state, state.plays.slice(0, -1), { keepStatus: false });
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
 * Reopen a completed game so its plays can be corrected (undo, add plays).
 * Ending it again recomputes the result.
 */
export function reopenGame(state: GameState): GameState {
  const g = clone(state);
  g.completed = false;
  delete g.result;
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

// ---------- Log markers ----------

const MARKER_TYPES = new Set<Play["playType"]>(["half_end", "overtime_start", "score_adjustment"]);

/** End of half, start of overtime, or a score change: not a snap or a try. */
export function isMarker(p: Pick<Play, "playType">): boolean {
  return MARKER_TYPES.has(p.playType);
}

function pushMarker(
  g: GameState,
  type: MarkerType,
  possession: Possession,
  extra: Partial<Play> = {},
): void {
  g.plays.push({
    ...recordMeta(g),
    id: Date.now(),
    playType: type,
    possession,
    yards: 0,
    down: g.down,
    yardsToGo: g.yardsToGo,
    lineOfScrimmage: g.lineOfScrimmage,
    firstDownTarget: g.firstDownTarget,
    ...extra,
  });
}

/**
 * The entry that decides whether a try is due: the last one that isn't a
 * score change (a score change right after a TD shouldn't skip the try).
 */
export function lastScoringCheckEntry(plays: Play[]): Play | undefined {
  for (let i = plays.length - 1; i >= 0; i--) {
    if (plays[i].playType !== "score_adjustment") return plays[i];
  }
  return undefined;
}

// ---------- Rebuilding from the log ----------

function playDataFrom(e: Play, possession: Possession): PlayData {
  return {
    possession,
    playType: e.playType as PlayData["playType"],
    yards: e.yards ?? 0,
    complete: e.complete,
    firstDown: e.firstDown,
    touchdown: e.touchdown,
    interception: e.interception,
    flagPull: e.flagPull,
    safety: e.safety,
    passDeflection: e.passDeflection,
    sack: e.sack,
    sackType: e.sackType,
    fumble: e.fumble,
    isPunt: e.isPunt,
    passer: e.passer ?? null,
    receiver: e.receiver ?? null,
    rusher: e.rusher ?? null,
    defender: e.defender ?? null,
  };
}

function isSnap(e: Play): boolean {
  return e.playType === "pass" || e.playType === "run" || e.playType === "punt" || e.playType === "coverage_sack";
}

/** Keeps the original entry's id and time on whatever the engine just logged. */
function keepIdentity(g: GameState, e: Play): void {
  const i = g.plays.length - 1;
  if (i < 0) return;
  g.plays[i] = { ...g.plays[i], id: e.id, recordedAt: e.recordedAt };
  if (!e.recordedAt) delete g.plays[i].recordedAt;
}

function stripTime(g: GameState): GameState {
  const last = g.plays[g.plays.length - 1];
  if (last) delete last.recordedAt;
  return g;
}

function applyEntry(g: GameState, e: Play, next: Play | undefined, original: GameState): GameState {
  let s = g;

  // Older games didn't log the end of the half or the start of overtime:
  // infer them from the period each entry was recorded in.
  if (!isMarker(e) && e.half === 2 && s.half === 1) {
    s = stripTime(endHalf(s, e.possession ?? s.possession));
  }
  if (e.isOvertimeConversion && !s.isOvertime) {
    s = stripTime(startOvertime(s, e.possession ?? s.possession));
  }

  // The possession logged with each entry is what the scorer saw, so it wins
  // over the rebuilt state. If they disagree, take the entry's own field spot.
  if (!isMarker(e) && e.possession && e.possession !== s.possession) {
    s = clone(s);
    s.possession = e.possession;
    delete s.awaitingInterceptionInfo;
    delete s.interceptionTeam;
    if (isSnap(e)) {
      s.down = e.down || 1;
      s.yardsToGo = e.yardsToGo;
      s.lineOfScrimmage = e.lineOfScrimmage;
      s.firstDownTarget = e.firstDownTarget || getFirstDownTargetLine(e.lineOfScrimmage, null);
    }
  }

  switch (e.playType) {
    case "half_end":
      s = endHalf(s, e.possession ?? "team");
      break;
    case "overtime_start":
      s = startOvertime(s, e.possession ?? "team");
      break;
    case "score_adjustment":
      s = adjustScore(s, e.possession ?? "team", e.points ?? 0);
      break;
    case "point_after":
      s = e.isOvertimeConversion
        ? handleOvertimeConversion(s, { type: e.attempt ?? 1, success: Boolean(e.success) })
        : recordPointAfter(s, {
            type: e.attempt ?? 1,
            success: Boolean(e.success),
            playType: e.rusher ? "run" : "pass",
            passer: e.passer ?? null,
            receiver: e.receiver ?? null,
            rusher: e.rusher ?? null,
          });
      break;
    case "penalty":
      s = recordPenalty(s, {
        yards: Math.abs(e.yards ?? 0),
        onOffense: Boolean(e.onOffense),
        lossOfDown: Boolean(e.lossOfDown),
        automaticFirstDown: e.automaticFirstDown,
        penaltyCode: e.penaltyCode,
        penaltyName: e.penaltyName,
      });
      break;
    default:
      s = addPlay(s, playDataFrom(e, s.possession));
      if (s.awaitingInterceptionInfo) {
        if (e.interceptionReturnTD) {
          s = handleInterceptionDetails(s, true, 0);
        } else if (e.returnSpot != null) {
          s = handleInterceptionDetails(s, false, e.returnSpot);
        } else if (next) {
          // Older games didn't store the return spot; the next snap starts there.
          s = handleInterceptionDetails(s, false, next.lineOfScrimmage ?? 5);
        } else if (!original.awaitingInterceptionInfo) {
          s = handleInterceptionDetails(s, false, original.lineOfScrimmage);
        }
      }
  }
  keepIdentity(s, e);
  return s;
}

/**
 * Rebuilds a game's score, field state and stats by replaying its log. Used
 * for undo and for play-by-play edits, so every stat stays consistent with
 * the plays. With keepStatus, a finished game stays finished (its result is
 * recomputed) and a pending overtime setup stays pending.
 */
export function rebuildGame(
  state: GameState,
  entries: Play[] = state.plays,
  { keepStatus = true }: { keepStatus?: boolean } = {},
): GameState {
  const first =
    state.firstPossession ??
    state.plays.find((e) => !isMarker(e) && e.possession)?.possession ??
    state.possession;
  let g = makeInitialGameState(state.roster ?? [], first, state.teamName, state.opponentName);
  // Players logged in stats but missing from the roster keep their stat line.
  for (const [id, ps] of Object.entries(state.playerStats ?? {})) {
    g.playerStats[id] ??= makeEmptyPlayerStats(ps.name, ps.number);
  }
  entries.forEach((e, i) => {
    g = applyEntry(g, e, entries[i + 1], state);
  });
  if (keepStatus) {
    if (state.awaitingOvertimeSetup && !g.isOvertime) g.awaitingOvertimeSetup = true;
    if (
      state.completed &&
      !g.completed &&
      !g.awaitingOvertimeConversion &&
      !g.awaitingInterceptionInfo &&
      !g.awaitingOvertimeSetup
    ) {
      g = markGameCompleted(g);
    }
  }
  return g;
}

/** States after each entry, for showing the score and situation in the play-by-play. */
export function replayTimeline(state: GameState, entries: Play[] = state.plays): GameState[] {
  const out: GameState[] = [];
  const first =
    state.firstPossession ??
    state.plays.find((e) => !isMarker(e) && e.possession)?.possession ??
    state.possession;
  let g = makeInitialGameState(state.roster ?? [], first, state.teamName, state.opponentName);
  for (const [id, ps] of Object.entries(state.playerStats ?? {})) {
    g.playerStats[id] ??= makeEmptyPlayerStats(ps.name, ps.number);
  }
  entries.forEach((e, i) => {
    g = applyEntry(g, e, entries[i + 1], state);
    out.push(g);
  });
  return out;
}
