"use client";

import { useEffect, useState } from "react";
import { suggestCameraName, type DriveVideo } from "@/lib/film/drive";
import {
  FILM_STATUS_LABELS,
  formatBytes,
  formatDuration,
  isFilmInProgress,
  type FilmCameraView,
  type FilmWatch,
} from "@/lib/film/types";

/** Check often while film is copying; slowly while only waiting on a watched folder. */
const POLL_MS = 5000;
const WATCH_POLL_MS = 30_000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export default function FilmManager({
  gameId,
  initialCameras,
  initialWatches,
  canManage,
  configured,
  shareEmail,
}: {
  gameId: string;
  initialCameras: FilmCameraView[];
  initialWatches: FilmWatch[];
  canManage: boolean;
  configured: boolean;
  shareEmail: string | null;
}) {
  const [cameras, setCameras] = useState(initialCameras);
  const [watches, setWatches] = useState(initialWatches);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const working = cameras.some((c) => isFilmInProgress(c.status));
  const watching = watches.some((w) => w.active);

  async function refresh() {
    try {
      const next = await api<{ cameras: FilmCameraView[]; watches: FilmWatch[] }>(`/api/film/games/${gameId}/cameras`);
      setCameras(next.cameras);
      setWatches(next.watches);
    } catch {
      // Keep showing the last good list; the next poll will try again.
    }
  }

  // While anything is copying or a folder is being watched, check for progress.
  useEffect(() => {
    if (!working && !watching) return;
    const timer = setInterval(() => void refresh(), working ? POLL_MS : WATCH_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only reads gameId
  }, [working, watching, gameId]);

  function toggleWatch(w: FilmWatch) {
    void act(
      `watch:${w.id}`,
      () => api(`/api/film/watches/${w.id}`, { method: "PATCH", body: JSON.stringify({ active: !w.active }) }),
      w.active ? "Couldn't stop watching." : "Couldn't resume watching.",
    );
  }

  async function act(key: string, action: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(null);
    }
  }

  function rename(c: FilmCameraView) {
    const name = prompt("Camera name", c.name)?.trim();
    if (!name || name === c.name) return;
    void act(
      `rename:${c.id}`,
      () => api(`/api/film/cameras/${c.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "Couldn't rename the camera.",
    );
  }

  function remove(c: FilmCameraView) {
    if (!confirm(`Delete ${c.name}? Its film is deleted from RouteRunnr (your Drive copy isn't touched).`)) return;
    void act(`delete:${c.id}`, () => api(`/api/film/cameras/${c.id}`, { method: "DELETE" }), "Couldn't delete the camera.");
  }

  function retry(c: FilmCameraView) {
    void act(`retry:${c.id}`, () => api(`/api/film/cameras/${c.id}/retry`, { method: "POST" }), "Couldn't restart the camera.");
  }

  return (
    <>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!configured && (
        <p className="mb-4 rounded-xl bg-yellow-50 p-4 text-sm text-yellow-900">
          Film storage isn&apos;t connected yet. Once it is, coaches can import camera recordings here.
        </p>
      )}

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-3 text-lg font-bold text-gray-800">Cameras ({cameras.length})</h3>
        {cameras.length === 0 ? (
          <p className="text-sm text-gray-500">
            {canManage ? "No film yet. Import camera recordings from Google Drive below." : "No film yet for this game."}
          </p>
        ) : (
          <ul className="space-y-3">
            {cameras.map((c) => (
              <CameraRow
                key={c.id}
                camera={c}
                canManage={canManage}
                busy={busy}
                onRename={() => rename(c)}
                onDelete={() => remove(c)}
                onRetry={() => retry(c)}
              />
            ))}
          </ul>
        )}
      </section>

      {watches.length > 0 && (
        <section className="mb-6 rounded-2xl bg-white p-5 shadow-xl">
          <h3 className="mb-3 text-lg font-bold text-gray-800">Watched Drive folders</h3>
          <ul className="space-y-2">
            {watches.map((w) => (
              <WatchRow key={w.id} watch={w} canManage={canManage} busy={busy} onToggle={() => toggleWatch(w)} />
            ))}
          </ul>
        </section>
      )}

      {canManage && configured && (
        <DriveImport gameId={gameId} shareEmail={shareEmail} cameraCount={cameras.length} onImported={refresh} />
      )}
    </>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "not checked yet";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins} min ago`;
  return `checked ${new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

function WatchRow({
  watch: w,
  canManage,
  busy,
  onToggle,
}: {
  watch: FilmWatch;
  canManage: boolean;
  busy: string | null;
  onToggle: () => void;
}) {
  // The watcher marks expired watches inactive on its next run.
  const on = w.active;
  return (
    <li className="rounded-xl bg-gray-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-gray-800">{w.folder_name ?? "Drive folder"}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${on ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"}`}
        >
          {on ? "Watching" : "Stopped"}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {on
          ? `New videos import automatically · ${timeAgo(w.last_checked_at)} · until ${new Date(w.expires_at).toLocaleDateString([], { month: "short", day: "numeric" })}`
          : "Not checking for new videos"}
        {w.imported_count > 0 && ` · ${w.imported_count} imported`}
      </p>
      {on && w.last_error && <p className="mt-1 text-xs text-red-700">{w.last_error}</p>}
      {canManage && (
        <button
          type="button"
          onClick={onToggle}
          disabled={busy !== null}
          className="mt-2 text-sm font-semibold text-blue-700 underline disabled:opacity-50"
        >
          {busy === `watch:${w.id}` ? "Saving…" : on ? "Stop watching" : "Watch again for 7 days"}
        </button>
      )}
    </li>
  );
}

function CameraRow({
  camera: c,
  canManage,
  busy,
  onRename,
  onDelete,
  onRetry,
}: {
  camera: FilmCameraView;
  canManage: boolean;
  busy: string | null;
  onRename: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const inProgress = isFilmInProgress(c.status);
  const details = [
    formatDuration(c.duration_ms),
    c.height ? `${c.height}p${c.fps ? Math.round(c.fps) : ""}` : "",
    formatBytes(c.size_bytes),
    c.recorded_start_at
      ? `started ${new Date(c.recorded_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "",
  ].filter(Boolean);

  return (
    <li className="flex gap-3 rounded-xl bg-gray-50 p-3">
      <div className="h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200">
        {c.thumbUrl && (
          // Signed Cloud Storage links aren't a fit for next/image's optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-gray-800">{c.name}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              c.status === "ready"
                ? "bg-green-100 text-green-800"
                : c.status === "failed"
                  ? "bg-red-100 text-red-800"
                  : "bg-blue-100 text-blue-800"
            }`}
          >
            {FILM_STATUS_LABELS[c.status]}
            {inProgress && c.status !== "queued" ? ` · ${c.progress}%` : ""}
          </span>
        </div>
        {inProgress && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(3, c.progress)}%` }} />
          </div>
        )}
        {details.length > 0 && <p className="mt-1 text-xs text-gray-500">{details.join(" · ")}</p>}
        {c.source_name && <p className="truncate text-xs text-gray-400">{c.source_name}</p>}
        {c.status === "failed" && c.error && <p className="mt-1 text-xs text-red-700">{c.error}</p>}
        {canManage && (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button type="button" onClick={onRename} disabled={busy !== null} className="font-semibold text-blue-700 underline disabled:opacity-50">
              Rename
            </button>
            {c.status === "failed" && (
              <button type="button" onClick={onRetry} disabled={busy !== null} className="font-semibold text-blue-700 underline disabled:opacity-50">
                {busy === `retry:${c.id}` ? "Retrying…" : "Retry"}
              </button>
            )}
            {!inProgress && (
              <button type="button" onClick={onDelete} disabled={busy !== null} className="font-semibold text-red-700 underline disabled:opacity-50">
                {busy === `delete:${c.id}` ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

interface Pick {
  selected: boolean;
  name: string;
}

function DriveImport({
  gameId,
  shareEmail,
  cameraCount,
  onImported,
}: {
  gameId: string;
  shareEmail: string | null;
  cameraCount: number;
  onImported: () => Promise<void>;
}) {
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState<DriveVideo[] | null>(null);
  const [folderName, setFolderName] = useState("");
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [watchingNow, setWatchingNow] = useState(false);

  async function watch() {
    if (!folder.trim()) {
      setError("Paste the folder's link first.");
      return;
    }
    setWatchingNow(true);
    setError(null);
    try {
      await api(`/api/film/games/${gameId}/watches`, { method: "POST", body: JSON.stringify({ folder }) });
      setFolder("");
      setFiles(null);
      await onImported();
    } catch (err) {
      setError(errorText(err, "Couldn't watch that folder."));
    } finally {
      setWatchingNow(false);
    }
  }

  async function findVideos(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ folderName: string; files: DriveVideo[] }>("/api/film/drive-folder", {
        method: "POST",
        body: JSON.stringify({ gameId, folder }),
      });
      setFiles(res.files);
      setFolderName(res.folderName);
      setPicks(
        Object.fromEntries(
          res.files.map((f, i) => [f.id, { selected: !f.imported, name: suggestCameraName(f.name, cameraCount + i) }]),
        ),
      );
    } catch (err) {
      setError(errorText(err, "Couldn't read that folder."));
      setFiles(null);
    } finally {
      setLoading(false);
    }
  }

  async function startImport() {
    if (!files) return;
    const cameras = files
      .filter((f) => !f.imported && picks[f.id]?.selected)
      .map((f) => ({ driveFileId: f.id, name: picks[f.id].name, sourceName: f.name, size: f.size }));
    if (cameras.length === 0) {
      setError("Pick at least one video.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await api<{ started: number; failed: string[] }>(`/api/film/games/${gameId}/cameras`, {
        method: "POST",
        body: JSON.stringify({ cameras }),
      });
      if (res.failed.length) setError(`Couldn't start: ${res.failed.join(", ")}. Try those again.`);
      setFiles(null);
      setFolder("");
      await onImported();
    } catch (err) {
      setError(errorText(err, "Couldn't start the import."));
    } finally {
      setImporting(false);
    }
  }

  async function copyEmail() {
    if (!shareEmail) return;
    try {
      await navigator.clipboard.writeText(shareEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Press-and-hold to copy still works.
    }
  }

  const selectedCount = files?.filter((f) => !f.imported && picks[f.id]?.selected).length ?? 0;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-xl">
      <h3 className="mb-2 text-lg font-bold text-gray-800">Import from Google Drive</h3>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-gray-600">
        <li>Upload the camera files for this game to a Drive folder.</li>
        <li>
          Share the folder (Viewer) with{" "}
          <button type="button" onClick={copyEmail} className="break-all font-mono text-xs text-blue-700 underline">
            {shareEmail}
          </button>
          {copied && <span className="ml-1 text-green-700">Copied</span>}
        </li>
        <li>
          Paste the folder&apos;s link, then either pick videos now with <strong>Find videos</strong>, or tap{" "}
          <strong>Watch folder</strong> to import every video automatically as it finishes uploading (checked every 5
          minutes for 7 days). You can set up the watch before the game.
        </li>
      </ol>

      <form onSubmit={findVideos} className="flex gap-2">
        <input
          type="url"
          required
          placeholder="https://drive.google.com/drive/folders/…"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border-2 border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={loading || watchingNow} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {loading ? "Looking…" : "Find videos"}
        </button>
      </form>
      <button
        type="button"
        onClick={watch}
        disabled={loading || watchingNow}
        className="mt-2 w-full rounded-xl border-2 border-blue-600 py-2 text-sm font-bold text-blue-700 disabled:opacity-50"
      >
        {watchingNow ? "Setting up…" : "Watch folder: import new videos automatically"}
      </button>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {files && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-gray-700">
            {files.length === 0 ? `No videos in “${folderName}”.` : `Videos in “${folderName}”. Name each camera:`}
          </p>
          <ul className="space-y-2">
            {files.map((f) => {
              const pick = picks[f.id];
              return (
                <li key={f.id} className="rounded-xl bg-gray-50 p-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={f.imported}
                      checked={!f.imported && Boolean(pick?.selected)}
                      onChange={(e) => setPicks((p) => ({ ...p, [f.id]: { ...p[f.id], selected: e.target.checked } }))}
                    />
                    <span className="min-w-0 flex-1 truncate text-gray-600">{f.name}</span>
                    <span className="text-xs text-gray-400">{f.imported ? "Already imported" : formatBytes(f.size)}</span>
                  </label>
                  {!f.imported && pick?.selected && (
                    <input
                      value={pick.name}
                      maxLength={60}
                      onChange={(e) => setPicks((p) => ({ ...p, [f.id]: { ...p[f.id], name: e.target.value } }))}
                      aria-label={`Camera name for ${f.name}`}
                      className="mt-2 w-full rounded-lg border-2 border-gray-300 px-2 py-1 font-semibold"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {files.length > 0 && (
            <button
              type="button"
              onClick={startImport}
              disabled={importing || selectedCount === 0}
              className="mt-3 w-full rounded-xl bg-green-600 py-3 font-bold text-white disabled:opacity-50"
            >
              {importing ? "Starting…" : `Import ${selectedCount} camera${selectedCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
