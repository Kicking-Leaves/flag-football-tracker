"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createTeam } from "@/lib/db";

export default function NewTeamPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const team = await createTeam(supabase, name.trim());
      router.push(`/teams/${team.id}/roster`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <h1 className="text-2xl font-bold">Create New Team</h1>
          <p className="text-blue-100">Start tracking a new team's season.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-xl"
        >
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-700">
              Team Name
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lake Washington 9th Grade"
              className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/"
              className="rounded-xl bg-gray-200 py-3 text-center font-bold text-gray-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-xl bg-gradient-to-r from-green-600 to-green-700 py-3 font-bold text-white shadow-lg disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create Team"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
