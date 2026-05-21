"use client";

import { useState } from "react";

interface InterceptionDialogProps {
  onSubmit: (data: { isTD: boolean; fieldPos: number }) => void;
}

export default function InterceptionDialog({
  onSubmit,
}: InterceptionDialogProps) {
  const [isTD, setIsTD] = useState(false);
  const [fieldPos, setFieldPos] = useState(20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-4 text-2xl font-bold">Interception Return</h3>
        <p className="mb-6 text-lg">Was it returned for a touchdown?</p>

        <div className="mb-6 space-y-3">
          <button
            type="button"
            onClick={() => setIsTD(true)}
            className={`w-full rounded-xl py-4 text-lg font-bold ${
              isTD ? "bg-green-600 text-white" : "bg-gray-100"
            }`}
          >
            ✓ Touchdown on Return
          </button>
          <button
            type="button"
            onClick={() => setIsTD(false)}
            className={`w-full rounded-xl py-4 text-lg font-bold ${
              !isTD ? "bg-blue-600 text-white" : "bg-gray-100"
            }`}
          >
            No Touchdown
          </button>
        </div>

        {!isTD && (
          <div className="mb-6">
            <label className="mb-3 block text-sm font-bold">
              Starting field position
            </label>
            <div className="mb-3 flex gap-3">
              <button
                type="button"
                onClick={() => setFieldPos(Math.max(0, fieldPos - 5))}
                className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
              >
                -5
              </button>
              <input
                type="number"
                value={fieldPos}
                onChange={(e) =>
                  setFieldPos(
                    Math.max(0, Math.min(51, parseInt(e.target.value) || 0)),
                  )
                }
                className="flex-1 rounded-xl border-2 px-4 py-3 text-center text-2xl font-bold"
              />
              <button
                type="button"
                onClick={() => setFieldPos(Math.min(51, fieldPos + 5))}
                className="rounded-lg bg-gray-300 px-4 py-2 font-bold"
              >
                +5
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 20, 25, 30, 35, 40, 45].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFieldPos(p)}
                  className="rounded-lg bg-gray-100 py-2 font-semibold"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => onSubmit({ isTD, fieldPos })}
          className="w-full rounded-xl bg-blue-600 py-4 text-lg font-bold text-white"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
