import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { getRequiredEnv } from "./env";

let supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return supabaseAdmin;
}
