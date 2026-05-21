"use client";

import { useState } from "react";
import type { OTConversionData } from "@/lib/types";

interface OvertimeConversionEntryProps {
  teamName: string;
  opponentName: string;
  possession: "team" | "opponent";
  round: number;
  onSubmit: (data: OTConversionData) => void;
}

/** WIAA-style OT conversion: 1pt from 5yd OR 2pt from 10yd. */
export default function OvertimeConversionEntry({
  teamName,
  opponentName,
  possession,
  round,
  onSubmit,
}: OvertimeConversionEntryProps) {
  const [type, setType] = useState<1 | 2>(1);
  const [success, setSuccess] = useState(true);

  const offenseName = possession === "team" ? teamName : opponentName;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-500 p-6 text-white shadow-xl">
        <h3 className="mb-2 text-center text-2xl font-bold">OT Round {round}</h3>
        <p className="text-center">{offenseName} on Offense</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setType(1)}
            className={`rounded-xl py-4 font-bold ${
              type === 1 ? "bg-yellow-500 text-white" : "bg-gray-100"
            }`}
          >
            1-Point (from 5)
          </button>
          <button
            type="button"
            onClick={() => setType(2)}
            className={`rounded-xl py-4 font-bold ${
              type === 2 ? "bg-green-500 text-white" : "bg-gray-100"
            }`}
          >
            2-Point (from 10)
          </button>
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
