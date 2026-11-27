// RouteRunnr film worker, run as a Cloud Run job.
//
//   node src/main.mjs import <cameraId>   copy from Google Drive, then process
//   node src/main.mjs process <cameraId>  read details, make the 720p copy and thumbnail
//   node src/main.mjs watch               import new videos from watched Drive folders
//                                         (run every 5 minutes by Cloud Scheduler)
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  status updates (bypasses RLS)
//   FILM_BUCKET                              Cloud Storage bucket for film
//   FILM_GCP_REGION, FILM_JOB_NAME          (watch) where to start import jobs
// Google credentials come from the job's service account (Application Default
// Credentials). Drive folders must be shared with that account.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import {
  filesToImport,
  md5Matches,
  objectPaths,
  probeDetails,
  progressFromLine,
  proxyArgs,
  shortError,
  suggestCameraName,
  thumbArgs,
} from "./lib.mjs";

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
const storage = new Storage();
const bucket = storage.bucket(env("FILM_BUCKET"));
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.readonly"] });

const CHUNK = 256 * 1024 * 1024; // Drive download range size; a failed range is retried alone.

async function loadCamera(id) {
  const { data, error } = await supabase.from("rr_film_cameras").select("*").eq("id", id).single();
  if (error) throw new Error(`Camera ${id}: ${error.message}`);
  return data;
}

async function update(id, fields) {
  const { error } = await supabase.from("rr_film_cameras").update(fields).eq("id", id);
  if (error) console.error(`Status update failed for ${id}: ${error.message}`);
}

/** Calls fn at most every `ms`, always passing the latest value. */
function throttle(fn, ms) {
  let last = 0;
  return (value) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      void fn(value);
    }
  };
}

async function driveToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("No Google access token for Drive");
  return token;
}

async function driveFileMeta(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      "?fields=id,name,size,md5Checksum,mimeType&supportsAllDrives=true",
    { headers: { Authorization: `Bearer ${await driveToken()}` } },
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Drive file not found. Is the folder still shared with RouteRunnr's importer account?"
        : `Drive metadata failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

/** Streams a Drive file in ranges, retrying each range, so an 18 GB copy survives hiccups. */
async function* driveChunks(fileId, size) {
  for (let start = 0; start < size; start += CHUNK) {
    const end = Math.min(start + CHUNK, size) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${await driveToken()}`, Range: `bytes=${start}-${end}` } },
        );
        if (res.status !== 206 && !(res.status === 200 && start === 0 && end === size - 1)) {
          throw new Error(`Drive download failed (${res.status})`);
        }
        const parts = [];
        let got = 0;
        for await (const part of Readable.fromWeb(res.body)) {
          parts.push(part);
          got += part.length;
        }
        if (got !== end - start + 1) throw new Error(`Short read: ${got} of ${end - start + 1} bytes`);
        yield Buffer.concat(parts, got);
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        console.warn(`Range ${start}-${end} attempt ${attempt} failed: ${shortError(err)}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
}

async function importFromDrive(camera) {
  if (!camera.drive_file_id) throw new Error("Camera has no Drive file to import");
  await update(camera.id, { status: "importing", progress: 0, error: null, job_execution: process.env.CLOUD_RUN_EXECUTION ?? null });

  const meta = await driveFileMeta(camera.drive_file_id);
  const size = Number(meta.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Drive didn't report a file size; is this a video file?");
  const paths = objectPaths(camera.team_id, camera.game_id, camera.id, meta.name);
  const file = bucket.file(paths.original);

  let copied = 0;
  const report = throttle((pct) => update(camera.id, { progress: pct }), 10_000);
  async function* counted() {
    for await (const chunk of driveChunks(camera.drive_file_id, size)) {
      copied += chunk.length;
      report(Math.min(99, Math.floor((copied / size) * 100)));
      yield chunk;
    }
  }
  console.log(`Copying ${meta.name} (${(size / 1e9).toFixed(2)} GB) to gs://${bucket.name}/${paths.original}`);
  await pipeline(
    Readable.from(counted()),
    file.createWriteStream({
      resumable: true,
      contentType: meta.mimeType?.startsWith("video/") ? meta.mimeType : "video/mp4",
      metadata: { metadata: { cameraId: camera.id, driveFileId: camera.drive_file_id } },
    }),
  );

  const [stored] = await file.getMetadata();
  if (Number(stored.size) !== size) throw new Error(`Copy size mismatch: ${stored.size} vs ${size}`);
  if (md5Matches(meta.md5Checksum, stored.md5Hash) === false) throw new Error("Copy checksum mismatch");

  await update(camera.id, { original_path: paths.original, size_bytes: size, source_name: meta.name, progress: 100 });
  return { ...camera, original_path: paths.original, source_name: meta.name };
}

