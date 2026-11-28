"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ScorebugBar from "@/components/overlay/ScorebugBar";
import { describePlayType, describeResult } from "@/lib/csv";
import type { GameState } from "@/lib/types";
import {
  buildClipItems,
  buildPlayItems,
  cameraBaseMs,
  nudgeForSnap,
  onCamera,
  scorebugAt,
  scorebugTimeline,
  suggestHourShift,
  videoSecondsAt,
  wallAtVideo,
  type FilmItem,
  type FilmPlayItem,
} from "@/lib/film/sync";
import {
  CLIP_COLUMNS,
  formatBytes,
  formatDuration,
  type FilmClip,
  type FilmExport,
  type FilmPlayableCamera,
} from "@/lib/film/types";

interface Props {
  gameId: string;
  teamId: string;
  teamName: string;
  opponentName: string;
  state: GameState;
  cameras: FilmPlayableCamera[];
  initialClips: FilmClip[];
  initialExports: FilmExport[];
  initialWindow: { preRollS: number; postRollS: number };
  playerNames: Record<string, string>;
  /** Admin/Coach: sync cameras, adjust plays, set the play window. */
  canSync: boolean;
  /** Admin/Coach/Stat Keeper: make custom clips. */
  canClip: boolean;
}

type Filter = "all" | "td" | "turnover" | "penalty" | "clips";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All plays" },
  { value: "td", label: "Touchdowns" },
  { value: "turnover", label: "Turnovers" },
  { value: "penalty", label: "Penalties" },
  { value: "clips", label: "Clips" },
];
const RATES = [1, 0.5, 0.25];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function clock(seconds: number): string {
  return formatDuration(Math.max(0, seconds) * 1000) || "0:00";
}

function signedSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(1)}s`;
}

export default function FilmReview(props: Props) {
  const { teamName, opponentName, state, playerNames, canSync, canClip } = props;
  const supabase = useMemo(() => createClient(), []);
  const plays = useMemo(() => state?.plays ?? [], [state]);
  const names = useMemo(() => ({ team: teamName, opponent: opponentName }), [teamName, opponentName]);

  const [cameras, setCameras] = useState(props.cameras);
  const [cameraId, setCameraId] = useState(props.cameras[0].id);
  const camera = cameras.find((c) => c.id === cameraId) ?? cameras[0];
  const bases = useMemo(() => new Map(cameras.map((c) => [c.id, cameraBaseMs(c, plays)])), [cameras, plays]);
  const base = bases.get(camera.id) ?? null;

  const [clips, setClips] = useState(props.initialClips);
  const [exports, setExports] = useState(props.initialExports);
  const [playWindow, setPlayWindow] = useState(props.initialWindow);

  const playItems = useMemo(
    () => buildPlayItems(plays, clips, playWindow.preRollS, playWindow.postRollS),
    [plays, clips, playWindow],
  );
  const clipItems = useMemo(() => buildClipItems(clips), [clips]);
  const timeline = useMemo(() => scorebugTimeline(state, teamName, opponentName), [state, teamName, opponentName]);
  const untimed = useMemo(
    () => plays.filter((p) => !["half_end", "overtime_start", "score_adjustment"].includes(p.playType)).length - playItems.length,
    [plays, playItems],
  );

  // ----- Filters -----
  const [filter, setFilter] = useState<Filter>("all");
  const [half, setHalf] = useState<"all" | "1" | "2" | "OT">("all");
  const [side, setSide] = useState<"all" | "team" | "opponent">("all");
  const [player, setPlayer] = useState("");
  const visible: FilmItem[] = useMemo(() => {
    if (filter === "clips") return clipItems;
    return playItems.filter(
      (p) =>
        (filter === "all" ||
          (filter === "td" && p.touchdown) ||
          (filter === "turnover" && p.turnover) ||
          (filter === "penalty" && p.penalty)) &&
        (half === "all" || String(p.entry.half ?? "") === half) &&
        (side === "all" || p.entry.possession === side) &&
        (!player || p.players.includes(player)),
    );
  }, [filter, half, side, player, playItems, clipItems]);
  const playersInGame = useMemo(() => {
    const ids = new Set(playItems.flatMap((p) => p.players));
    return [...ids].filter((id) => playerNames[id]).sort((a, b) => playerNames[a].localeCompare(playerNames[b]));
  }, [playItems, playerNames]);

  // ----- Player -----
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<{ seconds: number; play: boolean } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected =
    playItems.find((p) => p.key === selectedKey) ?? clipItems.find((c) => c.key === selectedKey) ?? null;
  const [wholeGame, setWholeGame] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  const [showBug, setShowBug] = useState(false);
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const wall = base === null ? null : wallAtVideo(camera, base, time);
  const bug = wall === null ? null : scorebugAt(timeline, wall);
  const toVideo = (w: number) => (base === null ? 0 : videoSecondsAt(camera, base, w));
  const durationS = camera.duration_ms / 1000;

  function seekTo(seconds: number, play: boolean) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, seconds), durationS);
    setTime(v.currentTime);
    if (play) void v.play().catch(() => {});
  }

  function select(item: FilmItem) {
    setSelectedKey(item.key);
    setWholeGame(false);
    setMessage(null);
    if (base === null || !onCamera(camera, base, item.startAt, item.endAt)) {
      setMessage(`${camera.name} didn't record this one. Try another camera.`);
      return;
    }
    seekTo(toVideo(item.startAt), true);
  }

  function step(delta: number) {
    const i = visible.findIndex((x) => x.key === selectedKey);
    const next = visible[i === -1 ? (delta > 0 ? 0 : visible.length - 1) : i + delta];
    if (next) select(next);
  }

  function switchCamera(id: string) {
    if (id === camera.id) return;
    const next = cameras.find((c) => c.id === id);
    const v = videoRef.current;
    const nextBase = bases.get(id) ?? null;
    if (next && v && base !== null && nextBase !== null) {
      // Stay on the same moment: each camera started recording at a different time.
      const at = wallAtVideo(camera, base, v.currentTime);
      pendingSeek.current = { seconds: videoSecondsAt(next, nextBase, at), play: !v.paused };
    }
    setCameraId(id);
  }

  function onLoaded() {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    const seek = pendingSeek.current;
    pendingSeek.current = null;
    if (seek) seekTo(seek.seconds, seek.play);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    setTime(v.currentTime);
    if (!wholeGame && loop && selected && base !== null) {
      const end = toVideo(selected.endAt);
      if (v.currentTime >= end) v.currentTime = Math.max(0, toVideo(selected.startAt));
    }
  }

  function changeRate(r: number) {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }

  function fullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen();
    else videoRef.current?.requestFullscreen?.();
  }

  // ----- Sync (Admin/Coach) -----
  const [syncOpen, setSyncOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const hourShift = base === null ? null : suggestHourShift(camera, base, playItems.map((p) => p.loggedAt));

  async function saveNudge(nudgeMs: number) {
    setBusy("sync");
    setMessage(null);
    try {
      const v = videoRef.current;
      const res = await api<{ nudgeMs: number }>(`/api/film/cameras/${camera.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nudgeMs }),
      });
      setCameras((cs) => cs.map((c) => (c.id === camera.id ? { ...c, nudge_ms: res.nudgeMs } : c)));
      // Keep the picture where it is; only the plays move.
      if (v) setTime(v.currentTime);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't save the sync.");
    } finally {
      setBusy(null);
    }
  }

  async function saveWindow(next: { preRollS: number; postRollS: number }) {
    setBusy("window");
    const { error } = await supabase
      .from("rr_teams")
      .update({ film_pre_roll_s: next.preRollS, film_post_roll_s: next.postRollS })
      .eq("id", props.teamId);
    setBusy(null);
    if (error) setMessage(error.message);
    else setPlayWindow(next);
  }

  // ----- Adjusting a play (Admin/Coach) -----
  async function adjustPlay(item: FilmPlayItem, edge: "start" | "end") {
    if (wall === null) return;
    const startAt = edge === "start" ? wall : item.startAt;
    const endAt = edge === "end" ? wall : item.endAt;
    if (endAt - startAt < 1000) {
      setMessage(edge === "start" ? "The start has to be before the end." : "The end has to be after the start.");
      return;
    }
    setBusy("adjust");
    setMessage(null);
    const existing = clips.find((c) => c.play_id !== null && Number(c.play_id) === item.id);
    const values = { start_at: new Date(startAt).toISOString(), end_at: new Date(endAt).toISOString() };
    const { data, error } = existing
      ? await supabase.from("rr_film_clips").update(values).eq("id", existing.id).select(CLIP_COLUMNS).single()
      : await supabase
          .from("rr_film_clips")
          .insert({ game_id: props.gameId, play_id: item.id, ...values })
          .select(CLIP_COLUMNS)
          .single();
    setBusy(null);
    if (error) return setMessage(error.message);
    setClips((cs) => [...cs.filter((c) => c.id !== (data as FilmClip).id), data as FilmClip]);
  }

  async function resetPlay(item: FilmPlayItem) {
    const existing = clips.find((c) => c.play_id !== null && Number(c.play_id) === item.id);
    if (!existing) return;
    setBusy("adjust");
    const { error } = await supabase.from("rr_film_clips").delete().eq("id", existing.id);
    setBusy(null);
    if (error) return setMessage(error.message);
    setClips((cs) => cs.filter((c) => c.id !== existing.id));
  }

  // ----- Custom clips (Admin/Coach/Stat Keeper) -----
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [clipTitle, setClipTitle] = useState("");
  const [clipOpen, setClipOpen] = useState(false);

  async function saveClip() {
    if (clipStart === null || clipEnd === null) return;
    if (clipEnd - clipStart < 1000) return setMessage("The clip's end has to be after its start.");
    setBusy("clip");
    setMessage(null);
    const { data, error } = await supabase
      .from("rr_film_clips")
      .insert({
        game_id: props.gameId,
        title: clipTitle.trim().slice(0, 80) || "Clip",
        start_at: new Date(clipStart).toISOString(),
        end_at: new Date(clipEnd).toISOString(),
      })
      .select(CLIP_COLUMNS)
      .single();
    setBusy(null);
    if (error) return setMessage(error.message);
    setClips((cs) => [...cs, data as FilmClip]);
    setClipStart(null);
    setClipEnd(null);
    setClipTitle("");
    setClipOpen(false);
    setFilter("clips");
    setSelectedKey(`c${(data as FilmClip).id}`);
  }

  async function deleteClip(id: string) {
    if (!confirm("Delete this clip for everyone?")) return;
    const { error } = await supabase.from("rr_film_clips").delete().eq("id", id);
    if (error) return setMessage(error.message);
    setClips((cs) => cs.filter((c) => c.id !== id));
    if (selectedKey === `c${id}`) setSelectedKey(null);
  }

  // ----- Downloads -----
  const [withBug, setWithBug] = useState(true);
  const inFlight = exports.some((e) => e.status === "queued" || e.status === "processing");
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(async () => {
      try {
        const res = await api<{ exports: FilmExport[] }>(`/api/film/games/${props.gameId}/exports`);
        setExports(res.exports);
      } catch {
        // Try again on the next tick.
      }
    }, 4000);
    return () => clearInterval(id);
  }, [inFlight, props.gameId]);

  async function download(item: FilmItem) {
    setBusy("download");
    setMessage(null);
    try {
      const res = await api<{ export: FilmExport }>("/api/film/exports", {
        method: "POST",
        body: JSON.stringify({
          cameraId: camera.id,
          overlay: withBug,
          ...(item.kind === "play" ? { playId: item.id } : { clipId: item.id }),
        }),
      });
      setExports((list) => [res.export, ...list.filter((e) => e.id !== res.export.id)]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't start the download.");
    } finally {
      setBusy(null);
    }
  }

  const cameraName = (id: string) => cameras.find((c) => c.id === id)?.name ?? "Camera";
  const describe = (p: FilmPlayItem) => {
    const who = p.players.map((id) => playerNames[id]).filter(Boolean).join(", ");
    return [describePlayType(p.entry), describeResult(p.entry, names), who].filter(Boolean).join(" · ");
  };
  const selectedPlay = selected?.kind === "play" ? selected : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ---------- Video ---------- */}
      <div className="space-y-3">
        <div className="sticky top-0 z-20 -mx-3 bg-gray-950 px-3 pb-2 sm:static sm:mx-0 sm:px-0">
          <div ref={stageRef} className="relative overflow-hidden rounded-lg bg-black" style={{ containerType: "inline-size" }}>
            <video
              key={camera.id}
              ref={videoRef}
              src={camera.videoUrl}
              poster={camera.thumbUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="block aspect-video w-full bg-black"
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTimeUpdate}
              onSeeked={() => videoRef.current && setTime(videoRef.current.currentTime)}
            />
            {showBug && bug && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ fontSize: "1.15cqw" }}>
                <ScorebugBar data={bug} position="bottom-left" />
              </div>
            )}
          </div>

          {/* Play markers along the whole game */}
          {base !== null && (
            <div className="relative mt-1 h-3 rounded bg-gray-800" aria-hidden>
              {playItems.map((p) => {
                const s = toVideo(p.loggedAt);
                if (s < 0 || s > durationS) return null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    tabIndex={-1}
                    onClick={() => select(p)}
                    title={p.label}
                    className={`absolute top-0 h-3 w-[3px] -translate-x-1/2 ${
                      p.touchdown ? "bg-amber-400" : p.turnover ? "bg-red-500" : "bg-gray-400"
                    } ${p.key === selectedKey ? "ring-2 ring-white" : ""}`}
                    style={{ left: `${(s / durationS) * 100}%` }}
                  />
                );
              })}
              <div className="absolute top-0 h-3 w-0.5 bg-blue-400" style={{ left: `${(time / durationS) * 100}%` }} />
            </div>
          )}
        </div>

        {/* Cameras */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {cameras.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => switchCamera(c.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                c.id === camera.id ? "border-blue-400 bg-blue-950" : "border-gray-700 bg-gray-900 hover:border-gray-500"
              }`}
            >
              {c.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbUrl} alt="" className="h-8 w-14 rounded object-cover" />
              )}
              {c.name}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => step(-1)} className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700">
            ← Prev
          </button>
          <button type="button" onClick={() => step(1)} className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700">
            Next →
          </button>
          <label className="flex items-center gap-1.5 rounded bg-gray-800 px-3 py-1.5">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} disabled={wholeGame} />
            Loop play
          </label>
          <div className="flex overflow-hidden rounded bg-gray-800">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => changeRate(r)}
                className={`px-2.5 py-1.5 ${rate === r ? "bg-blue-600" : "hover:bg-gray-700"}`}
              >
                {r}×
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 rounded bg-gray-800 px-3 py-1.5">
            <input type="checkbox" checked={showBug} onChange={(e) => setShowBug(e.target.checked)} />
            Show scoreboard
          </label>
          <button
            type="button"
            onClick={() => {
              setWholeGame((w) => !w);
              setSelectedKey(null);
            }}
            className={`rounded px-3 py-1.5 ${wholeGame ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
          >
            Whole game
          </button>
          <button type="button" onClick={fullscreen} className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700">
            Full screen
          </button>
          <span className="ml-auto tabular-nums text-gray-400">
            {clock(time)} / {clock(durationS)}
          </span>
        </div>

        {message && <p className="rounded bg-yellow-900/60 px-3 py-2 text-sm text-yellow-100">{message}</p>}

        {/* Selected play or clip */}
        {selected && !wholeGame && (
          <div className="space-y-3 rounded-lg bg-gray-900 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{selected.kind === "play" ? selected.label : selected.title}</h2>
              <span className="text-xs text-gray-400">
                {clock((selected.endAt - selected.startAt) / 1000)} long
                {selectedPlay?.adjusted ? " · adjusted" : ""}
              </span>
            </div>
            {selectedPlay && <p className="text-sm text-gray-300">{describe(selectedPlay)}</p>}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={withBug} onChange={(e) => setWithBug(e.target.checked)} />
                Include scoreboard
              </label>
              <button
                type="button"
                disabled={busy === "download"}
                onClick={() => download(selected)}
                className="rounded bg-blue-600 px-3 py-1.5 font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                {busy === "download" ? "Starting…" : `Download from ${camera.name}`}
              </button>
              {canSync && selectedPlay && (
                <>
                  <button
                    type="button"
                    disabled={busy === "adjust"}
                    onClick={() => adjustPlay(selectedPlay, "start")}
                    className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700"
                  >
                    Start here
                  </button>
                  <button
                    type="button"
                    disabled={busy === "adjust"}
                    onClick={() => adjustPlay(selectedPlay, "end")}
                    className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700"
                  >
                    End here
                  </button>
                  {selectedPlay.adjusted && (
                    <button type="button" onClick={() => resetPlay(selectedPlay)} className="text-gray-400 underline">
                      Reset
                    </button>
                  )}
                </>
              )}
              {canClip && selected.kind === "clip" && (
                <button type="button" onClick={() => deleteClip(selected.id)} className="text-red-400 underline">
                  Delete clip
                </button>
              )}
            </div>
          </div>
        )}

        {/* Make a clip */}
        {canClip && (
          <div className="rounded-lg bg-gray-900 p-3 text-sm">
            {!clipOpen ? (
              <button type="button" onClick={() => setClipOpen(true)} className="font-medium text-blue-400">
                + Make a clip
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-gray-300">Play the video, then mark where the clip starts and ends.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => wall !== null && setClipStart(wall)}
                    className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700"
                  >
                    Mark start{clipStart !== null ? ` (${clock(toVideo(clipStart))})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => wall !== null && setClipEnd(wall)}
                    className="rounded bg-gray-800 px-3 py-1.5 hover:bg-gray-700"
                  >
                    Mark end{clipEnd !== null ? ` (${clock(toVideo(clipEnd))})` : ""}
                  </button>
                  <input
                    value={clipTitle}
                    onChange={(e) => setClipTitle(e.target.value)}
                    placeholder="Name (e.g. Goal-line stand)"
                    maxLength={80}
                    className="min-w-0 flex-1 rounded bg-gray-800 px-2 py-1.5"
                  />
                  <button
                    type="button"
                    disabled={clipStart === null || clipEnd === null || busy === "clip"}
                    onClick={saveClip}
                    className="rounded bg-blue-600 px-3 py-1.5 font-medium disabled:opacity-50"
                  >
                    Save clip
                  </button>
                  <button type="button" onClick={() => setClipOpen(false)} className="text-gray-400 underline">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync (Admin/Coach) */}
        {canSync && (
          <div className="rounded-lg bg-gray-900 p-3 text-sm">
            <button type="button" onClick={() => setSyncOpen((o) => !o)} className="font-medium text-blue-400">
              {syncOpen ? "▾" : "▸"} Sync cameras and play length
            </button>
            {syncOpen && (
              <div className="mt-3 space-y-4">
                <div className="space-y-2">
                  <p className="text-gray-300">
                    <strong>{camera.name}</strong>:{" "}
                    {camera.recorded_start_at
                      ? `clock from the video file, adjusted ${signedSeconds(camera.nudge_ms)}.`
                      : `the video file had no start time, so it needs a manual sync (now ${signedSeconds(camera.nudge_ms)}).`}
                  </p>
                  {hourShift !== null && (
                    <div className="rounded bg-yellow-900/60 p-2 text-yellow-100">
                      Most plays fall outside this video. The camera&apos;s clock looks {Math.abs(hourShift)} hour
                      {Math.abs(hourShift) === 1 ? "" : "s"} off.{" "}
                      <button
                        type="button"
                        disabled={busy === "sync"}
                        onClick={() => saveNudge(camera.nudge_ms + hourShift * 3_600_000)}
                        className="font-semibold underline"
                      >
                        Fix it
                      </button>
                    </div>
                  )}
                  <p className="text-gray-400">
                    Pick a play, scrub to its snap, then tap <strong>This is the snap</strong>. Each camera only needs
                    this once per game.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!selectedPlay || base === null || busy === "sync"}
                      onClick={() => selectedPlay && base !== null && saveNudge(nudgeForSnap(base, selectedPlay.startAt, time))}
                      className="rounded bg-blue-600 px-3 py-1.5 font-medium disabled:opacity-50"
                    >
                      This is the snap{selectedPlay ? ` of ${selectedPlay.label.split(" (")[0]}` : ""}
                    </button>
                    {[-1000, -100, 100, 1000].map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={busy === "sync"}
                        onClick={() => saveNudge(camera.nudge_ms + d)}
                        className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700"
                        title={d > 0 ? "Plays happen later in this video" : "Plays happen earlier in this video"}
                      >
                        {d > 0 ? "+" : "−"}
                        {Math.abs(d) / 1000}s
                      </button>
                    ))}
                  </div>
                </div>

                <PlayWindowForm value={playWindow} busy={busy === "window"} onSave={saveWindow} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- Play list ---------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 ${filter === f.value ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
            >
              {f.label}
              {f.value === "clips" && clipItems.length ? ` (${clipItems.length})` : ""}
            </button>
          ))}
        </div>
        {filter !== "clips" && (
          <div className="grid grid-cols-3 gap-1.5 text-sm">
            <select value={half} onChange={(e) => setHalf(e.target.value as typeof half)} className="rounded bg-gray-800 px-2 py-1.5">
              <option value="all">Both halves</option>
              <option value="1">1st half</option>
              <option value="2">2nd half</option>
              <option value="OT">Overtime</option>
            </select>
            <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} className="rounded bg-gray-800 px-2 py-1.5">
              <option value="all">Both sides</option>
              <option value="team">{teamName} offense</option>
              <option value="opponent">{teamName} defense</option>
            </select>
            <select value={player} onChange={(e) => setPlayer(e.target.value)} className="rounded bg-gray-800 px-2 py-1.5">
              <option value="">All players</option>
              {playersInGame.map((id) => (
                <option key={id} value={id}>
                  {playerNames[id]}
                </option>
              ))}
            </select>
          </div>
        )}

        <ol className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
          {visible.length === 0 && (
            <li className="rounded bg-gray-900 p-3 text-sm text-gray-400">
              {filter === "clips" ? "No clips yet." : "No plays match."}
            </li>
          )}
          {visible.map((item) => {
            const recorded = base !== null && onCamera(camera, base, item.startAt, item.endAt);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => select(item)}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${
                    item.key === selectedKey ? "bg-blue-900 ring-1 ring-blue-400" : "bg-gray-900 hover:bg-gray-800"
                  } ${recorded ? "" : "opacity-50"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {item.kind === "play" ? item.label : item.title}
                      {item.kind === "play" && item.touchdown && <span className="ml-1.5 text-amber-400">TD</span>}
                      {item.kind === "play" && item.turnover && <span className="ml-1.5 text-red-400">TO</span>}
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {item.kind === "play"
                        ? `${item.entry.possession === "team" ? teamName : opponentName} ball`
                        : clock((item.endAt - item.startAt) / 1000)}
                    </span>
                  </div>
                  {item.kind === "play" && <div className="mt-0.5 text-xs text-gray-400">{describe(item)}</div>}
                  {!recorded && <div className="mt-0.5 text-xs text-gray-500">Not on {camera.name}</div>}
                </button>
              </li>
            );
          })}
        </ol>
        {untimed > 0 && filter !== "clips" && (
          <p className="text-xs text-gray-500">
            {untimed} play{untimed === 1 ? " was" : "s were"} logged before plays had timestamps, so{" "}
            {untimed === 1 ? "it can't" : "they can't"} be found on film.
          </p>
        )}

        {/* Downloads */}
        <div className="rounded-lg bg-gray-900 p-3">
          <h2 className="mb-2 text-sm font-semibold">Downloads</h2>
          {exports.length === 0 ? (
            <p className="text-sm text-gray-400">
              Pick a play or clip and tap Download. Files are kept for 30 days.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {exports.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate" title={e.file_name}>
                      {e.file_name.replace(/\.mp4$/, "")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {cameraName(e.camera_id)}
                      {e.overlay ? " · scoreboard" : ""}
                      {e.status === "ready" && e.size_bytes ? ` · ${formatBytes(e.size_bytes)}` : ""}
                      {e.status === "failed" && e.error ? ` · ${e.error}` : ""}
                    </div>
                  </div>
                  {e.status === "ready" ? (
                    <a
                      href={`/api/film/exports/${e.id}?download=1`}
                      className="shrink-0 rounded bg-blue-600 px-3 py-1 font-medium hover:bg-blue-500"
                    >
                      Save
                    </a>
                  ) : e.status === "failed" ? (
                    <span className="shrink-0 text-red-400">Failed</span>
                  ) : (
                    <span className="shrink-0 text-gray-400">
                      {e.status === "queued" ? "Starting…" : `Cutting ${e.progress}%`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayWindowForm({
  value,
  busy,
  onSave,
}: {
  value: { preRollS: number; postRollS: number };
  busy: boolean;
  onSave: (v: { preRollS: number; postRollS: number }) => void;
}) {
  const [pre, setPre] = useState(String(value.preRollS));
  const [post, setPost] = useState(String(value.postRollS));
  const preN = Math.round(Number(pre));
  const postN = Math.round(Number(post));
  const valid = Number.isFinite(preN) && preN >= 0 && preN <= 120 && Number.isFinite(postN) && postN >= 0 && postN <= 60;
  const changed = preN !== value.preRollS || postN !== value.postRollS;
  return (
    <div className="space-y-2">
      <p className="text-gray-300">
        Play length for this team. The scorer logs a play after it ends, so each play starts before the logged time.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          Start
          <input
            type="number"
            min={0}
            max={120}
            value={pre}
            onChange={(e) => setPre(e.target.value)}
            className="w-16 rounded bg-gray-800 px-2 py-1"
          />
          s before
        </label>
        <label className="flex items-center gap-1.5">
          End
          <input
            type="number"
            min={0}
            max={60}
            value={post}
            onChange={(e) => setPost(e.target.value)}
            className="w-16 rounded bg-gray-800 px-2 py-1"
          />
          s after
        </label>
        <button
          type="button"
          disabled={!valid || !changed || busy}
          onClick={() => onSave({ preRollS: preN, postRollS: postN })}
          className="rounded bg-blue-600 px-3 py-1 font-medium disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
