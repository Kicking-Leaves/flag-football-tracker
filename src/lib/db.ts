// Supabase data-access layer for the flag-football tracker.
//
// All functions take a SupabaseClient (so this module is agnostic to whether
// it's called from a server component, route handler, or browser component).
// Async functions throw on error so callers can catch and surface to the UI.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Game,
  GameState,
  PlayerStats,
  SeasonStats,
  Team,
} from "./types";
import { makeEmptyPlayerStats } from "./game-engine";

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
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Players ----------

export async function getPlayers(
  supabase: SupabaseClient,
  teamId: string,
) {
  const { data, error } = await supabase
    .from("players")
    .select("id, team_id, name, number, active, created_at")
    .eq("team_id", teamId)
    .order("number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createPlayer(
  supabase: SupabaseClient,
  teamId: string,
  name: string,
  number: string,
) {
  const { data, error } = await supabase
    .from("players")
    .insert({ team_id: teamId, name, number, active: true })
    .select("id, team_id, name, number, active, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlayer(
  supabase: SupabaseClient,
  id: string,
  patch: { name?: string; number?: string; active?: boolean },
) {
  const { error } = await supabase.from("players").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePlayer(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Games ----------

export async function getGames(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Game[]> {
  const { data, error } = await supabase
    .from("games")
    .select(
      "id, team_id, opponent_name, game_date, status, result, game_data, created_at, updated_at",
    )
    .eq("team_id", teamId)
    .order("game_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Game[];
}

export async function getGame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<Game | null> {
  const { data, error } = await supabase
    .from("games")
    .select(
      "id, team_id, opponent_name, game_date, status, result, game_data, created_at, updated_at",
    )
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data as Game | null;
}

export async function createGame(
  supabase: SupabaseClient,
  teamId: string,
  opponentName: string,
  gameDate: string,
  initialState: GameState,
): Promise<Game> {
  const { data, error } = await supabase
    .from("games")
    .insert({
      team_id: teamId,
      opponent_name: opponentName,
      game_date: gameDate,
      status: "in_progress",
      result: null,
      game_data: initialState,
    })
    .select(
      "id, team_id, opponent_name, game_date, status, result, game_data, created_at, updated_at",
    )
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
