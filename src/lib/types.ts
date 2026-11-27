// Domain types for the flag-football game tracker.
// These mirror the legacy app.jsx in-memory shape so business logic from
// the source files can be reused with minimal change.

// ---------- Persistent entities ----------

/** A high school (or club) that groups a coach's teams, e.g. JV + Varsity. */
export interface School {
  id: string;
  owner_id: string;
  name: string;
  created_at?: string;
}

/**
 * One person at a school. Roster entries (`Player`) on any of the school's
 * teams link here, so the same athlete on JV and Varsity is recognized as one.
 */
export interface Athlete {
  id: string;
  school_id: string;
  name: string;
  graduation_year?: number | null;
  created_at?: string;
}

export interface Team {
  id: string;
  owner_id: string;
  name: string;
  /** School this team belongs to; null if not assigned. */
  school_id?: string | null;
  created_at?: string;
  player_count?: number;
}

/** Allowed values for a season's term (academic period within a year). */
export const SEASON_TERMS = ["Winter", "Spring", "Summer", "Fall"] as const;
export type SeasonTerm = (typeof SEASON_TERMS)[number];

/**
 * A team's roster + schedule for a single year/term. Persisted in the
 * `seasons` table; one season may be marked `is_active` per team at a time.
 */
export interface Season {
  id: string;
  team_id: string;
  year: number;
  term: SeasonTerm | null;
  is_active: boolean;
  created_at?: string;
  /** Computed display helper, e.g. "Winter 2025" or "2025". Not stored. */
  displayName: string;
}

/** Format a season's display name: "Winter 2025" or just "2025". */
export function seasonDisplayName(
  year: number,
  term: SeasonTerm | null | undefined,
): string {
  return term ? `${term} ${year}` : String(year);
}

export interface Player {
  id: string;
  team_id: string;
  /** Shared athlete profile at the team's school; null if unlinked. */
  athlete_id?: string | null;
  /** Null for legacy players created before seasons were introduced. */
  season_id?: string | null;
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

/** scheduled = created but scoring hasn't started. */
export type GameStatus = "scheduled" | "in_progress" | "completed";

/** Scrimmages don't count toward season stats; regular and postseason games do. */
export const GAME_TYPES = ["scrimmage", "regular", "postseason"] as const;
export type GameType = (typeof GAME_TYPES)[number];
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  scrimmage: "Scrimmage",
  regular: "Regular season",
  postseason: "Postseason",
};

/** True when the game's stats count toward the season (not a scrimmage). */
export function countsForSeason(game: { game_type?: GameType | null }): boolean {
  return (game.game_type ?? "regular") !== "scrimmage";
}

/** Which games a season export covers. "full" = regular season + postseason. */
export type SeasonScope = "regular" | "postseason" | "full";
export const SEASON_SCOPE_LABELS: Record<SeasonScope, string> = {
  regular: "Regular season",
  postseason: "Postseason",
  full: "Full season",
};

export function inSeasonScope(game: { game_type?: GameType | null }, scope: SeasonScope): boolean {
  const type = game.game_type ?? "regular";
  if (type === "scrimmage") return false;
  return scope === "full" || type === scope;
}
export type GameResult = "win" | "loss" | "tie";

