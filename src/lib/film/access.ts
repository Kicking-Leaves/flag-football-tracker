// Server-side checks shared by the film API routes.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyTeamRole } from "@/lib/db";
import { can, type TeamRole } from "@/lib/permissions";
import { FilmError } from "./server";

export interface GameAccess {
  supabase: SupabaseClient;
  user: User;
  game: { id: string; team_id: string };
  role: TeamRole;
  /** Admin or Coach: import, rename, delete, retry. */
  canManage: boolean;
}

/** The signed-in user's access to a game; throws FilmError for outsiders. */
export async function gameAccess(gameId: string): Promise<GameAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new FilmError("Please sign in.", 401);
  // RLS hides games from non-members, so "not found" covers both cases.
  const { data: game, error } = await supabase
    .from("rr_games")
    .select("id, team_id")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  if (!game) throw new FilmError("Game not found.", 404);
  const role = await getMyTeamRole(supabase, game.team_id, user.id);
  if (!role) throw new FilmError("Game not found.", 404);
  return { supabase, user, game, role, canManage: can(role, "manageTeam") };
}

export function requireManage(access: GameAccess) {
  if (!access.canManage) throw new FilmError("Only admins and coaches can manage film.", 403);
}

/** Turns thrown errors into JSON responses. */
export function filmErrorResponse(err: unknown): Response {
  if (err instanceof FilmError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return Response.json({ error: message }, { status: 500 });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
