"use client";

import { useState } from "react";
import type { PointAfterData, RosterEntry, TryPoints } from "@/lib/types";

interface PointAfterEntryProps {
  scoringTeam: "team" | "opponent";
  roster: RosterEntry[];
  onSubmit: (data: PointAfterData) => void;
}

/**
 * Point-after-touchdown entry (WIAA): automatic 1pt, or a 2pt try from the 10
 * or a 3pt try from the 17, which can fail.
 */
const TRY_OPTIONS: {
  type: TryPoints;
  label: string;
  detail: string;
  active: string;
}[] = [
  { type: 1, label: "1-Point", detail: "Automatic", active: "bg-yellow-500" },
  { type: 2, label: "2-Point", detail: "from the 10", active: "bg-green-500" },
  { type: 3, label: "3-Point", detail: "from the 17", active: "bg-blue-500" },
];

export default function PointAfterEntry({
  scoringTeam,
  roster,
  onSubmit,
}: PointAfterEntryProps) {
  const [type, setType] = useState<TryPoints>(1);
  const [success, setSuccess] = useState(true);
  const [playType, setPlayType] = useState<"pass" | "run">("run");
  const [passer, setPasser] = useState("");
  const [receiver, setReceiver] = useState("");
  const [rusher, setRusher] = useState("");

  const isTry = type !== 1;
  const showRoster = scoringTeam === "team" && isTry;
  const sorted = [...roster].sort(
    (a, b) =>
      Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
  );

  function handleSubmit() {
    onSubmit({
      type,
      success: type === 1 ? true : success,
      playType: isTry ? playType : undefined,
      passer: isTry && playType === "pass" ? passer || null : null,
      receiver:
        isTry && playType === "pass" && success ? receiver || null : null,
      rusher: isTry && playType === "run" ? rusher || null : null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">POINT AFTER</p>
        <div className="mb-4 grid grid-cols-3 gap-3">
          {TRY_OPTIONS.map((o) => (
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

        {isTry && (
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
