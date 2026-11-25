import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveInvites, getMyTeamRole, getTeam, getTeamMembers } from "@/lib/db";
import { can } from "@/lib/permissions";
import MembersManager from "./MembersManager";

export const dynamic = "force-dynamic";

export default async function TeamMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: teamId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/teams/${teamId}/members`)}`);

  const [team, role] = await Promise.all([
    getTeam(supabase, teamId),
    getMyTeamRole(supabase, teamId, user.id),
  ]);
  if (!team || !role) notFound();
  if (!can(role, "manageMembers")) redirect(`/teams/${teamId}`);

  const [members, invites] = await Promise.all([
    getTeamMembers(supabase, teamId),
    getActiveInvites(supabase, teamId),
  ]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 p-6 text-white shadow-2xl">
          <Link href={`/teams/${teamId}`} className="text-sm text-green-100 underline">
            ← {team.name}
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Members</h1>
          <p className="mt-1 text-sm text-green-100">
            Invite coaches, stat keepers, players and parents.
          </p>
        </div>
        <MembersManager
          teamId={teamId}
          myUserId={user.id}
          myRole={role}
          members={members}
          invites={invites}
        />
      </div>
    </main>
  );
}
