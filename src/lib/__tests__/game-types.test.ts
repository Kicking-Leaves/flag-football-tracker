import { describe, it, expect } from "vitest";
import { computePlayerSeasonStats, computeSeasonStats } from "../db";
import { addPlay } from "../game-engine";
import { gameSackStats, playerStatsWithSacks } from "../sacks";
import { generateGameCSV, generatePlayByPlayCSV, generateSeasonCSV } from "../csv";
import { countsForSeason, inSeasonScope, type Game, type GameType } from "../types";
import { makeGame, makeGameState, PLAYER_DB, PLAYER_QB } from "./helpers";

function typed(type: GameType | undefined, result: "win" | "loss" = "win", pf = 14, pa = 7): Game {
  return { ...makeGame(result, pf, pa), game_type: type } as Game;
}

/** A game with one defensive player sack (by Dave), one defensive coverage
 *  sack, one of our passers sacked, and one coverage sack against us. */
function sackGameState() {
  let g = makeGameState({ possession: "opponent" });
  g = addPlay(g, {
    possession: "opponent",
    playType: "pass",
    yards: -4,
    complete: false,
    sack: true,
    flagPull: true,
    defender: PLAYER_DB.id,
  });
  g = addPlay(g, { possession: "opponent", playType: "coverage_sack", yards: 0 });
  g = { ...g, possession: "team" };
  g = addPlay(g, {
    possession: "team",
    playType: "pass",
    yards: -3,
    complete: false,
    sack: true,
    passer: PLAYER_QB.id,
  });
  g = addPlay(g, { possession: "team", playType: "coverage_sack", yards: 0 });
  return g;
}

describe("game type scope", () => {
  it("scrimmages never count; missing type is regular season", () => {
    expect(countsForSeason({ game_type: "scrimmage" })).toBe(false);
    expect(countsForSeason({})).toBe(true);
    expect(inSeasonScope({ game_type: "scrimmage" }, "full")).toBe(false);
    expect(inSeasonScope({}, "regular")).toBe(true);
    expect(inSeasonScope({ game_type: "postseason" }, "regular")).toBe(false);
    expect(inSeasonScope({ game_type: "postseason" }, "postseason")).toBe(true);
    expect(inSeasonScope({ game_type: "postseason" }, "full")).toBe(true);
  });

  it("season stats skip scrimmages and split regular/postseason", () => {
    const games = [
      typed("scrimmage", "loss", 0, 30),
      typed("regular", "win", 20, 6),
      typed(undefined, "loss", 6, 12),
      typed("postseason", "win", 28, 14),
    ];
    const full = computeSeasonStats(games);
    expect(full.gamesPlayed).toBe(3);
    expect(full.wins).toBe(2);
    expect(full.losses).toBe(1);
    expect(full.totalPointsAgainst).toBe(32);

    const regular = computeSeasonStats(games, "regular");
    expect(regular.gamesPlayed).toBe(2);
    expect(regular.totalPointsFor).toBe(26);

    const post = computeSeasonStats(games, "postseason");
    expect(post.gamesPlayed).toBe(1);
    expect(post.totalPointsFor).toBe(28);
  });

  it("player totals skip scrimmages but the game log keeps them", () => {
    const withPass = (type: GameType) => {
      let gd = makeGameState();
      gd = addPlay(gd, { possession: "team", playType: "pass", yards: 10, complete: true, passer: PLAYER_QB.id });
      return { ...makeGame("win", 6, 0), game_type: type, game_data: gd } as Game;
    };
    const { total, lines } = computePlayerSeasonStats(
      [withPass("scrimmage"), withPass("regular")],
      PLAYER_QB.id,
      PLAYER_QB.name,
      PLAYER_QB.number,
    );
    expect(lines).toHaveLength(2);
    expect(total.offense.passAttempts).toBe(1);
  });
});

describe("sacks", () => {
  it("counts player and coverage sacks for both sides from the play log", () => {
    const { team, byPlayer } = gameSackStats(sackGameState());
    expect(team).toEqual({ playerSacks: 1, coverageSacks: 1, sackedAllowed: 1, coverageSacksAllowed: 1 });
    expect(byPlayer).toEqual({ [PLAYER_DB.id]: 1 });
  });

  it("credits the defender and still counts the flag pull and TFL", () => {
    const ps = playerStatsWithSacks(sackGameState())[PLAYER_DB.id];
    expect(ps.defense.sacks).toBe(1);
    expect(ps.defense.flagPulls).toBe(1);
    expect(ps.defense.tacklesForLoss).toBe(1);
  });

  it("a flag pull for a loss without the sack flag isn't a sack", () => {
    let g = makeGameState({ possession: "opponent" });
    g = addPlay(g, { possession: "opponent", playType: "pass", yards: -2, complete: true, flagPull: true, defender: PLAYER_DB.id });
    expect(gameSackStats(g).team.playerSacks).toBe(0);
  });

  it("season totals add sacks across counted games only", () => {
    const gd = sackGameState();
    const games = [
      { ...makeGame("win", 7, 0), game_type: "regular", game_data: gd },
      { ...makeGame("win", 7, 0), game_type: "postseason", game_data: gd },
      { ...makeGame("win", 7, 0), game_type: "scrimmage", game_data: gd },
    ] as Game[];
    const stats = computeSeasonStats(games);
    expect(stats.sacks.playerSacks).toBe(2);
    expect(stats.sacks.coverageSacks).toBe(2);
    expect(stats.playerStats[PLAYER_DB.id].defense.sacks).toBe(2);
    expect(computeSeasonStats(games, "postseason").sacks.coverageSacksAllowed).toBe(1);
  });
});

describe("exports", () => {
  it("game CSV includes game type, team sacks and player sacks", () => {
    const csv = generateGameCSV({
      opponent_name: "Monroe",
      game_date: "2026-12-02",
      game_type: "scrimmage",
      teamName: "Woodinville",
      game_data: sackGameState(),
    });
    expect(csv).toContain("Game Type,Scrimmage");
    expect(csv).toContain("Player Sacks,1");
    expect(csv).toContain("Coverage Sacks,1");
    expect(csv).toContain("Total Sacks,2");
    expect(csv).toContain("Coverage Sacks Allowed,1");
    expect(csv).toContain("Player,Tackles,TFL,Sacks,INT,PD");
    expect(csv).toContain("#34 Dave,1,1,1,0,0");
  });

  it("play-by-play marks sacks", () => {
    const csv = generatePlayByPlayCSV({ opponent_name: "Monroe", game_data: sackGameState() });
    expect(csv).toContain("Sack");
  });

  it("season CSV names the scope and lists only the games it covers", () => {
    const games = [
      { ...typed("regular"), opponent_name: "Monroe" },
      { ...typed("postseason"), opponent_name: "Bothell" },
      { ...typed("scrimmage"), opponent_name: "Redmond" },
    ] as Game[];
    const csv = generateSeasonCSV("Woodinville", computeSeasonStats(games, "postseason"), {
      seasonName: "Fall 2026",
      scope: "postseason",
      games,
    });
    expect(csv).toContain("Woodinville Fall 2026 Season Statistics");
    expect(csv).toContain("Covers,Postseason");
    expect(csv).toContain("Player Sacks,0");
    expect(csv).toContain("Bothell");
    expect(csv).not.toContain("Monroe");
    expect(csv).not.toContain("Redmond");
  });
});
