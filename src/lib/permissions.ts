// Team roles and what each one may do. The database enforces the same rules
// with row-level security (see supabase/migrations/*_rr_team_roles.sql); this
// module only decides what the UI shows.

export const TEAM_ROLES = ["admin", "coach", "stat_keeper", "player", "parent"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Admin",
  coach: "Coach",
  stat_keeper: "Stat Keeper",
  player: "Player",
  parent: "Parent/Guardian",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  admin: "Full access, including managing members and admins.",
  coach: "Full access: roster, seasons, games, stats and members.",
  stat_keeper: "Create and score games, edit game stats, and export stats.",
  player: "View games, results and stats.",
  parent: "View games, players and stats.",
};

export type Capability =
  /** Rename/delete the team, set its school, manage seasons. */
  | "manageTeam"
  /** Add, edit, import and remove players; see coach notes. */
  | "manageRoster"
  /** Invite people and change or remove members. */
  | "manageMembers"
  /** Grant, change or remove the admin role. */
  | "manageAdmins"
  /** Create games. */
  | "createGame"
  /** Record plays and edit a game's stats. */
  | "scoreGame"
  /** Delete games. */
  | "deleteGame"
  /** Download or email stats CSVs. */
  | "exportStats";

const STAFF: TeamRole[] = ["admin", "coach"];
const SCORERS: TeamRole[] = ["admin", "coach", "stat_keeper"];

const ALLOWED: Record<Capability, TeamRole[]> = {
  manageTeam: STAFF,
  manageRoster: STAFF,
  manageMembers: STAFF,
  manageAdmins: ["admin"],
  createGame: SCORERS,
  scoreGame: SCORERS,
  deleteGame: STAFF,
  exportStats: SCORERS,
};

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

/** Whether `role` (null = not on the team) may do `capability`. */
export function can(role: TeamRole | null | undefined, capability: Capability): boolean {
  return !!role && ALLOWED[capability].includes(role);
}

/**
 * Roles `actor` may hand out through an invite or a role change. Coaches can
 * assign anything except admin.
 */
export function assignableRoles(actor: TeamRole | null | undefined): TeamRole[] {
  if (!can(actor, "manageMembers")) return [];
  return can(actor, "manageAdmins") ? [...TEAM_ROLES] : TEAM_ROLES.filter((r) => r !== "admin");
}

/**
 * Whether `actor` may change or remove a member who currently has `target`.
 * Only admins can touch admins.
 */
export function canManageMember(
  actor: TeamRole | null | undefined,
  target: TeamRole,
): boolean {
  if (!can(actor, "manageMembers")) return false;
  return target !== "admin" || can(actor, "manageAdmins");
}

/**
 * Only allow same-site relative redirects ("/teams/1"), never "//evil.com" or
 * absolute URLs, so a crafted ?next= can't send someone off-site after login.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}

/**
 * Turns the redirect address Supabase puts in an email link ({{ .RedirectTo }})
 * into a same-site path. The app asks for `<origin>/auth/callback?next=/x`, so
 * that wrapper is unwrapped to `/x`. Anything on another site becomes fallback.
 */
export function emailRedirectPath(
  redirectTo: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  if (!redirectTo) return fallback;
  let url: URL;
  try {
    url = new URL(redirectTo, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  if (url.pathname === "/auth/callback") {
    return safeNextPath(url.searchParams.get("next"), fallback);
  }
  return safeNextPath(url.pathname + url.search, fallback);
}
