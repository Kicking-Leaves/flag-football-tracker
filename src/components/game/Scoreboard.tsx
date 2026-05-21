"use client";

import type { GameState } from "@/lib/types";

interface ScoreboardProps {
  state: GameState;
  teamName: string;
  opponentName: string;
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return "4th";
}

export default function Scoreboard({
  state,
  teamName,
  opponentName,
}: ScoreboardProps) {
  const isOffense = state.possession === "team";
  const target = state.firstDownTarget;
  const targetLabel = target >= 51 ? "END" : String(target);

  const halfLabel =
    state.half === "OT"
      ? `OT-${state.overtimeRound}`
      : `${state.half === 1 ? "1st" : "2nd"} Half`;

  return (
    <div className="mb-4 rounded-2xl bg-white p-6 shadow-xl">
      <div className="grid grid-cols-3 items-center gap-3">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-500">
            {teamName}
          </p>
          <p className="text-5xl font-bold text-green-600">{state.score.team}</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-400">
            {halfLabel}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-gray-500">
            {opponentName}
          </p>
          <p className="text-5xl font-bold text-blue-600">
            {state.score.opponent}
          </p>
        </div>
      </div>

      {!state.awaitingOvertimeConversion && !state.completed && (
        <div className="mt-4 rounded-xl bg-gray-800 p-4 text-center text-white">
          <p className="text-sm text-gray-300">
            Possession:{" "}
            <span className="font-bold text-yellow-400">
              {isOffense ? teamName : opponentName}
            </span>
          </p>
          <p className="mt-1 text-2xl font-bold">
            {ordinal(state.down)} & {state.yardsToGo}
          </p>
          <p className="mt-1 text-sm text-gray-300">
            Ball on {state.lineOfScrimmage} → 1st: {targetLabel}
          </p>
        </div>
      )}
    </div>
  );
}
