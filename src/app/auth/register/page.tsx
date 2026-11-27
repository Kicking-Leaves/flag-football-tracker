"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const noopSubscribe = () => () => {};

/** ?invite=<id> when coming from a team invite link. */
function useInviteId(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const v = new URLSearchParams(window.location.search).get("invite");
      return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    },
    () => null,
  );
}

/**
 * Step 1 of getting an account: verify the email address. The link in the
 * email signs the person in and opens the account request form.
 */
export default function RegisterPage() {
  const invite = useInviteId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const next = invite ? `/auth/request-access?invite=${invite}` : "/auth/request-access";
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {invite ? "Join your team on RouteRunnr" : "Request a RouteRunnr account"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {invite
              ? "First, verify your email. Then set a password and you're in."
              : "First, verify your email. Then tell us who you are, and an admin will approve your account."}
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
            <p className="font-semibold">Check your email.</p>
            <p className="mt-1">
              We sent a link to <strong>{email.trim()}</strong>. Open it on this device to continue.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-3 text-green-900 underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Sending…" : "Verify email"}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href={invite ? `/auth/login?next=${encodeURIComponent(`/invite/${invite}`)}` : "/auth/login"} className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
