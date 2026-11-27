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
