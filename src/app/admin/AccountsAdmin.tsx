"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACCOUNT_STATUS_LABELS,
  removeFromTeam,
  setAccountStatus,
  setSiteAdmin,
  setTeamRole,
  type AccountStatus,
  type AdminAccount,
  type AdminTeam,
} from "@/lib/admin";
import { ROLE_LABELS, TEAM_ROLES, type TeamRole } from "@/lib/permissions";

const STATUS_STYLES: Record<AccountStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-800",
  rejected: "bg-gray-200 text-gray-700",
};

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function AccountsAdmin({
  accounts,
  teams,
  currentUserId,
  initialStatus,
}: {
  accounts: AdminAccount[];
  teams: AdminTeam[];
  currentUserId: string;
  initialStatus?: AccountStatus;
}) {
  const pendingCount = accounts.filter((a) => a.status === "pending").length;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AccountStatus | "all">(initialStatus ?? (pendingCount ? "pending" : "all"));
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<TeamRole | "" | "none">("");
  const [siteAdminsOnly, setSiteAdminsOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (siteAdminsOnly && !a.is_site_admin) return false;
      if (q && !`${a.full_name ?? ""} ${a.email}`.toLowerCase().includes(q)) return false;
      if (role === "none") return a.teams.length === 0;
      const onTeam = teamId ? a.teams.filter((t) => t.team_id === teamId) : a.teams;
      if (teamId && onTeam.length === 0) return false;
      if (role && !onTeam.some((t) => t.role === role)) return false;
      return true;
    });
  }, [accounts, search, status, teamId, role, siteAdminsOnly]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: accounts.length };
    for (const a of accounts) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [accounts]);

  return (
    <div>
      {/* Status tabs */}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["pending", "approved", "suspended", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${
              status === s ? "bg-gray-900 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"
            }`}
          >
            {s === "all" ? "All" : ACCOUNT_STATUS_LABELS[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 grid gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
        />
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.school_name ? ` (${t.school_name})` : ""}
            </option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TeamRole | "" | "none")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Any role</option>
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
          <option value="none">Not on any team</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-4">
          <input type="checkbox" checked={siteAdminsOnly} onChange={(e) => setSiteAdminsOnly(e.target.checked)} />
          Site admins only
        </label>
      </div>

      <p className="mb-2 text-sm text-gray-500">
        {filtered.length} {filtered.length === 1 ? "account" : "accounts"}
      </p>

      <ul className="space-y-2">
        {filtered.map((a) => (
          <li key={a.user_id} className="rounded-2xl bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setOpen(open === a.user_id ? null : a.user_id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"
            >
              <div className="min-w-0">
                <p className="font-bold text-gray-900">
                  {a.full_name || "(no name)"}
                  {a.is_site_admin && (
                    <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800">
                      Site admin
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-gray-600">{a.email}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {a.teams.length
                    ? a.teams.map((t) => `${t.team_name}: ${ROLE_LABELS[t.role]}`).join(" · ")
                    : "Not on any team"}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLES[a.status]}`}>
                {ACCOUNT_STATUS_LABELS[a.status]}
              </span>
            </button>
            {open === a.user_id && (
              <AccountDetail account={a} teams={teams} isSelf={a.user_id === currentUserId} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccountDetail({ account: a, teams, isSelf }: { account: AdminAccount; teams: AdminTeam[]; isSelf: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addTeam, setAddTeam] = useState("");
  const [addRole, setAddRole] = useState<TeamRole>("parent");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(label);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function suspend() {
    const reason = prompt(`Suspend ${a.email}? They'll lose access to all teams.\n\nReason (optional, shown to them):`);
    if (reason === null) return;
    void run("Account suspended.", () => setAccountStatus(supabase, a.user_id, "suspended", reason));
  }

  function reject() {
    const reason = prompt(`Reject the request from ${a.email}?\n\nReason (optional):`);
    if (reason === null) return;
    void run("Request rejected.", () => setAccountStatus(supabase, a.user_id, "rejected", reason));
  }

  function sendReset() {
    if (!confirm(`Email a password reset link to ${a.email}?`)) return;
    void run(`Password reset email sent to ${a.email}.`, async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(a.email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
      });
      if (error) throw error;
    });
  }

  const available = teams.filter((t) => !a.teams.some((m) => m.team_id === t.id));

  return (
    <div className="space-y-4 border-t border-gray-100 p-4 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <Row label="Requested" value={fmt(a.requested_at)} />
        <Row label="Last sign-in" value={fmt(a.last_sign_in_at)} />
        <Row label="Decided" value={`${fmt(a.decided_at)}${a.approved_via ? ` (via ${a.approved_via})` : ""}`} />
        <Row label="Email verified" value={a.email_confirmed ? "Yes" : "No"} />
        {a.request_note && <Row label="Their note" value={a.request_note} wide />}
        {a.status_reason && <Row label="Reason" value={a.status_reason} wide />}
      </dl>

      {/* Account actions */}
      <div className="flex flex-wrap gap-2">
        {a.status === "pending" && (
          <>
            <ActionButton tone="green" disabled={busy} onClick={() => run("Approved.", () => setAccountStatus(supabase, a.user_id, "approved"))}>
              Approve
            </ActionButton>
            <ActionButton tone="gray" disabled={busy} onClick={reject}>
              Reject
            </ActionButton>
          </>
        )}
        {a.status === "approved" && !isSelf && (
          <ActionButton tone="red" disabled={busy} onClick={suspend}>
            Suspend
          </ActionButton>
        )}
        {(a.status === "suspended" || a.status === "rejected") && (
          <ActionButton tone="green" disabled={busy} onClick={() => run("Account reactivated.", () => setAccountStatus(supabase, a.user_id, "approved"))}>
            {a.status === "rejected" ? "Approve" : "Reactivate"}
          </ActionButton>
        )}
        <ActionButton tone="gray" disabled={busy} onClick={sendReset}>
          Send password reset
        </ActionButton>
        {a.status === "approved" && !isSelf && (
          <ActionButton
            tone="purple"
            disabled={busy}
            onClick={() => {
              const on = !a.is_site_admin;
              if (!confirm(on ? `Make ${a.email} a site admin? They'll be able to manage every account.` : `Remove site admin from ${a.email}?`)) return;
              void run(on ? "Now a site admin." : "Site admin removed.", () => setSiteAdmin(supabase, a.user_id, on));
            }}
          >
            {a.is_site_admin ? "Remove site admin" : "Make site admin"}
          </ActionButton>
        )}
      </div>

      {/* Team memberships */}
      <div>
        <p className="mb-2 font-bold text-gray-800">Teams</p>
        {a.teams.length === 0 && <p className="mb-2 text-gray-500">Not on any team.</p>}
        <ul className="space-y-2">
          {a.teams.map((t) => (
            <li key={t.team_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
              <span className="min-w-0 flex-1 font-semibold">{t.team_name}</span>
              <select
                value={t.role}
                disabled={busy}
                onChange={(e) =>
                  run(`Role changed to ${ROLE_LABELS[e.target.value as TeamRole]}.`, () =>
                    setTeamRole(supabase, a.user_id, t.team_id, e.target.value as TeamRole),
                  )
                }
                className="rounded-lg border border-gray-300 px-2 py-1"
              >
                {TEAM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Remove ${a.email} from ${t.team_name}?`)) return;
                  void run("Removed from team.", () => removeFromTeam(supabase, a.user_id, t.team_id));
                }}
                className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={addTeam} onChange={(e) => setAddTeam(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1">
              <option value="">Add to team…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value as TeamRole)} className="rounded-lg border border-gray-300 px-2 py-1">
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !addTeam}
              onClick={() =>
                run("Added to team.", async () => {
                  await setTeamRole(supabase, a.user_id, addTeam, addRole);
                  setAddTeam("");
                })
              }
              className="rounded-lg bg-blue-600 px-3 py-1 font-bold text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
        {a.status !== "approved" && a.teams.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">Team access starts once the account is approved.</p>
        )}
      </div>

      {message && <p className="text-green-700">{message}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="inline font-semibold text-gray-600">{label}: </dt>
      <dd className="inline text-gray-800">{value}</dd>
    </div>
  );
}

const TONES = {
  green: "bg-green-600 text-white",
  red: "bg-red-600 text-white",
  gray: "bg-gray-200 text-gray-800",
  purple: "bg-purple-100 text-purple-800",
};

function ActionButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: keyof typeof TONES;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${TONES[tone]}`}>
      {children}
    </button>
  );
}
