// Supabase data-access layer for the flag-football tracker.
//
// All functions take a SupabaseClient (so this module is agnostic to whether
// it's called from a server component, route handler, or browser component).
// Async functions throw on error so callers can catch and surface to the UI.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Game,
  GameState,
  Player,
  PlayerStats,
  Season,
  SeasonStats,
  SeasonTerm,
  Team,
} from "./types";
import { seasonDisplayName } from "./types";
import { makeEmptyPlayerStats } from "./game-engine";

const PLAYER_SELECT =
  "id, team_id, season_id, name, number, active, graduation_year, position_offense, position_defense, notes, created_at";

const GAME_SELECT =
  "id, team_id, season_id, opponent_name, game_date, status, result, game_data, created_at, updated_at";

const SEASON_SELECT = "id, team_id, year, term, is_active, created_at";

/** DB row shape for a season, before we attach the computed displayName. */
interface SeasonRow {
  id: string;
  team_id: string;
  year: number;
  term: SeasonTerm | null;
  is_active: boolean;
  created_at?: string;
}

function hydrateSeason(row: SeasonRow): Season {
  return { ...row, displayName: seasonDisplayName(row.year, row.term) };
}

/** Term ordering used when sorting seasons within the same year. */
const TERM_ORDER: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};

function compareSeasonsDesc(a: SeasonRow, b: SeasonRow): number {
  if (a.year !== b.year) return b.year - a.year;
  // Within the same year: Fall > Summer > Spring > Winter (newest term last in
  // the calendar appears first). Null term sorts after named terms.
  const at = a.term ? TERM_ORDER[a.term] : -1;
  const bt = b.term ? TERM_ORDER[b.term] : -1;
  return bt - at;
}

// ---------- Teams ----------

