// Stats counted from a game's play log rather than stored counters: sacks and
// fumbles. The log is the source of truth (games are rebuilt from it after
// edits), and counting from it lets older games' coverage sacks count too.

import type { FumbleStats, GameState, PlayerStats, SackStats } from "./types";
import { isCoverageSack, isPlayerSack } from "./game-engine";

export function emptySackStats(): SackStats {
  return { playerSacks: 0, coverageSacks: 0, sackedAllowed: 0, coverageSacksAllowed: 0 };
}

export function emptyFumbleStats(): FumbleStats {
  return { fumbles: 0, fumblesLost: 0, recoveries: 0 };
}

export function addSackStats(into: SackStats, from: SackStats): void {
  into.playerSacks += from.playerSacks;
  into.coverageSacks += from.coverageSacks;
  into.sackedAllowed += from.sackedAllowed;
  into.coverageSacksAllowed += from.coverageSacksAllowed;
}

export function addFumbleStats(into: FumbleStats, from: FumbleStats): void {
  into.fumbles += from.fumbles;
  into.fumblesLost += from.fumblesLost;
  into.recoveries += from.recoveries;
}

export { isCoverageSack, isPlayerSack };

/** Team sack totals plus player sacks by roster id. */
export function gameSackStats(gd: Pick<GameState, "plays">): {
  team: SackStats;
  byPlayer: Record<string, number>;
} {
  const team = emptySackStats();
  const byPlayer: Record<string, number> = {};
  for (const p of gd.plays ?? []) {
    const defending = p.possession === "opponent";
    if (isCoverageSack(p)) {
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

/** Our fumbles and fumbles lost, plus fumbles our defense caught (by roster id). */
export function gameFumbleStats(gd: Pick<GameState, "plays">): {
  team: FumbleStats;
  byPlayer: Record<string, number>;
} {
  const team = emptyFumbleStats();
  const byPlayer: Record<string, number> = {};
  for (const p of gd.plays ?? []) {
    if (!p.fumble || (p.playType !== "pass" && p.playType !== "run")) continue;
    if (p.possession === "team") {
      team.fumbles++;
      if (p.fumble === "lost") team.fumblesLost++;
    } else if (p.fumble === "lost") {
      team.recoveries++;
      if (p.defender) byPlayer[p.defender] = (byPlayer[p.defender] ?? 0) + 1;
    }
  }
  return { team, byPlayer };
}

/** The game's player stats with sacks and fumble recoveries filled in from the play log. */
export function playerStatsWithDerived(
  gd: Pick<GameState, "plays" | "playerStats">,
): Record<string, PlayerStats> {
  const sacks = gameSackStats(gd).byPlayer;
  const recoveries = gameFumbleStats(gd).byPlayer;
  const out: Record<string, PlayerStats> = {};
  for (const [id, ps] of Object.entries(gd.playerStats ?? {})) {
    out[id] = {
      ...ps,
      defense: { ...ps.defense, sacks: sacks[id] ?? 0, fumbleRecoveries: recoveries[id] ?? 0 },
    };
  }
  return out;
}
