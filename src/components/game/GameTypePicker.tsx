"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateGameType } from "@/lib/db";
import { GAME_TYPES, GAME_TYPE_LABELS, type GameType } from "@/lib/types";

/** Lets scorers change a game between scrimmage, regular season and postseason. */
export default function GameTypePicker({ gameId, value }: { gameId: string; value: GameType }) {
  const router = useRouter();
  const [current, setCurrent] = useState<GameType>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: GameType) {
    const previous = current;
    setCurrent(next);
    setSaving(true);
    setError(null);
    try {
      await updateGameType(createClient(), gameId, next);
      router.refresh();
    } catch {
      setCurrent(previous);
      setError("Couldn't change the game type.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <label className="flex items-center gap-2 text-sm text-purple-100">
        Game type
        <select
          value={current}
          disabled={saving}
          onChange={(e) => void change(e.target.value as GameType)}
          className="rounded-lg bg-white px-2 py-1 text-sm font-semibold text-gray-800 disabled:opacity-60"
        >
          {GAME_TYPES.map((t) => (
            <option key={t} value={t}>
              {GAME_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="mt-1 text-xs text-yellow-200">{error}</p>}
    </div>
  );
}
