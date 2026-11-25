import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOverlayScoreboard } from "@/lib/db";
import { scorebugFromOverlayRow } from "@/lib/scorebug";
import type { ScorebugPosition } from "@/components/overlay/ScorebugBar";
import OverlayScorebug from "./OverlayScorebug";

// The overlay must never be cached: a stale scorebug is worse than none.
export const dynamic = "force-dynamic";

const POSITIONS: ScorebugPosition[] = [
  "bottom-left",
  "bottom-center",
  "top-left",
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function num(
  value: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(one(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default async function OverlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const supabase = await createClient();
  const row = await getOverlayScoreboard(supabase, token);
  if (!row) notFound();

  const requested = one(query.pos) as ScorebugPosition | undefined;
  const position =
    requested && POSITIONS.includes(requested) ? requested : "bottom-left";

  return (
    <>
      {/* The root layout paints an opaque body, which would defeat browser-source
          transparency. Scoped to this route so app pages are untouched. */}
      <style>{`html,body{background:transparent!important;margin:0;overflow:hidden}`}</style>
      <OverlayScorebug
        token={token}
        initial={scorebugFromOverlayRow(row)}
        position={position}
        delaySeconds={num(query.delay, 6, 0, 60)}
        scale={num(query.scale, 1, 0.3, 3)}
        debug={one(query.debug) === "1"}
      />
    </>
  );
}