export interface Game {
  id: string;
  team_id: string;
  /** Null for legacy games created before seasons were introduced. */
  season_id?: string | null;
  opponent_name: string;
  game_date: string;
  /** Defaults to "regular" in the database. */
  game_type?: GameType;
  status: GameStatus;
  result: GameResult | null;
  game_data: GameState;
  /** Unguessable token granting read-only access to the public stream overlay. */
  overlay_token?: string;
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
    /**
     * Pulled the passer's flag before the throw. Counted from the play log
     * (see sacks.ts), so stored game blobs may not carry it.
     */
    sacks?: number;
    /** Caught an opponent's fumble before it hit the ground (play log). */
    fumbleRecoveries?: number;
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

/** Sack totals for one game or season, counted from the play log. */
export interface SackStats {
  /** Our defense pulled the passer's flag before the throw. */
  playerSacks: number;
  /** Our defense: the passer didn't throw within the 7-second count. */
  coverageSacks: number;
  /** Our passer had their flag pulled before the throw. */
  sackedAllowed: number;
  /** Our passer didn't throw within the 7-second count. */
  coverageSacksAllowed: number;
}

/** Fumble totals for one game or season, counted from the play log. */
export interface FumbleStats {
  /** Our ball carriers' fumbles. */
  fumbles: number;
  /** Of those, caught by the defense (change of possession). */
  fumblesLost: number;
  /** Opponent fumbles our defense caught. */
  recoveries: number;
}

export interface TeamStats {
  offense: OffenseStats;
  defense: DefenseStats;
}

/** A recorded play in a game. The pre-play snapshot is captured so undo works. */
/** How a sack happened: flag pulled before the throw, or the 7-second count ran out. */
export type SackType = "player" | "coverage";
/**
 * Fumble outcome. "dead": the ball is dead where it was fumbled. "lost": the
 * defense caught it before it touched the ground and takes over there.
 */
export type FumbleResult = "dead" | "lost";

/**
 * Log entries that aren't snaps: end of the 1st half (possession = who
 * receives), start of overtime (possession = first offense) and manual score
 * changes (possession = side, points = amount). Kept in the log so a game can
 * be rebuilt from it after edits.
 */
export type MarkerType = "half_end" | "overtime_start" | "score_adjustment";

export interface Play {
  id: number;
  /** "coverage_sack" is legacy: newer games record a pass with sackType "coverage". */
  playType: "pass" | "run" | "punt" | "coverage_sack" | "penalty" | "point_after" | MarkerType;
  possession?: Possession;
  yards: number;
  complete?: boolean;
  firstDown?: boolean;
  touchdown?: boolean;
  turnover?: boolean;
  interception?: boolean;
  /** Set when the interception was returned for a touchdown. */
  interceptionReturnTD?: boolean;
  flagPull?: boolean;
  safety?: boolean;
  passDeflection?: boolean;
  /** Pass play ended in a sack (see sackType). */
  sack?: boolean;
  /** Missing on older plays with sack: true, which were player sacks. */
  sackType?: SackType;
  fumble?: FumbleResult;
  /** Interception not returned for a TD: where the intercepting team takes over. */
  returnSpot?: number;
  isPunt?: boolean;
  passer?: string | null;
  receiver?: string | null;
  rusher?: string | null;
  defender?: string | null;

  /**
   * When the scorer recorded this entry, as local wall-clock time with its UTC
   * offset (e.g. "2026-11-21T19:04:32.120-08:00"). Used to line plays up with
   * video. Absent on plays recorded before timestamps existed.
   */
  recordedAt?: string;
  /** Period the play was recorded in. */
  half?: 1 | 2 | "OT";

  // Pre-play snapshot (for undo + display).
  down: number;
  yardsToGo: number;
  lineOfScrimmage: number;
  firstDownTarget?: number;

  // Penalty-only fields.
  onOffense?: boolean;
  lossOfDown?: boolean;
  automaticFirstDown?: boolean;
  /** Penalty from the WIAA list (see penalties.ts), or "other". */
  penaltyCode?: string;
  /** Free-text name for an "other" penalty. */
  penaltyName?: string;

  // Point-after / overtime conversion.
  attempt?: TryPoints;
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
  /** Who had the ball first; lets the game be rebuilt from its play log. */
  firstPossession?: Possession;

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
  sacks: SackStats;
  fumbles: FumbleStats;
  /** Aggregated by player id (string uuid). */
  playerStats: Record<string, PlayerStats>;
}

// ---------- Engine action payload types ----------

export interface PlayData {
  possession: Possession;
  playType: "pass" | "run" | "punt" | "coverage_sack";
  yards: number;
  sackType?: SackType;
  fumble?: FumbleResult;
  complete?: boolean;
  firstDown?: boolean;
  touchdown?: boolean;
  turnover?: boolean;
  interception?: boolean;
  flagPull?: boolean;
  safety?: boolean;
  passDeflection?: boolean;
  sack?: boolean;
  isPunt?: boolean;
  passer?: string | null;
  receiver?: string | null;
  rusher?: string | null;
  defender?: string | null;
}

/**
 * WIAA try options: 1pt (automatic after a TD; pass-only from the 5 in OT),
 * 2pt from the 10, 3pt from the 17.
 */
export type TryPoints = 1 | 2 | 3;

export interface PointAfterData {
  type: TryPoints;
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
  automaticFirstDown?: boolean;
  penaltyCode?: string;
  penaltyName?: string;
}

export interface OTConversionData {
  type: TryPoints;
  success: boolean;
}

// ---------- Helper / DTO types ----------

export interface RosterEntry {
  id: string;
  name: string;
  number: string;
}
