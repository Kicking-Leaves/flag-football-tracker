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

/** True for files we import as camera film (same rule as the app). */
export function isVideoFile(file) {
  if (file?.mimeType?.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v)$/i.test(file?.name ?? "");
}

/** Minimum quiet time after a file's last change before the watcher imports it. */
export const SETTLE_MS = 2 * 60_000;

/**
 * Whether a Drive file has finished uploading. Drive only reports an MD5 once a
 * file's content is complete; waiting a couple of minutes after the last change
 * also skips files a sync client is still rewriting.
 */
export function readyToImport(file, now = Date.now()) {
  if (!isVideoFile(file)) return false;
  if (!file.md5Checksum || !(Number(file.size) > 0)) return false;
  const changed = Date.parse(file.modifiedTime ?? "");
  return Number.isFinite(changed) && now - changed >= SETTLE_MS;
}

/** Files a watch should import now: finished videos not already in the game, up to the camera limit. */
export function filesToImport(files, importedIds, cameraCount, maxCameras, now = Date.now()) {
  const room = Math.max(0, maxCameras - cameraCount);
  return files
    .filter((f) => !importedIds.has(f.id) && readyToImport(f, now))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, room);
}

// ---------- Film inbox: game folder names ----------

/** Lowercase letters and digits only, for loose name matching. */
export function squash(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isoDate(y, m, d) {
  const year = y < 100 ? 2000 + y : y;
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "12-2-26", "12-02-2026", "2026-12-02" (also with dots) → "2026-12-02". */
export function parseFolderDate(text) {
  const parts = String(text).split(/[-.]/).map((p) => p.trim());
  if (parts.length !== 3 || !parts.every((p) => /^\d{1,4}$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (parts[0].length === 4) return isoDate(a, b, c); // year first
  if (parts[2].length === 2 || parts[2].length === 4) return isoDate(c, a, b); // US month-day-year
  return null;
}

/**
 * Parses a game folder name: [<code>_]<date>_<opponent>[_<n>].
 * Inside a team folder (teamCode given) the code is optional; at the top of the
 * inbox it's required. The opponent may contain underscores ("mount_si").
 * Returns { code, date, opponent, game } or { error } with a reason a coach can act on.
 */
export function parseGameFolderName(name, { teamCode } = {}) {
  const parts = String(name ?? "").trim().split(/_+/).filter(Boolean);
  const example = teamCode
    ? "Use date_opponent_#, e.g. 12-2-26_monroe_1."
    : "Put game folders in the team's folder, named like 12-2-26_monroe_1.";
  let code = teamCode ?? null;
  // A leading team code is allowed (and checked) inside a team folder.
  if (parts.length && !parseFolderDate(parts[0])) {
    const given = squash(parts[0]);
    if (teamCode && given !== teamCode) {
      return { error: `This folder is in the ${teamCode} folder but starts with "${parts[0]}". ${example}` };
    }
    code = given;
    parts.shift();
  }
  if (!code || parts.length < 2) return { error: `Name doesn't follow the pattern. ${example}` };
  const date = parseFolderDate(parts[0]);
  if (!date) return { error: `"${parts[0]}" isn't a date like 12-2-26. ${example}` };
  let rest = parts.slice(1);
  let game = 1;
  if (rest.length > 1 && /^\d{1,2}$/.test(rest.at(-1))) {
    game = Number(rest.at(-1));
    rest = rest.slice(0, -1);
  }
  const opponent = rest.join(" ").trim();
  if (!squash(opponent) || game < 1) return { error: `Name doesn't follow the pattern. ${example}` };
  return { code, date, opponent, game };
}

/**
 * Which linked team a top-level inbox folder belongs to, if it's a team folder:
 * its name is the team's code or name, or ends with the code ("Woodinville JV").
 */
export function teamForFolder(folderName, teams) {
  const name = squash(folderName);
  if (!name) return null;
  return (
    teams.find((t) => name === t.code || name === squash(t.name)) ??
    teams.find((t) => t.code.length >= 2 && name.endsWith(t.code) && !parseFolderDate(folderName)) ??
    null
  );
}

const SCHOOL_WORDS = /(highschool|high|school|hs|academy|prep)$/;

/** Loose opponent match: "monroe" ~ "Monroe", "Monroe HS", "Monroe High School". */
export function opponentMatches(folderOpponent, gameOpponent) {
  const a = squash(folderOpponent);
  const b = squash(gameOpponent);
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (s) => {
    let out = s;
    while (SCHOOL_WORDS.test(out) && out.replace(SCHOOL_WORDS, "")) out = out.replace(SCHOOL_WORDS, "");
    return out;
  };
  return strip(a) === strip(b);
}

/** A game's calendar date where the team plays (Pacific time). */
export function localGameDate(gameDate, timeZone = "America/Los_Angeles") {
  const t = Date.parse(gameDate);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/**
 * Picks the scorekeeper's game for a parsed folder name from the team's games
 * ({ id, game_date, opponent_name, created_at }). Returns { gameId } or { error }.
 */
export function matchGame(parsed, games, timeZone = "America/Los_Angeles") {
  const sameDay = games.filter((g) => localGameDate(g.game_date, timeZone) === parsed.date);
  const [y, m, d] = parsed.date.split("-").map(Number);
  const when = `${m}/${d}/${String(y).slice(2)}`;
  if (sameDay.length === 0) return { error: `No game logged on ${when} yet. It'll match once the scorekeeper creates it.` };
  const matches = sameDay
    .filter((g) => opponentMatches(parsed.opponent, g.opponent_name))
    .sort((a, b) => Date.parse(a.game_date) - Date.parse(b.game_date) || Date.parse(a.created_at) - Date.parse(b.created_at));
  if (matches.length === 0) {
    const names = [...new Set(sameDay.map((g) => g.opponent_name))].join(", ");
    return { error: `No game against "${parsed.opponent}" on ${when}. Games that day: ${names}.` };
  }
  if (parsed.game > matches.length) {
    return { error: `Only ${matches.length} game${matches.length === 1 ? "" : "s"} against ${matches[0].opponent_name} on ${when}, so there's no game ${parsed.game}.` };
  }
  return { gameId: matches[parsed.game - 1].id };
}
