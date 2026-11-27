import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminTeams, isSiteAdmin } from "@/lib/admin";
import ChangeLog from "@/components/audit/ChangeLog";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/admin/audit");
  if (!(await isSiteAdmin(supabase))) notFound();
  const teams = await getAdminTeams(supabase);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <Link href="/admin" className="text-sm text-blue-600 underline">
          ← Site admin
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Change log</h1>
        <p className="mb-6 text-sm text-gray-600">
          Every change to games, play-by-play and stats: who, when and what changed.
        </p>
        <ChangeLog teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </div>
    </main>
  );
}
