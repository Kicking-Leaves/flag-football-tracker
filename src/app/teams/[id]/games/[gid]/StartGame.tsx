"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startGame } from "@/lib/db";
import { makeInitialGameState } from "@/lib/game-engine";
import { GAME_TYPE_LABELS, type GameType, type Player, type Possession } from "@/lib/types";

/** A scheduled game: confirm who's playing and who has the ball first, then score. */
export default function StartGame({
  teamId,
  gameId,
  teamName,
  opponentName,
  gameDate,
  gameType,
  players,
  backHref,
}: {
  teamId: string;
  gameId: string;
  teamName: string;
  opponentName: string;
  gameDate: string;
  gameType: GameType;
  players: Player[];
  backHref: string;
}) {
  const router = useRouter();
  const sorted = useMemo(
    () =>
      players
        .filter((p) => p.active)
        .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name)),
    [players],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sorted.map((p) => p.id)));
  const [firstPossession, setFirstPossession] = useState<Possession | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start() {
    if (!firstPossession || selected.size === 0) return;
    setStarting(true);
    setError(null);
    try {
      const roster = sorted
        .filter((p) => selected.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, number: p.number }));
      const state = makeInitialGameState(roster, firstPossession, teamName, opponentName);
      await startGame(createClient(), gameId, state);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the game.");
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 p-4">
      <div className="mx-auto max-w-2xl">
        <Link href={backHref} className="text-sm text-blue-600 underline">
          ← {teamName}
        </Link>
        <div className="mt-3 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-2xl">
          <p className="text-sm text-blue-100">
            {new Date(gameDate).toLocaleDateString()} · {GAME_TYPE_LABELS[gameType]}
          </p>
          <h1 className="mt-1 text-3xl font-bold">vs {opponentName}</h1>
          <p className="mt-1 text-blue-100">Not started yet</p>
        </div>

        <section className="mt-4 rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-3 text-xl font-bold text-gray-800">Who starts on offense?</h2>
          <div className="grid grid-cols-2 gap-3">
            {(["team", "opponent"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFirstPossession(p)}
                className={`rounded-xl py-4 font-bold ${
                  firstPossession === p
                    ? p === "team"
                      ? "bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg"
                      : "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {p === "team" ? teamName : opponentName}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowRoster((v) => !v)}
              className="text-sm font-semibold text-blue-700 underline"
            >
              Playing today: {selected.size} of {sorted.length} {showRoster ? "(hide)" : "(change)"}
            </button>
            {sorted.length === 0 && (
              <p className="mt-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
                No active players on this season&apos;s roster. Add players first.
              </p>
            )}
            {showRoster && (
              <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {sorted.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
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

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={start}
            disabled={starting || !firstPossession || selected.size === 0}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-green-600 to-green-700 py-4 text-lg font-bold text-white shadow-lg disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start Scoring"}
          </button>
          {!firstPossession && (
            <p className="mt-2 text-center text-xs text-gray-500">Pick who starts on offense.</p>
          )}
        </section>

        <p className="mt-4 text-center text-sm">
          <Link href={`/teams/${teamId}/games/${gameId}/stats`} className="text-gray-600 underline">
            Game details
          </Link>
        </p>
      </div>
    </main>
  );
}
