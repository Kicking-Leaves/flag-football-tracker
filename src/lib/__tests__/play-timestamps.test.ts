import { describe, it, expect, vi, afterEach } from "vitest";
import {
  addPlay,
  handleOvertimeConversion,
  localIsoTimestamp,
  recordPenalty,
  recordPointAfter,
} from "../game-engine";
import { generatePlayByPlayCSV } from "../csv";
import { makeGameState, PLAYER_QB, PLAYER_WR } from "./helpers";

const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe("localIsoTimestamp", () => {
  it("formats local time with a UTC offset that round-trips to the same instant", () => {
    const d = new Date("2026-11-21T03:04:05.006Z");
    const s = localIsoTimestamp(d);
    expect(s).toMatch(LOCAL_ISO);
    expect(new Date(s).getTime()).toBe(d.getTime());
  });

  it("uses the local wall-clock hour, not UTC", () => {
    const d = new Date(2026, 10, 21, 19, 4, 32, 120); // local 19:04:32.120
    expect(localIsoTimestamp(d).slice(0, 23)).toBe("2026-11-21T19:04:32.120");
  });
});

describe("recorded plays carry recordedAt + half", () => {
  it("regular plays", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 21, 19, 4, 32));
    const next = addPlay(makeGameState({ half: 2 }), {
      possession: "team",
      playType: "run",
      yards: 3,
    });
    const play = next.plays[0];
    expect(play.recordedAt).toMatch(LOCAL_ISO);
    expect(play.recordedAt?.slice(11, 19)).toBe("19:04:32");
    expect(play.half).toBe(2);
  });

  it("penalties record the offense at the time of the foul", () => {
    // 4th-down loss-of-down penalty flips possession; the row keeps the offense.
    const state = makeGameState({ possession: "opponent", down: 4 });
    const next = recordPenalty(state, { yards: 5, onOffense: true, lossOfDown: true });
    expect(next.possession).toBe("team");
    const row = next.plays[0];
    expect(row.possession).toBe("opponent");
    expect(row.recordedAt).toMatch(LOCAL_ISO);
  });

  it("tries and OT conversions", () => {
    const pat = recordPointAfter(makeGameState(), { type: 2, success: true });
    expect(pat.plays[0].recordedAt).toMatch(LOCAL_ISO);
    expect(pat.plays[0].half).toBe(1);

    const ot = handleOvertimeConversion(
      makeGameState({
        isOvertime: true,
        half: "OT",
        overtimeRound: 1,
        overtimeFirstOffense: "team",
        possession: "team",
        awaitingOvertimeConversion: true,
      }),
      { type: 3, success: false },
    );
    expect(ot.plays[0].recordedAt).toMatch(LOCAL_ISO);
    expect(ot.plays[0].half).toBe("OT");
  });
});

describe("generatePlayByPlayCSV", () => {
  function sampleGame() {
    let state = makeGameState({ teamName: "Eagles" });
    state = addPlay(state, {
      possession: "team",
      playType: "pass",
      yards: 14,
      complete: true,
      passer: PLAYER_QB.id,
      receiver: PLAYER_WR.id,
    });
    state = addPlay(state, {
      possession: "team",
      playType: "pass",
      yards: 31,
      complete: true,
      touchdown: true,
      passer: PLAYER_QB.id,
      receiver: PLAYER_WR.id,
    });
    state = recordPointAfter(state, { type: 3, success: true });
    state = addPlay(state, {
      possession: "opponent",
      playType: "run",
      yards: -6,
      safety: true,
    });
    return { opponent_name: "Hawks", game_data: state };
  }

  it("has a header and one row per recorded entry", () => {
    const lines = generatePlayByPlayCSV(sampleGame()).split("\n");
    expect(lines[0]).toBe(
      "#,Recorded At,Clock Time,Half,Offense,Down,To Go,Ball On,Type,Yards,Result,Scoring,Passer,Receiver,Rusher,Defender",
    );
    expect(lines).toHaveLength(5);
  });

  it("describes plays, tries, and who scored", () => {
    const [, first, td, pat, safety] = generatePlayByPlayCSV(sampleGame())
      .split("\n")
      .map((l) => l.split(","));

    expect(first[4]).toBe("Eagles");
    expect(first[8]).toBe("Pass");
    expect(first[10]).toBe("Complete; First down"); // 5 → 19 crosses the 17
    expect(first[12]).toBe("#1 Alice");
    expect(first[13]).toBe("#12 Bob");
    expect(first[2]).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    expect(td[10]).toBe("Complete; Touchdown");
    expect(td[11]).toBe("Eagles +6");

    expect(pat[8]).toBe("3-pt try");
    expect(pat[10]).toBe("Good");
    expect(pat[11]).toBe("Eagles +3");
    expect(pat[5]).toBe(""); // no down on a try

    // Safety on the opponent's snap scores for us.
    expect(safety[4]).toBe("Hawks");
    expect(safety[11]).toBe("Eagles +2");
  });

  it("leaves time columns blank for plays recorded before timestamps existed", () => {
    const game = sampleGame();
    delete game.game_data.plays[0].recordedAt;
    const row = generatePlayByPlayCSV(game).split("\n")[1].split(",");
    expect(row[1]).toBe("");
    expect(row[2]).toBe("");
  });
});
