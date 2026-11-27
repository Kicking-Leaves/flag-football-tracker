"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/auth/PasswordInput";

const MIN_LENGTH = 6; // Supabase project setting (password_min_length)

export default function RequestAccessForm({
  inviteId,
  initialName,
  passwordRequired,
  passwordOffered,
}: {
  inviteId: string | null;
  initialName: string;
  passwordRequired: boolean;
  passwordOffered: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      if (password) {
        const { error } = await createClient().auth.updateUser({ password });
        if (error) throw error;
      }
      const res = await fetch("/api/account-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, note, invite: inviteId }),
      });
      const body = (await res.json()) as { status?: string; teamId?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send your request.");
      if (body.status === "approved") {
        router.push(body.teamId ? `/teams/${body.teamId}` : "/");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your request.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        required
        maxLength={100}
        autoComplete="name"
        placeholder="Your full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      {!inviteId && (
        <textarea
          maxLength={500}
          rows={3}
          placeholder="Which team or school, and your role (coach, stat keeper, parent…)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      )}
      {passwordOffered && (
        <>
          <PasswordInput
            required={passwordRequired}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            placeholder={
              passwordRequired
                ? `Create a password (at least ${MIN_LENGTH} characters)`
                : "New password (optional; blank keeps your current one)"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && (
            <PasswordInput
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Sending…" : inviteId ? "Join team" : "Request account"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
