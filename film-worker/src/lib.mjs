// Pure helpers for the film worker (no I/O), unit-tested from the repo root.

/** Cloud Storage object paths for a camera. Prefixes drive the bucket's lifecycle rules. */
export function objectPaths(teamId, gameId, cameraId, sourceName = "") {
  const ext = (/\.([a-z0-9]{2,4})$/i.exec(sourceName)?.[1] ?? "mp4").toLowerCase();
  const base = `${teamId}/${gameId}/${cameraId}`;
  return {
    original: `originals/${base}.${ext}`,
    proxy: `review/${base}.mp4`,
    thumb: `thumbs/${base}.jpg`,
  };
}

/** Parses an ffmpeg frame rate like "30000/1001" or "30/1". */
export function parseFrameRate(rate) {
  if (!rate || typeof rate !== "string") return null;
  const [n, d = "1"] = rate.split("/");
  const value = Number(n) / Number(d);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

/**
 * Recording details from `ffprobe -show_format -show_streams` JSON.
 * Mevo files carry the recording start in `creation_time` (as VeloCut uses).
 */
export function probeDetails(probe) {
  const streams = probe?.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video") ?? null;
  const format = probe?.format ?? {};
  const creation =
    format.tags?.creation_time ?? video?.tags?.creation_time ?? null;
  const startMs = creation ? Date.parse(creation) : NaN;
  const seconds = Number(format.duration ?? video?.duration);
  return {
    recordedStartAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

/**
 * ffmpeg arguments for the 720p review copy: H.264 ~2.5 Mbps with a keyframe
 * every second (whatever the frame rate) so jumping to a play is instant, and
 * faststart so playback begins before the whole file loads.
 */
export function proxyArgs(input, output, { hasAudio = true } = {}) {
  return [
    "-hide_banner", "-nostdin", "-y",
    "-i", input,
    "-map", "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", "scale=-2:720",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-b:v", "2500k", "-maxrate", "3000k", "-bufsize", "5000k",
    "-force_key_frames", "expr:gte(t,n_forced*1)", "-sc_threshold", "0",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : []),
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    output,
  ];
}

/** ffmpeg arguments for one 640px-wide thumbnail, taken a minute in (or halfway for short files). */
export function thumbArgs(input, output, durationMs) {
  const at = durationMs ? Math.min(60, durationMs / 2000) : 0;
  return [
    "-hide_banner", "-nostdin", "-y",
    "-ss", at.toFixed(1), "-i", input,
    "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4",
    output,
  ];
}

/** Percent done from an ffmpeg `-progress` line (out_time_us / out_time_ms are both microseconds). */
export function progressFromLine(line, durationMs) {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (!m || !durationMs) return null;
  const pct = Math.floor(Number(m[1]) / 1000 / durationMs * 100);
  return Math.max(0, Math.min(99, pct));
}

/** Google Drive's md5Checksum (hex) vs Cloud Storage's md5Hash (base64). */
export function md5Matches(driveHex, gcsBase64) {
  if (!driveHex || !gcsBase64) return null; // can't tell
  return Buffer.from(gcsBase64, "base64").toString("hex") === driveHex.toLowerCase();
}

/** Keep error text short enough to show in the app. */
export function shortError(err) {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}
