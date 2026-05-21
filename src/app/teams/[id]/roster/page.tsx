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

export default function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: teamId } = use(params);
  const supabase = createClient();

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPlayers(supabase, teamId);
      setPlayers(list as Player[]);
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
    if (!name.trim() || !number.trim()) return;
    setError(null);
    try {
      await createPlayer(supabase, teamId, name.trim(), number.trim());
      setName("");
      setNumber("");
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
          <div className="mb-3 grid grid-cols-3 gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
              className="col-span-2 rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
            />
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="#"
              className="rounded-xl border-2 border-gray-300 px-4 py-3 text-center font-semibold focus:border-green-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || !number.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-green-500 to-green-600 py-3 font-bold text-white shadow disabled:opacity-50"
          >
            Add Player
          </button>
          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}
        </form>

        <div className="rounded-2xl bg-white p-5 shadow-xl">
          <h2 className="mb-3 text-lg font-bold text-gray-800">
            Roster ({players.length})
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : players.length === 0 ? (
            <p className="text-sm text-gray-500">No players yet.</p>
          ) : (
            <ul className="space-y-2">
              {players
                .slice()
                .sort(
                  (a, b) =>
                    Number(a.number) - Number(b.number) ||
                    a.name.localeCompare(b.name),
                )
                .map((p) => (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between rounded-xl p-3 ${
                      p.active ? "bg-gradient-to-r from-gray-50 to-blue-50" : "bg-gray-100 opacity-60"
                    }`}
                  >
                    <span className="font-semibold">
                      #{p.number} {p.name}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p)}
                        className="rounded-lg bg-gray-200 px-3 py-1 text-sm font-bold text-gray-700"
                      >
                        {p.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="rounded-lg bg-red-100 px-3 py-1 text-sm font-bold text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
