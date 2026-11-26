"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // The email template links to /auth/confirm, which signs the user in and
    // sends them to /auth/reset-password. redirectTo is a fallback for the
    // stock template (via supabase.co and /auth/callback).
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
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
          <h1 className="text-2xl font-semibold">Forgot your password?</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter your email and we&apos;ll send you a link to choose a new one.
          </p>
        </div>

        {sent ? (
          <div className="space-y-2 rounded bg-green-50 p-4 text-sm text-green-900">
            <p>
              If there&apos;s an account for <strong>{email}</strong>, a reset link is on
              its way from Kicking Leaves.
            </p>
            <p>The link works once. If it doesn&apos;t arrive in a few minutes, check your spam folder.</p>
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
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-center text-sm text-gray-500">
          <Link href="/auth/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
