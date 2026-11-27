import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getInviteSummary, getMyTeamRole } from "@/lib/db";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import AcceptInviteButton from "./AcceptInviteButton";

export const dynamic = "force-dynamic";

const STATUS_MESSAGES = {
  used: "This invite link has already been used. Ask the coach for a new one.",
  expired: "This invite link has expired. Ask the coach for a new one.",
  revoked: "This invite link was turned off. Ask the coach for a new one.",
} as const;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const invite = await getInviteSummary(supabase, id);
  const existingRole =
    invite && user ? await getMyTeamRole(supabase, invite.team_id, user.id) : null;
  const next = encodeURIComponent(`/invite/${id}`);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        {!invite ? (
          <>
            <h1 className="text-2xl font-bold text-gray-800">Invite not found</h1>
            <p className="mt-2 text-gray-600">
              This link isn&apos;t valid. Check that you copied the whole link.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-wide text-gray-500">
              Team invite
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-800">{invite.team_name}</h1>
            <p className="mt-3 text-gray-700">
              Join as <strong>{ROLE_LABELS[invite.role]}</strong>
            </p>
            <p className="text-sm text-gray-500">{ROLE_DESCRIPTIONS[invite.role]}</p>

            <div className="mt-6">
              {existingRole ? (
                <>
                  <p className="mb-3 text-sm text-gray-700">
                    You&apos;re already on this team as{" "}
                    <strong>{ROLE_LABELS[existingRole]}</strong>.
                  </p>
                  <Link
                    href={`/teams/${invite.team_id}`}
                    className="block rounded-xl bg-blue-600 py-3 text-center font-bold text-white"
                  >
                    Go to team
                  </Link>
                </>
              ) : invite.status !== "valid" ? (
                <p className="text-sm text-red-600">{STATUS_MESSAGES[invite.status]}</p>
              ) : user ? (
                <>
                  <p className="mb-3 text-sm text-gray-500">Signed in as {user.email}</p>
                  <AcceptInviteButton inviteId={id} />
                </>
              ) : (
                <div className="space-y-2">
                  <Link
                    href={`/auth/register?invite=${id}`}
                    className="block rounded-xl bg-blue-600 py-3 text-center font-bold text-white"
                  >
                    Create an account to join
                  </Link>
                  <Link
                    href={`/auth/login?next=${next}`}
                    className="block rounded-xl bg-gray-100 py-3 text-center font-bold text-gray-800"
                  >
                    I already have an account
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
