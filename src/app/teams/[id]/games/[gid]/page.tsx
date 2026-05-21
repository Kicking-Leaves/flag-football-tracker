import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getTeam } from "@/lib/db";
import GameTracker from "./GameTracker";

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

  const [team, game] = await Promise.all([
    getTeam(supabase, teamId),
    getGame(supabase, gameId),
  ]);

  if (!team || !game) notFound();
  if (game.team_id !== teamId) notFound();

  return (
    <GameTracker
      teamId={teamId}
      gameId={gameId}
      teamName={team.name}
      opponentName={game.opponent_name}
      gameDate={game.game_date}
      initialState={game.game_data}
    />
  );
}
