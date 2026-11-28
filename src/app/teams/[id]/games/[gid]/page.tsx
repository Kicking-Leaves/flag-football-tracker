import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole, getPlayers, getTeam, getTeamOverlayToken } from "@/lib/db";
import { can } from "@/lib/permissions";
import GameTracker from "./GameTracker";
import StartGame from "./StartGame";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string; gid: string }>;
}) {
  const { id: teamId, gid: gameId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [team, game, role] = await Promise.all([
    getTeam(supabase, teamId),
    getGame(supabase, gameId),
    getMyTeamRole(supabase, teamId, user.id),
  ]);

  if (!team || !game || !role) notFound();
  if (game.team_id !== teamId) notFound();
  // Players and parents follow along on the stats page.
  if (!can(role, "scoreGame")) redirect(`/teams/${teamId}/games/${gameId}/stats`);

  if (game.status === "scheduled") {
    const players = await getPlayers(supabase, teamId, game.season_id ?? null);
    return (
      <StartGame
        teamId={teamId}
        gameId={gameId}
        teamName={team.name}
        opponentName={game.opponent_name}
        gameDate={game.game_date}
        gameType={game.game_type ?? "regular"}
        players={players}
        backHref={game.season_id ? `/teams/${teamId}/seasons/${game.season_id}` : `/teams/${teamId}`}
      />
    );
  }

  const teamOverlayToken = await getTeamOverlayToken(supabase, teamId).catch(() => null);

  return (
    <GameTracker
      teamId={teamId}
      gameId={gameId}
      teamName={team.name}
      opponentName={game.opponent_name}
      gameDate={game.game_date}
      overlayToken={game.overlay_token ?? null}
      teamOverlayToken={teamOverlayToken}
      canResetOverlay={can(role, "manageTeam")}
      initialState={game.game_data}
      canDelete={can(role, "deleteGame")}
    />
  );
}
