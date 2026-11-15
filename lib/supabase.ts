import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Server-only Supabase client. Requires the service role key. */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export type KbChunkMatch = {
  id: string;
  content: string;
  topic: string;
  faculty: string | null;
  source_url: string | null;
  confidence: string;
  last_checked: string | null;
  similarity: number;
};

export async function searchKbChunks(
  embedding: number[],
  options: {
    matchCount?: number;
    topic?: string | null;
    faculty?: string | null;
  } = {}
): Promise<KbChunkMatch[]> {
  const { matchCount = 5, topic = null, faculty = null } = options;
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("match_kb_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_topic: topic,
    filter_faculty: faculty,
  });

  if (error) {
    throw new Error(`kb search failed: ${error.message}`);
  }

  return (data ?? []) as KbChunkMatch[];
}
