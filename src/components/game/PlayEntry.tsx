"use client";

import { useState } from "react";
import type {
  FumbleResult,
  GameState,
  Play,
  PlayData,
  Possession,
  RosterEntry,
  SackType,
} from "@/lib/types";

/** A play plus interception return details (only sent when editing a logged play). */
export type PlayEntryResult = PlayData & {
  interceptionReturnTD?: boolean;
  returnSpot?: number;
};

interface PlayEntryProps {
  /** The situation before the snap. */
  state: Pick<GameState, "possession" | "yardsToGo" | "lineOfScrimmage">;
  roster: RosterEntry[];
  onSubmit: (play: PlayEntryResult) => void;
  /** Editing a logged play: start from it and ask for interception return details inline. */
  initial?: Play;
  submitLabel?: string;
}

type PlayType = "pass" | "run" | "punt";

const PLAY_TYPES: { type: PlayType; label: string; active: string }[] = [
  { type: "pass", label: "Pass", active: "bg-blue-500" },
  { type: "run", label: "Run", active: "bg-green-500" },
  { type: "punt", label: "Punt", active: "bg-orange-500" },
];

type Players = {
  passer: string;
  receiver: string;
  rusher: string;
  defender: string;
};

type Flags = {
  complete: boolean;
  firstDown: boolean;
  touchdown: boolean;
  interception: boolean;
  flagPull: boolean;
  safety: boolean;
  passDeflection: boolean;
  sack: SackType | null;
  fumble: FumbleResult | null;
};

const offenseFlagDefaults: Flags = {
  complete: true,
  firstDown: false,
  touchdown: false,
  interception: false,
  flagPull: false,
  safety: false,
  passDeflection: false,
  sack: null,
  fumble: null,
};

const defenseFlagDefaults: Flags = {
  ...offenseFlagDefaults,
  flagPull: true, // Defense default = flag pull (common case).
};

function initialPlayType(p?: Play): PlayType {
  if (!p) return "pass";
  return p.playType === "run" || p.playType === "punt" ? p.playType : "pass";
}

function initialFlags(p: Play | undefined, isOffense: boolean): Flags {
  if (!p) return isOffense ? offenseFlagDefaults : defenseFlagDefaults;
  const coverage = p.playType === "coverage_sack" || (p.sack && p.sackType === "coverage");
  return {
    complete: p.complete ?? true,
    // The form adds a first down on its own when the yards reach the line, so
    // only carry over a first down that the yards don't explain.
    firstDown: Boolean(p.firstDown) && !((p.yards ?? 0) >= p.yardsToGo && p.yardsToGo > 0),
    touchdown: Boolean(p.touchdown),
    interception: Boolean(p.interception),
    flagPull: Boolean(p.flagPull),
    safety: Boolean(p.safety),
    passDeflection: Boolean(p.passDeflection),
    sack: coverage ? "coverage" : p.sack ? "player" : null,
    fumble: p.fumble ?? null,
  };
}

