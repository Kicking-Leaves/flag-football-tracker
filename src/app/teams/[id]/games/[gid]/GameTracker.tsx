"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveGameState, deleteGame } from "@/lib/db";
import { useGameReducer } from "@/hooks/useGameReducer";
import Scoreboard from "@/components/game/Scoreboard";
import PlayEntry from "@/components/game/PlayEntry";
import PointAfterEntry from "@/components/game/PointAfterEntry";
import PenaltyEntry from "@/components/game/PenaltyEntry";
import InterceptionDialog from "@/components/game/InterceptionDialog";
import OvertimeSetupDialog from "@/components/game/OvertimeSetupDialog";
import OvertimeConversionEntry from "@/components/game/OvertimeConversionEntry";
import type { GameState, Possession } from "@/lib/types";

interface GameTrackerProps {
  teamId: string;
  gameId: string;
  teamName: string;
  opponentName: string;
  gameDate: string;
  initialState: GameState;
}

type Mode = "normal" | "pointAfter" | "penalty";

export default function GameTracker({
  teamId,
  gameId,
  teamName,
  opponentName,
  initialState,
}: GameTrackerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const persistState = useCallback(
    async (next: GameState) => {
      await saveGameState(supabase, gameId, next);
    },
    [supabase, gameId],
  );

  const game = useGameReducer(initialState, { onSave: persistState });
  const { state } = game;

  // Player-side touchdown detection. After a TD, the engine keeps the field
  // state put; we surface a "Point After" mode to the user.
  const lastPlay = state.plays[state.plays.length - 1];
  const lastWasTD =
    lastPlay &&
    lastPlay.touchdown &&
    !lastPlay.isPointAfter &&
    !lastPlay.isOvertimeConversion;
  const needsPointAfter =
    lastWasTD && !state.completed && !state.isOvertime;

  const [mode, setMode] = useState<Mode>("normal");
  const [showSettings, setShowSettings] = useState(false);
  const [showEndHalfDialog, setShowEndHalfDialog] = useState(false);
  const [endHalfReceiver, setEndHalfReceiver] = useState<Possession>("team");
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Active mode resolves to pointAfter if a TD just happened.
  const activeMode: Mode = needsPointAfter ? "pointAfter" : mode;
  const possessionAtTD: "team" | "opponent" =
    lastPlay?.possession ?? state.possession;

  function handleEndGame() {
    if (state.half === 1) {
      setShowEndHalfDialog(true);
      return;
    }

    // If tied at end of regulation → enter OT setup.
    if (state.half === 2 && state.score.team === state.score.opponent) {
      game.triggerOTSetup();
      return;
    }

    // Otherwise mark completed.
    game.markCompleted();
    router.push(`/teams/${teamId}/games/${gameId}/stats`);
  }

  async function handleDeleteGame() {
    try {
      await deleteGame(supabase, gameId);
      router.push(`/teams/${teamId}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to delete game.");
    }
  }

  const roster = state.roster ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-green-50 to-blue-50 pb-28">
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <Link
            href={`/teams/${teamId}`}
            className="text-sm text-blue-600 underline"
          >
            ← {teamName}
          </Link>
          {state.completed && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
              GAME COMPLETED
            </span>
          )}
        </div>

        <Scoreboard
          state={state}
          teamName={teamName}
          opponentName={opponentName}
        />

        {/* Pending dialogs / blocking states */}
        {state.awaitingOvertimeSetup && (
          <OvertimeSetupDialog
            teamName={teamName}
            opponentName={opponentName}
            onSelect={(first) => game.startOvertime(first)}
          />
        )}

        {state.awaitingInterceptionInfo && (
          <InterceptionDialog
            onSubmit={({ isTD, fieldPos }) => {
              game.handleInterception({ isTD, fieldPos });
            }}
          />
        )}

        {/* Overtime conversion is its own input mode. */}
        {state.awaitingOvertimeConversion ? (
          <OvertimeConversionEntry
            teamName={teamName}
            opponentName={opponentName}
            possession={state.possession}
            round={state.overtimeRound}
            onSubmit={(data) => {
              game.handleOTConversion(data);
              if (state.completed) {
                router.push(`/teams/${teamId}/games/${gameId}/stats`);
              }
            }}
          />
        ) : state.completed ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-xl">
            <p className="mb-2 text-3xl font-bold text-gray-800">Final</p>
            <p className="mb-4 text-xl">
              {teamName} {state.score.team} - {opponentName}{" "}
              {state.score.opponent}
            </p>
            <Link
              href={`/teams/${teamId}/games/${gameId}/stats`}
              className="inline-block rounded-xl bg-purple-600 px-6 py-3 font-bold text-white shadow"
            >
              View Stats →
            </Link>
          </div>
        ) : (
          <>
            {/* Mode selector — hidden during forced point-after. */}
            {!needsPointAfter && (
              <div className="mb-4 rounded-2xl bg-white p-4 shadow-xl">
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode("normal")}
                    className={`rounded-xl py-4 font-bold ${
                      activeMode === "normal"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100"
                    }`}
                  >
                    Regular Play
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("pointAfter")}
                    className={`rounded-xl py-4 font-bold ${
                      activeMode === "pointAfter"
                        ? "bg-purple-600 text-white"
                        : "bg-gray-100"
                    }`}
                  >
                    Point After
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("penalty")}
                    className={`rounded-xl py-4 font-bold ${
                      activeMode === "penalty"
                        ? "bg-red-600 text-white"
                        : "bg-gray-100"
                    }`}
                  >
                    Penalty
                  </button>
                </div>
              </div>
            )}

            {activeMode === "normal" && (
              <PlayEntry
                state={state}
                roster={roster}
                onSubmit={(play) => game.addPlay(play)}
              />
            )}
            {activeMode === "pointAfter" && (
              <PointAfterEntry
                scoringTeam={possessionAtTD}
                roster={roster}
                onSubmit={(data) => {
                  game.recordPointAfter(data);
                  setMode("normal");
                }}
              />
            )}
            {activeMode === "penalty" && (
              <PenaltyEntry
                onSubmit={(data) => {
                  game.recordPenalty(data);
                  setMode("normal");
                }}
              />
            )}
          </>
        )}
      </div>

      {/* End-half dialog */}
      {showEndHalfDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-2xl font-bold">End 1st Half</h3>
            <p className="mb-6 text-lg">Which team receives the ball?</p>
            <div className="mb-4 space-y-3">
              <button
                type="button"
                onClick={() => setEndHalfReceiver("team")}
                className={`w-full rounded-xl py-4 text-lg font-bold ${
                  endHalfReceiver === "team"
                    ? "bg-green-600 text-white"
                    : "bg-gray-100"
                }`}
              >
                {teamName}
              </button>
              <button
                type="button"
                onClick={() => setEndHalfReceiver("opponent")}
                className={`w-full rounded-xl py-4 text-lg font-bold ${
                  endHalfReceiver === "opponent"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100"
                }`}
              >
                {opponentName}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowEndHalfDialog(false)}
                className="rounded-xl bg-gray-600 py-3 font-bold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  game.endHalf(endHalfReceiver);
                  setShowEndHalfDialog(false);
                }}
                className="rounded-xl bg-orange-600 py-3 font-bold text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo confirm */}
      {showUndoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-2xl font-bold text-orange-600">
              Undo last play?
            </h3>
            <p className="mb-6 text-lg">
              This will reverse all stats and restore the previous state.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowUndoConfirm(false)}
                className="rounded-xl bg-gray-600 py-4 font-bold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  game.undoLastPlay();
                  setShowUndoConfirm(false);
                }}
                className="rounded-xl bg-orange-600 py-4 font-bold text-white"
              >
                Yes, Undo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-6 text-2xl font-bold">Game Settings</h3>
            <div className="space-y-4">
              <div>
                <p className="mb-3 font-bold">Adjust Score</p>
                <div className="space-y-2">
                  <ScoreAdjuster
                    label={teamName}
                    value={state.score.team}
                    onChange={(amt) => game.adjustScore("team", amt)}
                  />
                  <ScoreAdjuster
                    label={opponentName}
                    value={state.score.opponent}
                    onChange={(amt) => game.adjustScore("opponent", amt)}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSettings(false);
                  setShowDeleteConfirm(true);
                }}
                className="w-full rounded-xl bg-red-100 py-3 font-bold text-red-700"
              >
                Delete this game
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="w-full rounded-xl bg-gray-600 py-3 font-bold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-2xl font-bold text-red-600">
              Delete this game?
            </h3>
            <p className="mb-6 text-lg">
              All plays, stats, and scores for this game will be permanently
              removed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-xl bg-gray-600 py-4 font-bold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteGame}
                className="rounded-xl bg-red-600 py-4 font-bold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav (always present during active gameplay) */}
      {!state.completed && (
        <div className="fixed bottom-0 left-0 right-0 grid grid-cols-4 gap-3 border-t-2 bg-white p-4">
          <button
            type="button"
            onClick={() => setShowUndoConfirm(true)}
            disabled={state.plays.length === 0}
            className="rounded-xl bg-orange-600 py-3 font-bold text-white disabled:opacity-50"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded-xl bg-gray-600 py-3 font-bold text-white"
          >
            Settings
          </button>
          <Link
            href={`/teams/${teamId}/games/${gameId}/stats`}
            className="rounded-xl bg-purple-600 py-3 text-center font-bold text-white"
          >
            Stats
          </Link>
          <button
            type="button"
            onClick={handleEndGame}
            className="rounded-xl bg-red-600 py-3 font-bold text-white"
          >
            {state.half === 1 ? "End Half" : "End Game"}
          </button>
        </div>
      )}
    </main>
  );
}

function ScoreAdjuster({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (delta: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
      <span className="font-semibold">{label}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(-1)}
          className="h-10 w-10 rounded-lg bg-red-500 font-bold text-white"
        >
          -
        </button>
        <span className="w-12 text-center text-xl font-bold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(1)}
          className="h-10 w-10 rounded-lg bg-green-500 font-bold text-white"
        >
          +
        </button>
      </div>
    </div>
  );
}
