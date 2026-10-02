import type { ProgrammeData } from '#shared/training'

export default defineEventHandler(async (event) => {
  const { supabase } = await useUserClient(event)
  const { sourceId } = await readBody<{ sourceId: string }>(event)
  const source = must(await supabase.from('sources').select('*').eq('id', sourceId).single(), 'the programme source')

  const job = must(await supabase.from('ai_jobs').insert({ kind: 'interpret', subject_id: sourceId }).select().single(), 'the job')
  try {
    const data = cleanProgramme(await structured<ProgrammeData>(event, {
      model: 'main',
      name: 'programme',
      schema: programmeSchema,
      input: [{ role: 'developer', content: programmeInstructions }, { role: 'user', content: await sourceContent(supabase, source) }]
    }))

    const { data: prev } = await supabase.from('programmes').select('version').eq('source_id', sourceId).order('version', { ascending: false }).limit(1)
    const programme = must(await supabase.from('programmes').insert({
      source_id: sourceId,
      version: (prev?.[0]?.version ?? 0) + 1,
      name: data.name || source.title,
      data
    }).select('id').single(), 'the programme')

    await supabase.from('ai_jobs').update({ status: 'done', result_id: programme.id, updated_at: new Date().toISOString() }).eq('id', job.id)
    return { programmeId: programme.id }
  } catch (e) {
    await supabase.from('ai_jobs').update({ status: 'failed', error: errorMessage(e), updated_at: new Date().toISOString() }).eq('id', job.id)
    throw e
  }
})