/** Play entry form, for live scoring and for editing a logged play. */
export default function PlayEntry({ state, roster, onSubmit, initial, submitLabel }: PlayEntryProps) {
  const isOffense = state.possession === "team";
  const editing = Boolean(initial);
  const [playType, setPlayType] = useState<PlayType>(initialPlayType(initial));
  const [yards, setYards] = useState(initial?.yards ?? 0);
  const [players, setPlayers] = useState<Players>({
    passer: initial?.passer ?? "",
    receiver: initial?.receiver ?? "",
    rusher: initial?.rusher ?? "",
    defender: initial?.defender ?? "",
  });
  const [flags, setFlags] = useState<Flags>(initialFlags(initial, isOffense));
  const [returnTD, setReturnTD] = useState(Boolean(initial?.interceptionReturnTD));
  const [returnSpot, setReturnSpot] = useState(initial?.returnSpot ?? 20);
  const [lastPasser, setLastPasser] = useState("");
  const [lastRusher, setLastRusher] = useState("");

  // Live scoring: when possession flips, reset to that side's defaults.
  const [seenPossession, setSeenPossession] = useState<Possession>(state.possession);
  if (!editing && seenPossession !== state.possession) {
    setSeenPossession(state.possession);
    setFlags(isOffense ? offenseFlagDefaults : defenseFlagDefaults);
    setPlayers({
      passer: isOffense ? lastPasser : "",
      receiver: "",
      rusher: isOffense ? lastRusher : "",
      defender: "",
    });
    setYards(0);
  }

  const isPunt = playType === "punt";
  const isCoverageSack = playType === "pass" && flags.sack === "coverage";
  const isSack = playType === "pass" && flags.sack !== null;
  // Fumbles happen on runs and after a catch.
  const canFumble = playType === "run" || (playType === "pass" && flags.complete && !isSack);

  const sortedRoster = [...roster].sort(
    (a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
  );

  function update(patch: Partial<Flags>) {
    setFlags((f) => {
      const next = { ...f, ...patch };
      // Keep outcomes that can't go together apart.
      if (patch.sack) {
        next.complete = false;
        next.touchdown = false;
        next.interception = false;
        next.passDeflection = false;
        next.fumble = null;
        if (!isOffense) next.flagPull = patch.sack === "player";
      }
      if (patch.touchdown || patch.interception || patch.passDeflection) next.sack = null;
      if (patch.interception) {
        next.fumble = null;
        if (!isOffense) next.flagPull = false;
      }
      if (patch.fumble === "lost") next.touchdown = false;
      if (patch.touchdown) {
        if (next.fumble === "lost") next.fumble = null;
        if (!isOffense) next.flagPull = false;
      }
      if (patch.complete === false) next.fumble = null;
      if (patch.flagPull === false && next.sack === "player") next.sack = null;
      return next;
    });
  }

  function choosePlayType(t: PlayType) {
    setPlayType(t);
    setFlags((f) => ({
      ...f,
      sack: t === "pass" ? f.sack : null,
      interception: t === "pass" ? f.interception : false,
      passDeflection: t === "pass" ? f.passDeflection : false,
      fumble: t === "punt" ? null : f.fumble,
    }));
  }

  function quickYards(delta: number) {
    setYards((y) => Math.max(-20, Math.min(60, y + delta)));
  }

  function handleSubmit() {
    if (isPunt) {
      onSubmit({ possession: state.possession, playType: "punt", isPunt: true, yards: 0 });
      return;
    }

    const playYards = isCoverageSack ? 0 : yards;
    const fumble = canFumble ? flags.fumble : null;
    const autoFirstDown =
      !isCoverageSack && fumble !== "lost" && playYards >= state.yardsToGo && state.yardsToGo > 0;
    const complete = playType === "pass" ? flags.complete && !isSack : true;

    const playData: PlayEntryResult = {
      possession: state.possession,
      playType,
      yards: playYards,
      complete,
      firstDown: !isCoverageSack && fumble !== "lost" && (flags.firstDown || autoFirstDown),
      touchdown: flags.touchdown && fumble !== "lost" && !isSack,
      interception: playType === "pass" && flags.interception,
      flagPull: !isOffense && !isCoverageSack && flags.flagPull,
      safety: isOffense && flags.safety,
      passDeflection: !isOffense && playType === "pass" && flags.passDeflection,
      ...(isSack ? { sack: true, sackType: flags.sack ?? "player" } : {}),
      ...(fumble ? { fumble } : {}),
      passer: playType === "pass" ? players.passer || null : null,
      receiver: playType === "pass" && complete ? players.receiver || null : null,
      rusher: playType === "run" ? players.rusher || null : null,
      defender: !isOffense && !isCoverageSack ? players.defender || null : null,
    };
    if (editing && playData.interception) {
      playData.interceptionReturnTD = returnTD;
      if (!returnTD) playData.returnSpot = returnSpot;
    }

    onSubmit(playData);
    if (editing) return;

    // Remember last passer / rusher for offense convenience.
    if (playType === "pass" && players.passer) setLastPasser(players.passer);
    if (playType === "run" && players.rusher) setLastRusher(players.rusher);

    setYards(0);
    setPlayers({
      passer: isOffense ? players.passer : "",
      receiver: "",
      rusher: isOffense ? players.rusher : "",
      defender: "",
    });
    setFlags(isOffense ? offenseFlagDefaults : defenseFlagDefaults);
  }

  const playerSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    focus: string,
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-xl border-2 border-gray-300 px-4 py-3 font-semibold focus:outline-none ${focus}`}
    >
      <option value="">{placeholder}</option>
      {sortedRoster.map((p) => (
        <option key={p.id} value={p.id}>
          #{p.number} {p.name}
        </option>
      ))}
    </select>
  );

  const toggle = (key: string, on: boolean, onClass: string, label: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`rounded-xl py-3 font-bold ${on ? `${onClass} text-white` : "bg-gray-100"}`}
    >
      {label}
    </button>
  );

  const choice = (on: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2 py-2 text-sm font-bold ${
        on ? "bg-gray-800 text-white" : "bg-white text-gray-700 ring-1 ring-gray-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Play type */}
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <p className="mb-3 text-sm font-bold text-gray-600">PLAY TYPE</p>
        <div className="grid grid-cols-3 gap-2">
          {PLAY_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => choosePlayType(t.type)}
              className={`rounded-xl px-1 py-4 text-sm font-bold ${
                playType === t.type ? `${t.active} text-white` : "bg-gray-100 text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Players */}
      {!isPunt && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">PLAYERS</p>
          {isOffense ? (
            <div className="space-y-3">
              {playType === "pass" && (
                <>
                  {playerSelect(players.passer, (v) => setPlayers({ ...players, passer: v }), "Select Passer", "focus:border-blue-500")}
                  {flags.complete && !isSack &&
                    playerSelect(players.receiver, (v) => setPlayers({ ...players, receiver: v }), "Select Receiver", "focus:border-green-500")}
                </>
              )}
              {playType === "run" &&
                playerSelect(players.rusher, (v) => setPlayers({ ...players, rusher: v }), "Select Rusher", "focus:border-green-500")}
            </div>
          ) : isCoverageSack ? (
            <p className="text-sm text-gray-500">No defender is credited on a coverage sack.</p>
          ) : (
            playerSelect(players.defender, (v) => setPlayers({ ...players, defender: v }), "Select Defender", "focus:border-purple-500")
          )}
        </div>
      )}

      {/* Yards */}
      {!isPunt && !isCoverageSack && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">
            YARDS{flags.fumble && canFumble ? " (to where the ball was fumbled)" : ""}
          </p>
          <div className="mb-4 flex items-center gap-2">
            <button type="button" onClick={() => quickYards(-5)} className="flex-shrink-0 rounded-xl bg-red-500 px-4 py-3 font-bold text-white">
              -5
            </button>
            <button type="button" onClick={() => quickYards(-1)} className="flex-shrink-0 rounded-xl bg-red-400 px-4 py-3 font-bold text-white">
              -1
            </button>
            <input
              type="number"
              value={yards}
              onChange={(e) => setYards(parseInt(e.target.value) || 0)}
              className="min-w-0 flex-1 rounded-xl border-2 px-2 py-3 text-center text-2xl font-bold"
            />
            <button type="button" onClick={() => quickYards(1)} className="flex-shrink-0 rounded-xl bg-green-400 px-4 py-3 font-bold text-white">
              +1
            </button>
            <button type="button" onClick={() => quickYards(5)} className="flex-shrink-0 rounded-xl bg-green-500 px-4 py-3 font-bold text-white">
              +5
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[10, 15, 20, 25, 30, 40].map((y) => (
              <button key={y} type="button" onClick={() => setYards(y)} className="rounded-lg bg-gray-100 py-2 font-semibold">
                {y}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Outcome */}
      {!isPunt && (
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <p className="mb-3 text-sm font-bold text-gray-600">OUTCOME</p>
          <div className="grid grid-cols-2 gap-3">
            {playType === "pass" && !isSack &&
              toggle("complete", flags.complete, "bg-green-500", flags.complete ? "✓ Complete" : "✗ Incomplete", () =>
                update({ complete: !flags.complete }),
              )}
            {playType === "pass" &&
              toggle("sack", isSack, "bg-red-700", isOffense ? "Sacked" : "Sack", () =>
                isSack ? update({ sack: null, complete: true }) : update({ sack: "player" }),
              )}
            {!isOffense && !isCoverageSack &&
              toggle("flagPull", flags.flagPull, "bg-purple-600", "Flag Pull", () => update({ flagPull: !flags.flagPull }))}
            {!isSack && toggle("firstDown", flags.firstDown, "bg-yellow-500", "1st Down", () => update({ firstDown: !flags.firstDown }))}
            {!isSack && toggle("touchdown", flags.touchdown, "bg-green-600", "Touchdown", () => update({ touchdown: !flags.touchdown }))}
            {playType === "pass" && !isSack &&
              toggle("interception", flags.interception, isOffense ? "bg-red-600" : "bg-blue-600", "Interception", () =>
                update({ interception: !flags.interception }),
              )}
            {canFumble &&
              toggle("fumble", flags.fumble !== null, "bg-amber-600", "Fumble", () =>
                update({ fumble: flags.fumble ? null : "dead" }),
              )}
            {isOffense && toggle("safety", flags.safety, "bg-purple-600", "Safety", () => update({ safety: !flags.safety }))}
            {!isOffense && playType === "pass" && !isSack &&
              toggle("pd", flags.passDeflection, "bg-orange-600", "Pass Deflection", () =>
                update({ passDeflection: !flags.passDeflection }),
              )}
          </div>

          {isSack && (
            <div className="mt-4 rounded-xl bg-red-50 p-3">
              <p className="mb-2 text-sm font-bold text-red-800">What kind of sack?</p>
              <div className="grid grid-cols-2 gap-2">
                {choice(flags.sack === "player", "Flag pulled", () => update({ sack: "player" }))}
                {choice(flags.sack === "coverage", "Coverage sack (7 sec)", () => update({ sack: "coverage" }))}
              </div>
              <p className="mt-2 text-xs text-red-800">
                {flags.sack === "coverage"
                  ? "No throw within the 7-second count. Ball back to the previous spot; the down counts."
                  : "Passer's flag pulled before the throw. Enter the yards lost."}
              </p>
            </div>
          )}

          {canFumble && flags.fumble && (
            <div className="mt-4 rounded-xl bg-amber-50 p-3">
              <p className="mb-2 text-sm font-bold text-amber-900">After the fumble</p>
              <div className="grid grid-cols-2 gap-2">
                {choice(flags.fumble === "dead", "Dead at the spot", () => update({ fumble: "dead" }))}
                {choice(flags.fumble === "lost", isOffense ? "Caught by defense" : "We caught it", () =>
                  update({ fumble: "lost" }),
                )}
              </div>
              <p className="mt-2 text-xs text-amber-900">
                {flags.fumble === "lost"
                  ? "Caught before it hit the ground: change of possession where it was fumbled."
                  : "The ball is dead where it was fumbled."}
              </p>
            </div>
          )}

          {editing && playType === "pass" && flags.interception && (
            <div className="mt-4 rounded-xl bg-blue-50 p-3">
              <p className="mb-2 text-sm font-bold text-blue-900">Interception return</p>
              <div className="grid grid-cols-2 gap-2">
                {choice(returnTD, "Returned for TD", () => setReturnTD(true))}
                {choice(!returnTD, "No touchdown", () => setReturnTD(false))}
              </div>
              {!returnTD && (
                <label className="mt-2 flex items-center gap-2 text-sm text-blue-900">
                  Takes over at their own
                  <input
                    type="number"
                    value={returnSpot}
                    min={0}
                    max={50}
                    onChange={(e) => setReturnSpot(Math.max(0, Math.min(50, parseInt(e.target.value) || 0)))}
                    className="w-20 rounded-lg border-2 px-2 py-1 text-center font-bold"
                  />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        className="w-full rounded-2xl bg-blue-600 py-5 text-xl font-bold text-white shadow-2xl"
      >
        {submitLabel ?? (isPunt ? "Record Punt" : isCoverageSack ? "Record Coverage Sack" : "Record Play")}
      </button>
    </div>
  );
}
