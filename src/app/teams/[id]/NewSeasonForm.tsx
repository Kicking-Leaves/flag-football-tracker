"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createSeason } from "@/lib/db";
import { SEASON_TERMS, type Season, type SeasonTerm } from "@/lib/types";

interface Props {
  teamId: string;
  /** Existing seasons (used to suggest a default year). */
  existingYears: Season[];
}

/**
 * Inline "New Season" form on the team dashboard. Year is required, term is
 * optional. On success, redirects to the new season's detail page.
 */
export default function NewSeasonForm({ teamId, existingYears }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<string>(() => {
    const newest = existingYears[0]?.year ?? new Date().getFullYear();
    return String(newest);
  });
  const [term, setTerm] = useState<"" | SeasonTerm>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setError("Year must be a valid 4-digit year.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const season = await createSeason(
        supabase,
        teamId,
        yearNum,
        term || null,
      );
      setOpen(false);
      router.push(`/teams/${teamId}/seasons/${season.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create season");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-gradient-to-r from-green-500 to-green-600 py-3 font-bold text-white shadow-lg"
      >
        + New Season
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-white p-5 shadow-xl"
    >
      <h3 className="mb-3 text-lg font-bold text-gray-800">New Season</h3>
      <div className="grid grid-cols-2 gap-3">
        <select
          value={term}
          onChange={(e) => setTerm(e.target.value as "" | SeasonTerm)}
          className="rounded-xl border-2 border-gray-300 bg-white px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
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
          className="rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
        />
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Becomes the team's active season. The previous active season (if any)
        will be deactivated.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg bg-gray-200 py-3 font-bold text-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-green-600 py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
