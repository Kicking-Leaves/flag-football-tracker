import Link from "next/link";
import type { TeamFilmInbox } from "@/lib/film/db";

/** Admin, coach and stat keeper view of the team's Drive film inbox: naming pattern and recent game folders. */
export default function FilmInboxCard({ teamId, inbox }: { teamId: string; inbox: TeamFilmInbox }) {
  const unmatched = inbox.folders.filter((f) => f.status === "unmatched");
  const matched = inbox.folders.filter((f) => f.status === "matched" && f.team_id === teamId).slice(0, 5);
  return (
    <section className="mb-6 rounded-2xl bg-white p-5 shadow-xl">
      <h2 className="text-lg font-bold text-gray-800">Film inbox</h2>
      <p className="mt-1 text-sm text-gray-600">
        After a game, open this team&apos;s folder in{" "}
        <a
          href={`https://drive.google.com/drive/folders/${inbox.folderId}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-blue-700 underline"
        >
          {inbox.folderName ?? "the film inbox"}
        </a>
        , make a folder named like <code className="rounded bg-gray-100 px-1">12-2-26_monroe_1</code> (date, opponent,
        game number that day) and drop the camera files in it. RouteRunnr checks every 20 minutes and adds them to the
        matching game.
      </p>
      {inbox.lastError && <p className="mt-2 text-sm text-red-700">{inbox.lastError}</p>}

      {unmatched.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-yellow-900">Unmatched folders</h3>
          <ul className="mt-2 space-y-2">
            {unmatched.map((f) => (
              <li key={f.id} className="rounded-xl bg-yellow-50 p-3 text-sm">
                <p className="font-mono text-xs font-semibold text-gray-800">{f.folder_name}</p>
                <p className="mt-1 text-yellow-900">{f.reason}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Rename the folder in Drive and it&apos;s rechecked on the next pass, or use <strong>Watch folder</strong> on
            the game&apos;s Film page to assign it by hand.
          </p>
        </div>
      )}

      {matched.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-gray-700">Recently matched</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {matched.map((f) => (
              <li key={f.id}>
                <Link href={`/teams/${teamId}/games/${f.game_id}/film`} className="font-mono text-xs text-blue-700 underline">
                  {f.folder_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
