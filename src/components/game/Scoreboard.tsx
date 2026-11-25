"use client";

import type { GameState } from "@/lib/types";
import { scorebugFromGameState } from "@/lib/scorebug";

interface ScoreboardProps {
  state: GameState;
  teamName: string;
  opponentName: string;
}

export default function Scoreboard({
  state,
  teamName,
  opponentName,
}: ScoreboardProps) {
  // Same formatter the stream overlay uses, so the two can't disagree.
  const bug = scorebugFromGameState(state, teamName, opponentName);

  return (
    <div className="mb-4 rounded-2xl bg-white p-6 shadow-xl">
      <div className="grid grid-cols-3 items-center gap-3">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-500">
            {bug.teamName}
          </p>
          <p className="text-5xl font-bold text-green-600">{bug.teamScore}</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-400">
            {bug.periodLabel}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-500">
            {bug.opponentName}
          </p>
          <p className="text-5xl font-bold text-blue-600">
            {bug.opponentScore}
          </p>
        </div>
      </div>

      {bug.downLabel && (
        <div className="mt-4 rounded-xl bg-gray-800 p-4 text-center text-white">
          <p className="text-sm text-gray-300">
            Possession:{" "}
            <span className="font-bold text-yellow-400">
              {bug.possession === "team" ? bug.teamName : bug.opponentName}
            </span>
          </p>
          <p className="mt-1 text-2xl font-bold">{bug.downLabel}</p>
          <p className="mt-1 text-sm text-gray-300">{bug.fieldLabel}</p>
        </div>
      )}
    </div>
  );
}
