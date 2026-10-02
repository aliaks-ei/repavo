import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyProposal, blockFromProgramme, exerciseIdentity, isDeparture, summariseBlock, whoopExport } from './training.ts'
import type { ProgrammeData, SetRecord, Workout } from './training.ts'

const programme: ProgrammeData = {
  name: 'Test', summary: '', current_week: null, rules: [], guides: [], issues: [], abs: [],
  methods: [{ name: 'Drop8', description: 'Drop 30% after each set.' }],
  exercises: [
    { key: 'bench', name: 'Bench Press', variant: null, equipment: 'barbell', rest_seconds: 90, technique: null, video_url: null },
    { key: 'incline', name: 'Incline Press', variant: '30°', equipment: 'dumbbell', rest_seconds: 60, technique: null, video_url: null }
  ],
  weeks: [1, 2].map(week => ({ week, sessions: [{ key: 'a', name: 'Day A', items: [
    { exercise_key: 'bench', sets: week === 1 ? 2 : 4, rep_min: 8, rep_max: 10, method: null, load: null },
    { exercise_key: 'incline', sets: 2, rep_min: 10, rep_max: 12, method: week === 2 ? 'Drop8' : null, load: null }
  ] }] }))
}

const w: Workout = { id: 'w1', block_id: 'b', session_key: 'a', session_name: 'Day A', status: 'completed', started_at: '2026-10-02T10:00:00Z', finished_at: '2026-10-02T10:45:00Z', rescheduled_for: null, abs_included: false, notes: null, updated_at: '2026-10-02T10:45:00Z' }
const set = (i: number, key: string, name: string, eq: SetRecord['equipment'], weight: number, reps: number, status: SetRecord['status'] = 'done'): SetRecord => ({
  id: `${key}${i}`, workout_id: 'w1', exercise_key: key, exercise_name: name, variant: key === 'incline' ? '30°' : null, equipment: eq, set_index: i, status, weight, unit: 'kg', reps, target_weight: null, target_reps: null, note: null, performed_at: '', updated_at: ''
})
const sets = [set(0, 'bench', 'Bench Press', 'barbell', 60, 10), set(1, 'bench', 'Bench Press', 'barbell', 60, 9), set(0, 'incline', 'Incline Press', 'dumbbell', 22, 12), set(1, 'incline', 'Incline Press', 'dumbbell', 22, 0, 'skipped')]

test('whoop export states units and weight meaning, lists skipped work', () => {
  const text = whoopExport(w, sets, ['bench', 'incline'])
  assert.match(text, /Units: kg/)
  assert.match(text, /Barbell Bench Press, total incl\. bar: 60 kg × 10, 60 kg × 9/)
  assert.match(text, /Dumbbell Incline Press \(30°\), per dumbbell: 22 kg × 12/)
  assert.match(text, /Duration: 45 min/)
})

test('summary counts skipped sets and target hits', () => {
  const plan = blockFromProgramme(programme, 1)
  plan.sessions[0]!.exercises[0]!.target_reps = 9
  const s = summariseBlock(plan, [w], sets)
  assert.equal(s.completed_sessions, 1)
  assert.equal(s.exercises[0]!.hit_target, true)
  assert.equal(s.exercises[1]!.skipped, 1)
})

test('departures outside prescribed range are detected', () => {
  const base = blockFromProgramme(programme, 1).sessions[0]!.exercises[0]!
  assert.equal(isDeparture(base, { sets: 2, target_reps: 10 }), false)
  assert.equal(isDeparture(base, { sets: 3, target_reps: 10 }), true)
  assert.equal(isDeparture(base, { sets: 2, target_reps: 12 }), true)
})

test('variants are distinct identities and proposals apply to one exercise', () => {
  assert.notEqual(exerciseIdentity({ exercise_name: 'Press', variant: '30°' }), exerciseIdentity({ exercise_name: 'Press', variant: null }))
  const plan = applyProposal(blockFromProgramme(programme, 1), { id: 'p', title: '', detail: '', reason: '', session_key: 'a', exercise_key: 'bench', change: { target_weight: null, target_reps: null, sets: 3 }, decision: 'accepted' })
  assert.equal(plan.sessions[0]!.exercises[0]!.sets, 3)
  assert.equal(plan.sessions[0]!.exercises[1]!.sets, 2)
})

test('weeks follow the programme and repeat after the last week', () => {
  assert.equal(blockFromProgramme(programme, 2).sessions[0]!.exercises[0]!.sets, 4)
  assert.equal(blockFromProgramme(programme, 2).sessions[0]!.exercises[1]!.method, 'Drop8')
  assert.equal(blockFromProgramme(programme, 3).sessions[0]!.exercises[0]!.sets, 2)
})
