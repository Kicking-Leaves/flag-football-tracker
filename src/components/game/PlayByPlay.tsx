"use client";

import { useMemo, useState } from "react";
import type { GameState, Play, Possession, TryPoints } from "@/lib/types";
import { isMarker, replayTimeline } from "@/lib/game-engine";
import { describePlayType, describeResult } from "@/lib/csv";
import PlayEntry, { type PlayEntryResult } from "./PlayEntry";
import PenaltyEntry from "./PenaltyEntry";

interface PlayByPlayProps {
  state: GameState;
  teamName: string;
  opponentName: string;
  /** Scorers can edit, delete and insert entries. */
  canEdit: boolean;
  /** Called with the edited log; the caller rebuilds the game from it. */
  onChange?: (entries: Play[]) => void | Promise<void>;
}

type Editing = { index: number; entry: Play; isNew: boolean } | null;

const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];

function situation(e: Play): string {
  if (isMarker(e) || e.isPointAfter || e.isOvertimeConversion) return "";
  if (e.playType === "penalty") return `Now ${ORDINAL[e.down] ?? e.down} & ${e.yardsToGo} at the ${e.lineOfScrimmage}`;
  return `${ORDINAL[e.down] ?? e.down} & ${e.yardsToGo} at the ${e.lineOfScrimmage}`;
}

