"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { describePlayType, describeResult } from "@/lib/csv";
import { GAME_TYPE_LABELS, type GameType, type Play, type RosterEntry } from "@/lib/types";

/** One row of rr_game_audit. */
interface AuditRow {
  id: number;
  game_id: string;
  team_id: string | null;
  team_name: string | null;
  game_label: string | null;
  actor_id: string | null;
  actor_email: string | null;
  at: string;
  action: string;
  details: {
    score_before?: { team: number; opponent: number };
    score_after?: { team: number; opponent: number };
    added?: { index: number; entry: Play }[];
    removed?: { index: number; entry: Play }[];
    changed?: { index: number; before: Play; after: Play }[];
    meta?: Record<string, [unknown, unknown]>;
    opponent?: string;
    game_date?: string;
    game_type?: GameType;
    status?: string;
    score?: { team: number; opponent: number };
  };
}

export const AUDIT_ACTIONS: Record<string, string> = {
  play_recorded: "Recorded a play",
  play_undone: "Undid a play",
  play_edited: "Edited a play",
  play_deleted: "Deleted a play",
  play_inserted: "Inserted a play",
  plays_changed: "Changed plays",
  game_created: "Created the game",
  game_started: "Started scoring",
  game_completed: "Ended the game",
  game_reopened: "Reopened the game",
  game_details_changed: "Changed game details",
  game_deleted: "Deleted the game",
};

const PAGE = 50;

