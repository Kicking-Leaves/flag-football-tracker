// WIAA girls flag football penalties (2026-27). WIAA plays NFHS flag football
// rules with WIAA exceptions; yardage and down effects follow the penalty
// summary in the WIAA Flag Football Manual 2026-27 (rule 10-6), with the
// 2026-27 exceptions sheet where it differs (illegal screen beyond the line).
// The manual isn't consistent on a few (flag guarding, intentional grounding,
// offensive personal fouls), so the scorer can always change the yards and
// down effect after picking one.
//
// Field positions are yards from the offense's own goal line (0-50).

export type PenaltySide = "offense" | "defense";

export interface PenaltyDef {
  code: string;
  name: string;
  side: PenaltySide;
  yards: number;
  /** Offense: the down counts. */
  lossOfDown?: boolean;
  /** Defense: the offense gets a first down. */
  automaticFirstDown?: boolean;
}

export const OTHER_PENALTY = "other";

export const PENALTIES: PenaltyDef[] = [
  // ----- Offense -----
  { code: "off_delay", name: "Delay of game", side: "offense", yards: 5 },
  { code: "off_false_start", name: "False start", side: "offense", yards: 5 },
  { code: "off_snap", name: "Snap infraction", side: "offense", yards: 5 },
  { code: "off_formation", name: "Illegal formation", side: "offense", yards: 5 },
  { code: "off_motion", name: "Illegal shift / motion", side: "offense", yards: 5 },
  { code: "off_substitution", name: "Illegal substitution", side: "offense", yards: 5 },
  { code: "off_numbering", name: "Numbering violation", side: "offense", yards: 5 },
  { code: "off_screen_behind", name: "Illegal screen (behind the line)", side: "offense", yards: 5 },
  { code: "off_shielding", name: "Shielding (impeding a rusher)", side: "offense", yards: 5 },
  { code: "off_qb_run", name: "Illegal advancement (QB run)", side: "offense", yards: 5 },
  { code: "off_grounding", name: "Intentional grounding", side: "offense", yards: 5 },
  { code: "off_holding", name: "Holding", side: "offense", yards: 5 },
  { code: "off_helping", name: "Helping the runner", side: "offense", yards: 5 },
  { code: "off_batting", name: "Illegal batting or kicking", side: "offense", yards: 5 },
  { code: "off_flag_guarding", name: "Flag guarding", side: "offense", yards: 5, lossOfDown: true },
  { code: "off_illegal_pass", name: "Illegal forward pass", side: "offense", yards: 5, lossOfDown: true },
  { code: "off_handoff", name: "Illegal hand-off", side: "offense", yards: 5, lossOfDown: true },
  { code: "off_pi", name: "Offensive pass interference", side: "offense", yards: 5, lossOfDown: true },
  { code: "off_screen_beyond", name: "Illegal screen (beyond the line)", side: "offense", yards: 10, lossOfDown: true },
  { code: "off_blocking", name: "Illegal blocking technique", side: "offense", yards: 10, lossOfDown: true },
  { code: "off_personal", name: "Personal foul", side: "offense", yards: 10, lossOfDown: true },
  { code: "off_unsportsmanlike", name: "Unsportsmanlike conduct", side: "offense", yards: 10, lossOfDown: true },
  { code: "off_grasping", name: "Runner grasping a teammate", side: "offense", yards: 10 },
  { code: "off_hurdling", name: "Hurdling", side: "offense", yards: 10 },
  { code: "off_participation", name: "Illegal participation", side: "offense", yards: 10 },

  // ----- Defense -----
  { code: "def_encroachment", name: "Encroachment", side: "defense", yards: 5 },
  { code: "def_false_start", name: "False start (defense)", side: "defense", yards: 5 },
  { code: "def_disconcerting", name: "Disconcerting act", side: "defense", yards: 5 },
  { code: "def_delay", name: "Delay of game", side: "defense", yards: 5 },
  { code: "def_substitution", name: "Illegal substitution", side: "defense", yards: 5 },
  { code: "def_illegal_rush", name: "Illegal rush", side: "defense", yards: 5 },
  { code: "def_holding", name: "Holding", side: "defense", yards: 5 },
  { code: "def_early_pull", name: "Early flag pull", side: "defense", yards: 5 },
  { code: "def_hands", name: "Illegal use of hands", side: "defense", yards: 5 },
  { code: "def_stripping", name: "Stripping the ball", side: "defense", yards: 5 },
  { code: "def_pi", name: "Defensive pass interference", side: "defense", yards: 5, automaticFirstDown: true },
  { code: "def_roughing", name: "Roughing the passer", side: "defense", yards: 10, automaticFirstDown: true },
  { code: "def_personal", name: "Personal foul", side: "defense", yards: 10, automaticFirstDown: true },
  { code: "def_hurdling", name: "Hurdling", side: "defense", yards: 10, automaticFirstDown: true },
  { code: "def_unsportsmanlike", name: "Unsportsmanlike conduct", side: "defense", yards: 10, automaticFirstDown: true },
  { code: "def_participation", name: "Illegal participation", side: "defense", yards: 10 },
];

export function penaltiesFor(side: PenaltySide): PenaltyDef[] {
  return PENALTIES.filter((p) => p.side === side);
}

export function findPenalty(code: string | null | undefined): PenaltyDef | undefined {
  return code ? PENALTIES.find((p) => p.code === code) : undefined;
}

/** Display name for a logged penalty: the WIAA name, the typed "other" name, or null. */
export function penaltyLabel(entry: { penaltyCode?: string; penaltyName?: string }): string | null {
  if (entry.penaltyCode === OTHER_PENALTY) return entry.penaltyName?.trim() || "Other";
  return findPenalty(entry.penaltyCode)?.name ?? null;
}

/**
 * Yards actually walked off from the ball's spot, applying half the distance
 * to the offending team's goal line (rule 10-1-5). Whole yards, rounded down.
 */
export function enforcedYards(
  standardYards: number,
  side: PenaltySide,
  lineOfScrimmage: number,
): { yards: number; halfDistance: boolean } {
  const toGoal = side === "offense" ? lineOfScrimmage : 50 - lineOfScrimmage;
  const half = Math.floor(Math.max(0, toGoal) / 2);
  return standardYards > half
    ? { yards: half, halfDistance: true }
    : { yards: standardYards, halfDistance: false };
}
