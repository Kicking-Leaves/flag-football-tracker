"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/permissions";

const noopSubscribe = () => () => {};

/**
 * Where to go after signing in, from ?next= (same-site paths only). Read from
 * window.location so the page needn't suspend on useSearchParams; "/" during
 * server render.
 */
function useNextPath(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => safeNextPath(new URLSearchParams(window.location.search).get("next")),
    () => "/",
  );
}

function withNext(path: string, next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = useNextPath();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${withNext("/auth/callback", next)}`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }

    setMessage("Check your email for a confirmation link.");
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-gray-500">
            Start tracking flag football games.
          </p>
        </div>

        <form onSubmit={handleSignup} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href={withNext("/auth/login", next)} className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
