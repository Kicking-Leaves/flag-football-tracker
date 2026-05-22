"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setActiveSeason } from "@/lib/db";

interface Props {
  seasonId: string;
  teamId: string;
}

/**
 * Per-row "Set as Active" button on the team dashboard. Only rendered for
 * non-active seasons (the active one already has its badge).
 */
export default function SeasonRowActions({ seasonId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleActivate() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await setActiveSeason(supabase, seasonId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-3">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        onClick={handleActivate}
        disabled={busy}
        className="rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50"
      >
        {busy ? "Activating…" : "Set as Active"}
      </button>
    </div>
  );
}
