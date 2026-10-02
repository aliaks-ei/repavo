// Pure training logic shared by the app and the server. No Nuxt imports here so `node --test` can run it.

export type Equipment = 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight' | 'other'
export const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'other']

// A programme is a list of exercises plus week-by-week prescriptions, all in English.
export interface ProgrammeExercise {
  key: string
  name: string
  variant: string | null
  equipment: Equipment
  rest_seconds: number | null
  technique: string | null
  video_url: string | null
}

export interface Prescription {
  exercise_key: string
  sets: number | null
  rep_min: number | null
  rep_max: number | null
  method: string | null
  load: string | null
}

export interface ProgrammeSession {
  key: string
  name: string
  items: Prescription[]
}

export interface ProgrammeWeek {
  week: number
  sessions: ProgrammeSession[]
}

export interface Guide {
  key: string
  kind: 'warmup' | 'finisher' | 'abs'
  title: string
  steps: string[]
  video_url: string | null
}

export interface ProgrammeIssue {
  severity: 'missing' | 'conflict' | 'unclear'
  message: string
  resolved?: boolean
}

export interface ProgrammeData {
  name: string
  summary: string
  current_week: number | null
  exercises: ProgrammeExercise[]
  weeks: ProgrammeWeek[]
  methods: { name: string, description: string }[]
  rules: string[]
  guides: Guide[]
  abs: Prescription[]
  issues: ProgrammeIssue[]
}

export interface PlanExercise {
  key: string
  name: string
  variant: string | null
  equipment: Equipment
  sets: number
  rep_min: number | null
  rep_max: number | null
  target_weight: number | null
  target_reps: number | null
  rest_seconds: number | null
  method?: string | null
  notes: string | null
  technique: string | null
  video_url: string | null
  rationale?: string | null
  rule_ref?: string | null
}

export interface PlanSession {
  key: string
  name: string
  exercises: PlanExercise[]
}

export interface BlockPlan {
  sessions: PlanSession[]
  abs: PlanExercise[]
}

export interface Proposal {
  id: string
  title: string
  detail: string
  reason: string
  session_key: string | null
  exercise_key: string | null
  change: { target_weight: number | null, target_reps: number | null, sets: number | null }
  decision: 'pending' | 'accepted' | 'rejected'
}

export type WorkoutStatus = 'in_progress' | 'interrupted' | 'completed' | 'skipped'

export interface Workout {
  id: string
  block_id: string
  session_key: string
  session_name: string
  status: WorkoutStatus
  started_at: string | null
  finished_at: string | null
  rescheduled_for: string | null
  abs_included: boolean
  notes: string | null
  updated_at: string
}

export interface SetRecord {
  id: string
  workout_id: string
  exercise_key: string
  exercise_name: string
  variant: string | null
  equipment: Equipment
  set_index: number
  status: 'done' | 'skipped'
  weight: number | null
  unit: 'kg' | 'lb'
  reps: number | null
  target_weight: number | null
  target_reps: number | null
  note: string | null
  performed_at: string
  updated_at: string
}

// What the weight number means for this equipment.
export function weightMeaning(equipment: Equipment): string {
  switch (equipment) {
    case 'dumbbell': return 'per dumbbell'
    case 'kettlebell': return 'per kettlebell'
    case 'barbell': return 'total incl. bar'
    case 'bodyweight': return 'added load'
    case 'machine':
    case 'cable': return 'stack'
    default: return ''
  }
}

export function repsLabel(ex: { rep_min: number | null, rep_max: number | null }): string {
  if (ex.rep_min && ex.rep_max && ex.rep_min !== ex.rep_max) return `${ex.rep_min}–${ex.rep_max}`
  return String(ex.rep_max ?? ex.rep_min ?? '–')
}

export function formatWeight(w: number | null | undefined): string {
  if (w == null) return '–'
  return Number.isInteger(w) ? String(w) : String(Math.round(w * 100) / 100)
}

// Exercises keep their identity by name + variant so different variants are never merged.
export function exerciseIdentity(s: { exercise_name: string, variant: string | null }): string {
  return `${s.exercise_name.trim().toLowerCase()}|${(s.variant ?? '').trim().toLowerCase()}`
}

export const REP_BUCKETS = [
  { key: '1-5', label: '1–5 reps', min: 1, max: 5 },
  { key: '6-8', label: '6–8 reps', min: 6, max: 8 },
  { key: '9-12', label: '9–12 reps', min: 9, max: 12 },
  { key: '13+', label: '13+ reps', min: 13, max: Infinity }
]

