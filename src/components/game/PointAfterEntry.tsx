"use client";

import { useState } from "react";
import type { PointAfterData, RosterEntry } from "@/lib/types";

interface PointAfterEntryProps {
  scoringTeam: "team" | "opponent";
  roster: RosterEntry[];
  onSubmit: (data: PointAfterData) => void;
}

/** Point-after-touchdown entry. 1pt always succeeds; 2pt can fail. */
export default function PointAfterEntry({
  scoringTeam,
  roster,
  onSubmit,
}: PointAfterEntryProps) {
  const [type, setType] = useState<1 | 2>(1);
  const [success, setSuccess] = useState(true);
  const [playType, setPlayType] = useState<"pass" | "run">("run");
  const [passer, setPasser] = useState("");
  const [receiver, setReceiver] = useState("");
  const [rusher, setRusher] = useState("");

  const showRoster = scoringTeam === "team" && type === 2;
  const sorted = [...roster].sort(
    (a, b) =>
      Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
  );

  function handleSubmit() {
    onSubmit({
      type,
      success: type === 1 ? true : success,
      playType: type === 2 ? playType : undefined,
      passer: type === 2 && playType === "pass" ? passer || null : null,
      receiver:
        type === 2 && playType === "pass" && success ? receiver || null : null,
      rusher: type === 2 && playType === "run" ? rusher || null : null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">POINT AFTER</p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setType(1)}
            className={`rounded-xl py-4 font-bold ${
              type === 1 ? "bg-yellow-500 text-white" : "bg-gray-100"
            }`}
          >
            1-Point Kick
          </button>
          <button
            type="button"
            onClick={() => setType(2)}
            className={`rounded-xl py-4 font-bold ${
              type === 2 ? "bg-green-500 text-white" : "bg-gray-100"
            }`}
          >
            2-Point Try
          </button>
        </div>

        {type === 2 && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPlayType("run")}
                className={`rounded-xl py-3 font-bold ${
                  playType === "run" ? "bg-blue-600 text-white" : "bg-gray-100"
                }`}
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => setPlayType("pass")}
                className={`rounded-xl py-3 font-bold ${
                  playType === "pass" ? "bg-blue-600 text-white" : "bg-gray-100"
                }`}
              >
                Pass
              </button>
            </div>

            {showRoster && (
              <div className="mb-4 space-y-2">
                {playType === "pass" && (
                  <>
                    <select
                      value={passer}
                      onChange={(e) => setPasser(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold"
                    >
                      <option value="">Passer</option>
                      {sorted.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.number} {p.name}
                        </option>
                      ))}
                    </select>
                    {success && (
                      <select
                        value={receiver}
                        onChange={(e) => setReceiver(e.target.value)}
                        className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold"
                      >
                        <option value="">Receiver</option>
                        {sorted.map((p) => (
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
                    value={rusher}
                    onChange={(e) => setRusher(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold"
                  >
                    <option value="">Rusher</option>
                    {sorted.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.number} {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

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
          </>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        className="w-full rounded-2xl bg-purple-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        Record Point After
      </button>
    </div>
  );
}
