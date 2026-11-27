// Server-only: sends app email (not auth email, which Supabase sends) through
// Resend. Needs RESEND_API_KEY; without it, sending is skipped and logged.

const FROM = "Kicking Leaves <noreply@kickingleaves.com>";

export interface Email {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True if sent; false if email isn't set up or Resend refused it. */
export async function sendEmail(email: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY isn't set; skipped email:", email.subject);
    return false;
  }
  if (email.to.length === 0) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: email.to, subject: email.subject, text: email.text, html: email.html }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("Resend refused email:", res.status, await res.text());
    return false;
  }
  return true;
}
