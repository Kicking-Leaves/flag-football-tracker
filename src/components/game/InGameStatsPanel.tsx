"use client";

// Slide-over (drawer) overlay that shows live game stats during gameplay.
// Reads exclusively from the passed-in GameState — no Supabase calls — so the
// coach can pop it open mid-play without losing context.

import { useEffect, useMemo, useState } from "react";
import type { GameState, PlayerStats } from "@/lib/types";

type Tab = "passing" | "rushing" | "receiving" | "defense";

interface InGameStatsPanelProps {
  open: boolean;
  onClose: () => void;
  state: GameState;
  teamName: string;
  opponentName: string;
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return "4th";
}

function halfLabel(state: GameState): string {
  if (state.half === "OT") return `OT-${state.overtimeRound}`;
  return state.half === 1 ? "1st Half" : "2nd Half";
}

export default function InGameStatsPanel({
  open,
  onClose,
  state,
  teamName,
  opponentName,
}: InGameStatsPanelProps) {
  // Lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const playerList = useMemo(
    () => Object.values(state.playerStats ?? {}),
    [state.playerStats],
  );

  const availableTabs: Tab[] = useMemo(() => {
    const tabs: Tab[] = [];
    if (playerList.some((p) => p.offense.passAttempts > 0)) tabs.push("passing");
    if (playerList.some((p) => p.offense.rushAttempts > 0)) tabs.push("rushing");
    if (playerList.some((p) => p.offense.receptions > 0)) tabs.push("receiving");
    if (
      playerList.some(
        (p) =>
          p.defense.flagPulls > 0 ||
          p.defense.interceptions > 0 ||
          p.defense.tacklesForLoss > 0 ||
          p.defense.passDeflections > 0,
      )
    ) {
      tabs.push("defense");
    }
    return tabs;
  }, [playerList]);

  // Track the user's tab pick. If it's no longer in availableTabs (or null),
  // we fall back to the first available tab when rendering. Deriving rather
  // than syncing in an effect avoids cascading renders.
  const [tabOverride, setTabOverride] = useState<Tab | null>(null);
  const activeTab: Tab | null =
    tabOverride && availableTabs.includes(tabOverride)
      ? tabOverride
      : (availableTabs[0] ?? null);

  const off = state.stats.offense;
  const def = state.stats.defense;
  const completionPct =
    off.passAttempts > 0
      ? Math.round((off.completions / off.passAttempts) * 100)
      : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />

      {/* Slide-over panel from the right */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="In-game stats"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md transform flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Sticky header with score + situation */}
        <header className="border-b bg-gradient-to-r from-purple-600 to-blue-600 p-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-xs uppercase text-purple-100">
                {halfLabel(state)}
              </p>
              <p className="text-3xl font-bold">
                {state.score.team} - {state.score.opponent}
              </p>
              <p className="text-xs text-purple-100">
                {teamName} vs {opponentName}
              </p>
              {!state.completed && !state.awaitingOvertimeConversion && (
                <p className="mt-1 text-sm font-semibold text-yellow-300">
                  {ordinal(state.down)} & {state.yardsToGo} · Ball on{" "}
                  {state.lineOfScrimmage}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/20 px-3 py-2 text-sm font-bold text-white"
              aria-label="Close stats"
            >
              Close
            </button>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Team offense */}
          <section className="mb-4 rounded-2xl bg-white p-4 shadow">
            <h3 className="mb-3 text-base font-bold text-gray-800">
              Team Offense
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <KV label="Plays" value={off.totalPlays} />
              <KV label="1st Downs" value={off.firstDowns} />
              <KV label="Touchdowns" value={off.touchdowns} accent />
              <KV
                label="Yards"
                value={off.passingYards + off.rushingYards}
                accent
              />
              <KV label="Pass Yds" value={off.passingYards} />
              <KV label="Rush Yds" value={off.rushingYards} />
              <KV
                label="Cmp / Att"
                value={`${off.completions}/${off.passAttempts}`}
              />
              <KV
                label="Cmp %"
                value={off.passAttempts > 0 ? `${completionPct}%` : "—"}
              />
            </div>
          </section>

          {/* Team defense */}
          <section className="mb-4 rounded-2xl bg-white p-4 shadow">
            <h3 className="mb-3 text-base font-bold text-gray-800">
              Team Defense
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <KV label="Flag Pulls" value={def.flagPulls} />
              <KV label="INTs" value={def.interceptions} />
              <KV label="Forced Punts" value={def.forcedPunts} />
              <KV label="TOs on Downs" value={def.turnoversOnDowns} />
            </div>
          </section>

          {/* Player tabs */}
          <section className="rounded-2xl bg-white p-4 shadow">
            <h3 className="mb-3 text-base font-bold text-gray-800">
              Player Stats
            </h3>
            {availableTabs.length === 0 ? (
              <p className="text-sm text-gray-500">
                No player stats recorded yet.
              </p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  {availableTabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTabOverride(t)}
                      className={`rounded-lg px-3 py-2 text-sm font-bold capitalize ${
                        activeTab === t
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {activeTab === "passing" && (
                  <PlayerRows
                    players={playerList.filter(
                      (p) => p.offense.passAttempts > 0,
                    )}
                    headers={["Cmp", "Att", "Yds", "TD", "INT"]}
                    cells={(p) => [
                      p.offense.completions,
                      p.offense.passAttempts,
                      p.offense.passingYards,
                      p.offense.touchdowns,
                      p.offense.interceptions,
                    ]}
                  />
                )}
                {activeTab === "rushing" && (
                  <PlayerRows
                    players={playerList.filter(
                      (p) => p.offense.rushAttempts > 0,
                    )}
                    headers={["Att", "Yds"]}
                    cells={(p) => [
                      p.offense.rushAttempts,
                      p.offense.rushingYards,
                    ]}
                  />
                )}
                {activeTab === "receiving" && (
                  <PlayerRows
                    players={playerList.filter(
                      (p) => p.offense.receptions > 0,
                    )}
                    headers={["Rec", "Yds"]}
                    cells={(p) => [
                      p.offense.receptions,
                      p.offense.receivingYards,
                    ]}
                  />
                )}
                {activeTab === "defense" && (
                  <PlayerRows
                    players={playerList.filter(
                      (p) =>
                        p.defense.flagPulls > 0 ||
                        p.defense.interceptions > 0 ||
                        p.defense.tacklesForLoss > 0 ||
                        p.defense.passDeflections > 0,
                    )}
                    headers={["Flags", "TFL", "INT", "PD"]}
                    cells={(p) => [
                      p.defense.flagPulls,
                      p.defense.tacklesForLoss,
                      p.defense.interceptions,
                      p.defense.passDeflections,
                    ]}
                  />
                )}
              </>
            )}
          </section>
        </div>

        {/* Sticky footer close */}
        <footer className="border-t bg-white p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-gray-700 py-4 font-bold text-white"
          >
            Back to Game
          </button>
        </footer>
      </aside>
    </>
  );
}

function KV({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-2 ${
        accent
          ? "border border-green-400 bg-gradient-to-r from-green-50 to-blue-50"
          : "bg-gray-50"
      }`}
    >
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p
        className={`text-lg font-bold ${
          accent ? "text-green-700" : "text-gray-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

interface PlayerRowsProps {
  players: PlayerStats[];
  headers: string[];
  cells: (p: PlayerStats) => (number | string)[];
}

function PlayerRows({ players, headers, cells }: PlayerRowsProps) {
  if (players.length === 0) {
    return <p className="text-sm text-gray-500">No stats yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-left">
          <tr>
            <th className="p-2 font-bold text-gray-700">Player</th>
            {headers.map((h) => (
              <th key={h} className="p-2 text-right font-bold text-gray-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => {
            const row = cells(p);
            return (
              <tr key={i} className="border-b border-gray-100">
                <td className="p-2 font-semibold">
                  #{p.number} {p.name}
                </td>
                {row.map((v, j) => (
                  <td key={j} className="p-2 text-right font-semibold">
                    {v}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
