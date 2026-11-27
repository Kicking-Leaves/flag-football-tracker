import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole, getTeam } from "@/lib/db";
import { can } from "@/lib/permissions";
import PlaysEditor from "./PlaysEditor";

export const dynamic = "force-dynamic";

export default async function PlayByPlayPage({
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
  const canScore = can(role, "scoreGame");

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-16">
      <div className="mx-auto max-w-2xl p-4">
        <Link href={`/teams/${teamId}/games/${gameId}/stats`} className="text-sm text-blue-600 underline">
          ← Game stats
        </Link>
        <div className="mb-4 mt-2 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 p-5 text-white shadow-xl">
          <h1 className="text-2xl font-bold">Play-by-play</h1>
          <p className="text-purple-100">
            {team.name} vs {game.opponent_name} · {new Date(game.game_date).toLocaleDateString()}
          </p>
        </div>
        {canScore && game.status === "in_progress" && (
          <p className="mb-4 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-900">
            This game is being scored. To fix a play, use <strong>Plays</strong> on the{" "}
            <Link href={`/teams/${teamId}/games/${gameId}`} className="underline">
              scoring screen
            </Link>{" "}
            so your edit doesn&apos;t collide with live scoring.
          </p>
        )}
        <PlaysEditor
          gameId={gameId}
          teamName={team.name}
          opponentName={game.opponent_name}
          initialState={game.game_data}
          canEdit={canScore && game.status === "completed"}
        />
      </div>
    </main>
  );
}
