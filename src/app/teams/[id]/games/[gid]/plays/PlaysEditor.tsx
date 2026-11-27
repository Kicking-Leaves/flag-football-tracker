"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveGameState } from "@/lib/db";
import { rebuildGame } from "@/lib/game-engine";
import PlayByPlay from "@/components/game/PlayByPlay";
import type { GameState, Play } from "@/lib/types";

/** Play-by-play for a finished game: edits rebuild the score and stats and save. */
export default function PlaysEditor({
  gameId,
  teamName,
  opponentName,
  initialState,
  canEdit,
}: {
  gameId: string;
  teamName: string;
  opponentName: string;
  initialState: GameState;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);

  async function onChange(entries: Play[]) {
    const next = rebuildGame(state, entries);
    await saveGameState(createClient(), gameId, next);
    setState(next);
    router.refresh();
  }

  return (
    <PlayByPlay
      state={state}
      teamName={teamName}
      opponentName={opponentName}
      canEdit={canEdit}
      onChange={onChange}
    />
  );
}
