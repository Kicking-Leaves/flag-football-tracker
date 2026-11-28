// Lining up logged plays with camera video. Pure functions only, shared by the
// film review screen and the download request handler.
//
// Everything is anchored on real-world time ("wall" time, epoch ms):
//   - a play's logged time comes from Play.recordedAt (the scorer's tap);
//   - a camera's video second 0 is its recording start (from the file), and
//     the camera's nudge corrects any clock difference:
//
//       video seconds = (wall - base + nudge) / 1000
//
// so one play maps onto every camera without storing per-camera offsets.

import type { GameState, Play, Possession } from "@/lib/types";
import { isMarker, makeInitialGameState, replayTimeline } from "@/lib/game-engine";
import { ordinal, scorebugFromGameState, type ScorebugData } from "@/lib/scorebug";
import type { FilmClip } from "./types";

/** The play's snap sits this long after the start of its window once synced. */
export const SNAP_LEAD_MS = 3000;
export const DEFAULT_PRE_ROLL_S = 20;
export const DEFAULT_POST_ROLL_S = 4;

export interface SyncCamera {
  recorded_start_at: string | null;
  duration_ms: number | null;
  nudge_ms: number;
}

export function entryWallMs(e: Pick<Play, "recordedAt">): number | null {
  if (!e.recordedAt) return null;
  const t = Date.parse(e.recordedAt);
  return Number.isFinite(t) ? t : null;
}

/**
 * Wall time of the camera's video second 0, before the nudge. Cameras whose
 * file had no start time fall back to a minute before the first logged play;
 * the sync screen then fixes them with the nudge.
 */
export function cameraBaseMs(camera: Pick<SyncCamera, "recorded_start_at">, plays: Play[]): number | null {
  if (camera.recorded_start_at) {
    const t = Date.parse(camera.recorded_start_at);
    if (Number.isFinite(t)) return t;
  }
  for (const e of plays) {
    const t = entryWallMs(e);
    if (t !== null) return t - 60_000;
  }
  return null;
}

export function videoSecondsAt(camera: Pick<SyncCamera, "nudge_ms">, base: number, wall: number): number {
  return (wall - base + camera.nudge_ms) / 1000;
}

export function wallAtVideo(camera: Pick<SyncCamera, "nudge_ms">, base: number, seconds: number): number {
  return base + seconds * 1000 - camera.nudge_ms;
}

/** Whether a wall-time range overlaps the camera's recording at all. */
export function onCamera(camera: SyncCamera, base: number, startAt: number, endAt: number): boolean {
  if (!camera.duration_ms) return false;
  const a = videoSecondsAt(camera, base, startAt);
  const b = videoSecondsAt(camera, base, endAt);
  return b > 0 && a < camera.duration_ms / 1000;
}

/**
 * The nudge that puts a play's snap SNAP_LEAD_MS into its window, given the
 * video second where the reviewer says the snap is.
 */
export function nudgeForSnap(base: number, windowStartAt: number, snapSeconds: number): number {
  return Math.round(snapSeconds * 1000 - (windowStartAt + SNAP_LEAD_MS - base));
}

/**
 * Cameras often store local time as if it were UTC. When most plays fall
 * outside the video but a whole-hour shift would put them inside, returns
 * that shift in hours (e.g. -8); otherwise null.
 */
export function suggestHourShift(camera: SyncCamera, base: number, loggedTimes: number[]): number | null {
  if (!camera.duration_ms || loggedTimes.length === 0) return null;
  const durationS = camera.duration_ms / 1000;
  const covered = (nudge: number) =>
    loggedTimes.filter((t) => {
      const s = videoSecondsAt({ nudge_ms: nudge }, base, t);
      return s >= 0 && s <= durationS;
    }).length;
  const half = Math.ceil(loggedTimes.length / 2);
  if (covered(camera.nudge_ms) >= half) return null;
  let best: { hours: number; count: number } | null = null;
  for (let h = -14; h <= 14; h++) {
    if (h === 0) continue;
    const count = covered(camera.nudge_ms + h * 3_600_000);
    if (!best || count > best.count) best = { hours: h, count };
  }
  return best && best.count >= half ? best.hours : null;
}

// ---------- Plays and clips on the timeline ----------

export interface FilmPlayItem {
  kind: "play";
  key: string;
  id: number;
  /** 1-based position among the game's plays (markers excluded). */
  number: number;
  entry: Play;
  loggedAt: number;
  startAt: number;
  endAt: number;
  /** A coach moved this play's start or end. */
  adjusted: boolean;
  label: string;
  /** Player ids involved, for the player filter. */
  players: string[];
  touchdown: boolean;
  turnover: boolean;
  penalty: boolean;
}

export interface FilmClipItem {
  kind: "clip";
  key: string;
  id: string;
  title: string;
  startAt: number;
  endAt: number;
}

export type FilmItem = FilmPlayItem | FilmClipItem;

/** "Play 12 (2nd & 6)", "Play 13 (2-pt try)". */
export function playLabel(number: number, p: Play): string {
  if (p.isOvertimeConversion) return `Play ${number} (OT ${p.attempt ?? ""}-pt try)`.replace(" -pt", "-pt");
  if (p.isPointAfter) return `Play ${number} (${p.attempt === 1 ? "PAT" : `${p.attempt}-pt try`})`;
  if (p.playType === "penalty") return `Play ${number} (penalty)`;
  return `Play ${number} (${ordinal(p.down)} & ${p.yardsToGo})`;
}

