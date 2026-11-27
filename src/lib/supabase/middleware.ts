import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: refresh the auth token. Do not run any code between createServerClient
  // and supabase.auth.getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed in but not an approved RouteRunnr account (pending, suspended,
  // rejected, or never requested — sign-ins are shared with another app):
  // only the account request flow and invite links are open.
  const path = request.nextUrl.pathname;
  if (user && !isOpenPath(path)) {
    const { data } = await supabase
      .from("rr_accounts")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data?.status !== "approved") {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Your account isn't approved." }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/auth/request-access";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  return supabaseResponse;
}

const OPEN_PREFIXES = ["/auth/", "/invite/", "/api/account-request"];

function isOpenPath(path: string): boolean {
  return OPEN_PREFIXES.some((p) => path.startsWith(p));
}
