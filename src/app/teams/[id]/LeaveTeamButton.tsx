"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { removeMember } from "@/lib/db";

export default function LeaveTeamButton({ teamId, userId }: { teamId: string; userId: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!confirm("Leave this team? You'll need a new invite to rejoin.")) return;
    setLeaving(true);
    setError(null);
    try {
      await removeMember(createClient(), teamId, userId);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't leave the team.");
      setLeaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={leave}
        disabled={leaving}
        className="text-sm font-semibold text-gray-500 underline disabled:opacity-50"
      >
        {leaving ? "Leaving…" : "Leave team"}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </>
  );
}
