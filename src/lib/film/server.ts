// Server-only: Google Cloud access for film (Drive listing, job runs, signed links).
// Import only from route handlers and server components; it reads a service
// account key from the environment.

import { GoogleAuth } from "google-auth-library";
import { Storage } from "@google-cloud/storage";
import { isVideoFile, type DriveVideo } from "./drive";

interface FilmConfig {
  project: string;
  region: string;
  bucket: string;
  job: string;
  credentials: { client_email: string; private_key: string };
}

let cached: FilmConfig | null | undefined;

/** Film settings from env, or null when film isn't set up for this deployment. */
export function filmConfig(): FilmConfig | null {
  if (cached !== undefined) return cached;
  const key = process.env.FILM_GCP_SA_KEY;
  const project = process.env.FILM_GCP_PROJECT;
  const bucket = process.env.FILM_BUCKET;
  if (!key || !project || !bucket) return (cached = null);
  const json = key.trim().startsWith("{") ? key : Buffer.from(key, "base64").toString("utf8");
  const credentials = JSON.parse(json) as FilmConfig["credentials"];
  cached = {
    project,
    region: process.env.FILM_GCP_REGION || "us-west1",
    bucket,
    job: process.env.FILM_JOB_NAME || "film-worker",
    credentials,
  };
  return cached;
}

function requireConfig(): FilmConfig {
  const config = filmConfig();
  if (!config) throw new FilmError("Film isn't set up yet for this site.", 503);
  return config;
}

/** The account a Drive folder must be shared with before it can be imported. */
export function filmShareEmail(): string | null {
  return filmConfig()?.credentials.client_email ?? null;
}

export class FilmError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function accessToken(scopes: string[]): Promise<string> {
  const { credentials } = requireConfig();
  const auth = new GoogleAuth({ credentials, scopes });
  const token = await auth.getAccessToken();
  if (!token) throw new FilmError("Couldn't sign in to Google Cloud.", 502);
  return token;
}

/** Video files directly inside a Drive folder shared with the film account. */
export async function listDriveFolder(folderId: string, importedIds: Set<string>): Promise<DriveVideo[]> {
  const token = await accessToken(["https://www.googleapis.com/auth/drive.readonly"]);
  const files: DriveVideo[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, size, mimeType)",
      pageSize: "200",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new FilmError(`Couldn't read that Drive folder (${res.status}).`, 502);
    const body = (await res.json()) as {
      nextPageToken?: string;
      files: { id: string; name: string; size?: string; mimeType?: string }[];
    };
    for (const f of body.files) {
      if (!isVideoFile(f)) continue;
      files.push({
        id: f.id,
        name: f.name,
        size: f.size ? Number(f.size) : null,
        mimeType: f.mimeType ?? null,
        imported: importedIds.has(f.id),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Confirms the folder is visible to the film account. Drive answers 404 both
 * for a bad link and for a folder that hasn't been shared yet.
 */
export async function checkDriveFolder(folderId: string): Promise<{ name: string }> {
  const token = await accessToken(["https://www.googleapis.com/auth/drive.readonly"]);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404 || res.status === 403) {
    throw new FilmError(
      `RouteRunnr can't see that folder. Share it with ${filmShareEmail()} (Viewer) and try again.`,
      404,
    );
  }
  if (!res.ok) throw new FilmError(`Couldn't read that Drive folder (${res.status}).`, 502);
  const body = (await res.json()) as { name: string; mimeType: string };
  if (body.mimeType !== "application/vnd.google-apps.folder") {
    throw new FilmError("That link is a file, not a folder. Paste the folder's link.");
  }
  return { name: body.name };
}

/** Starts the film worker for one camera. */
export async function startFilmJob(command: "import" | "process", cameraId: string): Promise<void> {
  const { project, region, job } = requireConfig();
  const token = await accessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const res = await fetch(
    `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: { containerOverrides: [{ args: [command, cameraId] }] } }),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new FilmError(`Couldn't start the film worker (${res.status}).`, 502);
}

let storage: Storage | null = null;
function bucket() {
  const { project, bucket: name, credentials } = requireConfig();
  storage ??= new Storage({ projectId: project, credentials });
  return storage.bucket(name);
}

/**
 * Paths the worker writes for a camera all sit under <prefix>/<team>/<game>/.
 * Links are only signed for paths inside the camera's own team and game, so a
 * bad path can never expose another team's film.
 */
export function pathBelongsTo(path: string, teamId: string, gameId: string): boolean {
  return /^(originals|review|thumbs|exports)\//.test(path) &&
    path.split("/").slice(1, 3).join("/") === `${teamId}/${gameId}` &&
    !path.includes("..");
}

/** A short-lived read link for a film object. */
export async function signedReadUrl(
  path: string,
  owner: { teamId: string; gameId: string },
  { minutes = 60, downloadName }: { minutes?: number; downloadName?: string } = {},
): Promise<string> {
  if (!pathBelongsTo(path, owner.teamId, owner.gameId)) throw new FilmError("Film not found.", 404);
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + minutes * 60_000,
      ...(downloadName
        ? { responseDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, "")}"` }
        : {}),
    });
  return url;
}

/** Deletes a camera's stored files (original, review copy, thumbnail). */
export async function deleteFilmObjects(paths: (string | null)[], owner: { teamId: string; gameId: string }) {
  const b = bucket();
  await Promise.all(
    paths
      .filter((p): p is string => Boolean(p) && pathBelongsTo(p as string, owner.teamId, owner.gameId))
      .map((p) => b.file(p).delete({ ignoreNotFound: true })),
  );
}