export async function getTeams(supabase: SupabaseClient): Promise<Team[]> {
  const { data: teamRows, error } = await supabase
    .from("teams")
    .select("id, owner_id, name, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Fetch player counts in a second query — simpler than a join here.
  const teams: Team[] = teamRows ?? [];
  if (teams.length === 0) return teams;

  const { data: counts, error: countErr } = await supabase
    .from("players")
    .select("team_id")
    .in(
      "team_id",
      teams.map((t) => t.id),
    );
  if (countErr) throw countErr;

  const countMap = new Map<string, number>();
  (counts ?? []).forEach((row: { team_id: string }) => {
    countMap.set(row.team_id, (countMap.get(row.team_id) ?? 0) + 1);
  });

  return teams.map((t) => ({ ...t, player_count: countMap.get(t.id) ?? 0 }));
}

export async function getTeam(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Team | null> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, owner_id, name, created_at")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTeam(
  supabase: SupabaseClient,
  name: string,
): Promise<Team> {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("teams")
    .insert({ owner_id: user.id, name })
    .select("id, owner_id, name, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function updateTeam(
  supabase: SupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.from("teams").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function deleteTeam(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  // Cascade: delete games and players first since FKs don't ON DELETE CASCADE.
  const { error: gErr } = await supabase.from("games").delete().eq("team_id", id);
  if (gErr) throw gErr;
  const { error: pErr } = await supabase
    .from("players")
    .delete()
    .eq("team_id", id);
  if (pErr) throw pErr;
  // Seasons cascade is best-effort: with players + games gone, no FKs remain.
  const { error: sErr } = await supabase
    .from("seasons")
    .delete()
    .eq("team_id", id);
  if (sErr) throw sErr;
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Seasons ----------

/**
 * Return all seasons for a team, newest year first; ties broken by term order.
 */
export async function getSeasons(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Season[]> {
  const { data, error } = await supabase
    .from("seasons")
    .select(SEASON_SELECT)
    .eq("team_id", teamId);
  if (error) throw error;
  const rows = (data ?? []) as SeasonRow[];
  return rows.slice().sort(compareSeasonsDesc).map(hydrateSeason);
}

export async function getSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<Season | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select(SEASON_SELECT)
    .eq("id", seasonId)
    .maybeSingle();
  if (error) throw error;
  return data ? hydrateSeason(data as SeasonRow) : null;
}

export async function getActiveSeason(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Season | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select(SEASON_SELECT)
    .eq("team_id", teamId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? hydrateSeason(data as SeasonRow) : null;
}

/**
 * Create a new season and atomically deactivate any existing active season for
 * the same team (Postgres enforces only-one-active via the partial unique
 * index `seasons_one_active_per_team`).
 */
export async function createSeason(
  supabase: SupabaseClient,
  teamId: string,
  year: number,
  term: SeasonTerm | null = null,
): Promise<Season> {
  // Deactivate any currently active season for this team first.
  const { error: deactivateErr } = await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("team_id", teamId)
    .eq("is_active", true);
  if (deactivateErr) throw deactivateErr;

  const { data, error } = await supabase
    .from("seasons")
    .insert({ team_id: teamId, year, term, is_active: true })
    .select(SEASON_SELECT)
    .single();
  if (error) throw error;
  return hydrateSeason(data as SeasonRow);
}

/** Make `seasonId` the active season for its team; deactivate all others. */
export async function setActiveSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<void> {
  // Need the team_id so we can deactivate siblings.
  const { data: row, error: fetchErr } = await supabase
    .from("seasons")
    .select("id, team_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error("Season not found");

  const { error: deactivateErr } = await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("team_id", row.team_id)
    .neq("id", seasonId);
  if (deactivateErr) throw deactivateErr;

  const { error: activateErr } = await supabase
    .from("seasons")
    .update({ is_active: true })
    .eq("id", seasonId);
  if (activateErr) throw activateErr;
}

export async function deleteSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<void> {
  // Detach any games / players first so the FK doesn't block the delete.
  const { error: gErr } = await supabase
    .from("games")
    .update({ season_id: null })
    .eq("season_id", seasonId);
  if (gErr) throw gErr;
  const { error: pErr } = await supabase
    .from("players")
    .delete()
    .eq("season_id", seasonId);
  if (pErr) throw pErr;
  const { error } = await supabase.from("seasons").delete().eq("id", seasonId);
  if (error) throw error;
}

// ---------- Players ----------

/**
 * Fetch players for a team. If `seasonId` is provided, only return players for
 * that season; otherwise return all players for the team (including legacy
 * rows with null season_id).
 */
export async function getPlayers(
  supabase: SupabaseClient,
  teamId: string,
  seasonId?: string | null,
): Promise<Player[]> {
  let query = supabase
    .from("players")
    .select(PLAYER_SELECT)
    .eq("team_id", teamId)
    .order("number", { ascending: true });
  if (seasonId) {
    query = query.eq("season_id", seasonId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Player[];
}

export async function getPlayer(
  supabase: SupabaseClient,
  playerId: string,
): Promise<Player | null> {
  const { data, error } = await supabase
    .from("players")
    .select(PLAYER_SELECT)
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw error;
  return (data as Player) ?? null;
}

/** Extra profile fields accepted by createPlayer / updatePlayer. */
export interface PlayerProfileInput {
  graduation_year?: number | null;
  position_offense?: string | null;
  position_defense?: string | null;
  notes?: string | null;
}

/**
 * Create a player belonging to a team + season. `seasonId` may be null to keep
 * backwards compatibility with legacy code paths, but new UI should always
 * pass it.
 */
export async function createPlayer(
  supabase: SupabaseClient,
  teamId: string,
  seasonId: string | null,
  name: string,
  number: string,
  profile: PlayerProfileInput = {},
): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .insert({
      team_id: teamId,
      season_id: seasonId,
      name,
      number,
      active: true,
      graduation_year: profile.graduation_year ?? null,
      position_offense: profile.position_offense ?? null,
      position_defense: profile.position_defense ?? null,
      notes: profile.notes ?? null,
    })
    .select(PLAYER_SELECT)
    .single();
  if (error) throw error;
  return data as Player;
}

export async function updatePlayer(
  supabase: SupabaseClient,
  id: string,
  patch: {
    name?: string;
    number?: string;
    active?: boolean;
    graduation_year?: number | null;
    position_offense?: string | null;
    position_defense?: string | null;
    notes?: string | null;
  },
) {
  const { error } = await supabase.from("players").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePlayer(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Games ----------

/**
 * Fetch games for a team. If `seasonId` is provided, only return games for
 * that season; otherwise return all games (including legacy rows with null
 * season_id).
 */
export async function getGames(
  supabase: SupabaseClient,
  teamId: string,
  seasonId?: string | null,
): Promise<Game[]> {
  let query = supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("team_id", teamId)
    .order("game_date", { ascending: false });
  if (seasonId) {
    query = query.eq("season_id", seasonId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Game[];
}

export async function getGame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<Game | null> {
  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data as Game | null;
}

export async function createGame(
  supabase: SupabaseClient,
  teamId: string,
  seasonId: string | null,
  opponentName: string,
  gameDate: string,
  initialState: GameState,
): Promise<Game> {
  const { data, error } = await supabase
    .from("games")
    .insert({
      team_id: teamId,
      season_id: seasonId,
      opponent_name: opponentName,
      game_date: gameDate,
      status: "in_progress",
      result: null,
      game_data: initialState,
    })
    .select(GAME_SELECT)
    .single();
  if (error) throw error;
  return data as Game;
}

export async function saveGameState(
  supabase: SupabaseClient,
  gameId: string,
  state: GameState,
): Promise<void> {
  const status = state.completed ? "completed" : "in_progress";
  const result = state.completed ? state.result ?? null : null;
  const { error } = await supabase
    .from("games")
    .update({
      game_data: state,
      status,
      result,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
  if (error) throw error;
}

export async function deleteGame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<void> {
  const { error } = await supabase.from("games").delete().eq("id", gameId);
  if (error) throw error;
}

// ---------- Per-player aggregation (pure — no Supabase call) ----------

/**
 * Aggregate a single player's stats across all completed games for a team.
 * Returns the running total plus the per-game log (newest first), including
 * games where the player did not record stats so the caller can decide how
 * to display them.
 */
export function computePlayerSeasonStats(
  games: Game[],
  playerId: string,
  fallbackName: string,
  fallbackNumber: string,
): {
  total: PlayerStats;
  lines: { game: Game; stats: PlayerStats | null }[];
} {
  const total = makeEmptyPlayerStats(fallbackName, fallbackNumber);
  const completed = games
    .filter((g) => g.status === "completed")
    .slice()
    .sort(
      (a, b) =>
        new Date(b.game_date).getTime() - new Date(a.game_date).getTime(),
    );
  const lines: { game: Game; stats: PlayerStats | null }[] = [];

  for (const game of completed) {
    const ps = (game.game_data?.playerStats ?? {})[playerId];
    lines.push({ game, stats: ps ?? null });
    if (!ps) continue;
    total.offense.passAttempts += ps.offense.passAttempts ?? 0;
    total.offense.completions += ps.offense.completions ?? 0;
    total.offense.incompletions += ps.offense.incompletions ?? 0;
    total.offense.passingYards += ps.offense.passingYards ?? 0;
    total.offense.interceptions += ps.offense.interceptions ?? 0;
    total.offense.rushAttempts += ps.offense.rushAttempts ?? 0;
    total.offense.rushingYards += ps.offense.rushingYards ?? 0;
    total.offense.receptions += ps.offense.receptions ?? 0;
    total.offense.receivingYards += ps.offense.receivingYards ?? 0;
    total.offense.touchdowns += ps.offense.touchdowns ?? 0;
    total.defense.flagPulls += ps.defense.flagPulls ?? 0;
    total.defense.interceptions += ps.defense.interceptions ?? 0;
    total.defense.tacklesForLoss += ps.defense.tacklesForLoss ?? 0;
    total.defense.passDeflections += ps.defense.passDeflections ?? 0;
  }
  return { total, lines };
}

// ---------- Season stats (pure — no Supabase call) ----------

/**
 * Build season totals from the array of completed games. Rebuilds from scratch
 * every time — never accumulates incrementally. This replaces the fragile
 * add/subtract approach from app.jsx.
 */
export function computeSeasonStats(games: Game[]): SeasonStats {
  const stats: SeasonStats = {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    totalPointsFor: 0,
    totalPointsAgainst: 0,
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
    playerStats: {},
  };

  for (const game of games) {
    if (game.status !== "completed") continue;
    const gd = game.game_data;
    if (!gd) continue;

    stats.gamesPlayed++;
    if (game.result === "win") stats.wins++;
    else if (game.result === "loss") stats.losses++;
    else if (game.result === "tie") stats.ties++;

    stats.totalPointsFor += gd.score?.team ?? 0;
    stats.totalPointsAgainst += gd.score?.opponent ?? 0;

    const off = gd.stats?.offense;
    if (off) {
      stats.offense.passAttempts += off.passAttempts ?? 0;
      stats.offense.completions += off.completions ?? 0;
      stats.offense.passingYards += off.passingYards ?? 0;
      stats.offense.rushAttempts += off.rushAttempts ?? 0;
      stats.offense.rushingYards += off.rushingYards ?? 0;
      stats.offense.firstDowns += off.firstDowns ?? 0;
      stats.offense.touchdowns += off.touchdowns ?? 0;
      stats.offense.totalPlays += off.totalPlays ?? 0;
      stats.offense.interceptions += off.interceptions ?? 0;
    }
    const def = gd.stats?.defense;
    if (def) {
      stats.defense.flagPulls += def.flagPulls ?? 0;
      stats.defense.interceptions += def.interceptions ?? 0;
      stats.defense.forcedPunts += def.forcedPunts ?? 0;
      stats.defense.turnoversOnDowns += def.turnoversOnDowns ?? 0;
    }

    Object.entries(gd.playerStats ?? {}).forEach(([playerId, playerData]) => {
      const pd = playerData as PlayerStats;
      const existing =
        stats.playerStats[playerId] ?? makeEmptyPlayerStats(pd.name, pd.number);
      // Preserve the latest known name/number from the most recent game.
      existing.name = pd.name;
      existing.number = pd.number;
      existing.offense.passAttempts += pd.offense.passAttempts ?? 0;
      existing.offense.completions += pd.offense.completions ?? 0;
      existing.offense.incompletions += pd.offense.incompletions ?? 0;
      existing.offense.passingYards += pd.offense.passingYards ?? 0;
      existing.offense.interceptions += pd.offense.interceptions ?? 0;
      existing.offense.rushAttempts += pd.offense.rushAttempts ?? 0;
      existing.offense.rushingYards += pd.offense.rushingYards ?? 0;
      existing.offense.receptions += pd.offense.receptions ?? 0;
      existing.offense.receivingYards += pd.offense.receivingYards ?? 0;
      existing.offense.touchdowns += pd.offense.touchdowns ?? 0;
      existing.defense.flagPulls += pd.defense.flagPulls ?? 0;
      existing.defense.interceptions += pd.defense.interceptions ?? 0;
      existing.defense.tacklesForLoss += pd.defense.tacklesForLoss ?? 0;
      existing.defense.passDeflections += pd.defense.passDeflections ?? 0;
      stats.playerStats[playerId] = existing;
    });
  }

  return stats;
}
