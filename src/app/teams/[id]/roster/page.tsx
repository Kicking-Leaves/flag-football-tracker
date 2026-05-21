"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  createPlayer,
  deletePlayer,
  getPlayers,
  updatePlayer,
} from "@/lib/db";
import type { Player } from "@/lib/types";
import { DEFENSE_POSITIONS, OFFENSE_POSITIONS } from "@/lib/types";

// ---------- helpers ----------

interface PlayerFormFields {
  name: string;
  number: string;
  graduation_year: string;
  position_offense: string;
  position_defense: string;
  notes: string;
}

function emptyForm(): PlayerFormFields {
  return {
    name: "",
    number: "",
    graduation_year: "",
    position_offense: "",
    position_defense: "",
    notes: "",
  };
}

function formFromPlayer(p: Player): PlayerFormFields {
  return {
    name: p.name,
    number: p.number,
    graduation_year:
      p.graduation_year != null ? String(p.graduation_year) : "",
    position_offense: p.position_offense ?? "",
    position_defense: p.position_defense ?? "",
    notes: p.notes ?? "",
  };
}

/** Parse a graduation year string into integer or null. Returns "invalid" on bad input. */
function parseGradYear(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) return "invalid";
  return n;
}

export default function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: teamId } = use(params);
  const supabase = createClient();

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-player form state
  const [addForm, setAddForm] = useState<PlayerFormFields>(emptyForm());

  // Edit-player state (null when no row is being edited)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlayerFormFields>(emptyForm());
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPlayers(supabase, teamId);
      setPlayers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, [supabase, teamId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.number.trim()) return;
    const grad = parseGradYear(addForm.graduation_year);
    if (grad === "invalid") {
      setError("Graduation year must be a 4-digit year.");
      return;
    }
    setError(null);
    try {
      await createPlayer(
        supabase,
        teamId,
        addForm.name.trim(),
        addForm.number.trim(),
        {
          graduation_year: grad,
          position_offense: addForm.position_offense || null,
          position_defense: addForm.position_defense || null,
          notes: addForm.notes.trim() || null,
        },
      );
      setAddForm(emptyForm());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add player");
    }
  }

  async function handleDelete(playerId: string) {
    if (!confirm("Remove this player from the roster?")) return;
    try {
      await deletePlayer(supabase, playerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleToggleActive(p: Player) {
    try {
      await updatePlayer(supabase, p.id, { active: !p.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  }

  function beginEdit(p: Player) {
    setEditingId(p.id);
    setEditForm(formFromPlayer(p));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm());
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    if (!editForm.name.trim() || !editForm.number.trim()) {
      setEditError("Name and number are required.");
      return;
    }
    const grad = parseGradYear(editForm.graduation_year);
    if (grad === "invalid") {
      setEditError("Graduation year must be a 4-digit year.");
      return;
    }
    setEditError(null);
    try {
      await updatePlayer(supabase, editingId, {
        name: editForm.name.trim(),
        number: editForm.number.trim(),
        graduation_year: grad,
        position_offense: editForm.position_offense || null,
        position_defense: editForm.position_defense || null,
        notes: editForm.notes.trim() || null,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  const sortedPlayers = players
    .slice()
    .sort(
      (a, b) =>
        Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
    );

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <Link
            href={`/teams/${teamId}`}
            className="text-sm text-blue-100 underline"
          >
            ← Team dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Roster</h1>
          <p className="text-blue-100">
            Players are reused across all games for this team.
          </p>
        </div>

        <form
          onSubmit={handleAdd}
          className="mb-4 rounded-2xl bg-white p-5 shadow-xl"
        >
          <h2 className="mb-3 text-lg font-bold text-gray-800">Add player</h2>
          <PlayerFormFieldsBlock
            values={addForm}
            onChange={setAddForm}
            prefix="add"
          />
          <button
            type="submit"
            disabled={!addForm.name.trim() || !addForm.number.trim()}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-green-500 to-green-600 py-4 font-bold text-white shadow disabled:opacity-50"
          >
            Add Player
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>

        <div className="rounded-2xl bg-white p-5 shadow-xl">
          <h2 className="mb-3 text-lg font-bold text-gray-800">
            Roster ({players.length})
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : sortedPlayers.length === 0 ? (
            <p className="text-sm text-gray-500">No players yet.</p>
          ) : (
            <ul className="space-y-2">
              {sortedPlayers.map((p) =>
                editingId === p.id ? (
                  <li
                    key={p.id}
                    className="rounded-xl border-2 border-blue-400 bg-blue-50 p-4"
                  >
                    <form onSubmit={handleSaveEdit}>
                      <PlayerFormFieldsBlock
                        values={editForm}
                        onChange={setEditForm}
                        prefix={`edit-${p.id}`}
                      />
                      {editError && (
                        <p className="mt-2 text-sm text-red-600">
                          {editError}
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg bg-gray-600 py-4 font-bold text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={
                            !editForm.name.trim() || !editForm.number.trim()
                          }
                          className="rounded-lg bg-green-600 py-4 font-bold text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li
                    key={p.id}
                    className={`rounded-xl p-3 ${
                      p.active
                        ? "bg-gradient-to-r from-gray-50 to-blue-50"
                        : "bg-gray-100 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/teams/${teamId}/players/${p.id}`}
                        className="min-w-0 flex-1"
                      >
                        <div className="font-semibold">
                          #{p.number} {p.name}
                        </div>
                        <div className="text-xs text-gray-600">
                          {p.graduation_year
                            ? `Class of ${p.graduation_year}`
                            : null}
                          {p.graduation_year &&
                          (p.position_offense || p.position_defense)
                            ? " · "
                            : null}
                          {p.position_offense || p.position_defense ? (
                            <>
                              {p.position_offense ?? "—"} /{" "}
                              {p.position_defense ?? "—"}
                            </>
                          ) : null}
                        </div>
                      </Link>
                      <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(p)}
                          aria-label={`Edit ${p.name}`}
                          className="rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-bold text-gray-700"
                        >
                          {p.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          className="rounded-lg bg-red-100 px-3 py-2 text-sm font-bold text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------- form sub-component ----------

interface PlayerFormFieldsBlockProps {
  values: PlayerFormFields;
  onChange: (next: PlayerFormFields) => void;
  prefix: string;
}

function PlayerFormFieldsBlock({
  values,
  onChange,
  prefix,
}: PlayerFormFieldsBlockProps) {
  function set<K extends keyof PlayerFormFields>(
    key: K,
    value: PlayerFormFields[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <input
          id={`${prefix}-name`}
          type="text"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Player name"
          className="col-span-2 rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
        />
        <input
          id={`${prefix}-number`}
          type="text"
          value={values.number}
          onChange={(e) => set("number", e.target.value)}
          placeholder="#"
          className="rounded-xl border-2 border-gray-300 px-4 py-3 text-center font-semibold focus:border-green-500 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input
          id={`${prefix}-grad`}
          type="number"
          inputMode="numeric"
          value={values.graduation_year}
          onChange={(e) => set("graduation_year", e.target.value)}
          placeholder="Grad year"
          className="rounded-xl border-2 border-gray-300 px-3 py-3 font-semibold focus:border-green-500 focus:outline-none"
        />
        <select
          id={`${prefix}-off`}
          value={values.position_offense}
          onChange={(e) => set("position_offense", e.target.value)}
          className="rounded-xl border-2 border-gray-300 bg-white px-3 py-3 font-semibold focus:border-green-500 focus:outline-none"
        >
          <option value="">Offense…</option>
          {OFFENSE_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>
        <select
          id={`${prefix}-def`}
          value={values.position_defense}
          onChange={(e) => set("position_defense", e.target.value)}
          className="rounded-xl border-2 border-gray-300 bg-white px-3 py-3 font-semibold focus:border-green-500 focus:outline-none"
        >
          <option value="">Defense…</option>
          {DEFENSE_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>
      </div>
      <textarea
        id={`${prefix}-notes`}
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 text-sm focus:border-green-500 focus:outline-none"
      />
    </div>
  );
}
