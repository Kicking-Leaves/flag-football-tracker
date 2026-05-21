"use client";

import { useEffect, useState } from "react";
import type { GameState, PlayData, RosterEntry } from "@/lib/types";

interface PlayEntryProps {
  state: GameState;
  roster: RosterEntry[];
  onSubmit: (play: PlayData) => void;
}

type PlayType = "pass" | "run" | "punt";

type Players = {
  passer: string;
  receiver: string;
  rusher: string;
  defender: string;
};

type Flags = {
  complete: boolean;
  firstDown: boolean;
  touchdown: boolean;
  interception: boolean;
  flagPull: boolean;
  safety: boolean;
  passDeflection: boolean;
};

const offenseFlagDefaults: Flags = {
  complete: true,
  firstDown: false,
  touchdown: false,
  interception: false,
  flagPull: false,
  safety: false,
  passDeflection: false,
};

const defenseFlagDefaults: Flags = {
  ...offenseFlagDefaults,
  flagPull: true, // Defense default = flag pull (common case).
};

/** Live play entry form. Mirrors the recordPlay logic from app.jsx. */
export default function PlayEntry({ state, roster, onSubmit }: PlayEntryProps) {
  const isOffense = state.possession === "team";
  const [playType, setPlayType] = useState<PlayType>("pass");
  const [yards, setYards] = useState(0);
  const [players, setPlayers] = useState<Players>({
    passer: "",
    receiver: "",
    rusher: "",
    defender: "",
  });
  const [flags, setFlags] = useState<Flags>(
    isOffense ? offenseFlagDefaults : defenseFlagDefaults,
  );
  const [lastPasser, setLastPasser] = useState("");
  const [lastRusher, setLastRusher] = useState("");

  // When possession flips, reset flag defaults appropriately.
  useEffect(() => {
    setFlags(isOffense ? offenseFlagDefaults : defenseFlagDefaults);
    setPlayers((prev) => ({
      ...prev,
      passer: isOffense ? lastPasser : "",
      receiver: "",
      rusher: isOffense ? lastRusher : "",
      defender: "",
    }));
    setYards(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffense]);

  const sortedRoster = [...roster].sort(
    (a, b) =>
      Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
  );

  function quickYards(delta: number) {
    setYards((y) => Math.max(-20, Math.min(60, y + delta)));
  }

  function handleSubmit() {
    if (playType === "punt") {
      onSubmit({
        possession: state.possession,
        playType: "punt",
        isPunt: true,
        yards: 0,
      });
      return;
    }

    // Auto-detect first down if yards gained >= yardsToGo.
    const autoFirstDown =
      yards >= state.yardsToGo && state.yardsToGo > 0;

    const playData: PlayData = {
      possession: state.possession,
      playType,
      yards,
      complete: playType === "pass" ? flags.complete : true,
      firstDown: flags.firstDown || autoFirstDown,
      touchdown: flags.touchdown,
      interception: flags.interception,
      flagPull: flags.flagPull,
      safety: flags.safety,
      passDeflection: flags.passDeflection,
      passer: playType === "pass" ? players.passer || null : null,
      receiver:
        playType === "pass" && flags.complete ? players.receiver || null : null,
      rusher: playType === "run" ? players.rusher || null : null,
      defender: !isOffense ? players.defender || null : null,
    };

    onSubmit(playData);

    // Remember last passer / rusher for offense convenience.
    if (playType === "pass" && players.passer) setLastPasser(players.passer);
    if (playType === "run" && players.rusher) setLastRusher(players.rusher);

    // Reset entry form. (Possession flips happen via useEffect when state changes.)
    setYards(0);
    setPlayers({
      passer: isOffense ? players.passer : "",
      receiver: "",
      rusher: isOffense ? players.rusher : "",
      defender: "",
    });
    setFlags(isOffense ? offenseFlagDefaults : defenseFlagDefaults);
  }

  return (
    <div className="space-y-4">
      {/* Play type */}
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">PLAY TYPE</p>
        <div className="grid grid-cols-3 gap-3">
          {(["pass", "run", "punt"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPlayType(t)}
              className={`rounded-xl py-4 font-bold capitalize ${
                playType === t
                  ? t === "pass"
                    ? "bg-blue-500 text-white"
                    : t === "run"
                      ? "bg-green-500 text-white"
                      : "bg-orange-500 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Players */}
      {playType !== "punt" && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">PLAYERS</p>
          {isOffense ? (
            <div className="space-y-3">
              {playType === "pass" && (
                <>
                  <select
                    value={players.passer}
                    onChange={(e) =>
                      setPlayers({ ...players, passer: e.target.value })
                    }
                    className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select Passer</option>
                    {sortedRoster.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.number} {p.name}
                      </option>
                    ))}
                  </select>
                  {flags.complete && (
                    <select
                      value={players.receiver}
                      onChange={(e) =>
                        setPlayers({ ...players, receiver: e.target.value })
                      }
                      className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
                    >
                      <option value="">Select Receiver</option>
                      {sortedRoster.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.number} {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {playType === "run" && (
                <select
                  value={players.rusher}
                  onChange={(e) =>
                    setPlayers({ ...players, rusher: e.target.value })
                  }
                  className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-green-500 focus:outline-none"
                >
                  <option value="">Select Rusher</option>
                  {sortedRoster.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.number} {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <select
              value={players.defender}
              onChange={(e) =>
                setPlayers({ ...players, defender: e.target.value })
              }
              className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-purple-500 focus:outline-none"
            >
              <option value="">Select Defender</option>
              {sortedRoster.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Yards */}
      {playType !== "punt" && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">YARDS</p>
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => quickYards(-5)}
              className="flex-shrink-0 rounded-xl bg-red-500 px-4 py-3 font-bold text-white"
            >
              -5
            </button>
            <button
              type="button"
              onClick={() => quickYards(-1)}
              className="flex-shrink-0 rounded-xl bg-red-400 px-4 py-3 font-bold text-white"
            >
              -1
            </button>
            <input
              type="number"
              value={yards}
              onChange={(e) => setYards(parseInt(e.target.value) || 0)}
              className="min-w-0 flex-1 rounded-xl border-2 px-2 py-3 text-center text-2xl font-bold"
            />
            <button
              type="button"
              onClick={() => quickYards(1)}
              className="flex-shrink-0 rounded-xl bg-green-400 px-4 py-3 font-bold text-white"
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => quickYards(5)}
              className="flex-shrink-0 rounded-xl bg-green-500 px-4 py-3 font-bold text-white"
            >
              +5
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[10, 15, 20, 25, 30, 40].map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setYards(y)}
                className="rounded-lg bg-gray-100 py-2 font-semibold"
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Outcome flags */}
      {playType !== "punt" && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">OUTCOME</p>
          <div className="grid grid-cols-2 gap-3">
            {playType === "pass" && isOffense && (
              <button
                type="button"
                onClick={() =>
                  setFlags({ ...flags, complete: !flags.complete })
                }
                className={`rounded-xl py-3 font-bold ${
                  flags.complete ? "bg-green-500 text-white" : "bg-red-500 text-white"
                }`}
              >
                {flags.complete ? "✓ Complete" : "✗ Incomplete"}
              </button>
            )}
            {!isOffense && (
              <button
                type="button"
                onClick={() => setFlags({ ...flags, flagPull: !flags.flagPull })}
                className={`rounded-xl py-3 font-bold ${
                  flags.flagPull ? "bg-purple-600 text-white" : "bg-gray-100"
                }`}
              >
                Flag Pull
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setFlags({ ...flags, firstDown: !flags.firstDown })
              }
              className={`rounded-xl py-3 font-bold ${
                flags.firstDown ? "bg-yellow-500 text-white" : "bg-gray-100"
              }`}
            >
              1st Down
            </button>
            <button
              type="button"
              onClick={() => {
                const newTD = !flags.touchdown;
                setFlags({
                  ...flags,
                  touchdown: newTD,
                  flagPull: !isOffense && newTD ? false : flags.flagPull,
                });
              }}
              className={`rounded-xl py-3 font-bold ${
                flags.touchdown ? "bg-green-600 text-white" : "bg-gray-100"
              }`}
            >
              Touchdown
            </button>
            {isOffense && (
              <button
                type="button"
                onClick={() =>
                  setFlags({ ...flags, interception: !flags.interception })
                }
                className={`rounded-xl py-3 font-bold ${
                  flags.interception ? "bg-red-600 text-white" : "bg-gray-100"
                }`}
              >
                Interception
              </button>
            )}
            {isOffense && (
              <button
                type="button"
                onClick={() => setFlags({ ...flags, safety: !flags.safety })}
                className={`rounded-xl py-3 font-bold ${
                  flags.safety ? "bg-purple-600 text-white" : "bg-gray-100"
                }`}
              >
                Safety
              </button>
            )}
            {!isOffense && (
              <button
                type="button"
                onClick={() => {
                  const newInt = !flags.interception;
                  setFlags({
                    ...flags,
                    interception: newInt,
                    flagPull: newInt ? false : flags.flagPull,
                  });
                }}
                className={`rounded-xl py-3 font-bold ${
                  flags.interception ? "bg-blue-600 text-white" : "bg-gray-100"
                }`}
              >
                Interception
              </button>
            )}
            {!isOffense && playType === "pass" && (
              <button
                type="button"
                onClick={() =>
                  setFlags({ ...flags, passDeflection: !flags.passDeflection })
                }
                className={`rounded-xl py-3 font-bold ${
                  flags.passDeflection ? "bg-orange-600 text-white" : "bg-gray-100"
                }`}
              >
                Pass Deflection
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        className="w-full rounded-2xl bg-blue-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        {playType === "punt" ? "Record Punt" : "Record Play"}
      </button>
    </div>
  );
}
