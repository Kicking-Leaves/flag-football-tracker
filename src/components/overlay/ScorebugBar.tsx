import type { ScorebugData } from "@/lib/scorebug";

export type ScorebugPosition = "bottom-left" | "bottom-center" | "top-left";

interface ScorebugBarProps {
  data: ScorebugData;
  position: ScorebugPosition;
}

/**
 * Broadcast-style scorebug for stream overlays.
 *
 * Every dimension is in `em`, and the stage sets its font-size in `vw`, so the
 * whole bar scales with the browser source's resolution without JS measuring
 * anything. A 1280x720 source and a 1920x1080 source both look right.
 */
export default function ScorebugBar({ data, position }: ScorebugBarProps) {
  const placement =
    position === "top-left"
      ? "top-[3em] left-[3em]"
      : position === "bottom-center"
        ? "bottom-[3em] left-1/2 -translate-x-1/2"
        : "bottom-[3em] left-[3em]";

  return (
    <div
      className={`absolute ${placement} flex items-stretch overflow-hidden rounded-[0.45em] bg-black/80 font-sans text-white shadow-[0_0.25em_1.5em_rgba(0,0,0,0.55)] ring-[0.06em] ring-white/15 backdrop-blur-[0.2em]`}
    >
      <TeamCell
        name={data.teamName}
        score={data.teamScore}
        hasBall={data.possession === "team"}
        accent="bg-green-500"
      />

      <div className="w-[0.06em] bg-white/20" />

      <TeamCell
        name={data.opponentName}
        score={data.opponentScore}
        hasBall={data.possession === "opponent"}
        accent="bg-blue-500"
      />

      <div className="w-[0.06em] bg-white/20" />

      <div className="flex flex-col justify-center px-[1.1em] py-[0.5em]">
        <span
          className={`text-[1.5em] font-black leading-none ${
            data.final ? "tracking-[0.06em] text-amber-400" : ""
          }`}
        >
          {data.primaryLabel}
        </span>
        <span className="mt-[0.35em] whitespace-nowrap text-[0.75em] font-semibold uppercase leading-none tracking-[0.08em] text-white/65">
          {data.periodLabel}
          {data.fieldLabel ? ` · ${data.fieldLabel}` : ""}
        </span>
      </div>
    </div>
  );
}

function TeamCell({
  name,
  score,
  hasBall,
  accent,
}: {
  name: string;
  score: number;
  hasBall: boolean;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-[0.7em] px-[1.1em] py-[0.5em]">
      <span className={`h-full w-[0.18em] shrink-0 rounded-full ${accent}`} />
      {/* Possession dot keeps its space when hidden so the bar never reflows. */}
      <span
        className={`size-[0.5em] shrink-0 rounded-full bg-amber-400 ${
          hasBall ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="max-w-[9em] truncate text-[1.1em] font-bold uppercase tracking-[0.04em]">
        {name}
      </span>
      <span className="ml-[0.2em] text-[1.9em] font-black leading-none tabular-nums">
        {score}
      </span>
    </div>
  );
}
