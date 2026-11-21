// Roster import: parse a CSV file or rows pasted from a spreadsheet, then plan
// how each row lands on a team-season roster (new athlete, link to an athlete
// already at the school, or update a player already on this roster).
//
// Pure functions only — the roster page previews the plan and db.ts applies it.

import type { Athlete, Player } from "./types";
import { DEFENSE_POSITIONS, OFFENSE_POSITIONS } from "./types";

// ---------- Template ----------

export const ROSTER_TEMPLATE_HEADERS = [
  "Number",
  "Name",
  "Grad Year",
  "Offense",
  "Defense",
  "Notes",
] as const;

export function rosterTemplateCsv(): string {
  return (
    ROSTER_TEMPLATE_HEADERS.join(",") +
    "\n7,Ava Martinez,2027,QB,S,\n12,Jordan Lee,2028,WR,CB,\n"
  );
}

// ---------- Parsing ----------

export interface ParsedRosterRow {
  /** 1-based line number in the input, for messages. */
  line: number;
  number: string;
  name: string;
  graduation_year: number | null;
  position_offense: string | null;
  position_defense: string | null;
  notes: string | null;
  /** Non-fatal problems (e.g. an unknown position that was dropped). */
  warnings: string[];
  /** Fatal problems; the row will not be imported. */
  errors: string[];
}

export interface ParsedRoster {
  rows: ParsedRosterRow[];
  /** True if the first line was recognized as a header row. */
  hasHeader: boolean;
}

type Field =
  | "number"
  | "name"
  | "first"
  | "last"
  | "grad"
  | "offense"
  | "defense"
  | "notes";

const HEADER_ALIASES: Record<Field, string[]> = {
  number: ["number", "no", "num", "#", "jersey", "jersey number", "jersey no", "jersey #"],
  name: ["name", "player", "player name", "full name", "athlete"],
  first: ["first", "first name", "firstname", "given name"],
  last: ["last", "last name", "lastname", "surname", "family name"],
  grad: ["grad year", "graduation year", "grad", "class", "class of", "year", "grad yr"],
  offense: ["offense", "off", "offensive position", "position offense", "off pos", "offense position"],
  defense: ["defense", "def", "defensive position", "position defense", "def pos", "defense position"],
  notes: ["notes", "note", "comments", "comment"],
};

/** Column order assumed when the input has no header row (the template's). */
const HEADERLESS_ORDER: Field[] = ["number", "name", "grad", "offense", "defense", "notes"];

function normalizeHeader(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/[_.:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerField(cell: string): Field | null {
  const h = normalizeHeader(cell);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
    if (aliases.includes(h)) return field;
  }
  return null;
}

/**
 * Split text into rows of cells. Tab-separated if the first non-blank line has
 * a tab (spreadsheet paste); otherwise CSV with RFC 4180 quoting.
 */
export function splitRows(text: string): { cells: string[]; line: number }[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.split("\n").find((l) => l.trim() !== "") ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const out: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) {
      out.push({ cells: cells.map((c) => c.trim()), line: rowStartLine });
    }
    cells = [];
    cell = "";
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n") {
      endRow();
      line++;
      rowStartLine = line;
    } else {
      cell += ch;
    }
  }
  endRow();
  return out;
}

