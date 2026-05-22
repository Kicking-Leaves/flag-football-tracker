"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createSeason, createTeam } from "@/lib/db";
import { SEASON_TERMS, type SeasonTerm } from "@/lib/types";

export default function NewTeamPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [term, setTerm] = useState<"" | SeasonTerm>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setError("Year must be a valid 4-digit year.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const team = await createTeam(supabase, name.trim());
      const season = await createSeason(
        supabase,
        team.id,
        yearNum,
        term || null,
      );
      // Land the user in the new season's roster builder.
      router.push(`/teams/${team.id}/roster?season=${season.id}`);
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
          <p className="text-blue-100">Start tracking a new team&apos;s first season.</p>
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

          <div>
            <label className="mb-2 block text-sm font-bold text-gray-700">
              First Season
            </label>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value as "" | SeasonTerm)}
                className="rounded-xl border-2 border-gray-300 bg-white px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
              >
                <option value="">(no term)</option>
                {SEASON_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="numeric"
                required
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Year"
                className="rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Term is optional. Year is required.
            </p>
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
