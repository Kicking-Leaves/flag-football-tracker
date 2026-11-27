"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createGame,
  getActiveSeason,
  getMyTeamRole,
  getSeasons,
  getTeam,
} from "@/lib/db";
import { makeInitialGameState } from "@/lib/game-engine";
import type { GameType, Season } from "@/lib/types";
import { GAME_TYPES, GAME_TYPE_LABELS } from "@/lib/types";
import { can } from "@/lib/permissions";

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
  const [gameType, setGameType] = useState<GameType>("regular");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load team, season list, and pick a default season if none came via URL.
  const loadShell = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [team, list, role] = await Promise.all([
        getTeam(supabase, teamId),
        getSeasons(supabase, teamId),
        user ? getMyTeamRole(supabase, teamId, user.id) : Promise.resolve(null),
      ]);
      // Only admins, coaches and stat keepers create games.
      if (!can(role, "createGame")) {
        router.replace(`/teams/${teamId}`);
        return;
      }
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!opponent.trim()) return;
    setCreating(true);
    setError(null);
    try {
      // The game-day roster and first possession are set when scoring starts.
      const state = makeInitialGameState([], "team", teamName, opponent.trim());
      await createGame(
        supabase,
        teamId,
        seasonId,
        opponent.trim(),
        new Date(`${gameDate}T12:00:00`).toISOString(),
        state,
        gameType,
      );
      router.push(seasonId ? `/teams/${teamId}/seasons/${seasonId}` : `/teams/${teamId}`);
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
          <p className="text-blue-100">
            Add a game to the schedule. Start scoring from the season page on game day.
          </p>
        </div>

        {loading ? (
          <p className="rounded-2xl bg-white p-6 text-center shadow">
            Loading roster…
          </p>
        ) : (
          <form
            onSubmit={handleCreate}
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
                Game type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {GAME_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGameType(t)}
                    className={`rounded-xl px-1 py-3 text-sm font-bold ${
                      gameType === t
                        ? "bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {GAME_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              {gameType === "scrimmage" && (
                <p className="mt-2 text-sm text-gray-600">
                  Scrimmage stats don&apos;t count toward season stats.
                </p>
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
                disabled={creating || !opponent.trim() || !seasonId}
                className="rounded-xl bg-gradient-to-r from-green-600 to-green-700 py-4 font-bold text-white shadow-lg disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create Game"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
