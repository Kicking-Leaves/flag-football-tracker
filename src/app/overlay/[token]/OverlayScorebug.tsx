"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOverlayScoreboard } from "@/lib/db";
import { scorebugFromOverlayRow, type ScorebugData } from "@/lib/scorebug";
import ScorebugBar, {
  type ScorebugPosition,
} from "@/components/overlay/ScorebugBar";

/** How often to ask the database for the current scoreboard. */
const POLL_MS = 2000;
/** How often to advance the delay buffer toward the present. */
const TICK_MS = 250;

interface OverlayScorebugProps {
  token: string;
  initial: ScorebugData;
  position: ScorebugPosition;
  /**
   * Seconds to hold each update back before showing it. The video path (encode
   * → RTMP → YouTube) runs several seconds behind the scorer's phone, so an
   * un-delayed bug spoils every play before viewers see it.
   */
  delaySeconds: number;
  scale: number;
  debug: boolean;
}

interface Snapshot {
  /** When this state became visible-eligible (wall clock ms). */
  at: number;
  data: ScorebugData;
}

export default function OverlayScorebug({
  token,
  initial,
  position,
  delaySeconds,
  scale,
  debug,
}: OverlayScorebugProps) {
  const supabase = useMemo(() => createClient(), []);
  const delayMs = delaySeconds * 1000;

  // `visible` starts from the server-rendered snapshot, so the bug paints
  // immediately rather than leaving the frame empty for `delaySeconds` at
  // stream start. The queue only holds changes still waiting out the delay.
  const queue = useRef<Snapshot[]>([]);
  const lastQueued = useRef<ScorebugData>(initial);
  const [visible, setVisible] = useState<ScorebugData>(initial);
  const [stale, setStale] = useState(false);

  // Poll the narrow RPC. One row, a handful of scalars — cheap enough that
  // Realtime would only add configuration, not freshness we can use.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const row = await getOverlayScoreboard(supabase, token);
        if (cancelled || !row) return;
        const data = scorebugFromOverlayRow(row);
        if (JSON.stringify(lastQueued.current) !== JSON.stringify(data)) {
          lastQueued.current = data;
          queue.current.push({ at: Date.now(), data });
        }
        setStale(false);
      } catch {
        // Network blips are expected over a field hotspot. Keep showing the
        // last known good scorebug rather than blanking the overlay.
        if (!cancelled) setStale(true);
      }
    }

    const id = setInterval(poll, POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [supabase, token]);

  // Release buffered snapshots once they are old enough.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - delayMs;
      let next: Snapshot | undefined;
      // Drain everything now old enough; if several plays landed during the
      // delay window we only render the most recent of them.
      while (queue.current.length > 0 && queue.current[0].at <= cutoff) {
        next = queue.current.shift();
      }
      if (next) setVisible(next.data);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [delayMs]);

  return (
    <div
      // em-based sizing inside the bar + a vw-based root font-size here means
      // the scorebug scales to whatever resolution the browser source renders.
      style={{ fontSize: `calc(${scale} * 1.15vw)` }}
      className={`fixed inset-0 overflow-hidden ${
        debug ? "outline outline-[0.15em] -outline-offset-[0.15em] outline-fuchsia-500" : ""
      }`}
    >
      <ScorebugBar data={visible} position={position} />
      {debug && (
        <div className="absolute left-[3em] top-[3em] rounded-[0.3em] bg-fuchsia-600/90 px-[0.8em] py-[0.4em] font-mono text-[0.7em] text-white">
          delay {delaySeconds}s · scale {scale} · {position}
          {stale ? " · OFFLINE" : ""}
        </div>
      )}
    </div>
  );
}
