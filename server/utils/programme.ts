import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResponseInputContent } from 'openai/resources/responses/responses'
import { EQUIPMENT, type Prescription, type ProgrammeData } from '#shared/training'

// Shared by reading a programme (interpret) and changing a draft on request (revise).

const prescription = obj({
  exercise_key: str,
  sets: nullable(int),
  rep_min: nullable(int),
  rep_max: nullable(int),
  method: nullable(str),
  load: nullable(str)
})

export const programmeSchema = obj({
  name: str,
  summary: str,
  current_week: nullable(int),
  exercises: arr(obj({ key: str, name: str, variant: nullable(str), equipment: oneOf(EQUIPMENT), rest_seconds: nullable(int), technique: nullable(str), video_url: nullable(str) })),
  weeks: arr(obj({ week: int, sessions: arr(obj({ key: str, name: str, items: arr(prescription) })) })),
  methods: arr(obj({ name: str, description: str })),
  rules: arr(str),
  guides: arr(obj({ key: str, kind: oneOf(['warmup', 'finisher', 'abs']), title: str, steps: arr(str), video_url: nullable(str) })),
  abs: arr(prescription),
  issues: arr(obj({ severity: oneOf(['missing', 'conflict', 'unclear']), message: str }))
})

export const programmeInstructions = `You turn a purchased strength-training programme into a clean weekly plan for a training app.

Language
- Write every field in English, whatever the source language. Translate exercise names to the common English gym name (e.g. "Тяга блока к поясу" → "Seated Cable Row"). Never include text in another language, quotes or citations.

What to extract
- exercises: each distinct exercise once. key is a short lowercase slug. variant holds what makes it distinct (angle, grip, stance, attachment), or null. equipment: the closest value; if the source does not make it clear, pick what the exercise name implies (barbell for bench press, squat, deadlift; dumbbell for dumbbell work; machine or cable for machines and pulleys).
- weeks: every week of the programme, numbered from 1, each with its sessions in order. Session keys stay the same across weeks (e.g. "workout-1"). Each item references an exercise key with sets and reps for that week. "8-10" → rep_min 8, rep_max 10; "8" → 8 and 8. If the programme gives a single week that repeats, return that one week.
- method: the name of a special set technique for that item (e.g. "Drop8", "MIO"), defined once in methods with a one- or two-sentence description. Otherwise null. For a method, put the main working sets and reps in sets/reps.
- load: short load guidance for that item only if the programme prescribes one (e.g. "RPE 8", "1 rep in reserve"). Otherwise null.
- rest_seconds: only when the programme fixes a rest time for the exercise; otherwise null.
- rules: at most 6 short sentences with the general rules that change how to train or progress (effort, tempo, progression, rest). Skip motivation and background.
- guides: warm-up or cool-down routines as short steps. Optional abdominal work goes to abs (prescriptions) and, if it has instructions, a guide with kind "abs".
- current_week: if the user notes say which week they are on now, that week number; otherwise null.
- summary: one short sentence (weeks, sessions per week, goal).

What to ignore
- Logged results, past loads and personal notes are not prescriptions. Do not turn them into exercises, loads or issues.
- Do not invent sets, reps or exercises.

Issues
- At most 5, one short sentence each, only when something needed to train is missing (sets, reps or which exercise) or the sources disagree in a way that changes what to do. Do not report missing rest, technique, videos, warm-up details or variants.`

// Pasted text and every file of a source, as model input. OpenAI fetches files directly.
export async function sourceContent(supabase: SupabaseClient, source: { title: string, text_content: string | null, files: { path: string, name: string }[] | null }) {
  const files = source.files ?? []
  const content: ResponseInputContent[] = [{ type: 'input_text', text: `Programme title: ${source.title}. Parts: ${[source.text_content && 'pasted text', ...files.map(f => f.name)].filter(Boolean).join(', ')}.` }]
  if (source.text_content) content.push({ type: 'input_text', text: source.text_content })
  for (const f of files) {
    const signed = must(await supabase.storage.from('sources').createSignedUrl(f.path, 600), f.name)
    content.push({ type: 'input_text', text: `File: ${f.name}` }, { type: 'input_file', file_url: signed.signedUrl })
  }
  return content
}

// Application checks: unique exercise keys, every prescription points at a known exercise, limits kept.
export function cleanProgramme(data: ProgrammeData): ProgrammeData {
  const known = new Set<string>()
  data.exercises = data.exercises.filter(e => e.key && !known.has(e.key) && known.add(e.key))
  const valid = (rx: Prescription) => known.has(rx.exercise_key)
  data.weeks = data.weeks
    .map(w => ({ ...w, sessions: w.sessions.map(s => ({ ...s, items: s.items.filter(valid) })).filter(s => s.items.length) }))
    .filter(w => w.sessions.length)
    .sort((a, b) => a.week - b.week)
  data.abs = data.abs.filter(valid)
  if (!data.weeks.length) throw createError({ statusCode: 422, statusMessage: 'No training sessions were found. Check that the files contain the programme itself.' })
  data.issues = data.issues.slice(0, 5).map(i => ({ ...i, resolved: false }))
  data.rules = data.rules.slice(0, 6)
  if (data.current_week && !data.weeks.some(w => w.week === data.current_week)) data.current_week = null
  return data
}
