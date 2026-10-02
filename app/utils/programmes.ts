// What deleting a programme removes. Weeks cascade to their logged sessions in the database.
export async function deletionImpact(opts: { sourceId?: string, programmeId?: string }) {
  const sb = useSupabase()
  const ids = opts.programmeId
    ? [opts.programmeId]
    : ((await sb.from('programmes').select('id').eq('source_id', opts.sourceId!)).data ?? []).map(p => p.id)
  const blocks = ids.length ? ((await sb.from('blocks').select('id').in('programme_id', ids).neq('status', 'discarded')).data ?? []).map(b => b.id) : []
  const { count } = blocks.length ? await sb.from('workouts').select('id', { count: 'exact', head: true }).in('block_id', blocks) : { count: 0 }
  return { versions: ids.length, weeks: blocks.length, sessions: count ?? 0 }
}

export function describeImpact(i: { versions: number, weeks: number, sessions: number }, what: 'programme' | 'draft') {
  const parts = [what === 'draft' ? 'this draft' : i.versions > 1 ? `this programme with all ${i.versions} versions and its files` : 'this programme and its files']
  if (i.weeks) parts.push(`${i.weeks} ${i.weeks === 1 ? 'week' : 'weeks'} planned from it`)
  if (i.sessions) parts.push(`${i.sessions} logged ${i.sessions === 1 ? 'session' : 'sessions'} with all their sets`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `This permanently deletes ${list}.`
}

export async function deleteSource(sourceId: string) {
  const sb = useSupabase()
  const { data: src } = await sb.from('sources').select('files').eq('id', sourceId).single()
  const paths = ((src?.files ?? []) as { path: string }[]).map(f => f.path)
  if (paths.length) await sb.storage.from('sources').remove(paths)
  const { error } = await sb.from('sources').delete().eq('id', sourceId)
  if (error) throw error
  await useTraining().refresh()
}

export async function deleteProgramme(programmeId: string) {
  const { error } = await useSupabase().from('programmes').delete().eq('id', programmeId)
  if (error) throw error
  await useTraining().refresh()
}
