import type { PlayerStats } from "@/lib/types";

interface StatsTableProps {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

export default function StatsTable({ title, headers, rows }: StatsTableProps) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl bg-white p-6 shadow-xl">
      <h3 className="mb-4 text-xl font-bold text-gray-800">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              {headers.map((h) => (
                <th key={h} className="p-3 text-left font-bold text-gray-700">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-100">
                {row.map((cell, j) => (
                  <td key={j} className="p-3 font-semibold">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Convenience row builders ----------

export function passingRows(
  players: PlayerStats[],
): (string | number)[][] {
  return players
    .filter((p) => p.offense.passAttempts > 0)
    .map((p) => [
      `#${p.number} ${p.name}`,
      p.offense.completions,
      p.offense.passAttempts,
      p.offense.passingYards,
      p.offense.touchdowns,
      p.offense.interceptions,
    ]);
}

export function rushingRows(
  players: PlayerStats[],
): (string | number)[][] {
  return players
    .filter((p) => p.offense.rushAttempts > 0)
    .map((p) => [
      `#${p.number} ${p.name}`,
      p.offense.rushAttempts,
      p.offense.rushingYards,
      p.offense.touchdowns,
    ]);
}

export function receivingRows(
  players: PlayerStats[],
): (string | number)[][] {
  return players
    .filter((p) => p.offense.receptions > 0)
    .map((p) => [
      `#${p.number} ${p.name}`,
      p.offense.receptions,
      p.offense.receivingYards,
      p.offense.touchdowns,
    ]);
}

export function defenseRows(
  players: PlayerStats[],
): (string | number)[][] {
  return players
    .filter(
      (p) =>
        p.defense.flagPulls > 0 ||
        p.defense.interceptions > 0 ||
        p.defense.tacklesForLoss > 0 ||
        p.defense.passDeflections > 0,
    )
    .map((p) => [
      `#${p.number} ${p.name}`,
      p.defense.flagPulls,
      p.defense.tacklesForLoss,
      p.defense.interceptions,
      p.defense.passDeflections,
    ]);
}