export function repBucket(reps: number): string {
  return REP_BUCKETS.find(b => reps >= b.min && reps <= b.max)?.key ?? '13+'
}

// Programme week used for a training week. Past the last week the cycle repeats.
export function programmeWeek(p: ProgrammeData, week: number): ProgrammeWeek | undefined {
  const sorted = [...p.weeks].sort((a, b) => a.week - b.week)
  if (!sorted.length) return
  return sorted.find(w => w.week === week) ?? sorted[(week - 1) % sorted.length]
}

export function blockFromProgramme(p: ProgrammeData, week: number): BlockPlan {
  const toPlan = (rx: Prescription): PlanExercise | null => {
    const e = p.exercises.find(x => x.key === rx.exercise_key)
    if (!e) return null
    const method = rx.method ? p.methods.find(m => m.name === rx.method) : undefined
    return {
      key: e.key,
      name: e.name,
      variant: e.variant,
      equipment: e.equipment,
      sets: rx.sets ?? 3,
      rep_min: rx.rep_min,
      rep_max: rx.rep_max,
      target_weight: null,
      target_reps: rx.rep_max ?? rx.rep_min,
      rest_seconds: e.rest_seconds,
      method: rx.method,
      notes: [method && `${method.name}: ${method.description}`, rx.load].filter(Boolean).join(' ') || null,
      technique: e.technique,
      video_url: e.video_url
    }
  }
  // The same exercise twice in one session gets a distinct key so its sets stay separate.
  const uniq = (list: PlanExercise[]) => {
    const seen = new Map<string, number>()
    return list.map((x) => {
      const n = (seen.get(x.key) ?? 0) + 1
      seen.set(x.key, n)
      return n > 1 ? { ...x, key: `${x.key}-${n}` } : x
    })
  }
  const w = programmeWeek(p, week)
  return {
    sessions: (w?.sessions ?? []).map(s => ({ key: s.key, name: s.name, exercises: uniq(s.items.map(toPlan).filter((x): x is PlanExercise => !!x)) })),
    abs: uniq(p.abs.map(toPlan).filter((x): x is PlanExercise => !!x))
  }
}

export interface ExerciseSummary {
  session_key: string
  exercise_key: string
  name: string
  variant: string | null
  target_weight: number | null
  target_reps: number | null
  planned_sets: number
  done: { weight: number | null, reps: number | null }[]
  skipped: number
  hit_target: boolean
}

export interface BlockSummary {
  sessions: { key: string, name: string, status: WorkoutStatus | 'not_started', workout_id: string | null, notes: string | null }[]
  exercises: ExerciseSummary[]
  completed_sessions: number
  missed_sessions: number
}

// Latest workout per session key wins; earlier attempts stay in history.
export function latestWorkoutBySession(workouts: Workout[]): Map<string, Workout> {
  const m = new Map<string, Workout>()
  for (const w of [...workouts].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) m.set(w.session_key, w)
  return m
}

export function summariseBlock(plan: BlockPlan, workouts: Workout[], sets: SetRecord[]): BlockSummary {
  const bySession = latestWorkoutBySession(workouts)
  const exercises: ExerciseSummary[] = []
  for (const s of plan.sessions) {
    const w = bySession.get(s.key)
    for (const e of s.exercises) {
      const mine = w ? sets.filter(x => x.workout_id === w.id && x.exercise_key === e.key) : []
      const done = mine.filter(x => x.status === 'done').sort((a, b) => a.set_index - b.set_index)
      exercises.push({
        session_key: s.key,
        exercise_key: e.key,
        name: e.name,
        variant: e.variant,
        target_weight: e.target_weight,
        target_reps: e.target_reps,
        planned_sets: e.sets,
        done: done.map(x => ({ weight: x.weight, reps: x.reps })),
        skipped: Math.max(0, e.sets - done.length),
        hit_target: done.length >= e.sets && done.every(x =>
          (e.target_reps == null || (x.reps ?? 0) >= e.target_reps)
          && (e.target_weight == null || (x.weight ?? 0) >= e.target_weight))
      })
    }
  }
  const sessions = plan.sessions.map((s) => {
    const w = bySession.get(s.key)
    return { key: s.key, name: s.name, status: w?.status ?? 'not_started' as const, workout_id: w?.id ?? null, notes: w?.notes ?? null }
  })
  return {
    sessions,
    exercises,
    completed_sessions: sessions.filter(s => s.status === 'completed').length,
    missed_sessions: sessions.filter(s => s.status !== 'completed').length
  }
}

