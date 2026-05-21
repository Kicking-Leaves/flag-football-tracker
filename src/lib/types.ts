// Domain types for the flag-football game tracker.
// These mirror the legacy app.jsx in-memory shape so business logic from
// the source files can be reused with minimal change.

// ---------- Persistent entities ----------

export interface Team {
  id: string;
  owner_id: string;
  name: string;
  created_at?: string;
  player_count?: number;
}

export interface Player {
  id: string;
  team_id: string;
  name: string;
  number: string;
  active: boolean;
  graduation_year?: number | null;
  position_offense?: string | null;
  position_defense?: string | null;
  notes?: string | null;
  created_at?: string;
}

/** Allowed offensive positions for a roster player. Empty/null = unspecified. */
export const OFFENSE_POSITIONS = [
  "QB",
  "WR",
  "RB",
  "TE",
  "C",
  "Flex",
] as const;
export type OffensePosition = (typeof OFFENSE_POSITIONS)[number];

/** Allowed defensive positions for a roster player. Empty/null = unspecified. */
export const DEFENSE_POSITIONS = [
  "CB",
  "S",
  "LB",
  "DE",
  "DT",
  "Flex",
] as const;
export type DefensePosition = (typeof DEFENSE_POSITIONS)[number];

export type GameStatus = "in_progress" | "completed";
export type GameResult = "win" | "loss" | "tie";

export interface Game {
  id: string;
  team_id: string;
  opponent_name: string;
  game_date: string;
  status: GameStatus;
  result: GameResult | null;
  game_data: GameState;
  created_at?: string;
  updated_at?: string;
}

// ---------- Game state ----------

export type Possession = "team" | "opponent";

/** Stats tracked per player for an individual game. */
export interface PlayerStats {
  name: string;
  number: string;
  offense: {
    passAttempts: number;
    completions: number;
    incompletions: number;
    passingYards: number;
    interceptions: number;
    rushAttempts: number;
    rushingYards: number;
    receptions: number;
    receivingYards: number;
    touchdowns: number;
  };
  defense: {
    flagPulls: number;
    interceptions: number;
    tacklesForLoss: number;
    passDeflections: number;
  };
}

export interface OffenseStats {
  passAttempts: number;
  completions: number;
  passingYards: number;
  rushAttempts: number;
  rushingYards: number;
  firstDowns: number;
  touchdowns: number;
  totalPlays: number;
  interceptions: number;
}

export interface DefenseStats {
  flagPulls: number;
  interceptions: number;
  forcedPunts: number;
  turnoversOnDowns: number;
}

export interface TeamStats {
  offense: OffenseStats;
  defense: DefenseStats;
}

/** A recorded play in a game. The pre-play snapshot is captured so undo works. */
export interface Play {
  id: number;
  playType: "pass" | "run" | "punt" | "penalty" | "point_after";
  possession?: Possession;
  yards: number;
  complete?: boolean;
  firstDown?: boolean;
  touchdown?: boolean;
  turnover?: boolean;
  interception?: boolean;
  flagPull?: boolean;
  safety?: boolean;
  passDeflection?: boolean;
  isPunt?: boolean;
  passer?: string | null;
  receiver?: string | null;
  rusher?: string | null;
  defender?: string | null;

  // Pre-play snapshot (for undo + display).
  down: number;
  yardsToGo: number;
  lineOfScrimmage: number;
  firstDownTarget?: number;

  // Penalty-only fields.
  onOffense?: boolean;
  lossOfDown?: boolean;

  // Point-after / overtime conversion.
  attempt?: 1 | 2;
  success?: boolean;
  points?: number;
  isPointAfter?: boolean;
  isOvertimeConversion?: boolean;
  overtimeRound?: number;
}

/** Full game state — persisted to games.game_data as JSONB. */
export interface GameState {
  // Display metadata kept inside the blob for self-contained CSVs.
  teamName?: string;
  opponentName?: string;
  roster?: { id: string; name: string; number: string }[];

  score: { team: number; opponent: number };
  possession: Possession;
  half: 1 | 2 | "OT";
  down: number;
  yardsToGo: number;
  lineOfScrimmage: number;
  firstDownTarget: number;
  plays: Play[];

  playerStats: Record<string, PlayerStats>;
  stats: TeamStats;

  isOvertime: boolean;
  overtimeRound: number;
  overtimeFirstOffense: Possession | null;

  awaitingOvertimeSetup?: boolean;
  awaitingOvertimeConversion?: boolean;
  awaitingInterceptionInfo?: boolean;
  interceptionTeam?: Possession;

  completed: boolean;
  result?: GameResult;
}

// ---------- Aggregate season stats ----------

export interface SeasonStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  totalPointsFor: number;
  totalPointsAgainst: number;
  offense: OffenseStats;
  defense: DefenseStats;
  /** Aggregated by player id (string uuid). */
  playerStats: Record<string, PlayerStats>;
}

// ---------- Engine action payload types ----------

export interface PlayData {
  possession: Possession;
  playType: "pass" | "run" | "punt";
  yards: number;
  complete?: boolean;
  firstDown?: boolean;
  touchdown?: boolean;
  turnover?: boolean;
  interception?: boolean;
  flagPull?: boolean;
  safety?: boolean;
  passDeflection?: boolean;
  isPunt?: boolean;
  passer?: string | null;
  receiver?: string | null;
  rusher?: string | null;
  defender?: string | null;
}

export interface PointAfterData {
  type: 1 | 2;
  success: boolean;
  playType?: "pass" | "run";
  passer?: string | null;
  receiver?: string | null;
  rusher?: string | null;
}

export interface PenaltyData {
  yards: number;
  onOffense: boolean;
  lossOfDown: boolean;
}

export interface OTConversionData {
  type: 1 | 2;
  success: boolean;
}

// ---------- Helper / DTO types ----------

export interface RosterEntry {
  id: string;
  name: string;
  number: string;
}
