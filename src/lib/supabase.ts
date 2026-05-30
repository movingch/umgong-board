import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseReady = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('YOUR-PROJECT') &&
  !supabaseAnonKey.includes('YOUR-SUPABASE')
);

export const supabase = isSupabaseReady
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;
