import { describe, it, expect } from "vitest";
import {
  normalizeName,
  parseRosterText,
  planRosterImport,
  rosterTemplateCsv,
  splitRows,
  summarizePlan,
} from "../roster-import";
import type { Athlete, Player } from "../types";

function player(over: Partial<Player>): Player {
  return {
    id: "p-" + (over.name ?? "x"),
    team_id: "t1",
    season_id: "s1",
    name: "Someone",
    number: "0",
    active: true,
    ...over,
  };
}

function athlete(over: Partial<Athlete>): Athlete {
  return { id: "a-" + (over.name ?? "x"), school_id: "sch", name: "Someone", ...over };
}

describe("splitRows", () => {
  it("handles quoted CSV cells with commas, quotes, and newlines", () => {
    const rows = splitRows('Number,Name,Notes\n7,"Martinez, Ava","Says ""hi""\nline 2"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1].cells).toEqual(["7", "Martinez, Ava", 'Says "hi"\nline 2']);
  });

  it("uses tabs for spreadsheet pastes and drops blank lines", () => {
    const rows = splitRows("7\tAva Martinez\t2027\n\n12\tJordan Lee\t2028\n");
    expect(rows.map((r) => r.cells)).toEqual([
      ["7", "Ava Martinez", "2027"],
      ["12", "Jordan Lee", "2028"],
    ]);
    expect(rows[1].line).toBe(3);
  });

  it("strips a UTF-8 BOM and CRLF line endings (Excel exports)", () => {
    const rows = splitRows("﻿Number,Name\r\n7,Ava\r\n");
    expect(rows[0].cells).toEqual(["Number", "Name"]);
    expect(rows[1].cells).toEqual(["7", "Ava"]);
  });
});

describe("parseRosterText", () => {
  it("parses the downloadable template", () => {
    const { rows, hasHeader } = parseRosterText(rosterTemplateCsv());
    expect(hasHeader).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      number: "7",
      name: "Ava Martinez",
      graduation_year: 2027,
      position_offense: "QB",
      position_defense: "S",
      notes: null,
      errors: [],
    });
  });

  it("maps headers in any order and common aliases, incl. first/last name", () => {
    const { rows } = parseRosterText(
      "Last Name,First Name,Jersey #,Class of,Pos (ignored),Comments\nLee,Jordan,#12,'28,WR,fast\n",
    );
    expect(rows[0]).toMatchObject({
      number: "12",
      name: "Jordan Lee",
      graduation_year: 2028,
      notes: "fast",
    });
  });

  it("assumes template column order when there is no header", () => {
    const { rows, hasHeader } = parseRosterText("22\tSam Patel\t2027\tRB\tLB\n");
    expect(hasHeader).toBe(false);
    expect(rows[0]).toMatchObject({
      number: "22",
      name: "Sam Patel",
      position_offense: "RB",
      position_defense: "LB",
    });
  });

  it("normalizes position case and warns on unknown positions or years", () => {
    const { rows } = parseRosterText("Number,Name,Grad Year,Offense,Defense\n3,Kai,Senior,qb,Rover\n");
    expect(rows[0].position_offense).toBe("QB");
    expect(rows[0].position_defense).toBeNull();
    expect(rows[0].graduation_year).toBeNull();
    expect(rows[0].warnings).toHaveLength(2);
    expect(rows[0].errors).toEqual([]);
  });

  it("flags rows missing a name or number", () => {
    const { rows } = parseRosterText("Number,Name\n,Ava\n9,\n");
    expect(rows[0].errors).toEqual(["Missing jersey number."]);
    expect(rows[1].errors).toEqual(["Missing name."]);
  });
});

describe("normalizeName", () => {
  it("ignores case, accents, punctuation, and extra spaces", () => {
    expect(normalizeName("  José  O'Neil-Smith Jr. ")).toBe(normalizeName("jose oneil smith jr"));
  });
});

describe("planRosterImport", () => {
  const parse = (text: string) => parseRosterText(text).rows;

  it("creates new athletes when nothing matches", () => {
    const plan = planRosterImport(parse("7,Ava Martinez,2027"), { roster: [], athletes: [] });
    expect(plan[0].action).toEqual({ kind: "create" });
  });

  it("links to the one athlete at the school with the same name (JV → Varsity)", () => {
    const ava = athlete({ name: "Ava Martinez", graduation_year: 2027 });
    const plan = planRosterImport(parse("4,ava martinez,2027"), { roster: [], athletes: [ava] });
    expect(plan[0].action).toEqual({ kind: "link", athleteId: ava.id });
  });

  it("does not link when grad years disagree", () => {
    const ava = athlete({ name: "Ava Martinez", graduation_year: 2026 });
    const plan = planRosterImport(parse("4,Ava Martinez,2027"), { roster: [], athletes: [ava] });
    expect(plan[0].action).toEqual({ kind: "create" });
    expect(plan[0].candidates).toEqual([]);
  });

  it("with several same-name athletes, defaults to new and offers the candidates", () => {
    const a1 = athlete({ id: "a1", name: "Sam Lee" });
    const a2 = athlete({ id: "a2", name: "Sam Lee" });
    const plan = planRosterImport(parse("5,Sam Lee"), { roster: [], athletes: [a1, a2] });
    expect(plan[0].action).toEqual({ kind: "create" });
    expect(plan[0].candidates.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(plan[0].warnings[0]).toMatch(/2 athletes/);
  });

  it("updates a player already on this roster instead of duplicating", () => {
    const existing = player({ name: "Jordan Lee", number: "12" });
    const plan = planRosterImport(parse("14,Jordan Lee,2028"), {
      roster: [existing],
      athletes: [athlete({ name: "Jordan Lee" })],
    });
    expect(plan[0].action).toEqual({ kind: "update", playerId: existing.id });
    expect(plan[0].existingPlayer).toBe(existing);
  });

  it("skips error rows and repeated names, and warns on taken numbers", () => {
    const plan = planRosterImport(parse("7,Ava\n8,ava\n,Nobody\n12,Kai"), {
      roster: [player({ name: "Jordan Lee", number: "12" })],
      athletes: [],
    });
    expect(plan.map((r) => r.action.kind)).toEqual(["create", "skip", "skip", "create"]);
    expect(plan[1].warnings[0]).toMatch(/line 1/);
    expect(plan[3].warnings[0]).toMatch(/#12 is already worn/);
    expect(summarizePlan(plan)).toEqual({ create: 2, link: 0, update: 0, skip: 2 });
  });
});
