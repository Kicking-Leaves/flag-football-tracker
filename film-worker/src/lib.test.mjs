import { describe, expect, it } from "vitest";
import {
  md5Matches,
  objectPaths,
  parseFrameRate,
  probeDetails,
  progressFromLine,
  proxyArgs,
  thumbArgs,
} from "./lib.mjs";

describe("objectPaths", () => {
  it("files each camera under lifecycle prefixes, keeping the original's extension", () => {
    expect(objectPaths("t", "g", "c", "MEVO_0042.MOV")).toEqual({
      original: "originals/t/g/c.mov",
      proxy: "review/t/g/c.mp4",
      thumb: "thumbs/t/g/c.jpg",
    });
    expect(objectPaths("t", "g", "c").original).toBe("originals/t/g/c.mp4");
  });
});

describe("probeDetails", () => {
  const probe = {
    format: { duration: "5400.533", tags: { creation_time: "2026-11-21T18:58:02.000000Z" } },
    streams: [
      { codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
      { codec_type: "audio" },
    ],
  };

  it("reads start time, length, size and frame rate", () => {
    expect(probeDetails(probe)).toEqual({
      recordedStartAt: "2026-11-21T18:58:02.000Z",
      durationMs: 5400533,
      width: 1920,
      height: 1080,
      fps: 29.97,
      hasAudio: true,
    });
  });

  it("falls back to the video stream's creation time and copes with missing tags", () => {
    const streamOnly = { format: { duration: "10" }, streams: [{ codec_type: "video", tags: { creation_time: "2026-11-21T19:00:00Z" } }] };
    expect(probeDetails(streamOnly).recordedStartAt).toBe("2026-11-21T19:00:00.000Z");
    expect(probeDetails(streamOnly).hasAudio).toBe(false);
    expect(probeDetails({ format: {}, streams: [] })).toMatchObject({ recordedStartAt: null, durationMs: null, fps: null });
  });
});

describe("parseFrameRate", () => {
  it("handles fractions and junk", () => {
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
  });
});

describe("ffmpeg arguments", () => {
  it("makes a 720p copy with a keyframe every second and faststart", () => {
    const args = proxyArgs("in", "out.mp4");
    expect(args).toContain("scale=-2:720");
    expect(args).toContain("expr:gte(t,n_forced*1)");
    expect(args).toContain("+faststart");
    expect(args.at(-1)).toBe("out.mp4");
    expect(args).toContain("0:a:0");
    expect(proxyArgs("in", "out.mp4", { hasAudio: false })).not.toContain("0:a:0");
  });

  it("takes the thumbnail a minute in, or halfway through short clips", () => {
    expect(thumbArgs("in", "t.jpg", 5_400_000)).toContain("60.0");
    expect(thumbArgs("in", "t.jpg", 20_000)).toContain("10.0");
  });
});

describe("progressFromLine", () => {
  it("turns ffmpeg progress into a capped percentage", () => {
    expect(progressFromLine("out_time_us=2700000000", 5_400_000)).toBe(50);
    expect(progressFromLine("out_time_ms=5400000000", 5_400_000)).toBe(99);
    expect(progressFromLine("frame=100", 5_400_000)).toBeNull();
  });
});

describe("md5Matches", () => {
  it("compares Drive hex with Cloud Storage base64", () => {
    const hex = "9e107d9d372bb6826bd81d3542a419d6";
    const b64 = Buffer.from(hex, "hex").toString("base64");
    expect(md5Matches(hex, b64)).toBe(true);
    expect(md5Matches(hex, Buffer.from("00".repeat(16), "hex").toString("base64"))).toBe(false);
    expect(md5Matches(undefined, b64)).toBeNull();
  });
});

import { filesToImport, readyToImport, SETTLE_MS } from "./lib.mjs";

describe("watcher", () => {
  const now = Date.parse("2026-11-28T20:00:00Z");
  const old = new Date(now - SETTLE_MS - 1000).toISOString();
  const fresh = new Date(now - 30_000).toISOString();
  const file = (id, extra = {}) => ({ id, name: `${id}.MP4`, mimeType: "video/mp4", size: "1000", md5Checksum: "abc", modifiedTime: old, ...extra });

  it("only imports videos that have finished uploading and settled", () => {
    expect(readyToImport(file("a"), now)).toBe(true);
    expect(readyToImport(file("a", { md5Checksum: undefined }), now)).toBe(false);
    expect(readyToImport(file("a", { modifiedTime: fresh }), now)).toBe(false);
    expect(readyToImport(file("a", { size: "0" }), now)).toBe(false);
    expect(readyToImport({ ...file("a"), name: "notes.txt", mimeType: "text/plain" }, now)).toBe(false);
  });

  it("skips files already imported and respects the camera limit", () => {
    const files = [file("c"), file("a"), file("b"), file("d", { modifiedTime: fresh })];
    expect(filesToImport(files, new Set(["b"]), 0, 8, now).map((f) => f.id)).toEqual(["a", "c"]);
    expect(filesToImport(files, new Set(), 7, 8, now).map((f) => f.id)).toEqual(["a"]);
    expect(filesToImport(files, new Set(), 8, 8, now)).toEqual([]);
  });

});

import { localGameDate, matchGame, opponentMatches, parseFolderDate, parseGameFolderName, teamForFolder } from "./lib.mjs";

describe("inbox folder names", () => {
  it("reads dates in the usual US and ISO shapes", () => {
    expect(parseFolderDate("12-2-26")).toBe("2026-12-02");
    expect(parseFolderDate("12-02-2026")).toBe("2026-12-02");
    expect(parseFolderDate("2026-12-02")).toBe("2026-12-02");
    expect(parseFolderDate("12.2.26")).toBe("2026-12-02");
    expect(parseFolderDate("2-30-26")).toBeNull();
    expect(parseFolderDate("12-2")).toBeNull();
  });

  it("parses team, date, opponent and game number", () => {
    expect(parseGameFolderName("varsity_12-2-26_monroe_1")).toEqual({ code: "varsity", date: "2026-12-02", opponent: "monroe", game: 1 });
    expect(parseGameFolderName("JV_12-2-26_Monroe")).toEqual({ code: "jv", date: "2026-12-02", opponent: "Monroe", game: 1 });
    expect(parseGameFolderName("varsity_12-2-26_mount_si_2")).toMatchObject({ opponent: "mount si", game: 2 });
  });

  it("explains names that don't fit", () => {
    expect(parseGameFolderName("monroe film").error).toMatch(/pattern/);
    expect(parseGameFolderName("varsity_dec2_monroe").error).toMatch(/isn't a date/);
  });

  it("inside a team folder, the team code is optional but must match if given", () => {
    expect(parseGameFolderName("12-2-26_monroe_1", { teamCode: "varsity" })).toEqual({ code: "varsity", date: "2026-12-02", opponent: "monroe", game: 1 });
    expect(parseGameFolderName("varsity_12-2-26_monroe", { teamCode: "varsity" })).toMatchObject({ code: "varsity", opponent: "monroe" });
    expect(parseGameFolderName("jv_12-2-26_monroe", { teamCode: "varsity" }).error).toMatch(/in the varsity folder/);
    expect(parseGameFolderName("12-2-26", { teamCode: "varsity" }).error).toMatch(/pattern/);
  });

  it("at the top of the inbox, a game folder needs its team code", () => {
    expect(parseGameFolderName("12-2-26_monroe_1").error).toMatch(/team's folder/);
  });

  it("recognizes team folders by code or name", () => {
    const teams = [
      { team_id: "v", code: "varsity", name: "Woodinville Varsity" },
      { team_id: "j", code: "jv", name: "Woodinville JV" },
    ];
    expect(teamForFolder("Woodinville Varsity", teams)?.team_id).toBe("v");
    expect(teamForFolder("Woodinville JV", teams)?.team_id).toBe("j");
    expect(teamForFolder("JV", teams)?.team_id).toBe("j");
    expect(teamForFolder("varsity_12-2-26_monroe_1", teams)).toBeNull();
    expect(teamForFolder("Scouting", teams)).toBeNull();
  });

  it("matches opponents loosely", () => {
    expect(opponentMatches("monroe", "Monroe HS")).toBe(true);
    expect(opponentMatches("monroe", "Monroe High School")).toBe(true);
    expect(opponentMatches("mount si", "Mount Si")).toBe(true);
    expect(opponentMatches("monroe", "Mountlake Terrace")).toBe(false);
  });

  it("uses the Pacific calendar date of a game", () => {
    expect(localGameDate("2026-12-03T03:30:00Z")).toBe("2026-12-02"); // 7:30pm Dec 2 in Seattle
  });

  describe("matchGame", () => {
    const games = [
      { id: "g1", game_date: "2026-12-02T18:00:00Z", opponent_name: "Monroe", created_at: "2026-12-02T17:00:00Z" },
      { id: "g2", game_date: "2026-12-02T21:00:00Z", opponent_name: "Monroe", created_at: "2026-12-02T20:00:00Z" },
      { id: "g3", game_date: "2026-12-02T23:00:00Z", opponent_name: "Redmond", created_at: "2026-12-02T22:00:00Z" },
    ];
    const parsed = (game = 1, opponent = "monroe", date = "2026-12-02") => ({ code: "varsity", date, opponent, game });

    it("picks the nth game against that opponent that day", () => {
      expect(matchGame(parsed(1), games)).toEqual({ gameId: "g1" });
      expect(matchGame(parsed(2), games)).toEqual({ gameId: "g2" });
      expect(matchGame(parsed(1, "redmond"), games)).toEqual({ gameId: "g3" });
    });

    it("says why nothing matched", () => {
      expect(matchGame(parsed(1, "monroe", "2025-12-02"), games).error).toMatch(/No game logged on 12\/2\/25/);
      expect(matchGame(parsed(1, "bothell"), games).error).toMatch(/Games that day: Monroe, Redmond/);
      expect(matchGame(parsed(3), games).error).toMatch(/Only 2 games/);
    });
  });
});
