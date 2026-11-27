"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PasswordInput from "@/components/auth/PasswordInput";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 6; // Supabase project setting (password_min_length)

export default function ResetPasswordPage() {
  const router = useRouter();
  // null while checking; the reset link signs the user in via /auth/callback.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setSignedIn(Boolean(data.user));
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">Choose a new password</h1>

        {signedIn === null && <p className="text-sm text-gray-500">Checking your link…</p>}

        {signedIn === false && (
          <div className="space-y-3 text-sm">
            <p className="rounded bg-yellow-50 p-4 text-yellow-900">
              This reset link has expired or was already used. Each link only works once.
            </p>
            <Link href="/auth/forgot-password" className="block text-center underline">
              Send a new link
            </Link>
          </div>
        )}

        {signedIn && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <PasswordInput
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              placeholder={`New password (at least ${MIN_LENGTH} characters)`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
