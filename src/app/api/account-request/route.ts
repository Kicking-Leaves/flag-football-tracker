import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { escapeHtml, sendEmail } from "@/lib/email";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Files the signed-in (email-verified) user's account request. With a valid
 * team invite the account is approved and joins the team; otherwise it's
 * pending and the site admins get an email.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { fullName?: unknown; note?: unknown; invite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 100) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const invite = typeof body.invite === "string" && UUID_RE.test(body.invite) ? body.invite : null;
  if (!fullName) return NextResponse.json({ error: "Enter your name." }, { status: 400 });

  const { data: status, error } = await supabase.rpc("rr_request_account", {
    p_full_name: fullName,
    p_note: note,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (invite && status !== "suspended") {
    const { data: teamId, error: inviteError } = await supabase.rpc("rr_accept_invite", { p_invite: invite });
    if (!inviteError) return NextResponse.json({ status: "approved", teamId });
    // A bad or used invite falls back to a normal request.
    if (status !== "pending") return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  if (status === "pending") {
    const { data: admins } = await supabase.rpc("rr_take_request_notification");
    const to = (admins as string[] | null) ?? [];
    if (to.length) {
      const origin = request.nextUrl.origin;
      const link = `${origin}/admin?status=pending`;
      const lines = [
        `${fullName} (${user.email}) asked for a RouteRunnr account.`,
        note ? `\nThey wrote: ${note}` : "",
        `\nApprove or reject it: ${link}`,
      ];
      await sendEmail({
        to,
        subject: `RouteRunnr account request: ${fullName}`,
        text: lines.join("\n"),
        html: `<p><strong>${escapeHtml(fullName)}</strong> (${escapeHtml(user.email ?? "")}) asked for a RouteRunnr account.</p>${
          note ? `<p>They wrote:<br>${escapeHtml(note)}</p>` : ""
        }<p><a href="${escapeHtml(link)}">Review the request</a></p>`,
      });
    }
  }

  return NextResponse.json({ status });
}