function clockTime(e: Play): string {
  // "2026-11-21T19:04:32.120-08:00" → "7:04 PM"
  if (!e.recordedAt) return "";
  const [hh, mm] = e.recordedAt.slice(11, 16).split(":").map(Number);
  if (Number.isNaN(hh)) return "";
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

function periodLabel(e: Play): string {
  return e.half === "OT" ? "OT" : e.half === 2 ? "2nd half" : e.half === 1 ? "1st half" : "";
}

/** Fields every logged entry keeps through an edit. */
function identity(e: Play): Partial<Play> {
  return {
    id: e.id,
    recordedAt: e.recordedAt,
    half: e.half,
    down: e.down,
    yardsToGo: e.yardsToGo,
    lineOfScrimmage: e.lineOfScrimmage,
    firstDownTarget: e.firstDownTarget,
  };
}

export default function PlayByPlay({ state, teamName, opponentName, canEdit, onChange }: PlayByPlayProps) {
  const entries = state.plays;
  const timeline = useMemo(() => replayTimeline(state), [state]);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = { team: teamName, opponent: opponentName };
  const sideName = (p?: Possession) => (p === "team" ? teamName : p === "opponent" ? opponentName : "");
  const players = state.playerStats ?? {};
  const who = (id?: string | null) => (id && players[id] ? `#${players[id].number} ${players[id].name}` : "");

  async function commit(next: Play[]) {
    if (!onChange) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the change.");
    } finally {
      setBusy(false);
    }
  }

  function save(entry: Play) {
    if (!editing) return;
    const next = entries.slice();
    if (editing.isNew) next.splice(editing.index, 0, entry);
    else next[editing.index] = entry;
    void commit(next);
  }

  function remove(index: number) {
    if (!confirm("Delete this entry? The score and stats will be recalculated.")) return;
    void commit(entries.filter((_, i) => i !== index));
  }

  function insertAfter(index: number) {
    const before = index >= 0 ? timeline[index] : null;
    const s = before ?? { possession: state.firstPossession ?? "team", down: 1, yardsToGo: 12, lineOfScrimmage: 5, firstDownTarget: 17, half: 1 as const };
    setEditing({
      index: index + 1,
      isNew: true,
      entry: {
        id: Date.now(),
        playType: "run",
        possession: s.possession,
        yards: 0,
        down: s.down,
        yardsToGo: s.yardsToGo,
        lineOfScrimmage: s.lineOfScrimmage,
        firstDownTarget: s.firstDownTarget,
        half: s.half,
      },
    });
  }

  const people = (e: Play) =>
    [
      e.passer && `Passer ${who(e.passer)}`,
      e.receiver && `Receiver ${who(e.receiver)}`,
      e.rusher && `Rusher ${who(e.rusher)}`,
      e.defender && `Defender ${who(e.defender)}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {entries.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-gray-500 shadow">
          No plays yet.
          {canEdit && (
            <button
              type="button"
              onClick={() => insertAfter(-1)}
              className="mt-3 block w-full rounded-lg bg-blue-50 py-2 text-sm font-bold text-blue-700"
            >
              + Add a play
            </button>
          )}
        </div>
      ) : (
        <ol className="space-y-2">
          {entries.map((e, i) => {
            const after = timeline[i];
            const marker = isMarker(e);
            const showPeriod = i === 0 || entries[i - 1].half !== e.half;
            return (
              <li key={`${e.id}-${i}`}>
                {showPeriod && !marker && (
                  <p className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-gray-500">{periodLabel(e)}</p>
                )}
                <div className={`rounded-xl p-3 shadow-sm ${marker ? "bg-gray-100" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">
                        #{i + 1}
                        {clockTime(e) && ` · ${clockTime(e)}`}
                        {!marker && e.possession && ` · ${sideName(e.possession)} ball`}
                        {situation(e) && ` · ${situation(e)}`}
                      </p>
                      <p className="font-bold text-gray-800">
                        {describePlayType(e)}
                        {!marker && e.playType !== "penalty" && !e.isPointAfter && !e.isOvertimeConversion && e.playType !== "punt" && e.playType !== "coverage_sack" && !(e.sack && e.sackType === "coverage")
                          ? ` · ${e.yards >= 0 ? "+" : ""}${e.yards} yds`
                          : ""}
                      </p>
                      {describeResult(e, names) && <p className="text-sm text-gray-700">{describeResult(e, names)}</p>}
                      {people(e) && <p className="text-xs text-gray-500">{people(e)}</p>}
                    </div>
                    <p className="whitespace-nowrap text-sm font-bold text-gray-700">
                      {after?.score.team ?? 0}-{after?.score.opponent ?? 0}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="mt-2 flex gap-2 text-xs font-bold">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing({ index: i, entry: e, isNew: false })}
                        className="rounded-lg bg-blue-50 px-3 py-1 text-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(i)}
                        className="rounded-lg bg-red-50 px-3 py-1 text-red-700"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => insertAfter(i)}
                        className="rounded-lg bg-gray-100 px-3 py-1 text-gray-700"
                      >
                        + Insert play after
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {editing && (
        <EntryEditor
          key={`${editing.entry.id}-${editing.index}`}
          editing={editing}
          state={state}
          beforeLos={editing.index > 0 ? timeline[editing.index - 1]?.lineOfScrimmage ?? 5 : 5}
          teamName={teamName}
          opponentName={opponentName}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function EntryEditor({
  editing,
  state,
  beforeLos,
  teamName,
  opponentName,
  busy,
  onCancel,
  onSave,
}: {
  editing: NonNullable<Editing>;
  state: GameState;
  beforeLos: number;
  teamName: string;
  opponentName: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (entry: Play) => void;
}) {
  const e = editing.entry;
  const [possession, setPossession] = useState<Possession>(e.possession ?? "team");
  const [attempt, setAttempt] = useState<TryPoints>(e.attempt ?? 2);
  const [success, setSuccess] = useState(e.success ?? true);
  const [points, setPoints] = useState(e.points ?? 1);
  const roster = state.roster ?? [];
  const base = identity(e);
  const isSnap = ["pass", "run", "punt", "coverage_sack"].includes(e.playType);

  const sidePicker = (label: string) => (
    <div className="mb-4">
      <p className="mb-2 text-sm font-bold text-gray-700">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {(["team", "opponent"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPossession(p)}
            className={`rounded-xl py-3 font-bold ${possession === p ? "bg-gray-800 text-white" : "bg-gray-100"}`}
          >
            {p === "team" ? teamName : opponentName}
          </button>
        ))}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (isSnap) {
    body = (
      <>
        {sidePicker("Who had the ball?")}
        <PlayEntry
          key={possession}
          state={{ possession, yardsToGo: e.yardsToGo, lineOfScrimmage: e.lineOfScrimmage }}
          roster={roster}
          initial={possession === e.possession ? e : { ...e, possession, passer: null, receiver: null, rusher: null, defender: null }}
          submitLabel={editing.isNew ? "Add play" : "Save play"}
          onSubmit={(data: PlayEntryResult) => onSave({ ...base, ...data, possession } as Play)}
        />
      </>
    );
  } else if (e.playType === "penalty") {
    body = (
      <>
        {sidePicker("Who had the ball?")}
        <PenaltyEntry
          lineOfScrimmage={beforeLos}
          initial={{
            yards: Math.abs(e.yards ?? 0),
            onOffense: e.onOffense,
            lossOfDown: e.lossOfDown,
            automaticFirstDown: e.automaticFirstDown,
            penaltyCode: e.penaltyCode,
            penaltyName: e.penaltyName,
          }}
          submitLabel="Save penalty"
          onSubmit={(data) =>
            onSave({
              ...base,
              playType: "penalty",
              possession,
              yards: data.onOffense ? -data.yards : data.yards,
              onOffense: data.onOffense,
              lossOfDown: data.lossOfDown,
              ...(data.automaticFirstDown ? { automaticFirstDown: true } : {}),
              ...(data.penaltyCode ? { penaltyCode: data.penaltyCode } : {}),
              ...(data.penaltyName ? { penaltyName: data.penaltyName } : {}),
            } as Play)
          }
        />
      </>
    );
  } else if (e.playType === "point_after") {
    const ot = Boolean(e.isOvertimeConversion);
    body = (
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        {sidePicker("Who tried it?")}
        <p className="mb-2 text-sm font-bold text-gray-700">Try</p>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {([1, 2, 3] as TryPoints[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAttempt(t)}
              className={`rounded-xl py-3 font-bold ${attempt === t ? "bg-purple-600 text-white" : "bg-gray-100"}`}
            >
              {t} pt{!ot && t === 1 ? " (auto)" : ""}
            </button>
          ))}
        </div>
        {(ot || attempt !== 1) && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSuccess(true)} className={`rounded-xl py-3 font-bold ${success ? "bg-green-600 text-white" : "bg-gray-100"}`}>
              Good
            </button>
            <button type="button" onClick={() => setSuccess(false)} className={`rounded-xl py-3 font-bold ${!success ? "bg-red-600 text-white" : "bg-gray-100"}`}>
              No good
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            const good = !ot && attempt === 1 ? true : success;
            onSave({ ...e, possession, attempt, success: good, points: good ? attempt : 0 });
          }}
          className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-bold text-white"
        >
          Save try
        </button>
      </div>
    );
  } else {
    // End of half, start of overtime, score change.
    const label =
      e.playType === "half_end" ? "Who receives in the 2nd half?" : e.playType === "overtime_start" ? "Who goes first in overtime?" : "Score change for";
    body = (
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        {sidePicker(label)}
        {e.playType === "score_adjustment" && (
          <label className="mb-4 flex items-center gap-2 font-bold text-gray-700">
            Points
            <input
              type="number"
              value={points}
              onChange={(ev) => setPoints(parseInt(ev.target.value) || 0)}
              className="w-24 rounded-lg border-2 px-2 py-2 text-center"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => onSave({ ...e, possession, ...(e.playType === "score_adjustment" ? { points } : {}) })}
          className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-bold text-white"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-white p-4 shadow-xl">
          <div>
            <p className="text-lg font-bold">{editing.isNew ? `Insert play #${editing.index + 1}` : `Edit #${editing.index + 1}`}</p>
            <p className="text-xs text-gray-500">The score and all stats are recalculated when you save.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-bold">
            Cancel
          </button>
        </div>
        {busy ? <p className="rounded-2xl bg-white p-6 text-center shadow">Saving…</p> : body}
      </div>
    </div>
  );
}
