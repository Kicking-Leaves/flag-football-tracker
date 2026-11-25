// Supabase data-access layer for the flag-football tracker.
//
// All functions take a SupabaseClient (so this module is agnostic to whether
// it's called from a server component, route handler, or browser component).
// Async functions throw on error so callers can catch and surface to the UI.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Athlete,
  Game,
  GameState,
  Player,
  PlayerStats,
  School,
  Season,
  SeasonStats,
  SeasonTerm,
  Team,
} from "./types";
import { seasonDisplayName } from "./types";
import type { OverlayScoreboardRow } from "./scorebug";
import { normalizeName, type PlannedRosterRow } from "./roster-import";
import { makeEmptyPlayerStats } from "./game-engine";

const PLAYER_SELECT =
  "id, team_id, season_id, athlete_id, name, number, active, graduation_year, position_offense, position_defense, notes, created_at";

const TEAM_SELECT = "id, owner_id, name, school_id, created_at";
const SCHOOL_SELECT = "id, owner_id, name, created_at";
const ATHLETE_SELECT = "id, school_id, name, graduation_year, created_at";

const GAME_SELECT =
  "id, team_id, season_id, opponent_name, game_date, status, result, game_data, overlay_token, created_at, updated_at";

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
    .from("rr_teams")
    .select(TEAM_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Fetch player counts in a second query — simpler than a join here.
  const teams: Team[] = teamRows ?? [];
  if (teams.length === 0) return teams;

  const { data: counts, error: countErr } = await supabase
    .from("rr_players")
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
    .from("rr_teams")
    .select(TEAM_SELECT)
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
    .from("rr_teams")
    .insert({ owner_id: user.id, name })
    .select(TEAM_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateTeam(
  supabase: SupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.from("rr_teams").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function deleteTeam(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  // Cascade: delete games and players first since FKs don't ON DELETE CASCADE.
  const { error: gErr } = await supabase.from("rr_games").delete().eq("team_id", id);
  if (gErr) throw gErr;
  const { error: pErr } = await supabase
    .from("rr_players")
    .delete()
    .eq("team_id", id);
  if (pErr) throw pErr;
  // Seasons cascade is best-effort: with players + games gone, no FKs remain.
  const { error: sErr } = await supabase
    .from("rr_seasons")
    .delete()
    .eq("team_id", id);
  if (sErr) throw sErr;
  const { error } = await supabase.from("rr_teams").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Schools & athletes ----------

export async function getSchools(supabase: SupabaseClient): Promise<School[]> {
  const { data, error } = await supabase
    .from("rr_schools")
    .select(SCHOOL_SELECT)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as School[];
}

export async function getSchool(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<School | null> {
  const { data, error } = await supabase
    .from("rr_schools")
    .select(SCHOOL_SELECT)
    .eq("id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return (data as School) ?? null;
}

export async function createSchool(
  supabase: SupabaseClient,
  name: string,
): Promise<School> {
  // owner_id defaults to auth.uid() in the database.
  const { data, error } = await supabase
    .from("rr_schools")
    .insert({ name })
    .select(SCHOOL_SELECT)
    .single();
  if (error) throw error;
  return data as School;
}

/**
 * Assign a team to a school (or none). Changing schools unlinks the team's
 * roster entries from their athletes (database trigger), since those athletes
 * belong to the old school; they are then re-linked to athletes at the new
 * school (see linkTeamPlayersToSchool).
 */
export async function setTeamSchool(
  supabase: SupabaseClient,
  teamId: string,
  schoolId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("rr_teams")
    .update({ school_id: schoolId })
    .eq("id", teamId);
  if (error) throw error;
  if (schoolId) await linkTeamPlayersToSchool(supabase, teamId, schoolId);
}

/**
 * Link every unlinked roster entry on a team to an athlete at its school.
 * Entries for the same person across seasons share one athlete; a person
 * already at the school (e.g. on JV when Varsity joins) is matched with the
 * same rule as roster import — exactly one athlete with that name and no
 * conflicting grad year — and otherwise a new athlete is created.
 */
export async function linkTeamPlayersToSchool(
  supabase: SupabaseClient,
  teamId: string,
  schoolId: string,
): Promise<void> {
  const [players, athletes] = await Promise.all([
    getPlayers(supabase, teamId),
    getAthletes(supabase, schoolId),
  ]);
  const unlinked = players.filter((p) => !p.athlete_id);
  for (const p of unlinked) {
    const athlete = await findOrCreateAthlete(
      supabase,
      schoolId,
      p.name,
      p.graduation_year ?? null,
      athletes,
    );
    const { error } = await supabase
      .from("rr_players")
      .update({ athlete_id: athlete.id })
      .eq("id", p.id);
    if (error) throw error;
  }
}

/**
 * Reuse the single athlete at the school matching this name (and grad year,
 * when both are known); otherwise create one. `known` is a cache of the
 * school's athletes that is updated in place, so callers looping over many
 * players don't create duplicates for the same person.
 */
async function findOrCreateAthlete(
  supabase: SupabaseClient,
  schoolId: string,
  name: string,
  graduationYear: number | null,
  known?: Athlete[],
): Promise<Athlete> {
  const athletes = known ?? (await getAthletes(supabase, schoolId));
  const key = normalizeName(name);
  const matches = athletes.filter(
    (a) =>
      normalizeName(a.name) === key &&
      (a.graduation_year == null ||
        graduationYear == null ||
        a.graduation_year === graduationYear),
  );
  if (matches.length === 1) return matches[0];
  const created = await createAthlete(supabase, schoolId, name, graduationYear);
  athletes.push(created);
  return created;
}

export async function getAthletes(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<Athlete[]> {
  const { data, error } = await supabase
    .from("rr_athletes")
    .select(ATHLETE_SELECT)
    .eq("school_id", schoolId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Athlete[];
}

export async function createAthlete(
  supabase: SupabaseClient,
  schoolId: string,
  name: string,
  graduationYear: number | null,
): Promise<Athlete> {
  const { data, error } = await supabase
    .from("rr_athletes")
    .insert({ school_id: schoolId, name, graduation_year: graduationYear })
    .select(ATHLETE_SELECT)
    .single();
  if (error) throw error;
  return data as Athlete;
}

/** A roster entry plus the team/season names it belongs to, for display. */
export interface RosterEntryWithTeam extends Player {
  team_name: string;
  season_name: string | null;
}

/**
 * Every roster entry (on any team, any season) linked to the given athletes.
 * Used to show "also on Varsity (#12)" and to combine stats across teams.
 */
export async function getRosterEntriesForAthletes(
  supabase: SupabaseClient,
  athleteIds: string[],
): Promise<RosterEntryWithTeam[]> {
  if (athleteIds.length === 0) return [];
  const { data, error } = await supabase
    .from("rr_players")
    .select(PLAYER_SELECT)
    .in("athlete_id", athleteIds);
  if (error) throw error;
  const players = (data ?? []) as Player[];
  if (players.length === 0) return [];

  const teamIds = [...new Set(players.map((p) => p.team_id))];
  const seasonIds = [
    ...new Set(players.map((p) => p.season_id).filter((id): id is string => !!id)),
  ];
  const [teamsRes, seasonsRes] = await Promise.all([
    supabase.from("rr_teams").select("id, name").in("id", teamIds),
    seasonIds.length
      ? supabase.from("rr_seasons").select(SEASON_SELECT).in("id", seasonIds)
      : Promise.resolve({ data: [] as SeasonRow[], error: null }),
  ]);
  if (teamsRes.error) throw teamsRes.error;
  if (seasonsRes.error) throw seasonsRes.error;

  const teamName = new Map(
    (teamsRes.data ?? []).map((t: { id: string; name: string }) => [t.id, t.name]),
  );
  const seasonName = new Map(
    ((seasonsRes.data ?? []) as SeasonRow[]).map((s) => [
      s.id,
      seasonDisplayName(s.year, s.term),
    ]),
  );
  return players.map((p) => ({
    ...p,
    team_name: teamName.get(p.team_id) ?? "",
    season_name: p.season_id ? (seasonName.get(p.season_id) ?? null) : null,
  }));
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
    .from("rr_seasons")
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
    .from("rr_seasons")
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
    .from("rr_seasons")
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
    .from("rr_seasons")
    .update({ is_active: false })
    .eq("team_id", teamId)
    .eq("is_active", true);
  if (deactivateErr) throw deactivateErr;

  const { data, error } = await supabase
    .from("rr_seasons")
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
    .from("rr_seasons")
    .select("id, team_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error("Season not found");

  const { error: deactivateErr } = await supabase
    .from("rr_seasons")
    .update({ is_active: false })
    .eq("team_id", row.team_id)
    .neq("id", seasonId);
  if (deactivateErr) throw deactivateErr;

  const { error: activateErr } = await supabase
    .from("rr_seasons")
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
    .from("rr_games")
    .update({ season_id: null })
    .eq("season_id", seasonId);
  if (gErr) throw gErr;
  const { error: pErr } = await supabase
    .from("rr_players")
    .delete()
    .eq("season_id", seasonId);
  if (pErr) throw pErr;
  const { error } = await supabase.from("rr_seasons").delete().eq("id", seasonId);
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
    .from("rr_players")
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
    .from("rr_players")
    .select(PLAYER_SELECT)
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw error;
  return (data as Player) ?? null;
}

/** Extra profile fields accepted by createPlayer / updatePlayer. */
export interface PlayerProfileInput {
  /**
   * Athlete to link. Omit to create a new athlete automatically when the team
   * belongs to a school; pass null to leave the roster entry unlinked.
   */
  athlete_id?: string | null;
  graduation_year?: number | null;
  position_offense?: string | null;
  position_defense?: string | null;
  notes?: string | null;
}

/**
 * Create a player belonging to a team + season. `seasonId` may be null to keep
 * backwards compatibility with legacy code paths, but new UI should always
 * pass it.
 *
 * If the team belongs to a school and no `athlete_id` is given, the player is
 * linked to the matching athlete at that school (one athlete with the same
 * name and no conflicting grad year) or a new one, so the same person on JV
 * and Varsity, or across seasons, is one athlete.
 */
export async function createPlayer(
  supabase: SupabaseClient,
  teamId: string,
  seasonId: string | null,
  name: string,
  number: string,
  profile: PlayerProfileInput = {},
): Promise<Player> {
  let athleteId = profile.athlete_id;
  if (athleteId === undefined) {
    const team = await getTeam(supabase, teamId);
    athleteId = team?.school_id
      ? (
          await findOrCreateAthlete(
            supabase,
            team.school_id,
            name,
            profile.graduation_year ?? null,
          )
        ).id
      : null;
  }

  const { data, error } = await supabase
    .from("rr_players")
    .insert({
      team_id: teamId,
      season_id: seasonId,
      athlete_id: athleteId,
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
  const { error } = await supabase.from("rr_players").update(patch).eq("id", id);
  if (error) throw error;

  // Name and grad year belong to the athlete: keep the athlete and the same
  // athlete's roster entries on other teams/seasons in step.
  const shared: { name?: string; graduation_year?: number | null } = {};
  if (patch.name !== undefined) shared.name = patch.name;
  if (patch.graduation_year !== undefined) shared.graduation_year = patch.graduation_year;
  if (Object.keys(shared).length === 0) return;

  const { data: row, error: rowErr } = await supabase
    .from("rr_players")
    .select("athlete_id")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) throw rowErr;
  const athleteId = (row as { athlete_id: string | null } | null)?.athlete_id;
  if (!athleteId) return;

  const { error: aErr } = await supabase
    .from("rr_athletes")
    .update(shared)
    .eq("id", athleteId);
  if (aErr) throw aErr;
  const { error: sErr } = await supabase
    .from("rr_players")
    .update(shared)
    .eq("athlete_id", athleteId)
    .neq("id", id);
  if (sErr) throw sErr;
}

/**
 * Apply a previewed roster import to a team-season. Rows are applied one at a
 * time; on failure the error names the row, and rows before it stay applied
 * (re-importing the same file updates them instead of duplicating).
 */
export async function applyRosterImport(
  supabase: SupabaseClient,
  teamId: string,
  seasonId: string,
  plan: PlannedRosterRow[],
): Promise<{ created: number; linked: number; updated: number }> {
  const result = { created: 0, linked: 0, updated: 0 };
  const team = await getTeam(supabase, teamId);
  const schoolId = team?.school_id ?? null;
  for (const row of plan) {
    const profile = {
      graduation_year: row.graduation_year,
      position_offense: row.position_offense,
      position_defense: row.position_defense,
      notes: row.notes,
    };
    try {
      switch (row.action.kind) {
        case "create": {
          // "New player" is explicit: don't let createPlayer auto-match an
          // existing athlete the coach chose not to link.
          const athleteId = schoolId
            ? (await createAthlete(supabase, schoolId, row.name, row.graduation_year)).id
            : null;
          await createPlayer(supabase, teamId, seasonId, row.name, row.number, {
            ...profile,
            athlete_id: athleteId,
          });
          result.created++;
          break;
        }
        case "link":
          await createPlayer(supabase, teamId, seasonId, row.name, row.number, {
            ...profile,
            athlete_id: row.action.athleteId,
          });
          result.linked++;
          break;
        case "update": {
          // Only overwrite fields the upload actually filled in.
          const patch: Parameters<typeof updatePlayer>[2] = { number: row.number };
          if (row.graduation_year != null) patch.graduation_year = row.graduation_year;
          if (row.position_offense) patch.position_offense = row.position_offense;
          if (row.position_defense) patch.position_defense = row.position_defense;
          if (row.notes) patch.notes = row.notes;
          await updatePlayer(supabase, row.action.playerId, patch);
          result.updated++;
          break;
        }
        case "skip":
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Line ${row.line} (${row.name}): ${msg}`);
    }
  }
  return result;
}

export async function deletePlayer(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("rr_players").delete().eq("id", id);
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
    .from("rr_games")
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
    .from("rr_games")
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
    .from("rr_games")
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
    .from("rr_games")
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
  const { error } = await supabase.from("rr_games").delete().eq("id", gameId);
  if (error) throw error;
}

// ---------- Public stream overlay ----------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the narrow scoreboard projection for a public overlay token.
 *
 * Callable with the anon key: rr_get_overlay_scoreboard is SECURITY DEFINER and
 * the token match is the authorization check. Returns null for an unknown or
 * malformed token so callers can 404 without leaking which games exist.
 */
export async function getOverlayScoreboard(
  supabase: SupabaseClient,
  token: string,
): Promise<OverlayScoreboardRow | null> {
  // Guard before the round trip: Postgres errors on an invalid uuid cast.
  if (!UUID_RE.test(token)) return null;

  const { data, error } = await supabase.rpc("rr_get_overlay_scoreboard", {
    p_token: token,
  });
  if (error) throw error;

  const rows = (data ?? []) as OverlayScoreboardRow[];
  return rows[0] ?? null;
}

/** Issue a fresh overlay token, invalidating any URL already handed out. */
export async function rotateOverlayToken(
  supabase: SupabaseClient,
  gameId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const { error } = await supabase
    .from("rr_games")
    .update({ overlay_token: token })
    .eq("id", gameId);
  if (error) throw error;
  return token;
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