function parseGradYear(raw: string, warnings: string[]): number | null {
  const s = raw.trim().replace(/^'/, "");
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return Number(s);
  if (/^\d{2}$/.test(s)) return 2000 + Number(s);
  warnings.push(`Grad year "${raw}" isn't a year, so it was left blank.`);
  return null;
}

function parsePosition(
  raw: string,
  allowed: readonly string[],
  side: "offense" | "defense",
  warnings: string[],
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const match = allowed.find((p) => p.toLowerCase() === s.toLowerCase());
  if (match) return match;
  warnings.push(
    `${side === "offense" ? "Offensive" : "Defensive"} position "${s}" isn't one of ${allowed.join(", ")}, so it was left blank.`,
  );
  return null;
}

export function parseRosterText(text: string): ParsedRoster {
  const raw = splitRows(text);
  if (raw.length === 0) return { rows: [], hasHeader: false };

  const headerFields = raw[0].cells.map(headerField);
  const hasHeader = headerFields.some(
    (f) => f === "name" || f === "number" || f === "first" || f === "last",
  );
  const columns: (Field | null)[] = hasHeader ? headerFields : HEADERLESS_ORDER;
  const body = hasHeader ? raw.slice(1) : raw;

  const rows = body.map(({ cells, line }) => {
    const get = (field: Field) => {
      const idx = columns.indexOf(field);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const warnings: string[] = [];
    const errors: string[] = [];

    const number = get("number").replace(/^#/, "").trim();
    let name = get("name");
    if (!name) name = [get("first"), get("last")].filter(Boolean).join(" ");
    name = name.replace(/\s+/g, " ").trim();

    if (!name) errors.push("Missing name.");
    if (!number) errors.push("Missing jersey number.");

    const notes = get("notes");
    return {
      line,
      number,
      name,
      graduation_year: parseGradYear(get("grad"), warnings),
      position_offense: parsePosition(get("offense"), OFFENSE_POSITIONS, "offense", warnings),
      position_defense: parsePosition(get("defense"), DEFENSE_POSITIONS, "defense", warnings),
      notes: notes || null,
      warnings,
      errors,
    };
  });

  return { rows, hasHeader };
}

// ---------- Planning ----------

/** How a parsed row will be applied. */
export type RosterImportAction =
  /** Create a new athlete (if the team has a school) and a roster entry. */
  | { kind: "create" }
  /** Add a roster entry for an athlete already at the school. */
  | { kind: "link"; athleteId: string }
  /** Update a player already on this team-season roster. */
  | { kind: "update"; playerId: string }
  /** Don't import this row. */
  | { kind: "skip" };

export interface PlannedRosterRow extends ParsedRosterRow {
  action: RosterImportAction;
  /** Athletes at the school whose name matches; offered as link targets. */
  candidates: Athlete[];
  /** Existing player on this roster this row would update, if any. */
  existingPlayer: Player | null;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/[-\s]+/g, " ")
    .trim();
}

function gradCompatible(a?: number | null, b?: number | null): boolean {
  return a == null || b == null || a === b;
}

/**
 * Decide what to do with each parsed row.
 *
 * - A row whose name matches a player already on this roster updates that
 *   player (number, positions, notes, grad year).
 * - Otherwise, if exactly one athlete at the school matches by name (and grad
 *   year, when both have one), the row links to that athlete — this is how the
 *   same person ends up on JV and Varsity. Several matches default to a new
 *   athlete and list the candidates so the coach can pick.
 * - Otherwise the row creates a new athlete.
 * Rows with errors, and repeats of a name earlier in the upload, are skipped.
 */
export function planRosterImport(
  parsed: ParsedRosterRow[],
  context: { roster: Player[]; athletes: Athlete[] },
): PlannedRosterRow[] {
  const seenNames = new Map<string, number>();
  const numberOwners = new Map<string, string>();
  for (const p of context.roster) numberOwners.set(p.number, normalizeName(p.name));

  return parsed.map((row) => {
    const key = normalizeName(row.name);
    const warnings = [...row.warnings];

    const existingPlayer =
      context.roster.find(
        (p) =>
          normalizeName(p.name) === key &&
          gradCompatible(p.graduation_year, row.graduation_year),
      ) ?? null;

    const candidates = context.athletes.filter(
      (a) =>
        normalizeName(a.name) === key &&
        gradCompatible(a.graduation_year, row.graduation_year),
    );

    let action: RosterImportAction;
    if (row.errors.length > 0) {
      action = { kind: "skip" };
    } else if (seenNames.has(key)) {
      warnings.push(`Same name as line ${seenNames.get(key)}; skipped.`);
      action = { kind: "skip" };
    } else if (existingPlayer) {
      action = { kind: "update", playerId: existingPlayer.id };
    } else if (candidates.length === 1) {
      action = { kind: "link", athleteId: candidates[0].id };
    } else {
      if (candidates.length > 1) {
        warnings.push(
          `${candidates.length} athletes at this school are named ${row.name}; pick one or keep as new.`,
        );
      }
      action = { kind: "create" };
    }

    if (action.kind !== "skip") {
      seenNames.set(key, row.line);
      const owner = numberOwners.get(row.number);
      if (owner !== undefined && owner !== key) {
        warnings.push(`#${row.number} is already worn by another player on this roster.`);
      }
      numberOwners.set(row.number, key);
    }

    return { ...row, warnings, action, candidates, existingPlayer };
  });
}

export function summarizePlan(plan: PlannedRosterRow[]) {
  const count = (kind: RosterImportAction["kind"]) =>
    plan.filter((r) => r.action.kind === kind).length;
  return {
    create: count("create"),
    link: count("link"),
    update: count("update"),
    skip: count("skip"),
  };
}
