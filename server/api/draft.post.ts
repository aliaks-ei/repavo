import { blockFromProgramme, isDeparture, summariseBlock, type BlockPlan, type ProgrammeData, type Proposal } from '#shared/training'

interface DraftOut {
  exercises: { session_key: string, exercise_key: string, sets: number, target_weight: number | null, target_reps: number | null, rationale: string, rule_ref: string | null }[]
  proposals: { title: string, detail: string, reason: string, session_key: string | null, exercise_key: string | null, target_weight: number | null, target_reps: number | null, sets: number | null }[]
  notes: string
}

const schema = obj({
  exercises: arr(obj({ session_key: str, exercise_key: str, sets: int, target_weight: nullable(num), target_reps: nullable(int), rationale: str, rule_ref: nullable(str) })),
  proposals: arr(obj({ title: str, detail: str, reason: str, session_key: nullable(str), exercise_key: nullable(str), target_weight: nullable(num), target_reps: nullable(int), sets: nullable(int) })),
  notes: str
})

export default defineEventHandler(async (event) => {
  const { supabase } = await useUserClient(event)
  const { blockId, comment } = await readBody<{ blockId: string, comment?: string }>(event)

  const block = must(await supabase.from('blocks').select('*').eq('id', blockId).single(), 'this week')
  const programme = must(await supabase.from('programmes').select('*').eq('id', block.programme_id).single(), 'the programme')
  const workouts = (await supabase.from('workouts').select('*').eq('block_id', blockId)).data ?? []
  const sets = workouts.length ? (await supabase.from('sets').select('*').in('workout_id', workouts.map(w => w.id))).data ?? [] : []
  const { data: settings } = await supabase.from('settings').select('*').maybeSingle()
  const proposalsEnabled = settings?.proposals_enabled ?? true

  const job = must(await supabase.from('ai_jobs').insert({ kind: 'draft', subject_id: blockId }).select().single(), 'the job')
  try {
    const data = programme.data as ProgrammeData
    const current = block.plan as BlockPlan
    const summary = summariseBlock(current, workouts, sets)
    // Sets and rep ranges always come from the programme's next week as written; only targets move.
    const nextWeek = block.week_number + 1
    const base = blockFromProgramme(data, nextWeek)
    if (!base.sessions.length) throw createError({ statusCode: 422, statusMessage: 'The programme has no sessions for the next week.' })

    const out = await structured<DraftOut>(event, {
      model: 'main',
      name: 'next_week',
      schema,
      input: [
        {
          role: 'developer',
          content: `You plan the next week of a purchased strength programme. Follow the programme strictly.
- Return one entry in "exercises" for every exercise in next_week, using its session key and exercise key.
- Keep "sets" equal to next_week's sets and target_reps inside its rep range. Sets and reps can change from week to week by design (wave loading); that is not a departure.
- Set target_weight from the actual results and the programme's progression rules. Use the same unit as the logged sets. Dumbbell weight is per dumbbell; barbell weight is total including the bar.
- If a lift has no logged result, keep the current target (or null).
- rationale: one short sentence citing the actual result. rule_ref: the progression rule text you applied, or null.
- ${proposalsEnabled
            ? 'Anything outside the programme (different sets, reps outside the range, swapped exercises, deloads not in the rules) goes in "proposals" only, never in "exercises". Propose only when the results or the comment clearly justify it.'
            : 'Return an empty "proposals" list. The user wants the programme exactly as written.'}`
        },
        {
          role: 'user',
          content: JSON.stringify({
            programme: { name: data.name, rules: data.rules, methods: data.methods },
            next_week: { week_number: nextWeek, plan: base },
            current_week: { week_number: block.week_number, plan: current },
            results: summary,
            comment: comment || null
          })
        }
      ]
    })

    // Application check: the model's output only changes targets. Departures become proposals or are dropped.
    const plan: BlockPlan = structuredClone(base)
    const proposals: Proposal[] = []
    for (const s of plan.sessions) {
      const prev = current.sessions.find(c => c.key === s.key)
      for (const e of s.exercises) {
        const old = prev?.exercises.find(x => x.key === e.key)
        e.target_weight = old?.target_weight ?? null
        e.target_reps = old?.target_reps ?? e.target_reps
        const next = out.exercises.find(x => x.session_key === s.key && x.exercise_key === e.key)
        if (!next) continue
        e.rationale = next.rationale
        e.rule_ref = next.rule_ref
        e.target_weight = next.target_weight ?? e.target_weight
        if (isDeparture(e, next)) {
          if (proposalsEnabled) {
            proposals.push({
              id: crypto.randomUUID(),
              title: `${e.name}: ${next.sets} × ${next.target_reps ?? '?'}`,
              detail: `Programme says ${e.sets} sets of ${e.rep_min ?? '?'}–${e.rep_max ?? '?'} reps.`,
              reason: next.rationale,
              session_key: s.key,
              exercise_key: e.key,
              change: { target_weight: null, target_reps: next.target_reps, sets: next.sets },
              decision: 'pending'
            })
          }
        } else if (next.target_reps != null) {
          e.target_reps = next.target_reps
        }
      }
    }
    if (proposalsEnabled) {
      for (const p of out.proposals) {
        const valid = !p.session_key || plan.sessions.some(s => s.key === p.session_key && (!p.exercise_key || s.exercises.some(e => e.key === p.exercise_key)))
        if (!valid) continue
        proposals.push({
          id: crypto.randomUUID(), title: p.title, detail: p.detail, reason: p.reason,
          session_key: p.session_key, exercise_key: p.exercise_key,
          change: { target_weight: p.target_weight, target_reps: p.target_reps, sets: p.sets },
          decision: 'pending'
        })
      }
    }

    // Replace an earlier unactivated draft for the same week instead of piling them up.
    await supabase.from('blocks').update({ status: 'discarded' }).eq('programme_id', block.programme_id).eq('week_number', nextWeek).eq('status', 'draft')
    const next = must(await supabase.from('blocks').insert({
      programme_id: block.programme_id,
      week_number: nextWeek,
      plan,
      proposals,
      comment: comment || null,
      summary,
      notes: out.notes
    }).select('id').single(), 'the new week')

    await supabase.from('ai_jobs').update({ status: 'done', result_id: next.id, updated_at: new Date().toISOString() }).eq('id', job.id)
    return { blockId: next.id }
  } catch (e) {
    await supabase.from('ai_jobs').update({ status: 'failed', error: errorMessage(e), updated_at: new Date().toISOString() }).eq('id', job.id)
    throw e
  }
})
