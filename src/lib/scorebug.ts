// Display formatting for the scoreboard, shared by the in-app Scoreboard and
// the public stream overlay so the two can never drift apart.
//
// Pure functions only — no React, no Supabase. Two adapters feed the same
// formatter: one from the in-memory GameState, one from the flat row returned
// by the get_overlay_scoreboard RPC.

import type { GameState, Possession } from "@/lib/types";

/** Everything a scorebug renders, already formatted for display. */
export interface ScorebugData {
  teamName: string;
  teamScore: number;
  opponentName: string;
  opponentScore: number;
  /** "1st Half", "2nd Half", or "OT 2". */
  periodLabel: string;
  /**
   * The bar's headline slot, always populated: the down and distance while
   * play is live, "FINAL" once the game ends, "OT TRY" while an overtime
   * conversion is pending.
   */
  primaryLabel: string;
  /** "2nd & 7". Null when no down is live (final, or awaiting an OT try). */
  downLabel: string | null;
  /** "Ball on 35 → 1st: END". Null when no down is live. */
  fieldLabel: string | null;
  /** Side with the ball. Null when no down is live. */
  possession: Possession | null;
  final: boolean;
}

/** Flat input shared by both adapters, mirroring the RPC's column set. */
export interface ScorebugInput {
  teamName: string;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
  possession: Possession;
  half: 1 | 2 | "OT";
  overtimeRound: number;
  down: number;
  yardsToGo: number;
  lineOfScrimmage: number;
  firstDownTarget: number;
  completed: boolean;
  awaitingOvertimeConversion: boolean;
}

/** Row shape returned by the get_overlay_scoreboard Postgres function. */
export interface OverlayScoreboardRow {
  team_name: string;
  opponent_name: string;
  team_score: number;
  opponent_score: number;
  possession: string;
  half: string;
  overtime_round: number;
  down: number;
  yards_to_go: number;
  line_of_scrimmage: number;
  first_down_target: number;
  completed: boolean;
  awaiting_ot_conversion: boolean;
}

export function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return "4th";
}

/**
 * The field is 50 yards, so a first-down target past it is the end zone
 * rather than a yard line.
 */
export function firstDownTargetLabel(target: number): string {
  return target >= 51 ? "END" : String(target);
}

export function periodLabel(
  half: 1 | 2 | "OT",
  overtimeRound: number,
): string {
  if (half === "OT") return `OT ${overtimeRound}`;
  return half === 1 ? "1st Half" : "2nd Half";
}

export function formatScorebug(input: ScorebugInput): ScorebugData {
  // Mirrors the in-app board: the down/field line is meaningless once the game
  // is over or while an overtime conversion is pending.
  const downIsLive = !input.completed && !input.awaitingOvertimeConversion;
  const downLabel = downIsLive
    ? `${ordinal(input.down)} & ${input.yardsToGo}`
    : null;

  return {
    teamName: input.teamName,
    teamScore: input.teamScore,
    opponentName: input.opponentName,
    opponentScore: input.opponentScore,
    periodLabel: periodLabel(input.half, input.overtimeRound),
    // Never empty: an unpopulated headline would leave a hole in the bar.
    primaryLabel: input.completed ? "FINAL" : (downLabel ?? "OT TRY"),
    downLabel,
    fieldLabel: downIsLive
      ? `Ball on ${input.lineOfScrimmage} → 1st: ${firstDownTargetLabel(
          input.firstDownTarget,
        )}`
      : null,
    possession: downIsLive ? input.possession : null,
    final: input.completed,
  };
}

/** Adapter: in-app game state (client-side, full blob in memory). */
export function scorebugFromGameState(
  state: GameState,
  teamName: string,
  opponentName: string,
): ScorebugData {
  return formatScorebug({
    teamName,
    opponentName,
    teamScore: state.score.team,
    opponentScore: state.score.opponent,
    possession: state.possession,
    half: state.half,
    overtimeRound: state.overtimeRound,
    down: state.down,
    yardsToGo: state.yardsToGo,
    lineOfScrimmage: state.lineOfScrimmage,
    firstDownTarget: state.firstDownTarget,
    completed: state.completed,
    awaitingOvertimeConversion: state.awaitingOvertimeConversion ?? false,
  });
}

/** Adapter: flat RPC row (public overlay, no auth, narrow projection). */
export function scorebugFromOverlayRow(
  row: OverlayScoreboardRow,
): ScorebugData {
  // `half` arrives as text from JSONB: "1", "2", or "OT".
  const half: 1 | 2 | "OT" =
    row.half === "OT" ? "OT" : row.half === "2" ? 2 : 1;

  return formatScorebug({
    teamName: row.team_name,
    opponentName: row.opponent_name,
    teamScore: row.team_score,
    opponentScore: row.opponent_score,
    possession: row.possession === "opponent" ? "opponent" : "team",
    half,
    overtimeRound: row.overtime_round,
    down: row.down,
    yardsToGo: row.yards_to_go,
    lineOfScrimmage: row.line_of_scrimmage,
    firstDownTarget: row.first_down_target,
    completed: row.completed,
    awaitingOvertimeConversion: row.awaiting_ot_conversion,
  });
}