// Keys the engine fills in for every entry; differences in them aren't edits.
const IGNORED_KEYS = new Set(["id", "recordedAt", "down", "yardsToGo", "lineOfScrimmage", "firstDownTarget", "half"]);
const PLAYER_KEYS = new Set(["passer", "receiver", "rusher", "defender"]);

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function fmtValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export default function ChangeLog({
  gameId,
  teams,
  showGame = true,
}: {
  /** Only this game's changes (the game's Change history page). */
  gameId?: string;
  /** Teams to filter by (site admin log). */
  teams?: { id: string; name: string }[];
  showGame?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [rosters, setRosters] = useState<Record<string, Record<string, RosterEntry>>>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hideRecorded, setHideRecorded] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      let q = supabase.from("rr_game_audit").select("*").order("at", { ascending: false }).range(offset, offset + PAGE - 1);
      if (gameId) q = q.eq("game_id", gameId);
      if (teamId) q = q.eq("team_id", teamId);
      if (action) q = q.eq("action", action);
      else if (hideRecorded) q = q.neq("action", "play_recorded");
      if (actor.trim()) q = q.ilike("actor_email", `%${actor.trim()}%`);
      if (from) q = q.gte("at", new Date(`${from}T00:00:00`).toISOString());
      if (to) q = q.lt("at", new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString());
      const { data, error } = await q;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const page = (data ?? []) as AuditRow[];
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setMore(page.length === PAGE);
      setLoading(false);

      // Player names for the games on this page.
      const ids = [...new Set(page.map((r) => r.game_id))];
      if (ids.length) {
        const { data: games } = await supabase.from("rr_games").select("id, roster:game_data->roster").in("id", ids);
        const next: Record<string, Record<string, RosterEntry>> = {};
        for (const g of (games ?? []) as { id: string; roster: RosterEntry[] | null }[]) {
          next[g.id] = Object.fromEntries((g.roster ?? []).map((p) => [p.id, p]));
        }
        setRosters((prev) => ({ ...prev, ...next }));
      }
    },
    [supabase, gameId, teamId, action, actor, from, to, hideRecorded],
  );

  useEffect(() => {
    // Debounce typing in the email filter.
    const t = setTimeout(() => void load(0), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-4 grid gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-3">
        {teams && (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All changes</option>
          {Object.entries(AUDIT_ACTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="Who (email)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={hideRecorded} onChange={(e) => setHideRecorded(e.target.checked)} disabled={Boolean(action)} />
          Only corrections (hide plays recorded live)
        </label>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="rounded-xl bg-white p-6 text-center text-gray-500 shadow-sm">No changes match.</p>
      )}

      <ol className="space-y-2">
        {rows.map((r) => (
          <AuditItem key={r.id} row={r} roster={rosters[r.game_id] ?? {}} showGame={showGame} />
        ))}
      </ol>

      {more && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(rows.length)}
          className="mt-4 w-full rounded-xl bg-white py-3 font-bold text-gray-700 shadow-sm disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
      {loading && rows.length === 0 && <p className="text-center text-gray-500">Loading…</p>}
    </div>
  );
}

function AuditItem({ row: r, roster, showGame }: { row: AuditRow; roster: Record<string, RosterEntry>; showGame: boolean }) {
  const who = (id: unknown) => {
    if (typeof id !== "string" || !id) return "—";
    const p = roster[id];
    return p ? `#${p.number} ${p.name}` : "(player)";
  };
  const names = { team: r.team_name ?? "Team", opponent: (r.game_label ?? "").replace(/^vs /, "").split(" · ")[0] || "Opponent" };
  const line = (e: Play) => {
    const result = describeResult(e, names);
    const yards = ["pass", "run"].includes(e.playType) && !(e.sack && e.sackType === "coverage") ? ` ${e.yards >= 0 ? "+" : ""}${e.yards} yds` : "";
    const people = ["passer", "receiver", "rusher", "defender"]
      .filter((k) => e[k as keyof Play])
      .map((k) => `${k} ${who(e[k as keyof Play])}`)
      .join(", ");
    return `${describePlayType(e)}${yards}${result ? ` — ${result}` : ""}${people ? ` (${people})` : ""}`;
  };
  const d = r.details;
  const scoreChanged =
    d.score_before && d.score_after &&
    (d.score_before.team !== d.score_after.team || d.score_before.opponent !== d.score_after.opponent);

  return (
    <li className="rounded-xl bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold text-gray-900">{AUDIT_ACTIONS[r.action] ?? r.action}</p>
        <p className="text-xs text-gray-500">{fmtTime(r.at)}</p>
      </div>
      <p className="text-xs text-gray-600">
        {r.actor_email ?? "System"}
        {showGame && (
          <>
            {" · "}
            {r.team_name ?? "Team"} {r.game_label ?? ""}
            {r.team_id && r.action !== "game_deleted" && (
              <>
                {" · "}
                <Link href={`/teams/${r.team_id}/games/${r.game_id}/history`} className="underline">
                  game history
                </Link>
              </>
            )}
          </>
        )}
      </p>

      <div className="mt-2 space-y-1 text-gray-800">
        {d.added?.map((a) => (
          <p key={`a${a.index}`}>
            <span className="font-semibold text-green-700">+ #{a.index + 1}</span> {line(a.entry)}
          </p>
        ))}
        {d.removed?.map((a) => (
          <p key={`r${a.index}`}>
            <span className="font-semibold text-red-700">− #{a.index + 1}</span> <span className="line-through decoration-red-300">{line(a.entry)}</span>
          </p>
        ))}
        {d.changed?.map((c) => {
          const keys = [...new Set([...Object.keys(c.before), ...Object.keys(c.after)])].filter(
            (k) => !IGNORED_KEYS.has(k) && JSON.stringify(c.before[k as keyof Play]) !== JSON.stringify(c.after[k as keyof Play]),
          );
          return (
            <div key={`c${c.index}`}>
              <p>
                <span className="font-semibold text-blue-700">✎ #{c.index + 1}</span> {line(c.after)}
              </p>
              <ul className="ml-6 list-disc text-xs text-gray-600">
                {keys.map((k) => (
                  <li key={k}>
                    {k}:{" "}
                    {PLAYER_KEYS.has(k)
                      ? `${who(c.before[k as keyof Play])} → ${who(c.after[k as keyof Play])}`
                      : `${fmtValue(c.before[k as keyof Play])} → ${fmtValue(c.after[k as keyof Play])}`}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {d.meta &&
          Object.entries(d.meta).map(([k, [before, after]]) => (
            <p key={k} className="text-gray-700">
              {k === "game_type"
                ? `Game type: ${GAME_TYPE_LABELS[before as GameType] ?? before} → ${GAME_TYPE_LABELS[after as GameType] ?? after}`
                : k === "status"
                  ? `Status: ${fmtValue(before)} → ${fmtValue(after)}`
                  : k === "game_date"
                    ? `Date: ${new Date(String(before)).toLocaleDateString()} → ${new Date(String(after)).toLocaleDateString()}`
                    : k === "roster"
                      ? `Game roster: ${fmtValue(before)} → ${fmtValue(after)} players`
                      : `${k}: ${fmtValue(before)} → ${fmtValue(after)}`}
            </p>
          ))}
        {r.action === "game_created" && (
          <p className="text-gray-700">
            vs {d.opponent} · {d.game_type ? GAME_TYPE_LABELS[d.game_type] : ""}
          </p>
        )}
        {r.action === "game_deleted" && d.score && (
          <p className="text-gray-700">
            Final state {d.score.team}-{d.score.opponent} ({d.status}). The full game is kept in this log entry.
          </p>
        )}
        {scoreChanged && (
          <p className="text-xs font-semibold text-gray-600">
            Score {d.score_before!.team}-{d.score_before!.opponent} → {d.score_after!.team}-{d.score_after!.opponent}
          </p>
        )}
      </div>
    </li>
  );
}
