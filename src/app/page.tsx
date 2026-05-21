import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./logout-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Welcome to RouteRunnr</h1>
      <p className="text-sm text-gray-600">Signed in as {user.email}</p>
      <LogoutButton />
      <p className="mt-12 max-w-sm text-center text-xs text-gray-400">
        This is a Phase 1 placeholder. The real dashboard arrives in Phase 2.
      </p>
    </main>
  );
}
