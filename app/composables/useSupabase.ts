import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function useSupabase() {
  if (!client) {
    const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
    client = createClient(supabaseUrl, supabaseKey)
  }
  return client
}

// Server calls for AI work. Sends the user's token so the server acts as the user.
export async function api<T>(path: string, body: unknown): Promise<T> {
  const { data } = await useSupabase().auth.getSession()
  return await $fetch<T>(path, {
    method: 'POST',
    body: body as Record<string, unknown>,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` }
  })
}

export function apiError(e: unknown): string {
  const err = e as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You are offline. This needs a connection.'
  return err.data?.statusMessage || err.data?.message || err.statusMessage || err.message || 'Something went wrong.'
}
