"use client";

import { useState } from "react";
import type { OTConversionData, TryPoints } from "@/lib/types";

interface OvertimeConversionEntryProps {
  teamName: string;
  opponentName: string;
  possession: "team" | "opponent";
  round: number;
  onSubmit: (data: OTConversionData) => void;
}

/**
 * WIAA-style OT conversion: 1pt (pass only) from the 5, 2pt from the 10, or
 * 3pt from the 17.
 */
const OT_OPTIONS: {
  type: TryPoints;
  label: string;
  detail: string;
  active: string;
}[] = [
  { type: 1, label: "1-Point", detail: "from 5 (pass)", active: "bg-yellow-500" },
  { type: 2, label: "2-Point", detail: "from 10", active: "bg-green-500" },
  { type: 3, label: "3-Point", detail: "from 17", active: "bg-blue-500" },
];

export default function OvertimeConversionEntry({
  teamName,
  opponentName,
  possession,
  round,
  onSubmit,
}: OvertimeConversionEntryProps) {
  const [type, setType] = useState<TryPoints>(1);
  const [success, setSuccess] = useState(true);

  const offenseName = possession === "team" ? teamName : opponentName;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-500 p-6 text-white shadow-xl">
        <h3 className="mb-2 text-center text-2xl font-bold">OT Round {round}</h3>
        <p className="text-center">{offenseName} on Offense</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 grid grid-cols-3 gap-3">
          {OT_OPTIONS.map((o) => (
            <button
              key={o.type}
              type="button"
              onClick={() => setType(o.type)}
              className={`rounded-xl py-3 font-bold leading-tight ${
                type === o.type ? `${o.active} text-white` : "bg-gray-100"
              }`}
            >
              {o.label}
              <span className="block text-xs font-semibold opacity-80">
                {o.detail}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSuccess(true)}
            className={`rounded-xl py-3 font-bold ${
              success ? "bg-green-600 text-white" : "bg-gray-100"
            }`}
          >
            ✓ Success
          </button>
          <button
            type="button"
            onClick={() => setSuccess(false)}
            className={`rounded-xl py-3 font-bold ${
              !success ? "bg-red-600 text-white" : "bg-gray-100"
            }`}
          >
            ✗ Failed
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit({ type, success })}
        className="w-full rounded-2xl bg-orange-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        Record Conversion
      </button>
    </div>
  );
}
