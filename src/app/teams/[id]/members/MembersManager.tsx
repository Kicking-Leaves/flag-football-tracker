"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createInvite,
  removeMember,
  revokeInvite,
  setMemberRole,
  type TeamInvite,
  type TeamMember,
} from "@/lib/db";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  assignableRoles,
  canManageMember,
  type TeamRole,
} from "@/lib/permissions";

/** Roles whose invite links default to "anyone with the link" (group chats). */
const REUSABLE_BY_DEFAULT: TeamRole[] = ["player", "parent"];

function inviteUrl(id: string): string {
  return `${window.location.origin}/invite/${id}`;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function MembersManager({
  teamId,
  myUserId,
  myRole,
  members,
  invites,
}: {
  teamId: string;
  myUserId: string;
  myRole: TeamRole;
  members: TeamMember[];
  invites: TeamInvite[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const roles = assignableRoles(myRole);

  const [inviteRole, setInviteRole] = useState<TeamRole>("parent");
  const [reusable, setReusable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState<{ url: string; role: TeamRole } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickRole(role: TeamRole) {
    setInviteRole(role);
    setReusable(REUSABLE_BY_DEFAULT.includes(role));
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  async function share(url: string, role: TeamRole) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join our team on RouteRunnr", text: `Join as ${ROLE_LABELS[role]}`, url });
        return;
      } catch {
        // Cancelled or unsupported; fall back to copying.
      }
    }
    await copy(url);
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const invite = await createInvite(supabase, teamId, inviteRole, !reusable);
      setNewLink({ url: inviteUrl(invite.id), role: invite.role });
      router.refresh();
    } catch (err) {
      setError(errorText(err, "Couldn't create the invite."));
    } finally {
      setCreating(false);
    }
  }

  async function run(key: string, action: () => Promise<void>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(null);
    }
  }

  function handleRoleChange(m: TeamMember, role: TeamRole) {
    if (role === m.role) return;
    if (m.user_id === myUserId && !confirm(`Change your own role to ${ROLE_LABELS[role]}? You may lose access to this page.`)) {
      return;
    }
    void run(`role:${m.user_id}`, () => setMemberRole(supabase, teamId, m.user_id, role), "Couldn't change the role.");
  }

  function handleRemove(m: TeamMember) {
    const self = m.user_id === myUserId;
    const ok = confirm(self ? "Leave this team? You'll need a new invite to rejoin." : `Remove ${m.email} from the team?`);
    if (!ok) return;
    void run(
      `remove:${m.user_id}`,
      async () => {
        await removeMember(supabase, teamId, m.user_id);
        if (self) router.push("/");
      },
      "Couldn't remove the member.",
    );
  }

  return (
    <>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Invite */}
      <section className="mb-6 rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-800">Invite someone</h2>
        <label className="mb-1 block text-sm font-semibold text-gray-700" htmlFor="invite-role">
          Role
        </label>
        <select
          id="invite-role"
          value={inviteRole}
          onChange={(e) => pickRole(e.target.value as TeamRole)}
          className="w-full rounded-xl border-2 border-gray-300 px-3 py-3 font-semibold"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-gray-500">{ROLE_DESCRIPTIONS[inviteRole]}</p>

        <fieldset className="mt-3 space-y-2 text-sm">
          <legend className="sr-only">Who can use the link</legend>
          <label className="flex items-start gap-2">
            <input type="radio" checked={!reusable} onChange={() => setReusable(false)} className="mt-1" />
            <span>
              <strong>One person</strong>: the link stops working once someone joins.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={reusable} onChange={() => setReusable(true)} className="mt-1" />
            <span>
              <strong>Anyone with the link</strong>: good for a team group chat. Works for 14 days or until you turn it off.
            </span>
          </label>
        </fieldset>

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create invite link"}
        </button>

        {newLink && (
          <div className="mt-4 rounded-xl bg-green-50 p-3">
            <p className="mb-1 text-sm font-semibold text-green-900">
              {ROLE_LABELS[newLink.role]} invite link
            </p>
            <p className="break-all font-mono text-xs text-gray-700">{newLink.url}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => share(newLink.url, newLink.role)}
                className="rounded-lg bg-green-600 py-2 text-sm font-bold text-white"
              >
                Share
              </button>
              <button
                type="button"
                onClick={() => copy(newLink.url)}
                className="rounded-lg bg-white py-2 text-sm font-bold text-green-800 shadow"
              >
                {copied === newLink.url ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Open invites */}
      {invites.length > 0 && (
        <section className="mb-6 rounded-2xl bg-white p-5 shadow-xl">
          <h2 className="mb-3 text-lg font-bold text-gray-800">Open invite links</h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{ROLE_LABELS[i.role]}</p>
                  <p className="text-xs text-gray-500">
                    {i.single_use ? "One person" : `Anyone · ${i.used_count} joined`} · expires{" "}
                    {new Date(i.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => copy(inviteUrl(i.id))}
                    className="rounded-lg bg-blue-100 px-3 py-2 font-bold text-blue-700"
                  >
                    {copied === inviteUrl(i.id) ? "Copied" : "Copy"}
                  </button>
                  {(i.role !== "admin" || roles.includes("admin")) && (
                    <button
                      type="button"
                      disabled={busy === `revoke:${i.id}`}
                      onClick={() => run(`revoke:${i.id}`, () => revokeInvite(supabase, i.id), "Couldn't turn off the link.")}
                      className="rounded-lg bg-red-100 px-3 py-2 font-bold text-red-700 disabled:opacity-50"
                    >
                      Turn off
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Members */}
      <section className="rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-800">Members ({members.length})</h2>
        <ul className="space-y-2">
          {members.map((m) => {
            const self = m.user_id === myUserId;
            const manageable = canManageMember(myRole, m.role);
            return (
              <li key={m.user_id} className="rounded-xl bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-all text-sm font-semibold">
                    {m.email}
                    {self && <span className="ml-1 text-gray-500">(you)</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    {manageable ? (
                      <select
                        value={m.role}
                        disabled={busy === `role:${m.user_id}`}
                        onChange={(e) => handleRoleChange(m, e.target.value as TeamRole)}
                        className="rounded-lg border-2 border-gray-300 px-2 py-1 text-sm font-semibold"
                        aria-label={`Role for ${m.email}`}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-bold text-gray-700">
                        {ROLE_LABELS[m.role]}
                      </span>
                    )}
                    {(manageable || self) && (
                      <button
                        type="button"
                        disabled={busy === `remove:${m.user_id}`}
                        onClick={() => handleRemove(m)}
                        className="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-bold text-red-700 disabled:opacity-50"
                      >
                        {self ? "Leave" : "Remove"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
