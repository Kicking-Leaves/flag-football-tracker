import { describe, expect, it } from "vitest";
import {
  TEAM_ROLES,
  assignableRoles,
  can,
  canManageMember,
  isTeamRole,
  safeNextPath,
  type Capability,
  type TeamRole,
} from "../permissions";
import { makeInitialGameState, markGameCompleted, reopenGame } from "../game-engine";

const CAPABILITIES: Capability[] = [
  "manageTeam",
  "manageRoster",
  "manageMembers",
  "manageAdmins",
  "createGame",
  "scoreGame",
  "deleteGame",
  "exportStats",
];

function allowed(role: TeamRole): Capability[] {
  return CAPABILITIES.filter((c) => can(role, c));
}

describe("role capabilities", () => {
  it("admin can do everything", () => {
    expect(allowed("admin")).toEqual(CAPABILITIES);
  });

  it("coach can do everything except manage admins", () => {
    expect(allowed("coach")).toEqual(CAPABILITIES.filter((c) => c !== "manageAdmins"));
  });

  it("stat keeper can create, score and export games only", () => {
    expect(allowed("stat_keeper")).toEqual(["createGame", "scoreGame", "exportStats"]);
  });

  it("players and parents are view-only", () => {
    expect(allowed("player")).toEqual([]);
    expect(allowed("parent")).toEqual([]);
  });

  it("non-members can do nothing", () => {
    expect(CAPABILITIES.some((c) => can(null, c))).toBe(false);
    expect(CAPABILITIES.some((c) => can(undefined, c))).toBe(false);
  });
});

describe("assigning roles", () => {
  it("admins can assign every role; coaches every role but admin", () => {
    expect(assignableRoles("admin")).toEqual([...TEAM_ROLES]);
    expect(assignableRoles("coach")).toEqual(["coach", "stat_keeper", "player", "parent"]);
  });

  it("other roles can't assign anything", () => {
    expect(assignableRoles("stat_keeper")).toEqual([]);
    expect(assignableRoles("parent")).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it("only admins can change or remove admins", () => {
    expect(canManageMember("admin", "admin")).toBe(true);
    expect(canManageMember("coach", "admin")).toBe(false);
    expect(canManageMember("coach", "coach")).toBe(true);
    expect(canManageMember("coach", "parent")).toBe(true);
    expect(canManageMember("stat_keeper", "parent")).toBe(false);
  });

  it("recognizes valid roles", () => {
    expect(isTeamRole("parent")).toBe(true);
    expect(isTeamRole("owner")).toBe(false);
    expect(isTeamRole(null)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/teams/1?season=2")).toBe("/teams/1?season=2");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "@evil.com", "evil", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("reopenGame", () => {
  it("clears completion and result so a finished game can be corrected", () => {
    const done = markGameCompleted(makeInitialGameState([], "team"));
    expect(done.completed).toBe(true);
    expect(done.result).toBe("tie");
    const reopened = reopenGame(done);
    expect(reopened.completed).toBe(false);
    expect(reopened.result).toBeUndefined();
    expect(done.completed).toBe(true); // input not mutated
  });
});
