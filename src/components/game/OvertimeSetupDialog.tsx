"use client";

import type { Possession } from "@/lib/types";

interface OvertimeSetupDialogProps {
  teamName: string;
  opponentName: string;
  onSelect: (firstOffense: Possession) => void;
}

export default function OvertimeSetupDialog({
  teamName,
  opponentName,
  onSelect,
}: OvertimeSetupDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-4 text-center text-2xl font-bold">OVERTIME</h3>
        <p className="mb-6 text-center text-lg">
          Game tied! Which team starts on offense?
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onSelect("team")}
            className="w-full rounded-xl bg-green-600 py-5 text-xl font-bold text-white shadow-lg"
          >
            {teamName}
          </button>
          <button
            type="button"
            onClick={() => onSelect("opponent")}
            className="w-full rounded-xl bg-blue-600 py-5 text-xl font-bold text-white shadow-lg"
          >
            {opponentName}
          </button>
        </div>
      </div>
    </div>
  );
}
