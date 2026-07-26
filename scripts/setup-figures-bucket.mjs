import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase.storage.createBucket("standards-figures", {
  public: false,
});

if (error) {
  if (error.message?.toLowerCase().includes("already exists")) {
    console.log("Bucket already exists, nothing to do.");
  } else {
    console.error("Error creating bucket:", error.message);
    process.exit(1);
  }
} else {
  console.log("Bucket created:", data);
}
