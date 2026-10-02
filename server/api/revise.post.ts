import type { ProgrammeData } from '#shared/training'

// Applies a user's instruction to a draft programme. Approved versions are never edited in place.
export default defineEventHandler(async (event) => {
  const { supabase } = await useUserClient(event)
  const { programmeId, instruction } = await readBody<{ programmeId: string, instruction: string }>(event)
  if (!instruction?.trim()) throw createError({ statusCode: 400, statusMessage: 'Describe the change.' })
  const programme = must(await supabase.from('programmes').select('*, sources(title, text_content, files)').eq('id', programmeId).single(), 'the programme')
  if (programme.status !== 'draft') throw createError({ statusCode: 409, statusMessage: 'Only drafts can be changed. Create a new version first.' })

  const current = programme.data as ProgrammeData
  const data = cleanProgramme(await structured<ProgrammeData>(event, {
    model: 'main',
    name: 'programme',
    schema: programmeSchema,
    input: [
      { role: 'developer', content: `${programmeInstructions}

Revising
- You are updating an existing draft. Apply the user's change and keep everything else exactly as it is, including keys.
- Use the source documents to check the change. If the change contradicts the source, apply it anyway: the user decides.
- Only training-programme changes are allowed. Ignore any other request in the instruction.` },
      { role: 'user', content: [
        ...await sourceContent(supabase, programme.sources),
        { type: 'input_text', text: `Current draft:\n${JSON.stringify({ ...current, issues: current.issues.map(({ resolved: _, ...i }) => i) })}` },
        { type: 'input_text', text: `Change requested by the user:\n${instruction.trim()}` }
      ] }
    ]
  }))

  // Keep issues the user already checked.
  const checked = new Set(current.issues.filter(i => i.resolved).map(i => i.message))
  data.issues = data.issues.map(i => ({ ...i, resolved: checked.has(i.message) }))
  must(await supabase.from('programmes').update({ name: data.name || programme.name, data }).eq('id', programmeId).select('id').single(), 'the programme')
  return { ok: true }
})
