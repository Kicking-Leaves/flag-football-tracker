import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGame, getMyTeamRole } from "@/lib/db";
import { isSiteAdmin } from "@/lib/admin";
import ChangeLog from "@/components/audit/ChangeLog";

export const dynamic = "force-dynamic";

/** A game's change history, for the team's admins and site admins. */
export default async function GameHistoryPage({
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

  const [role, siteAdmin, game] = await Promise.all([
    getMyTeamRole(supabase, teamId, user.id),
    isSiteAdmin(supabase),
    getGame(supabase, gameId).catch(() => null),
  ]);
  if (role !== "admin" && !siteAdmin) notFound();
  if (game && game.team_id !== teamId) notFound();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {game ? (
          <Link href={`/teams/${teamId}/games/${gameId}/stats`} className="text-sm text-blue-600 underline">
            ← Game stats
          </Link>
        ) : (
          <Link href={siteAdmin ? "/admin/audit" : `/teams/${teamId}`} className="text-sm text-blue-600 underline">
            ← Back
          </Link>
        )}
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Change history</h1>
        <p className="mb-6 text-sm text-gray-600">
          {game ? `vs ${game.opponent_name} · ${new Date(game.game_date).toLocaleDateString()}` : "Deleted game"}. Every
          play recorded, edited, undone or deleted, with who did it and when.
        </p>
        <ChangeLog gameId={gameId} showGame={false} />
      </div>
    </main>
  );
}
