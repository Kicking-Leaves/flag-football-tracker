"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite } from "@/lib/db";

export default function AcceptInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const teamId = await acceptInvite(createClient(), inviteId);
      router.push(`/teams/${teamId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the team.");
      setJoining(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={join}
        disabled={joining}
        className="w-full rounded-xl bg-green-600 py-3 font-bold text-white disabled:opacity-50"
      >
        {joining ? "Joining…" : "Join team"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </>
  );
}
