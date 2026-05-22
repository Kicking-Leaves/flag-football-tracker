"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createGame,
  getActiveSeason,
  getPlayers,
  getSeasons,
  getTeam,
} from "@/lib/db";
import { makeInitialGameState } from "@/lib/game-engine";
import type { Player, Possession, Season } from "@/lib/types";

export default function NewGamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: teamId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const initialSeasonParam = searchParams.get("season");

  const [teamName, setTeamName] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(initialSeasonParam);

  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [firstPossession, setFirstPossession] =
    useState<Possession>("team");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load team, season list, and pick a default season if none came via URL.
  const loadShell = useCallback(async () => {
    setLoading(true);
    try {
      const [team, list] = await Promise.all([
        getTeam(supabase, teamId),
        getSeasons(supabase, teamId),
      ]);
      if (team) setTeamName(team.name);
      setSeasons(list);
      if (!seasonId) {
        const active = await getActiveSeason(supabase, teamId);
        if (active) {
          setSeasonId(active.id);
        } else if (list.length > 0) {
          setSeasonId(list[0].id);
        }
      } else {
        // Validate the supplied season belongs to this team.
        const found = list.find((s) => s.id === seasonId);
        if (!found) {
          const active = await getActiveSeason(supabase, teamId);
          setSeasonId(active?.id ?? list[0]?.id ?? null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, teamId]);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  // Whenever the active season changes, reload its players.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!seasonId) {
        setPlayers([]);
        setSelected(new Set());
        return;
      }
      try {
        const list = await getPlayers(supabase, teamId, seasonId);
        if (cancelled) return;
        const active = (list as Player[]).filter((p) => p.active);
        setPlayers(active);
        setSelected(new Set(active.map((p) => p.id)));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load roster",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, teamId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!opponent.trim() || selected.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const roster = players
        .filter((p) => selected.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, number: p.number }));
      const state = makeInitialGameState(
        roster,
        firstPossession,
        teamName,
        opponent.trim(),
      );
      const game = await createGame(
        supabase,
        teamId,
        seasonId,
        opponent.trim(),
        new Date(`${gameDate}T12:00:00`).toISOString(),
        state,
      );
      router.push(`/teams/${teamId}/games/${game.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game");
      setCreating(false);
    }
  }

  const backHref = seasonId
    ? `/teams/${teamId}/seasons/${seasonId}`
    : `/teams/${teamId}`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <Link
            href={backHref}
            className="text-sm text-blue-100 underline"
          >
            ← {teamName || "Team"}
          </Link>
          <h1 className="mt-2 text-3xl font-bold">New Game</h1>
          <p className="text-blue-100">Set up a new game and start tracking.</p>
        </div>

        {loading ? (
          <p className="rounded-2xl bg-white p-6 text-center shadow">
            Loading roster…
          </p>
        ) : (
          <form
            onSubmit={handleStart}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Season
              </label>
              {seasons.length === 0 ? (
                <div className="rounded-xl bg-yellow-50 p-4 text-sm text-yellow-800">
                  No seasons yet.{" "}
                  <Link
                    href={`/teams/${teamId}`}
                    className="underline"
                  >
                    Create one first
                  </Link>
                  .
                </div>
              ) : (
                <select
                  value={seasonId ?? ""}
                  onChange={(e) => setSeasonId(e.target.value || null)}
                  className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
                >
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                      {s.is_active ? " (active)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Opponent
              </label>
              <input
                type="text"
                required
                autoFocus
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="Opponent team name"
                className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Game date
              </label>
              <input
                type="date"
                required
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                First possession
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFirstPossession("team")}
                  className={`rounded-xl py-3 font-bold ${
                    firstPossession === "team"
                      ? "bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {teamName || "Your team"}
                </button>
                <button
                  type="button"
                  onClick={() => setFirstPossession("opponent")}
                  className={`rounded-xl py-3 font-bold ${
                    firstPossession === "opponent"
                      ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {opponent || "Opponent"}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Roster for this game ({selected.size} of {players.length})
              </label>
              {players.length === 0 ? (
                <div className="rounded-xl bg-yellow-50 p-4 text-sm text-yellow-800">
                  No active players in this season.{" "}
                  {seasonId ? (
                    <Link
                      href={`/teams/${teamId}/roster?season=${seasonId}`}
                      className="underline"
                    >
                      Add players first
                    </Link>
                  ) : (
                    <Link
                      href={`/teams/${teamId}/roster`}
                      className="underline"
                    >
                      Add players first
                    </Link>
                  )}
                  .
                </div>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
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
                        className="flex items-center gap-3 rounded-xl bg-gray-50 p-3"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          className="h-5 w-5"
                        />
                        <span className="font-semibold">
                          #{p.number} {p.name}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <Link
                href={backHref}
                className="rounded-xl bg-gray-200 py-4 text-center font-bold text-gray-700"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={
                  creating ||
                  !opponent.trim() ||
                  selected.size === 0 ||
                  players.length === 0 ||
                  !seasonId
                }
                className="rounded-xl bg-gradient-to-r from-green-600 to-green-700 py-4 font-bold text-white shadow-lg disabled:opacity-50"
              >
                {creating ? "Starting…" : "Start Game"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
