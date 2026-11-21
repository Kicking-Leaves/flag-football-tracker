"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyRosterImport, type RosterEntryWithTeam } from "@/lib/db";
import {
  parseRosterText,
  planRosterImport,
  rosterTemplateCsv,
  summarizePlan,
  type PlannedRosterRow,
  type RosterImportAction,
} from "@/lib/roster-import";
import type { Athlete, Player } from "@/lib/types";

interface RosterImportProps {
  teamId: string;
  seasonId: string;
  seasonName: string;
  /** Null when the team isn't assigned to a school (no athlete matching). */
  schoolName: string | null;
  roster: Player[];
  athletes: Athlete[];
  /** Roster entries on the school's teams, for "on Varsity #12" hints. */
  schoolEntries: RosterEntryWithTeam[];
  onImported: () => Promise<void> | void;
}

function downloadTemplate() {
  const blob = new Blob([rosterTemplateCsv()], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roster-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Encode an action as a <select> value and back. */
function actionValue(a: RosterImportAction): string {
  switch (a.kind) {
    case "link":
      return `link:${a.athleteId}`;
    case "update":
      return `update:${a.playerId}`;
    default:
      return a.kind;
  }
}
function parseActionValue(v: string): RosterImportAction {
  if (v.startsWith("link:")) return { kind: "link", athleteId: v.slice(5) };
  if (v.startsWith("update:")) return { kind: "update", playerId: v.slice(7) };
  return { kind: v as "create" | "skip" };
}

/**
 * Upload a CSV or paste rows from a spreadsheet, preview how each row maps onto
 * this season's roster, then import.
 */
export default function RosterImport({
  teamId,
  seasonId,
  seasonName,
  schoolName,
  roster,
  athletes,
  schoolEntries,
  onImported,
}: RosterImportProps) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  /** Per-line overrides of the planned action. */
  const [overrides, setOverrides] = useState<Record<number, RosterImportAction>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const plan: PlannedRosterRow[] = useMemo(() => {
    if (!text.trim()) return [];
    const planned = planRosterImport(parseRosterText(text).rows, { roster, athletes });
    return planned.map((r) =>
      overrides[r.line] ? { ...r, action: overrides[r.line] } : r,
    );
  }, [text, roster, athletes, overrides]);
  const summary = summarizePlan(plan);
  const toImport = summary.create + summary.link + summary.update;

  /** "JV #4 (Fall 2026)" for each team an athlete is already on. */
  function whereElse(athleteId: string): string {
    return schoolEntries
      .filter((e) => e.athlete_id === athleteId && e.team_id !== teamId)
      .map((e) => `${e.team_name} #${e.number}${e.season_name ? ` (${e.season_name})` : ""}`)
      .join(", ");
  }

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setOverrides({});
    setText(await file.text());
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const r = await applyRosterImport(supabase, teamId, seasonId, plan);
      const parts = [
        r.created && `${r.created} added`,
        r.linked && `${r.linked} linked from other teams`,
        r.updated && `${r.updated} updated`,
      ].filter(Boolean);
      setDone(`Imported: ${parts.join(", ") || "nothing to change"}.`);
      setText("");
      setOverrides({});
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      // Rows before the failure were saved; refresh so the preview reflects them.
      await onImported();
    } finally {
      setImporting(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-4 rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Upload roster</h2>
            <p className="text-sm text-gray-600">
              CSV file, or paste rows from Google Sheets or Excel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setDone(null);
            }}
            className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"
          >
            Upload
          </button>
        </div>
        {done && <p className="mt-3 text-sm font-semibold text-green-700">{done}</p>}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-white p-5 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-800">
          Upload roster to {seasonName}
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setOverrides({});
            setError(null);
          }}
          className="text-sm font-semibold text-gray-500 underline"
        >
          Cancel
        </button>
      </div>

      <p className="mb-3 text-sm text-gray-600">
        Columns: <strong>Number, Name</strong>, and optionally Grad Year,
        Offense, Defense, Notes. A header row is recommended; without one,
        columns are read in that order.{" "}
        <button
          type="button"
          onClick={downloadTemplate}
          className="font-semibold text-blue-700 underline"
        >
          Download template
        </button>
      </p>
      {!schoolName && (
        <p className="mb-3 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900">
          This team isn&apos;t assigned to a school, so players won&apos;t be
          linked to the same athletes on your other teams. Set a school on the
          team dashboard first if you want that.
        </p>
      )}

      <label className="mb-2 block">
        <span className="sr-only">Roster CSV file</span>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="block w-full text-sm"
        />
      </label>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOverrides({});
          setDone(null);
        }}
        placeholder={"Number\tName\tGrad Year\tOffense\tDefense\n7\tAva Martinez\t2027\tQB\tS"}
        rows={6}
        className="w-full rounded-xl border-2 border-gray-300 p-3 font-mono text-sm"
        aria-label="Paste roster rows"
      />

      {plan.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-sm font-semibold text-gray-700">
            {summary.create} new · {summary.link} from {schoolName ?? "school"} ·{" "}
            {summary.update} updates · {summary.skip} skipped
          </p>
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
            {plan.map((row) => (
              <li
                key={row.line}
                className={`rounded-xl p-3 text-sm ${
                  row.action.kind === "skip" ? "bg-gray-100 opacity-70" : "bg-gray-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold">
                      {row.number ? `#${row.number} ` : ""}
                      {row.name || "(no name)"}
                    </span>
                    <span className="text-gray-500">
                      {row.graduation_year ? ` · ${row.graduation_year}` : ""}
                      {row.position_offense || row.position_defense
                        ? ` · ${row.position_offense ?? "—"} / ${row.position_defense ?? "—"}`
                        : ""}
                      {` · line ${row.line}`}
                    </span>
                  </div>
                  {row.errors.length > 0 ? (
                    <span className="font-semibold text-red-600">Skipped</span>
                  ) : (
                    <select
                      value={actionValue(row.action)}
                      onChange={(e) =>
                        setOverrides((o) => ({
                          ...o,
                          [row.line]: parseActionValue(e.target.value),
                        }))
                      }
                      className="rounded-lg border-2 border-gray-300 px-2 py-1 text-sm font-semibold"
                      aria-label={`Action for ${row.name}`}
                    >
                      {row.existingPlayer && (
                        <option value={`update:${row.existingPlayer.id}`}>
                          Update #{row.existingPlayer.number} on this roster
                        </option>
                      )}
                      {row.candidates.map((a) => {
                        const where = whereElse(a.id);
                        return (
                          <option key={a.id} value={`link:${a.id}`}>
                            Same person{where ? ` as ${where}` : ` (${a.name})`}
                          </option>
                        );
                      })}
                      <option value="create">New player</option>
                      <option value="skip">Skip</option>
                    </select>
                  )}
                </div>
                {[...row.errors, ...row.warnings].map((m, i) => (
                  <p
                    key={i}
                    className={`mt-1 text-xs ${
                      row.errors.includes(m) ? "text-red-600" : "text-yellow-800"
                    }`}
                  >
                    {m}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleImport}
        disabled={importing || toImport === 0}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 py-4 font-bold text-white shadow disabled:opacity-50"
      >
        {importing
          ? "Importing…"
          : toImport === 0
            ? "Nothing to import"
            : `Import ${toImport} player${toImport === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
