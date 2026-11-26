import { describe, expect, it } from "vitest";
import { isVideoFile, parseDriveFolderId, suggestCameraName } from "../film/drive";
import { formatBytes, formatDuration, isFilmInProgress } from "../film/types";
import { pathBelongsTo } from "../film/server";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("parseDriveFolderId", () => {
  it("accepts the link shapes Drive hands out, and bare ids", () => {
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID);
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(parseDriveFolderId(`  ${ID}  `)).toBe(ID);
  });

  it("rejects things that aren't Drive folders", () => {
    expect(parseDriveFolderId("")).toBeNull();
    expect(parseDriveFolderId("https://example.com/open?id=" + ID)).toBeNull();
    expect(parseDriveFolderId("not a link")).toBeNull();
  });
});

describe("Drive files", () => {
  it("recognizes videos by type or extension", () => {
    expect(isVideoFile({ name: "a.bin", mimeType: "video/mp4" })).toBe(true);
    expect(isVideoFile({ name: "MEVO_0042.MOV" })).toBe(true);
    expect(isVideoFile({ name: "roster.csv", mimeType: "text/csv" })).toBe(false);
  });

  it("suggests camera names from file names", () => {
    expect(suggestCameraName("MEVO_Sideline_0042.MP4", 0)).toBe("MEVO Sideline 0042");
    expect(suggestCameraName(".mp4", 2)).toBe("Camera 3");
  });
});

describe("formatting", () => {
  it("formats lengths and sizes", () => {
    expect(formatDuration(5_525_000)).toBe("1:32:05");
    expect(formatDuration(247_000)).toBe("4:07");
    expect(formatDuration(null)).toBe("");
    expect(formatBytes(18_200_000_000)).toBe("18.2 GB");
    expect(formatBytes(850_000_000)).toBe("850 MB");
  });

  it("knows which statuses are still working", () => {
    expect(isFilmInProgress("importing")).toBe(true);
    expect(isFilmInProgress("ready")).toBe(false);
    expect(isFilmInProgress("failed")).toBe(false);
  });
});

describe("pathBelongsTo", () => {
  it("only allows a camera's own team and game folders", () => {
    expect(pathBelongsTo("review/team1/game1/cam.mp4", "team1", "game1")).toBe(true);
    expect(pathBelongsTo("originals/team1/game1/cam.mov", "team1", "game1")).toBe(true);
    expect(pathBelongsTo("review/team2/game1/cam.mp4", "team1", "game1")).toBe(false);
    expect(pathBelongsTo("review/team1/game2/cam.mp4", "team1", "game1")).toBe(false);
    expect(pathBelongsTo("other/team1/game1/cam.mp4", "team1", "game1")).toBe(false);
    expect(pathBelongsTo("review/team1/game1/../../team2/game9/x.mp4", "team1", "game1")).toBe(false);
  });
});
