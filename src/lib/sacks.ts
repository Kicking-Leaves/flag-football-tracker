// Sack stats, counted from a game's play log rather than stored counters, so
// undo needs no bookkeeping and coverage sacks from older games count too.

import type { GameState, Play, PlayerStats, SackStats } from "./types";

export function emptySackStats(): SackStats {
  return { playerSacks: 0, coverageSacks: 0, sackedAllowed: 0, coverageSacksAllowed: 0 };
}

export function addSackStats(into: SackStats, from: SackStats): void {
  into.playerSacks += from.playerSacks;
  into.coverageSacks += from.coverageSacks;
  into.sackedAllowed += from.sackedAllowed;
  into.coverageSacksAllowed += from.coverageSacksAllowed;
}

/** A pass play where the passer's flag was pulled before the throw. */
export function isPlayerSack(p: Play): boolean {
  return p.playType === "pass" && Boolean(p.sack);
}

/** Team sack totals plus player sacks by roster id. */
export function gameSackStats(gd: Pick<GameState, "plays">): {
  team: SackStats;
  byPlayer: Record<string, number>;
} {
  const team = emptySackStats();
  const byPlayer: Record<string, number> = {};
  for (const p of gd.plays ?? []) {
    const defending = p.possession === "opponent";
    if (p.playType === "coverage_sack") {
      if (defending) team.coverageSacks++;
      else team.coverageSacksAllowed++;
    } else if (isPlayerSack(p)) {
      if (defending) {
        team.playerSacks++;
        if (p.defender) byPlayer[p.defender] = (byPlayer[p.defender] ?? 0) + 1;
      } else {
        team.sackedAllowed++;
      }
    }
  }
  return { team, byPlayer };
}

/** The game's player stats with defense.sacks filled in from the play log. */
export function playerStatsWithSacks(
  gd: Pick<GameState, "plays" | "playerStats">,
): Record<string, PlayerStats> {
  const { byPlayer } = gameSackStats(gd);
  const out: Record<string, PlayerStats> = {};
  for (const [id, ps] of Object.entries(gd.playerStats ?? {})) {
    out[id] = { ...ps, defense: { ...ps.defense, sacks: byPlayer[id] ?? 0 } };
  }
  return out;
}
