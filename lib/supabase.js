import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing. Check .env.local location/name and restart dev server.");
}
if (!supabaseKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Check .env.local location/name and restart dev server.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
