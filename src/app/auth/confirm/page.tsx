"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { emailRedirectPath } from "@/lib/permissions";

/**
 * Landing page for links in Supabase auth emails. The templates link here
 * directly (not via supabase.co) with ?token_hash=&type=&next={{ .RedirectTo }}.
 *
 * The code is only used when the person taps the button: email security
 * scanners (e.g. Outlook Safe Links) open links in advance and would
 * otherwise use up the one-time code before the person gets there.
 */

const COPY: Record<string, { title: string; button: string }> = {
  signup: { title: "Confirm your email", button: "Confirm email" },
  email: { title: "Confirm your email", button: "Continue" },
  magiclink: { title: "Sign in", button: "Sign in" },
  invite: { title: "Accept your invitation", button: "Accept invitation" },
  recovery: { title: "Reset your password", button: "Continue" },
  email_change: { title: "Confirm your new email", button: "Confirm new email" },
};

const noopSubscribe = () => () => {};

function useLinkParams(): string {
  // Serialised so useSyncExternalStore gets a stable value.
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.search,
    () => "",
  );
}

export default function ConfirmPage() {
  const router = useRouter();
  const params = new URLSearchParams(useLinkParams());
  const tokenHash = params.get("token_hash");
  const type = params.get("type") ?? "";
  const copy = COPY[type];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!tokenHash || !copy) return;
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      setError(
        type === "recovery"
          ? "This reset link has expired or was already used."
          : "This link has expired or was already used.",
      );
      setLoading(false);
      return;
    }
    const dest =
      type === "recovery"
        ? "/auth/reset-password"
        : emailRedirectPath(params.get("next"), window.location.origin);
    router.replace(dest);
    router.refresh();
  }

  const valid = Boolean(tokenHash && copy);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">{copy?.title ?? "RouteRunnr"}</h1>

        {valid && !error && (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "One moment…" : copy.button}
          </button>
        )}

        {(!valid || error) && (
          <div className="space-y-3 text-sm">
            <p className="rounded bg-yellow-50 p-4 text-yellow-900">
              {error ?? "This link isn't complete. Try opening it from the email again."}
            </p>
            <Link
              href={type === "recovery" ? "/auth/forgot-password" : "/auth/login"}
              className="block text-center underline"
            >
              {type === "recovery" ? "Send a new reset link" : "Go to sign in"}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
