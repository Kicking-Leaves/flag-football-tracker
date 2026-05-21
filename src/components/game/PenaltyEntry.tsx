"use client";

import { useState } from "react";
import type { PenaltyData } from "@/lib/types";

interface PenaltyEntryProps {
  onSubmit: (data: PenaltyData) => void;
}

export default function PenaltyEntry({ onSubmit }: PenaltyEntryProps) {
  const [yards, setYards] = useState(5);
  const [onOffense, setOnOffense] = useState(true);
  const [lossOfDown, setLossOfDown] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">PENALTY</p>

        <div className="mb-4">
          <p className="mb-2 text-sm font-bold text-gray-700">Penalty on:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOnOffense(true)}
              className={`rounded-xl py-3 font-bold ${
                onOffense ? "bg-red-600 text-white" : "bg-gray-100"
              }`}
            >
              Offense
            </button>
            <button
              type="button"
              onClick={() => setOnOffense(false)}
              className={`rounded-xl py-3 font-bold ${
                !onOffense ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              Defense
            </button>
          </div>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-sm font-bold text-gray-700">Penalty yards:</p>
          <div className="mb-3 flex gap-3">
            <button
              type="button"
              onClick={() => setYards(Math.max(0, yards - 5))}
              className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
            >
              -5
            </button>
            <input
              type="number"
              value={yards}
              onChange={(e) =>
                setYards(Math.max(0, parseInt(e.target.value) || 0))
              }
              className="flex-1 rounded-xl border-2 px-4 py-3 text-center text-2xl font-bold"
            />
            <button
              type="button"
              onClick={() => setYards(yards + 5)}
              className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
            >
              +5
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[5, 10, 15].map((y) => (
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

        <div>
          <p className="mb-2 text-sm font-bold text-gray-700">Down status:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setLossOfDown(false)}
              className={`rounded-xl py-3 font-bold ${
                !lossOfDown ? "bg-yellow-600 text-white" : "bg-gray-100"
              }`}
            >
              Replay Down
            </button>
            <button
              type="button"
              onClick={() => setLossOfDown(true)}
              className={`rounded-xl py-3 font-bold ${
                lossOfDown ? "bg-orange-600 text-white" : "bg-gray-100"
              }`}
            >
              Loss of Down
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit({ yards, onOffense, lossOfDown })}
        className="w-full rounded-2xl bg-red-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        Record Penalty
      </button>
    </div>
  );
}
