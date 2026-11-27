"use client";

import { useState } from "react";
import CSVExport from "@/components/game/CSVExport";
import { SEASON_SCOPE_LABELS, type SeasonScope } from "@/lib/types";

export interface SeasonExportOption {
  scope: SeasonScope;
  csv: string;
  filename: string;
  games: number;
}

/** Download team + player stats for the regular season, postseason or full season. */
export default function SeasonExport({
  options,
  title,
}: {
  options: SeasonExportOption[];
  title: string;
}) {
  const [scope, setScope] = useState<SeasonScope>("full");
  const current = options.find((o) => o.scope === scope) ?? options[0];

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.scope}
            type="button"
            onClick={() => setScope(o.scope)}
            className={`rounded-xl px-1 py-3 text-sm font-bold ${
              scope === o.scope
                ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {SEASON_SCOPE_LABELS[o.scope]}
            <span className="block text-xs font-semibold opacity-80">
              {o.games} {o.games === 1 ? "game" : "games"}
            </span>
          </button>
        ))}
      </div>
      {current.games === 0 ? (
        <p className="text-sm text-gray-500">
          No completed {SEASON_SCOPE_LABELS[current.scope].toLowerCase()} games yet.
        </p>
      ) : (
        <CSVExport
          csv={current.csv}
          filename={current.filename}
          emailSubject={`${title}: ${SEASON_SCOPE_LABELS[current.scope]} stats`}
          emailBody={`${title} — ${SEASON_SCOPE_LABELS[current.scope]} stats\n\n${current.csv}`}
        />
      )}
      <p className="mt-3 text-xs text-gray-500">
        Team and player stats. Full season is regular season plus postseason.
        Scrimmages aren&apos;t included; export a scrimmage from its game page.
      </p>
    </div>
  );
}