function run(cmd, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errTail = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (onLine) onLine(line);
      else out += `${line}\n`;
    });
    child.stderr.on("data", (d) => {
      errTail = (errTail + d.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${errTail.trim().split("\n").slice(-3).join(" | ")}`)),
    );
  });
}

async function signedReadUrl(path) {
  const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 6 * 3600_000 });
  return url;
}

async function processCamera(camera) {
  if (!camera.original_path) throw new Error("Camera has no stored original to process");
  await update(camera.id, { status: "processing", progress: 0, error: null, job_execution: process.env.CLOUD_RUN_EXECUTION ?? null });

  // ffmpeg reads the original straight from Cloud Storage (range requests),
  // so the 18 GB file never has to fit on the worker.
  const input = await signedReadUrl(camera.original_path);
  const details = probeDetails(JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input])));
  if (!details.durationMs) throw new Error("Couldn't read the video's length; is the file complete?");
  await update(camera.id, {
    recorded_start_at: details.recordedStartAt,
    duration_ms: details.durationMs,
    width: details.width,
    height: details.height,
    fps: details.fps,
  });

  const dir = await mkdtemp(join(tmpdir(), "film-"));
  try {
    const paths = objectPaths(camera.team_id, camera.game_id, camera.id, camera.source_name ?? camera.original_path);
    const proxyFile = join(dir, "review.mp4");
    const thumbFile = join(dir, "thumb.jpg");

    await run("ffmpeg", thumbArgs(input, thumbFile, details.durationMs));
    await bucket.upload(thumbFile, { destination: paths.thumb, contentType: "image/jpeg" });
    await update(camera.id, { thumb_path: paths.thumb });

    const report = throttle((pct) => update(camera.id, { progress: pct }), 10_000);
    await run("ffmpeg", proxyArgs(input, proxyFile, { hasAudio: details.hasAudio }), {
      onLine: (line) => {
        const pct = progressFromLine(line, details.durationMs);
        if (pct !== null) report(pct);
      },
    });
    const { size } = await stat(proxyFile);
    console.log(`Review copy ${(size / 1e9).toFixed(2)} GB; uploading`);
    await pipeline(
      createReadStream(proxyFile),
      bucket.file(paths.proxy).createWriteStream({ resumable: true, contentType: "video/mp4" }),
    );
    await update(camera.id, { proxy_path: paths.proxy, status: "ready", progress: 100, error: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- Watched folders ----------

const MAX_CAMERAS = 8; // same limit as the app

async function listFolder(folderId) {
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, size, mimeType, md5Checksum, modifiedTime)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${await driveToken()}` },
    });
    if (res.status === 404 || res.status === 403) {
      throw new Error("RouteRunnr can't see this folder any more. Is it still shared with the importer account?");
    }
    if (!res.ok) throw new Error(`Drive listing failed (${res.status})`);
    const body = await res.json();
    files.push(...body.files);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return files;
}

const runAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

/** Starts the import worker for one camera (a separate, larger job execution). */
async function startImportJob(cameraId) {
  const project = await runAuth.getProjectId();
  const region = env("FILM_GCP_REGION");
  const job = env("FILM_JOB_NAME");
  const client = await runAuth.getClient();
  const { token } = await client.getAccessToken();
  const res = await fetch(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ overrides: { containerOverrides: [{ args: ["import", cameraId] }] } }),
  });
  if (!res.ok) throw new Error(`Couldn't start import (${res.status}): ${await res.text()}`);
}

async function checkWatch(watch) {
  const files = await listFolder(watch.folder_id);
  const { data: cams, error } = await supabase
    .from("rr_film_cameras")
    .select("drive_file_id")
    .eq("game_id", watch.game_id);
  if (error) throw new Error(error.message);
  const imported = new Set(cams.map((c) => c.drive_file_id).filter(Boolean));
  const picks = filesToImport(files, imported, cams.length, MAX_CAMERAS);
  if (picks.length === 0) return 0;

  const { data: created, error: insertError } = await supabase
    .from("rr_film_cameras")
    .insert(
      picks.map((f, i) => ({
        game_id: watch.game_id,
        name: suggestCameraName(f.name, cams.length + i),
        position: cams.length + i,
        source: "drive",
        drive_file_id: f.id,
        source_name: f.name,
        size_bytes: Number(f.size) || null,
        created_by: watch.created_by,
      })),
    )
    .select("id, name");
  if (insertError) throw new Error(insertError.message);

  let started = 0;
  for (const cam of created) {
    try {
      await startImportJob(cam.id);
      started++;
      console.log(`Watch ${watch.id}: importing ${cam.name}`);
    } catch (err) {
      await update(cam.id, { status: "failed", error: shortError(err) });
    }
  }
  return started;
}

async function runWatches() {
  const nowIso = new Date().toISOString();
  // Expired watches stop on their own.
  await supabase.from("rr_film_watches").update({ active: false }).eq("active", true).lte("expires_at", nowIso);

  const { data: watches, error } = await supabase
    .from("rr_film_watches")
    .select("id, game_id, folder_id, created_by, imported_count")
    .eq("active", true)
    .gt("expires_at", nowIso);
  if (error) throw new Error(error.message);
  console.log(`${watches.length} active watch(es)`);

  for (const watch of watches) {
    const fields = { last_checked_at: new Date().toISOString(), last_error: null };
    try {
      const started = await checkWatch(watch);
      if (started) fields.imported_count = watch.imported_count + started;
    } catch (err) {
      console.error(`Watch ${watch.id}:`, err);
      fields.last_error = shortError(err);
    }
    const { error: saveError } = await supabase.from("rr_film_watches").update(fields).eq("id", watch.id);
    if (saveError) console.error(`Watch ${watch.id} save failed: ${saveError.message}`);
  }
}

async function main() {
  const [command, cameraId] = process.argv.slice(2);
  if (command === "watch") {
    await runWatches();
    return;
  }
  if (!["import", "process"].includes(command) || !cameraId) {
    throw new Error("Usage: main.mjs import|process <cameraId> | watch");
  }
  let camera = await loadCamera(cameraId);
  try {
    if (command === "import") camera = await importFromDrive(camera);
    await processCamera(camera);
    console.log(`Camera ${cameraId} ready`);
  } catch (err) {
    console.error(err);
    await update(cameraId, { status: "failed", error: shortError(err) });
    process.exitCode = 1;
  }
}

await main();
