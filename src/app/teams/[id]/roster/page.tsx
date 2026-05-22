"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createPlayer,
  deletePlayer,
  getActiveSeason,
  getPlayers,
  getSeason,
  getSeasons,
  updatePlayer,
} from "@/lib/db";
import type { Player, Season } from "@/lib/types";
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const seasonParam = searchParams.get("season");

  const [season, setSeason] = useState<Season | null>(null);
  const [allSeasons, setAllSeasons] = useState<Season[]>([]);
  const [resolvingSeason, setResolvingSeason] = useState(true);

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-player form state
  const [addForm, setAddForm] = useState<PlayerFormFields>(emptyForm());

  // Edit-player state (null when no row is being edited)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlayerFormFields>(emptyForm());
  const [editError, setEditError] = useState<string | null>(null);

  // Copy-from-previous state
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Resolve the active season if no `?season=` query param was supplied.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setResolvingSeason(true);
      try {
        const seasons = await getSeasons(supabase, teamId);
        if (cancelled) return;
        setAllSeasons(seasons);

        if (seasonParam) {
          const found = seasons.find((s) => s.id === seasonParam) ?? null;
          if (!found) {
            // Param is stale — fall back to active season or first season.
            const active = await getActiveSeason(supabase, teamId);
            if (active) {
              router.replace(`/teams/${teamId}/roster?season=${active.id}`);
              return;
            }
          }
          setSeason(found ?? null);
        } else {
          const active = await getActiveSeason(supabase, teamId);
          if (active) {
            router.replace(`/teams/${teamId}/roster?season=${active.id}`);
            return;
          }
          // No active season — pick the most recent if any.
          if (seasons.length > 0) {
            router.replace(`/teams/${teamId}/roster?season=${seasons[0].id}`);
            return;
          }
          // Truly no seasons — let the page render an empty state.
          setSeason(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load season");
      } finally {
        if (!cancelled) setResolvingSeason(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, seasonParam]);

  // Refetch the season object on demand (e.g., after seasonParam changes mid-page).
  useEffect(() => {
    if (!seasonParam) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSeason(supabase, seasonParam);
        if (!cancelled) setSeason(s);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load season");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonParam]);

  const refresh = useCallback(async () => {
    if (!season) {
      setPlayers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getPlayers(supabase, teamId, season.id);
      setPlayers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, [supabase, teamId, season]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!season) return;
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
        season.id,
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

  /** Copy every player from the most recent OTHER season into this one. */
  async function handleCopyFromPrevious() {
    if (!season) return;
    const previous = allSeasons.find((s) => s.id !== season.id);
    if (!previous) {
      setCopyError("No previous season to copy from.");
      return;
    }
    if (
      !confirm(
        `Copy all players from "${previous.displayName}" into "${season.displayName}"?`,
      )
    ) {
      return;
    }
    setCopying(true);
    setCopyError(null);
    try {
      const sourceRoster = await getPlayers(supabase, teamId, previous.id);
      if (sourceRoster.length === 0) {
        setCopyError(`"${previous.displayName}" has no players to copy.`);
        return;
      }
      for (const p of sourceRoster) {
        await createPlayer(supabase, teamId, season.id, p.name, p.number, {
          graduation_year: p.graduation_year ?? null,
          position_offense: p.position_offense ?? null,
          position_defense: p.position_defense ?? null,
          notes: p.notes ?? null,
        });
      }
      await refresh();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Failed to copy");
    } finally {
      setCopying(false);
    }
  }

  const sortedPlayers = players
    .slice()
    .sort(
      (a, b) =>
        Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
    );

  const otherSeasons = allSeasons.filter((s) => s.id !== season?.id);

  // No-season state: prompt user back to team dashboard.
  if (!resolvingSeason && !season) {
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
          </div>
          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-gray-700">
              No season selected. Create a season on the team dashboard first.
            </p>
            <Link
              href={`/teams/${teamId}`}
              className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <Link
            href={season ? `/teams/${teamId}/seasons/${season.id}` : `/teams/${teamId}`}
            className="text-sm text-blue-100 underline"
          >
            ← {season?.displayName ?? "Team dashboard"}
          </Link>
          <h1 className="mt-2 text-3xl font-bold">
            {season ? `${season.displayName} Roster` : "Roster"}
          </h1>
          <p className="text-blue-100">
            Players are scoped to this season. Career stats roll up across all
            seasons.
          </p>
        </div>

        {otherSeasons.length > 0 && players.length === 0 && !loading && (
          <div className="mb-4 rounded-2xl bg-yellow-50 p-4 shadow">
            <p className="text-sm font-bold text-yellow-900">
              Empty roster — copy from a previous season?
            </p>
            <p className="mt-1 text-xs text-yellow-800">
              Pulls all players from{" "}
              <strong>{otherSeasons[0]?.displayName}</strong> into this season.
            </p>
            {copyError && (
              <p className="mt-2 text-sm text-red-600">{copyError}</p>
            )}
            <button
              type="button"
              onClick={handleCopyFromPrevious}
              disabled={copying}
              className="mt-3 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {copying ? "Copying…" : `Copy from ${otherSeasons[0]?.displayName}`}
            </button>
          </div>
        )}

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
            disabled={
              !season ||
              !addForm.name.trim() ||
              !addForm.number.trim()
            }
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-green-500 to-green-600 py-4 font-bold text-white shadow disabled:opacity-50"
          >
            Add Player
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>

        <div className="rounded-2xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">
              Roster ({players.length})
            </h2>
            {otherSeasons.length > 0 && players.length > 0 && (
              <button
                type="button"
                onClick={handleCopyFromPrevious}
                disabled={copying}
                className="rounded-lg bg-yellow-100 px-3 py-1.5 text-xs font-bold text-yellow-800 disabled:opacity-50"
              >
                {copying
                  ? "Copying…"
                  : `+ Copy from ${otherSeasons[0]?.displayName}`}
              </button>
            )}
          </div>
          {copyError && players.length > 0 && (
            <p className="mb-2 text-sm text-red-600">{copyError}</p>
          )}
          {loading || resolvingSeason ? (
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
