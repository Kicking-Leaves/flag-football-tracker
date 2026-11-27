"use client";

import { useState } from "react";
import type { PenaltyData } from "@/lib/types";
import {
  OTHER_PENALTY,
  enforcedYards,
  findPenalty,
  penaltiesFor,
  type PenaltySide,
} from "@/lib/penalties";

interface PenaltyEntryProps {
  /** Ball spot (yards from the offense's goal line), for half-the-distance. */
  lineOfScrimmage: number;
  /** Start from an existing penalty (play-by-play edits). */
  initial?: Partial<PenaltyData>;
  submitLabel?: string;
  onSubmit: (data: PenaltyData) => void;
}

type DownEffect = "replay" | "lossOfDown" | "firstDown";

export default function PenaltyEntry({
  lineOfScrimmage,
  initial,
  submitLabel = "Record Penalty",
  onSubmit,
}: PenaltyEntryProps) {
  const [side, setSide] = useState<PenaltySide>(initial?.onOffense === false ? "defense" : "offense");
  const [code, setCode] = useState(initial?.penaltyCode ?? "");
  const [otherName, setOtherName] = useState(initial?.penaltyName ?? "");
  const [yards, setYards] = useState(initial?.yards ?? 5);
  const [effect, setEffect] = useState<DownEffect>(
    initial?.automaticFirstDown ? "firstDown" : initial?.lossOfDown ? "lossOfDown" : "replay",
  );
  const [note, setNote] = useState<string | null>(null);

  function pick(nextSide: PenaltySide, nextCode: string) {
    setSide(nextSide);
    setCode(nextCode);
    const def = findPenalty(nextCode);
    if (!def) {
      setNote(null);
      return;
    }
    const enforced = enforcedYards(def.yards, def.side, lineOfScrimmage);
    setYards(enforced.yards);
    setEffect(def.automaticFirstDown ? "firstDown" : def.lossOfDown ? "lossOfDown" : "replay");
    setNote(
      enforced.halfDistance
        ? `${def.yards} yards, half the distance to the goal: ${enforced.yards}.`
        : `${def.yards} yards${def.lossOfDown ? ", loss of down" : ""}${
            def.automaticFirstDown ? ", automatic first down" : ""
          }.`,
    );
  }

  function changeSide(next: PenaltySide) {
    if (next === side) return;
    // Penalty names differ by side; clear the pick.
    setSide(next);
    setCode("");
    setNote(null);
    setEffect("replay");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">PENALTY</p>

        <div className="mb-4">
          <p className="mb-2 text-sm font-bold text-gray-700">Penalty on:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => changeSide("offense")}
              className={`rounded-xl py-3 font-bold ${
                side === "offense" ? "bg-red-600 text-white" : "bg-gray-100"
              }`}
            >
              Offense
            </button>
            <button
              type="button"
              onClick={() => changeSide("defense")}
              className={`rounded-xl py-3 font-bold ${
                side === "defense" ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              Defense
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-bold text-gray-700">
            Penalty (optional)
          </label>
          <select
            value={code}
            onChange={(e) => pick(side, e.target.value)}
            className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 font-semibold focus:border-red-500 focus:outline-none"
          >
            <option value="">Not specified</option>
            {penaltiesFor(side).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.yards})
              </option>
            ))}
            <option value={OTHER_PENALTY}>Other…</option>
          </select>
          {code === OTHER_PENALTY && (
            <input
              type="text"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              placeholder="What was called"
              maxLength={60}
              className="mt-2 w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:border-red-500 focus:outline-none"
            />
          )}
          {note && <p className="mt-2 text-sm text-gray-600">{note}</p>}
        </div>

        <div className="mb-4">
          <p className="mb-2 text-sm font-bold text-gray-700">Penalty yards:</p>
          <div className="mb-3 flex gap-3">
            <button
              type="button"
              onClick={() => setYards(Math.max(0, yards - 1))}
              className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
            >
              -1
            </button>
            <input
              type="number"
              value={yards}
              onChange={(e) => setYards(Math.max(0, parseInt(e.target.value) || 0))}
              className="min-w-0 flex-1 rounded-xl border-2 px-4 py-3 text-center text-2xl font-bold"
            />
            <button
              type="button"
              onClick={() => setYards(yards + 1)}
              className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
            >
              +1
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[5, 10, 15].map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setYards(enforcedYards(y, side, lineOfScrimmage).yards)}
                className="rounded-lg bg-gray-100 py-2 font-semibold"
              >
                {y}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            From the ball on the {lineOfScrimmage}. For a spot foul, adjust the yards.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-gray-700">Down:</p>
          <div className={`grid gap-3 ${side === "defense" ? "grid-cols-2" : "grid-cols-2"}`}>
            <button
              type="button"
              onClick={() => setEffect("replay")}
              className={`rounded-xl py-3 font-bold ${
                effect === "replay" ? "bg-yellow-600 text-white" : "bg-gray-100"
              }`}
            >
              Replay Down
            </button>
            {side === "offense" ? (
              <button
                type="button"
                onClick={() => setEffect("lossOfDown")}
                className={`rounded-xl py-3 font-bold ${
                  effect === "lossOfDown" ? "bg-orange-600 text-white" : "bg-gray-100"
                }`}
              >
                Loss of Down
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEffect("firstDown")}
                className={`rounded-xl py-3 font-bold ${
                  effect === "firstDown" ? "bg-green-600 text-white" : "bg-gray-100"
                }`}
              >
                Automatic 1st Down
              </button>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onSubmit({
            yards,
            onOffense: side === "offense",
            lossOfDown: side === "offense" && effect === "lossOfDown",
            automaticFirstDown: side === "defense" && effect === "firstDown",
            ...(code ? { penaltyCode: code } : {}),
            ...(code === OTHER_PENALTY && otherName.trim() ? { penaltyName: otherName.trim() } : {}),
          })
        }
        className="w-full rounded-2xl bg-red-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        {submitLabel}
      </button>
    </div>
  );
}
