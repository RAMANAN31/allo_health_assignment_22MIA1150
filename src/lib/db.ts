import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jbjdsevvfarxxlegttxr.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_0fZmm7mU6e1v-6Xq-ni2Pw_AjQh4jZS';

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseKey);
