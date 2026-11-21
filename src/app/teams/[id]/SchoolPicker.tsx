"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createSchool, setTeamSchool } from "@/lib/db";
import type { School } from "@/lib/types";

const NEW = "__new__";

/**
 * Assign the team to a school so its players can be shared with the school's
 * other teams (e.g. JV and Varsity).
 */
export default function SchoolPicker({
  teamId,
  schools,
  currentSchoolId,
}: {
  teamId: string;
  schools: School[];
  currentSchoolId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const current = schools.find((s) => s.id === currentSchoolId) ?? null;
  const [editing, setEditing] = useState(!current && schools.length === 0);
  const [choice, setChoice] = useState(currentSchoolId ?? (schools.length ? "" : NEW));
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = choice === NEW ? null : choice || null;
    if (current && target !== current.id) {
      const ok = confirm(
        `Move this team out of ${current.name}? Its players will no longer be linked to athletes on ${current.name}'s other teams.`,
      );
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      let schoolId = target;
      if (choice === NEW) {
        if (!newName.trim()) return;
        schoolId = (await createSchool(supabase, newName.trim())).id;
      }
      await setTeamSchool(supabase, teamId, schoolId);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save school");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">School</p>
          <p className="truncate font-semibold text-gray-800">
            {current ? current.name : "Not set"}
          </p>
          {!current && (
            <p className="text-xs text-gray-500">
              Set a school to share players between teams, like JV and Varsity.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-shrink-0 rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-700"
        >
          {current ? "Change" : "Set school"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mb-6 rounded-2xl bg-white p-4 shadow">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">School</p>
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="mb-2 w-full rounded-xl border-2 border-gray-300 px-3 py-3 font-semibold"
        aria-label="School"
      >
        {schools.length > 0 && <option value="">No school</option>}
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value={NEW}>+ New school…</option>
      </select>
      {choice === NEW && (
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Lake Washington High School"
          className="mb-2 w-full rounded-xl border-2 border-gray-300 px-3 py-3"
          aria-label="New school name"
          autoFocus
        />
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setChoice(currentSchoolId ?? "");
            setError(null);
          }}
          className="rounded-lg bg-gray-200 py-3 font-bold text-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || (choice === NEW && !newName.trim())}
          className="rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
