"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createPlayer, type RosterEntryWithTeam } from "@/lib/db";
import type { Athlete, Player } from "@/lib/types";

interface AddFromSchoolProps {
  teamId: string;
  seasonId: string;
  schoolName: string;
  roster: Player[];
  athletes: Athlete[];
  schoolEntries: RosterEntryWithTeam[];
  onAdded: () => Promise<void> | void;
}

/**
 * Add an athlete who is already on another of the school's teams (e.g. a JV
 * player called up to Varsity) to this season's roster, linked to the same
 * athlete profile.
 */
export default function AddFromSchool({
  teamId,
  seasonId,
  schoolName,
  roster,
  athletes,
  schoolEntries,
  onAdded,
}: AddFromSchoolProps) {
  const supabase = createClient();
  const [athleteId, setAthleteId] = useState("");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Athletes not already on this roster, with their most recent entry elsewhere.
  const options = useMemo(() => {
    const onRoster = new Set(roster.map((p) => p.athlete_id).filter(Boolean));
    return athletes
      .filter((a) => !onRoster.has(a.id))
      .map((a) => {
        const entries = schoolEntries
          .filter((e) => e.athlete_id === a.id)
          .sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? ""));
        return { athlete: a, latest: entries[0] ?? null };
      });
  }, [athletes, roster, schoolEntries]);

  if (options.length === 0) return null;

  function pick(id: string) {
    setAthleteId(id);
    setError(null);
    // Default to the number they wear elsewhere.
    setNumber(options.find((o) => o.athlete.id === id)?.latest?.number ?? "");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const opt = options.find((o) => o.athlete.id === athleteId);
    if (!opt || !number.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const src = opt.latest;
      await createPlayer(supabase, teamId, seasonId, opt.athlete.name, number.trim(), {
        athlete_id: opt.athlete.id,
        graduation_year: opt.athlete.graduation_year ?? null,
        position_offense: src?.position_offense ?? null,
        position_defense: src?.position_defense ?? null,
      });
      setAthleteId("");
      setNumber("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add player");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleAdd} className="mb-4 rounded-2xl bg-white p-5 shadow-xl">
      <h2 className="mb-1 text-lg font-bold text-gray-800">
        Add from {schoolName}
      </h2>
      <p className="mb-3 text-sm text-gray-600">
        Players already on another {schoolName} team. They stay the same
        athlete, so their stats can be combined.
      </p>
      <div className="flex gap-2">
        <select
          value={athleteId}
          onChange={(e) => pick(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border-2 border-gray-300 px-3 py-3 font-semibold"
          aria-label="Athlete"
        >
          <option value="">Select athlete</option>
          {options.map(({ athlete, latest }) => (
            <option key={athlete.id} value={athlete.id}>
              {athlete.name}
              {athlete.graduation_year ? ` '${String(athlete.graduation_year).slice(2)}` : ""}
              {latest ? ` — ${latest.team_name} #${latest.number}` : ""}
            </option>
          ))}
        </select>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="#"
          inputMode="numeric"
          className="w-20 rounded-xl border-2 border-gray-300 px-3 py-3 text-center font-semibold"
          aria-label="Jersey number on this team"
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving || !athleteId || !number.trim()}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 py-3 font-bold text-white shadow disabled:opacity-50"
      >
        {saving ? "Adding…" : "Add to roster"}
      </button>
    </form>
  );
}
