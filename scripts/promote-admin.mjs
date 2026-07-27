import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/promote-admin.mjs <email>");
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Find the user by email (admin API paginates; fine for a small user base)
let user = null;
let page = 1;
while (!user) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (user || data.users.length < 200) break;
  page++;
}

if (!user) {
  console.error(`No account found for ${email}. Create it first via Supabase Dashboard > Authentication > Users.`);
  process.exit(1);
}

const { error } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: "admin" },
});

if (error) throw new Error(error.message);
console.log(`Promoted ${email} to admin.`);
