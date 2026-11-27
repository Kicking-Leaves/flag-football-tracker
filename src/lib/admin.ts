// Site admin data access. Every function here is checked in the database
// (rr_admin_* functions refuse anyone who isn't a site admin).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamRole } from "./permissions";

export type AccountStatus = "pending" | "approved" | "suspended" | "rejected";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

export interface AdminAccount {
  user_id: string;
  email: string;
  full_name: string | null;
  status: AccountStatus;
  is_site_admin: boolean;
  approved_via: string | null;
  status_reason: string | null;
  request_note: string | null;
  requested_at: string;
  decided_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  teams: { team_id: string; team_name: string; role: TeamRole }[];
}

export interface AdminTeam {
  id: string;
  name: string;
  school_name: string | null;
  member_count: number;
}

export async function isSiteAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("rr_is_site_admin");
  if (error) return false;
  return Boolean(data);
}

export async function pendingAccountCount(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("rr_accounts")
    .select("user_id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

export async function getAdminAccounts(supabase: SupabaseClient): Promise<AdminAccount[]> {
  const { data, error } = await supabase.rpc("rr_admin_accounts");
  if (error) throw error;
  return (data ?? []) as AdminAccount[];
}

export async function getAdminTeams(supabase: SupabaseClient): Promise<AdminTeam[]> {
  const { data, error } = await supabase.rpc("rr_admin_teams");
  if (error) throw error;
  return (data ?? []) as AdminTeam[];
}

export async function setAccountStatus(
  supabase: SupabaseClient,
  userId: string,
  status: Exclude<AccountStatus, "pending">,
  reason?: string,
) {
  const { error } = await supabase.rpc("rr_admin_set_status", {
    p_user: userId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function setSiteAdmin(supabase: SupabaseClient, userId: string, on: boolean) {
  const { error } = await supabase.rpc("rr_admin_set_site_admin", { p_user: userId, p_on: on });
  if (error) throw error;
}

export async function setTeamRole(supabase: SupabaseClient, userId: string, teamId: string, role: TeamRole) {
  const { error } = await supabase.rpc("rr_admin_set_team_role", { p_user: userId, p_team: teamId, p_role: role });
  if (error) throw error;
}

export async function removeFromTeam(supabase: SupabaseClient, userId: string, teamId: string) {
  const { error } = await supabase.rpc("rr_admin_remove_from_team", { p_user: userId, p_team: teamId });
  if (error) throw error;
}
