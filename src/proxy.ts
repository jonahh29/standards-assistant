import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isAdminOnlyPath(pathname: string): boolean {
  return (
    pathname === "/upload" ||
    pathname === "/api/documents/upload-url" ||
    pathname === "/api/documents/process" ||
    /^\/api\/documents\/[^/]+$/.test(pathname) ||
    /^\/api\/documents\/[^/]+\/figures-batch$/.test(pathname)
  );
}

export async function proxy(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!user) {
    if (pathname === "/login") return supabaseResponse;
    if (isApi) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  const isAdmin = user.app_metadata?.role === "admin";
  if (isAdminOnlyPath(pathname) && !isAdmin) {
    if (isApi) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
