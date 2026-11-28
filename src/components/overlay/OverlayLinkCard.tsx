"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SCOREBUG_POSITIONS, type ScorebugPosition } from "./ScorebugBar";

/**
 * The stream overlay link for pasting into a browser source (Mevo Studio,
 * OBS). The team link follows whichever game the team is scoring, so the
 * camera operator sets it once; a game link shows only that game. Tokens are
 * the only credential: anyone with the link can see the scoreboard, nothing
 * else.
 */
export default function OverlayLinkCard({
  teamId,
  teamToken,
  gameToken = null,
  canReset = false,
  compact = false,
}: {
  teamId: string;
  teamToken: string;
  /** Offer "This game only" too (scoring screen). */
  gameToken?: string | null;
  /** Admins and coaches can issue a new team link. */
  canReset?: boolean;
  /** Inside the scoring screen's settings, without the card chrome. */
  compact?: boolean;
}) {
  const [token, setToken] = useState(teamToken);
  const [which, setWhich] = useState<"team" | "game">("team");
  const [position, setPosition] = useState<ScorebugPosition>("bottom-left");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only rendered after hydration in practice, but don't read window on the server.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  const chosen = which === "game" && gameToken ? gameToken : token;
  const url = origin
    ? `${origin}/overlay/${chosen}?delay=6${position === "bottom-left" ? "" : `&pos=${position}`}`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API needs a secure context; the field below is selectable.
    }
  }

  async function reset() {
    if (!confirm("Make a new team link? The old one stops working, so the camera setup will need the new link.")) return;
    setError(null);
    const next = crypto.randomUUID();
    const { error } = await createClient().from("rr_teams").update({ overlay_token: next }).eq("id", teamId);
    if (error) setError(error.message);
    else setToken(next);
  }

  return (
    <div className={compact ? "" : "mb-6 rounded-2xl bg-white p-5 shadow"}>
      <p className="mb-1 font-bold">Stream scoreboard</p>
      <p className="mb-3 text-sm text-gray-600">
        Add this link as a browser source in Mevo Studio or OBS.{" "}
        {which === "team"
          ? "It always shows the game this team is scoring, so set it up once and leave it."
          : "It shows only this game."}{" "}
        Anyone with the link can see the score.
      </p>

      {gameToken && (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(["team", "game"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWhich(w)}
              className={`rounded-md py-1.5 font-semibold ${which === w ? "bg-white shadow" : "text-gray-600"}`}
            >
              {w === "team" ? "Team link" : "This game only"}
            </button>
          ))}
        </div>
      )}

      <label className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">Position</span>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as ScorebugPosition)}
          className="rounded-lg bg-gray-100 px-2 py-1.5"
        >
          {SCOREBUG_POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mb-2 w-full rounded-lg bg-gray-100 px-3 py-2 font-mono text-xs"
      />
      <button
        type="button"
        onClick={copy}
        className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white"
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
      {canReset && which === "team" && (
        <button type="button" onClick={reset} className="mt-2 text-xs text-gray-500 underline">
          Make a new team link (stops the old one)
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
