import { describe, expect, it, vi } from "vitest";
import { addPlay } from "../game-engine";
import {
  buildClipItems,
  buildPlayItems,
  cameraBaseMs,
  cutRange,
  exportFileName,
  nudgeForSnap,
  overlaySegments,
  scorebugAt,
  scorebugTimeline,
  suggestHourShift,
  videoSecondsAt,
  wallAtVideo,
} from "../film/sync";
import type { FilmClip } from "../film/types";
import type { GameState, PlayData } from "../types";
import { makeGameState, PLAYER_QB, PLAYER_WR } from "./helpers";

const T0 = Date.parse("2026-11-21T19:00:00.000-08:00");

const pass = (yards: number, o: Partial<PlayData> = {}): PlayData => ({
  possession: "team",
  playType: "pass",
  yards,
  complete: true,
  passer: PLAYER_QB.id,
  receiver: PLAYER_WR.id,
  ...o,
});

/** Plays logged at T0 + the given seconds. */
function gameWithPlaysAt(seconds: number[], plays: PlayData[]): GameState {
  let g = makeGameState();
  seconds.forEach((s, i) => {
    vi.setSystemTime(T0 + s * 1000);
    g = addPlay(g, plays[i]);
  });
  vi.useRealTimers();
  return g;
}

describe("camera sync", () => {
  const camera = { recorded_start_at: new Date(T0 - 120_000).toISOString(), duration_ms: 3_600_000, nudge_ms: 0 };

  it("maps wall time to video time and back, with the nudge", () => {
    const base = cameraBaseMs(camera, [])!;
    expect(videoSecondsAt(camera, base, T0)).toBe(120);
    const nudged = { ...camera, nudge_ms: 1500 };
    expect(videoSecondsAt(nudged, base, T0)).toBe(121.5);
    expect(wallAtVideo(nudged, base, 121.5)).toBe(T0);
  });

  it("falls back to a minute before the first logged play without a start time", () => {
    vi.useFakeTimers();
    const g = gameWithPlaysAt([30], [pass(5)]);
    expect(cameraBaseMs({ recorded_start_at: null }, g.plays)).toBe(T0 + 30_000 - 60_000);
    expect(cameraBaseMs({ recorded_start_at: null }, [])).toBeNull();
  });

  it("puts the snap SNAP_LEAD_MS into the play's window after a manual sync", () => {
    const base = cameraBaseMs(camera, [])!;
    const windowStart = T0 - 20_000;
    // The reviewer found the snap at 250.0s in the video.
    const nudge = nudgeForSnap(base, windowStart, 250);
    expect(videoSecondsAt({ nudge_ms: nudge }, base, windowStart + 3000)).toBeCloseTo(250, 6);
  });

  it("suggests a whole-hour shift when the camera clock was local time stored as UTC", () => {
    const base = cameraBaseMs(camera, [])!;
    const logged = [T0 + 8 * 3_600_000, T0 + 8 * 3_600_000 + 600_000];
    expect(suggestHourShift(camera, base, logged)).toBe(-8);
    expect(suggestHourShift(camera, base, [T0, T0 + 60_000])).toBeNull();
  });

  it("cuts only the part the camera recorded", () => {
    const base = cameraBaseMs(camera, [])!;
    expect(cutRange(camera, base, T0 - 200_000, T0 - 110_000)).toEqual({
      startMs: 0,
      endMs: 10_000,
      startAt: T0 - 120_000,
      endAt: T0 - 110_000,
    });
    expect(cutRange(camera, base, T0 - 500_000, T0 - 400_000)).toBeNull();
  });
});

describe("plays and clips on the timeline", () => {
  it("windows each timestamped play, numbering every play, with coach adjustments", () => {
    vi.useFakeTimers();
    const g = gameWithPlaysAt([10, 40, 70], [pass(5), pass(30, { touchdown: false }), pass(0, { complete: false, interception: true })]);
    // An old play without a timestamp keeps its number but can't be shown.
    delete g.plays[0].recordedAt;
    const adjust: Pick<FilmClip, "play_id" | "start_at" | "end_at">[] = [
      { play_id: g.plays[1].id, start_at: new Date(T0 + 15_000).toISOString(), end_at: new Date(T0 + 45_000).toISOString() },
    ];
    const items = buildPlayItems(g.plays, adjust, 20, 4);
    expect(items.map((i) => i.number)).toEqual([2, 3]);
    expect(items[0]).toMatchObject({ startAt: T0 + 15_000, endAt: T0 + 45_000, adjusted: true, label: "Play 2 (2nd & 7)" });
    expect(items[1]).toMatchObject({ startAt: T0 + 50_000, endAt: T0 + 74_000, adjusted: false, turnover: true });
    expect(items[0].players).toEqual([PLAYER_QB.id, PLAYER_WR.id]);
  });

  it("lists custom clips by start time, leaving out play adjustments", () => {
    const row = (id: string, start: number, title: string | null, play_id: number | null = null): FilmClip => ({
      id, game_id: "g", team_id: "t", play_id, title, created_by: null, created_at: "",
      start_at: new Date(T0 + start).toISOString(), end_at: new Date(T0 + start + 5000).toISOString(),
    });
    const items = buildClipItems([row("b", 9000, "Second"), row("a", 1000, "First"), row("p", 0, null, 123)]);
    expect(items.map((c) => c.title)).toEqual(["First", "Second"]);
  });
});

describe("scoreboard over time", () => {
  it("shows the score after each play from its logged time on", () => {
    vi.useFakeTimers();
    const g = gameWithPlaysAt([10, 40], [pass(10), pass(40, { touchdown: true })]);
    const tl = scorebugTimeline(g, "Woodinville", "Redmond");
    expect(scorebugAt(tl, T0).primaryLabel).toBe("1st & 12");
    expect(scorebugAt(tl, T0 + 11_000).teamScore).toBe(0);
    expect(scorebugAt(tl, T0 + 41_000).teamScore).toBe(6);
    expect(scorebugAt(tl, T0 + 41_000).teamName).toBe("Woodinville");
  });

  it("splits a cut into stretches where the scoreboard changes", () => {
    vi.useFakeTimers();
    const g = gameWithPlaysAt([10, 40], [pass(10), pass(40, { touchdown: true })]);
    const tl = scorebugTimeline(g, "W", "R");
    const segs = overlaySegments(tl, T0 + 20_000, T0 + 44_000);
    expect(segs.map((s) => [s.fromMs, s.toMs])).toEqual([
      [0, 20_000],
      [20_000, 24_000],
    ]);
    expect(segs[1].bug.teamScore).toBe(6);
    // Nothing changes inside this stretch: one segment.
    expect(overlaySegments(tl, T0 + 12_000, T0 + 30_000)).toHaveLength(1);
  });
});

describe("download names", () => {
  it("names files like the design doc, without characters files can't hold", () => {
    expect(
      exportFileName({ gameDate: "2026-11-21", opponent: "Eagles", label: "Play 12 (2nd & 6)", camera: "Sideline", overlay: false }),
    ).toBe("2026-11-21 vs Eagles – Play 12 (2nd & 6) – Sideline.mp4");
    expect(
      exportFileName({ gameDate: "2026-11-21T00:00:00Z", opponent: 'A/B "C"', label: "Clip", camera: "End:zone", overlay: true }),
    ).toBe("2026-11-21 vs A B C – Clip – End zone (scoreboard).mp4");
  });
});
