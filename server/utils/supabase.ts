import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

// Supabase client acting as the signed-in user, so row-level security applies to every query.
export async function useUserClient(event: H3Event) {
  const token = getHeader(event, 'authorization')?.replace(/^Bearer /, '')
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Sign in again.' })
  const { supabaseUrl, supabaseKey } = useRuntimeConfig(event).public
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw createError({ statusCode: 401, statusMessage: 'Sign in again.' })
  return { supabase, user: data.user }
}

// Rows are untyped (no generated DB types), so callers get `any` after the null check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must(res: { data: unknown, error: { message: string } | null }, what: string): any {
  if (res.error || res.data == null) throw createError({ statusCode: 404, statusMessage: `Could not load ${what}.` })
  return res.data
}
