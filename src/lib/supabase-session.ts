import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

export async function getSupabaseSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore since
            // middleware is responsible for refreshing the session cookie.
          }
        },
      },
    }
  );
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await getSupabaseSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export function isAdmin(user: User | null): boolean {
  return user?.app_metadata?.role === "admin";
}

export type Product = "residential" | "commercial";

/** Which document products a user can see/search. Admin always has full access
 * regardless of their own `products` field, so promoting someone to admin never
 * requires also remembering to grant them every product separately. */
export function getAllowedProducts(user: User | null): Product[] {
  if (isAdmin(user)) return ["residential", "commercial"];
  const products = user?.app_metadata?.products;
  return Array.isArray(products) ? (products as Product[]) : [];
}