// Programme-strict check: any change to set count or a target outside the prescribed rep range
// is a departure from the programme and must become a proposal.
export function isDeparture(base: PlanExercise, next: { sets: number, target_reps: number | null }): boolean {
  if (next.sets !== base.sets) return true
  if (next.target_reps == null) return false
  if (base.rep_min != null && next.target_reps < base.rep_min) return true
  if (base.rep_max != null && next.target_reps > base.rep_max) return true
  return false
}

export function applyProposal(plan: BlockPlan, p: Proposal): BlockPlan {
  const copy: BlockPlan = structuredClone(plan)
  for (const s of copy.sessions) {
    if (p.session_key && s.key !== p.session_key) continue
    for (const e of s.exercises) {
      if (p.exercise_key && e.key !== p.exercise_key) continue
      if (p.change.target_weight != null) e.target_weight = p.change.target_weight
      if (p.change.target_reps != null) e.target_reps = p.change.target_reps
      if (p.change.sets != null) e.sets = p.change.sets
    }
  }
  return copy
}

function whoopName(name: string, variant: string | null, equipment: Equipment): string {
  const base = variant ? `${name} (${variant})` : name
  const eq = equipment === 'other' || equipment === 'bodyweight' || equipment === 'machine' ? '' : equipment
  if (!eq || base.toLowerCase().includes(eq)) return base
  return `${eq[0]!.toUpperCase()}${eq.slice(1)} ${base}`
}

export function whoopExport(w: Workout, sets: SetRecord[], order: string[]): string {
  const unit = sets[0]?.unit ?? 'kg'
  const lines: string[] = [`Strength training: ${w.session_name}`]
  if (w.started_at) {
    const d = new Date(w.started_at)
    lines.push(`Date: ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`)
    if (w.finished_at) lines.push(`Duration: ${Math.max(1, Math.round((+new Date(w.finished_at) - +d) / 60000))} min`)
  }
  lines.push(`Units: ${unit}. Dumbbell weight is per dumbbell. Barbell weight is total including the bar.`, '')

  const groups = new Map<string, SetRecord[]>()
  for (const s of [...sets].sort((a, b) => a.set_index - b.set_index)) {
    groups.set(s.exercise_key, [...(groups.get(s.exercise_key) ?? []), s])
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
  const skipped: string[] = []
  for (const k of keys) {
    const g = groups.get(k)!
    const first = g[0]!
    const done = g.filter(s => s.status === 'done')
    const name = whoopName(first.exercise_name, first.variant, first.equipment)
    if (!done.length) {
      skipped.push(name)
      continue
    }
    const meaning = first.equipment === 'dumbbell' ? ', per dumbbell' : first.equipment === 'barbell' ? ', total incl. bar' : ''
    const parts = done.map(s => s.weight != null && s.weight > 0
      ? `${formatWeight(s.weight)} ${s.unit} × ${s.reps ?? 0}`
      : `${s.reps ?? 0} reps`)
    lines.push(`${name}${meaning}: ${parts.join(', ')}`)
  }
  if (skipped.length) lines.push('', `Skipped: ${skipped.join(', ')}`)
  if (w.notes) lines.push('', `Notes: ${w.notes}`)
  return lines.join('\n')
}

// Deterministic statistics for one exercise; the assistant explains these, it does not compute them.
export function exerciseStats(sets: (SetRecord & { date: string, session_name: string })[]) {
  const done = sets.filter(s => s.status === 'done' && s.reps != null)
  const sessions = new Map<string, typeof done>()
  for (const s of [...done].sort((a, b) => a.set_index - b.set_index)) sessions.set(s.workout_id, [...(sessions.get(s.workout_id) ?? []), s])
  const perSession = [...sessions.entries()].map(([workout_id, ss]) => {
    const top = ss.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) || ((b.weight ?? 0) === (a.weight ?? 0) && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a))
    return {
      workout_id,
      date: ss[0]!.date,
      session_name: ss[0]!.session_name,
      top_weight: top.weight,
      top_reps: top.reps,
      bucket: repBucket(top.reps ?? 0),
      volume: ss.reduce((n, s) => n + (s.weight ?? 0) * (s.reps ?? 0), 0),
      sets: ss.map(s => `${formatWeight(s.weight)}×${s.reps}`).join(', ')
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
  const bestByBucket: Record<string, { weight: number | null, reps: number | null, date: string }> = {}
  for (const p of perSession) {
    const cur = bestByBucket[p.bucket]
    if (!cur || (p.top_weight ?? 0) > (cur.weight ?? 0)) bestByBucket[p.bucket] = { weight: p.top_weight, reps: p.top_reps, date: p.date }
  }
  return { sessions: perSession, best_by_rep_range: bestByBucket, total_sessions: perSession.length }
}