/** Logged plays that have a timestamp, with their windows (adjusted where a coach moved them). */
export function buildPlayItems(
  plays: Play[],
  clips: Pick<FilmClip, "play_id" | "start_at" | "end_at">[],
  preRollS: number,
  postRollS: number,
): FilmPlayItem[] {
  const adjustments = new Map<number, { start: number; end: number }>();
  for (const c of clips) {
    if (c.play_id !== null) adjustments.set(Number(c.play_id), { start: Date.parse(c.start_at), end: Date.parse(c.end_at) });
  }
  const items: FilmPlayItem[] = [];
  let number = 0;
  for (const entry of plays) {
    if (isMarker(entry)) continue;
    number += 1;
    const loggedAt = entryWallMs(entry);
    if (loggedAt === null) continue;
    const adj = adjustments.get(entry.id);
    items.push({
      kind: "play",
      key: `p${entry.id}`,
      id: entry.id,
      number,
      entry,
      loggedAt,
      startAt: adj?.start ?? loggedAt - preRollS * 1000,
      endAt: adj?.end ?? loggedAt + postRollS * 1000,
      adjusted: Boolean(adj),
      label: playLabel(number, entry),
      players: [entry.passer, entry.receiver, entry.rusher, entry.defender].filter((x): x is string => Boolean(x)),
      touchdown: Boolean(entry.touchdown || entry.interceptionReturnTD),
      turnover: Boolean(entry.interception || entry.fumble === "lost" || entry.turnover),
      penalty: entry.playType === "penalty",
    });
  }
  return items;
}

export function buildClipItems(clips: FilmClip[]): FilmClipItem[] {
  return clips
    .filter((c) => c.play_id === null)
    .map((c) => ({
      kind: "clip" as const,
      key: `c${c.id}`,
      id: c.id,
      title: c.title ?? "Clip",
      startAt: Date.parse(c.start_at),
      endAt: Date.parse(c.end_at),
    }))
    .sort((a, b) => a.startAt - b.startAt);
}

/** Which side had the ball on a logged play. */
export function offenseOf(item: FilmPlayItem): Possession | undefined {
  return item.entry.possession;
}

// ---------- Scoreboard over time ----------

export interface ScorebugTimeline {
  /** Before the first logged entry. */
  initial: ScorebugData;
  /** The scoreboard after each timestamped entry, from its logged time on. */
  changes: { at: number; bug: ScorebugData }[];
}

export function scorebugTimeline(state: GameState, teamName: string, opponentName: string): ScorebugTimeline {
  const first =
    state.firstPossession ?? state.plays.find((e) => !isMarker(e) && e.possession)?.possession ?? state.possession;
  const initial = scorebugFromGameState(makeInitialGameState([], first), teamName, opponentName);
  const states = replayTimeline(state);
  const changes: ScorebugTimeline["changes"] = [];
  let last = -Infinity;
  state.plays.forEach((e, i) => {
    const t = entryWallMs(e);
    if (t === null || !states[i]) return;
    // Entries are applied in log order; a timestamp earlier than the one
    // before it (an entry inserted later) takes effect with its neighbour.
    last = Math.max(last, t);
    changes.push({ at: last, bug: scorebugFromGameState(states[i], teamName, opponentName) });
  });
  return { initial, changes };
}

export function scorebugAt(tl: ScorebugTimeline, wall: number): ScorebugData {
  let bug = tl.initial;
  for (const c of tl.changes) {
    if (c.at > wall) break;
    bug = c.bug;
  }
  return bug;
}

export interface OverlaySegment {
  /** Milliseconds from the start of the cut. */
  fromMs: number;
  toMs: number;
  bug: ScorebugData;
}

/** What the scoreboard shows during a cut, merged where nothing changes. */
export function overlaySegments(tl: ScorebugTimeline, startAt: number, endAt: number): OverlaySegment[] {
  const total = Math.round(endAt - startAt);
  const segments: OverlaySegment[] = [{ fromMs: 0, toMs: total, bug: scorebugAt(tl, startAt) }];
  for (const c of tl.changes) {
    if (c.at <= startAt || c.at >= endAt) continue;
    const at = Math.round(c.at - startAt);
    const prev = segments[segments.length - 1];
    if (JSON.stringify(prev.bug) === JSON.stringify(c.bug)) continue;
    if (at <= prev.fromMs) {
      prev.bug = c.bug;
      continue;
    }
    prev.toMs = at;
    segments.push({ fromMs: at, toMs: total, bug: c.bug });
  }
  return segments;
}

// ---------- Downloads ----------

/** "2026-11-21 vs Eagles – Play 12 (2nd & 6) – Sideline.mp4" */
export function exportFileName(parts: {
  gameDate: string;
  opponent: string;
  label: string;
  camera: string;
  overlay: boolean;
}): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const base = [parts.gameDate.slice(0, 10), `vs ${clean(parts.opponent)}`].join(" ");
  const name = `${base} – ${clean(parts.label)} – ${clean(parts.camera)}${parts.overlay ? " (scoreboard)" : ""}`;
  return `${name.slice(0, 190)}.mp4`;
}

/** A wall-time range as a cut of one camera's video, or null if the camera didn't record it. */
export function cutRange(
  camera: SyncCamera,
  base: number,
  startAt: number,
  endAt: number,
): { startMs: number; endMs: number; startAt: number; endAt: number } | null {
  if (!camera.duration_ms) return null;
  const startMs = Math.max(0, Math.round(videoSecondsAt(camera, base, startAt) * 1000));
  const endMs = Math.min(camera.duration_ms, Math.round(videoSecondsAt(camera, base, endAt) * 1000));
  if (endMs - startMs < 500) return null;
  // The wall times actually covered, for the scoreboard.
  return {
    startMs,
    endMs,
    startAt: wallAtVideo(camera, base, startMs / 1000),
    endAt: wallAtVideo(camera, base, endMs / 1000),
  };
}
