import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminAccounts, getAdminTeams, isSiteAdmin } from "@/lib/admin";
import AccountsAdmin from "./AccountsAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (!(await isSiteAdmin(supabase))) notFound();

  const [accounts, teams, { status }] = await Promise.all([
    getAdminAccounts(supabase),
    getAdminTeams(supabase),
    searchParams,
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <Link href="/" className="text-sm text-blue-600 underline">
          ← Home
        </Link>
        <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Site admin</h1>
            <p className="text-sm text-gray-600">
              Accounts, team memberships and roles across RouteRunnr.
            </p>
          </div>
          <Link
            href="/admin/audit"
            className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white shadow"
          >
            Change log
          </Link>
        </div>
        <AccountsAdmin
          accounts={accounts}
          teams={teams}
          currentUserId={user.id}
          initialStatus={status === "pending" || status === "suspended" || status === "approved" || status === "rejected" ? status : undefined}
        />
      </div>
    </main>
  );
}
