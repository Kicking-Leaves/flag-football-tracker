import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getInviteSummary } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import LogoutButton from "@/app/logout-button";
import RequestAccessForm from "./RequestAccessForm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Step 2 of getting an account (after verifying the email): ask for one, or
 * see where a request stands. Signed-in users without an approved account are
 * sent here by the middleware.
 */
export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite: inviteParam } = await searchParams;
  const inviteId = inviteParam && UUID_RE.test(inviteParam) ? inviteParam : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(inviteId ? `/auth/register?invite=${inviteId}` : "/auth/register");

  const { data: account } = await supabase
    .from("rr_accounts")
    .select("status, full_name, status_reason")
    .eq("user_id", user.id)
    .maybeSingle();
  const invite = inviteId ? await getInviteSummary(supabase, inviteId).catch(() => null) : null;
  const validInvite = invite?.status === "valid" ? invite : null;

  if (account?.status === "approved") {
    redirect(validInvite ? `/invite/${inviteId}` : "/");
  }

  // Signed in with Google, or an existing sign-in (another Kicking Leaves app):
  // they already have a way to sign in, so a password is optional.
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
  // A sign-in created by the email check just now (first sign-in within a day
  // of the account's creation) has no password yet.
  const isNew =
    !user.last_sign_in_at ||
    new Date(user.last_sign_in_at).getTime() - new Date(user.created_at).getTime() < 24 * 60 * 60 * 1000;
  const passwordRequired = provider === "email" && isNew;

  let body: React.ReactNode;
  if (account?.status === "pending" && !validInvite) {
    body = (
      <>
        <h1 className="text-2xl font-semibold">Request received</h1>
        <p className="mt-2 text-sm text-gray-600">
          Thanks{account.full_name ? `, ${account.full_name}` : ""}. An admin will review your request for{" "}
          <strong>{user.email}</strong>. You&apos;ll be able to sign in once it&apos;s approved.
        </p>
      </>
    );
  } else if (account?.status === "suspended") {
    body = (
      <>
        <h1 className="text-2xl font-semibold">Account suspended</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your RouteRunnr account ({user.email}) is suspended.
          {account.status_reason ? ` Reason: ${account.status_reason}` : ""} Contact the RouteRunnr admin if you think
          this is a mistake.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-2xl font-semibold">
          {validInvite ? `Join ${validInvite.team_name}` : "Request a RouteRunnr account"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {validInvite
            ? `You're joining as ${ROLE_LABELS[validInvite.role]}.`
            : account?.status === "rejected"
              ? "Your earlier request wasn't approved. You can send a new one."
              : "Tell us who you are. An admin will review your request."}
        </p>
        <p className="mt-1 text-sm text-gray-500">Email verified: {user.email}</p>
        <div className="mt-5">
          <RequestAccessForm
            inviteId={validInvite ? inviteId : null}
            initialName={account?.full_name ?? (user.user_metadata?.full_name as string | undefined) ?? ""}
            passwordRequired={passwordRequired}
            passwordOffered={provider === "email"}
          />
        </div>
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>{body}</div>
        <div className="flex items-center justify-between text-sm text-gray-500">
          <Link href="/auth/login" className="underline">
            Use a different account
          </Link>
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
