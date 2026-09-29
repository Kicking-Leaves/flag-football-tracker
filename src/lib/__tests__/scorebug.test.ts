import { describe, expect, it } from "vitest";
import {
  firstDownTargetLabel,
  ordinal,
  periodLabel,
  scorebugFromGameState,
  scorebugFromOverlayRow,
  type OverlayScoreboardRow,
} from "../scorebug";
import { makeGameState } from "./helpers";

describe("ordinal", () => {
  it("formats downs 1 through 4", () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th"]);
  });
});

describe("firstDownTargetLabel", () => {
  it("shows the yard line inside the field", () => {
    expect(firstDownTargetLabel(35)).toBe("35");
    expect(firstDownTargetLabel(50)).toBe("50");
  });

  it("shows END once the target is past the goal line", () => {
    expect(firstDownTargetLabel(51)).toBe("END");
    expect(firstDownTargetLabel(58)).toBe("END");
  });
});

describe("periodLabel", () => {
  it("labels regulation halves", () => {
    expect(periodLabel(1, 0)).toBe("1st Half");
    expect(periodLabel(2, 0)).toBe("2nd Half");
  });

  it("labels overtime with its round", () => {
    expect(periodLabel("OT", 2)).toBe("OT 2");
  });
});

describe("scorebugFromGameState", () => {
  it("formats a live down", () => {
    const state = makeGameState({
      score: { team: 21, opponent: 14 },
      possession: "team",
      half: 2,
      down: 2,
      yardsToGo: 7,
      lineOfScrimmage: 35,
      firstDownTarget: 42,
    });

    expect(scorebugFromGameState(state, "Raiders", "Falcons")).toEqual({
      teamName: "Raiders",
      teamScore: 21,
      opponentName: "Falcons",
      opponentScore: 14,
      periodLabel: "2nd Half",
      primaryLabel: "2nd & 7",
      downLabel: "2nd & 7",
      fieldLabel: "Ball on 35 → 1st: 42",
      possession: "team",
      final: false,
    });
  });

  it("drops down, field, and possession once the game is complete", () => {
    const bug = scorebugFromGameState(
      makeGameState({ completed: true, result: "win" }),
      "Raiders",
      "Falcons",
    );

    expect(bug.downLabel).toBeNull();
    expect(bug.fieldLabel).toBeNull();
    expect(bug.possession).toBeNull();
    expect(bug.final).toBe(true);
    expect(bug.primaryLabel).toBe("FINAL");
  });

  it("drops the down line while an overtime conversion is pending", () => {
    const bug = scorebugFromGameState(
      makeGameState({
        half: "OT",
        isOvertime: true,
        overtimeRound: 1,
        awaitingOvertimeConversion: true,
      }),
      "Raiders",
      "Falcons",
    );

    expect(bug.periodLabel).toBe("OT 1");
    expect(bug.downLabel).toBeNull();
    expect(bug.final).toBe(false);
    // The headline slot must never be blank, or the bar renders a hole.
    expect(bug.primaryLabel).toBe("OT TRY");
  });

  it("uses END when the first-down target is the goal line", () => {
    const bug = scorebugFromGameState(
      makeGameState({ lineOfScrimmage: 44, firstDownTarget: 56 }),
      "Raiders",
      "Falcons",
    );

    expect(bug.fieldLabel).toBe("Ball on 44 → 1st: END");
  });
});

describe("scorebugFromOverlayRow", () => {
  function makeRow(
    overrides: Partial<OverlayScoreboardRow> = {},
  ): OverlayScoreboardRow {
    return {
      team_name: "Raiders",
      opponent_name: "Falcons",
      team_score: 21,
      opponent_score: 14,
      possession: "opponent",
      half: "2",
      overtime_round: 0,
      down: 3,
      yards_to_go: 4,
      line_of_scrimmage: 28,
      first_down_target: 32,
      completed: false,
      awaiting_ot_conversion: false,
      ...overrides,
    };
  }

  it("maps a flat RPC row to the same shape as game state", () => {
    expect(scorebugFromOverlayRow(makeRow())).toEqual({
      teamName: "Raiders",
      teamScore: 21,
      opponentName: "Falcons",
      opponentScore: 14,
      periodLabel: "2nd Half",
      primaryLabel: "3rd & 4",
      downLabel: "3rd & 4",
      fieldLabel: "Ball on 28 → 1st: 32",
      possession: "opponent",
      final: false,
    });
  });

  it("parses half from JSONB text, including OT", () => {
    expect(scorebugFromOverlayRow(makeRow({ half: "1" })).periodLabel).toBe(
      "1st Half",
    );
    expect(
      scorebugFromOverlayRow(makeRow({ half: "OT", overtime_round: 3 }))
        .periodLabel,
    ).toBe("OT 3");
  });

  it("defaults an unrecognized possession to the tracked team", () => {
    expect(scorebugFromOverlayRow(makeRow({ possession: "" })).possession).toBe(
      "team",
    );
  });

  it("agrees with the game-state adapter for the same underlying values", () => {
    const fromState = scorebugFromGameState(
      makeGameState({
        score: { team: 21, opponent: 14 },
        possession: "opponent",
        half: 2,
        down: 3,
        yardsToGo: 4,
        lineOfScrimmage: 28,
        firstDownTarget: 32,
      }),
      "Raiders",
      "Falcons",
    );

    expect(scorebugFromOverlayRow(makeRow())).toEqual(fromState);
  });
});
