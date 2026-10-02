import { get, set as idbSet } from 'idb-keyval'
import type { BlockPlan, PlanExercise, ProgrammeData, Proposal, SetRecord, Workout } from '#shared/training'
import { exerciseIdentity, latestWorkoutBySession } from '#shared/training'

export interface Block {
  id: string
  programme_id: string
  week_number: number
  status: 'draft' | 'active' | 'completed' | 'discarded'
  plan: BlockPlan
  proposals: Proposal[]
  comment: string | null
  summary: unknown
  notes: string | null
  created_at: string
  activated_at: string | null
}

export interface Programme {
  id: string
  source_id: string
  version: number
  name: string
  status: 'draft' | 'approved' | 'archived'
  data: ProgrammeData
  approved_at: string | null
}

export interface Settings { proposals_enabled: boolean, unit: 'kg' | 'lb' }

export type HistorySet = SetRecord & { date: string, session_name: string }

interface LocalState {
  userId: string | null
  block: Block | null
  programme: Programme | null
  settings: Settings
  workouts: Record<string, Workout>
  sets: Record<string, SetRecord>
  history: HistorySet[]
  dirty: { workouts: string[], sets: string[], deletedSets: string[] }
  lastSync: string | null
  loaded: boolean
}

const blank = (): LocalState => ({
  userId: null, block: null, programme: null,
  settings: { proposals_enabled: true, unit: 'kg' },
  workouts: {}, sets: {}, history: [],
  dirty: { workouts: [], sets: [], deletedSets: [] },
  lastSync: null, loaded: false
})

const state = reactive<LocalState>(blank())
const status = reactive({ online: true, syncing: false, error: '' as string, storageError: '' as string })
let syncTimer: ReturnType<typeof setTimeout> | undefined
let listening = false

const WORKOUT_FIELDS = ['id', 'block_id', 'session_key', 'session_name', 'status', 'started_at', 'finished_at', 'rescheduled_for', 'abs_included', 'notes', 'updated_at'] as const
const SET_FIELDS = ['id', 'workout_id', 'exercise_key', 'exercise_name', 'variant', 'equipment', 'set_index', 'status', 'weight', 'unit', 'reps', 'target_weight', 'target_reps', 'note', 'performed_at', 'updated_at'] as const
const pick = <T extends object>(o: T, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, (o as Record<string, unknown>)[k] ?? null]))

const key = () => `repavo:v1:${state.userId}`

// Every edit is written to IndexedDB at once; the network sync runs after.
async function persist() {
  if (!state.userId) return
  try {
    const { loaded: _, ...data } = toRaw(state)
    await idbSet(key(), JSON.parse(JSON.stringify(data)))
    status.storageError = ''
  } catch {
    status.storageError = 'This device could not save your last change. Keep the app open until it syncs.'
  }
}

function markDirty(list: 'workouts' | 'sets' | 'deletedSets', id: string) {
  if (!state.dirty[list].includes(id)) state.dirty[list].push(id)
  persist()
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => sync(), 800)
}

async function load(userId: string) {
  if (state.userId === userId && state.loaded) return
  Object.assign(state, blank())
  state.userId = userId
  try {
    const saved = await get(key())
    if (saved) Object.assign(state, saved)
  } catch {
    status.storageError = 'Saved data on this device could not be read.'
  }
  state.loaded = true
  if (!listening) {
    listening = true
    status.online = navigator.onLine
    window.addEventListener('online', () => {
      status.online = true
      sync().then(refresh)
    })
    window.addEventListener('offline', () => { status.online = false })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync()
    })
  }
  sync().then(refresh)
}

async function sync() {
  if (status.syncing || !navigator.onLine || !state.userId) return
  const pending = state.dirty.workouts.length + state.dirty.sets.length + state.dirty.deletedSets.length
  if (!pending) return
  status.syncing = true
  const sb = useSupabase()
  // Snapshot versions so edits made during the request stay pending.
  const wSnap = state.dirty.workouts.filter(id => state.workouts[id]).map(id => [id, state.workouts[id]!.updated_at] as const)
  const sSnap = state.dirty.sets.filter(id => state.sets[id]).map(id => [id, state.sets[id]!.updated_at] as const)
  const dSnap = [...state.dirty.deletedSets]
  try {
    // Upserts by device-generated id, so a repeated sync never creates duplicates.
    if (wSnap.length) {
      const { error } = await sb.from('workouts').upsert(wSnap.map(([id]) => pick(state.workouts[id]!, WORKOUT_FIELDS)))
      if (error) throw error
    }
    if (sSnap.length) {
      const { error } = await sb.from('sets').upsert(sSnap.map(([id]) => pick(state.sets[id]!, SET_FIELDS)))
      if (error) throw error
    }
    if (dSnap.length) {
      const { error } = await sb.from('sets').delete().in('id', dSnap)
      if (error) throw error
    }
    state.dirty.workouts = state.dirty.workouts.filter(id => !wSnap.some(([i, v]) => i === id && state.workouts[id]?.updated_at === v))
    state.dirty.sets = state.dirty.sets.filter(id => !sSnap.some(([i, v]) => i === id && state.sets[id]?.updated_at === v))
    state.dirty.workouts = state.dirty.workouts.filter(id => state.workouts[id])
    state.dirty.sets = state.dirty.sets.filter(id => state.sets[id])
    state.dirty.deletedSets = state.dirty.deletedSets.filter(id => !dSnap.includes(id))
    state.lastSync = new Date().toISOString()
    status.error = ''
  } catch (e) {
    status.error = (e as { message?: string }).message ?? 'Sync failed.'
  } finally {
    status.syncing = false
    await persist()
  }
}

// Pull the server copy. Local unsynced edits always win over server rows.
async function refresh() {
  if (!navigator.onLine || !state.userId) return
  const sb = useSupabase()
  try {
    let { data: settings } = await sb.from('settings').select('proposals_enabled, unit').maybeSingle()
    if (!settings) settings = (await sb.from('settings').insert({}).select('proposals_enabled, unit').single()).data
    if (settings) state.settings = settings as Settings

    const { data: block, error } = await sb.from('blocks').select('*').eq('status', 'active').maybeSingle()
    if (error) throw error
    // Unsynced items of a week that was deleted elsewhere can never sync; drop them.
    if (state.block && state.block.id !== block?.id) {
      const exists = (await sb.from('blocks').select('id').eq('id', state.block.id).maybeSingle()).data
      if (!exists) forgetBlock(state.block.id)
    }
    state.block = block as Block | null
    state.programme = block ? ((await sb.from('programmes').select('*').eq('id', block.programme_id).single()).data as Programme) : null

    const workouts = block ? ((await sb.from('workouts').select('*').eq('block_id', block.id)).data ?? []) as Workout[] : []
    const sets = workouts.length ? ((await sb.from('sets').select('*').in('workout_id', workouts.map(w => w.id))).data ?? []) as SetRecord[] : []
    const nextW: Record<string, Workout> = {}
    const nextS: Record<string, SetRecord> = {}
    for (const w of workouts) nextW[w.id] = w
    for (const s of sets) nextS[s.id] = { ...s, weight: s.weight == null ? null : Number(s.weight), target_weight: s.target_weight == null ? null : Number(s.target_weight) }
    for (const id of state.dirty.workouts) if (state.workouts[id]) nextW[id] = state.workouts[id]!
    for (const id of state.dirty.sets) if (state.sets[id]) nextS[id] = state.sets[id]!
    for (const id of state.dirty.deletedSets) delete nextS[id]
    state.workouts = nextW
    state.sets = nextS

    const { data: hist } = await sb.from('sets').select('*, workouts!inner(started_at, session_name)').eq('status', 'done').order('performed_at', { ascending: false }).limit(600)
    state.history = (hist ?? []).map(({ workouts: w, ...s }) => ({ ...s, weight: s.weight == null ? null : Number(s.weight), date: w.started_at ?? s.performed_at, session_name: w.session_name })) as HistorySet[]
    state.lastSync = new Date().toISOString()
    await persist()
  } catch (e) {
    status.error = (e as { message?: string }).message ?? 'Could not refresh.'
  }
}

function forgetBlock(blockId: string) {
  const gone = new Set(Object.values(state.workouts).filter(w => w.block_id === blockId).map(w => w.id))
  for (const id of gone) delete state.workouts[id]
  for (const s of Object.values(state.sets)) if (gone.has(s.workout_id)) delete state.sets[s.id]
  state.dirty.workouts = state.dirty.workouts.filter(id => !gone.has(id))
  state.dirty.sets = state.dirty.sets.filter(id => state.sets[id])
}

function now() {
  return new Date().toISOString()
}

function workoutFor(sessionKey: string): Workout | undefined {
  if (!state.block) return
  return latestWorkoutBySession(Object.values(state.workouts).filter(w => w.block_id === state.block!.id)).get(sessionKey)
}

function startSession(sessionKey: string): Workout {
  const existing = workoutFor(sessionKey)
  if (existing && existing.status !== 'completed') {
    if (existing.status !== 'in_progress') updateWorkout(existing.id, { status: 'in_progress', started_at: existing.started_at ?? now() })
    return existing
  }
  const session = state.block!.plan.sessions.find(s => s.key === sessionKey)!
  const w: Workout = {
    id: crypto.randomUUID(), block_id: state.block!.id, session_key: sessionKey, session_name: session.name,
    status: 'in_progress', started_at: now(), finished_at: null, rescheduled_for: null, abs_included: false, notes: null, updated_at: now()
  }
  state.workouts[w.id] = w
  markDirty('workouts', w.id)
  return w
}

function updateWorkout(id: string, patch: Partial<Workout>) {
  Object.assign(state.workouts[id]!, patch, { updated_at: now() })
  markDirty('workouts', id)
}

function skipSession(sessionKey: string) {
  const existing = workoutFor(sessionKey)
  if (existing && existing.status !== 'completed') return updateWorkout(existing.id, { status: 'skipped', rescheduled_for: null })
  const session = state.block!.plan.sessions.find(s => s.key === sessionKey)!
  const w: Workout = {
    id: crypto.randomUUID(), block_id: state.block!.id, session_key: sessionKey, session_name: session.name,
    status: 'skipped', started_at: null, finished_at: null, rescheduled_for: null, abs_included: false, notes: null, updated_at: now()
  }
  state.workouts[w.id] = w
  markDirty('workouts', w.id)
}

function setsFor(workoutId: string, exerciseKey?: string): SetRecord[] {
  return Object.values(state.sets)
    .filter(s => s.workout_id === workoutId && (!exerciseKey || s.exercise_key === exerciseKey))
    .sort((a, b) => a.set_index - b.set_index)
}

function saveSet(workoutId: string, ex: PlanExercise, index: number, patch: Partial<SetRecord>): SetRecord {
  const found = setsFor(workoutId, ex.key).find(s => s.set_index === index)
  const rec: SetRecord = found
    ? { ...found, ...patch, updated_at: now() }
    : {
        id: crypto.randomUUID(), workout_id: workoutId, exercise_key: ex.key, exercise_name: ex.name, variant: ex.variant,
        equipment: ex.equipment, set_index: index, status: 'done', weight: null, unit: state.settings.unit, reps: null,
        target_weight: ex.target_weight, target_reps: ex.target_reps, note: null, performed_at: now(), updated_at: now(), ...patch
      }
  state.sets[rec.id] = rec
  markDirty('sets', rec.id)
  return rec
}

function removeSet(id: string) {
  delete state.sets[id]
  state.dirty.sets = state.dirty.sets.filter(x => x !== id)
  markDirty('deletedSets', id)
}

// Latest earlier result for the same exercise and variant.
function previousResult(name: string, variant: string | null, excludeWorkoutId?: string) {
  const id = exerciseIdentity({ exercise_name: name, variant })
  const local: HistorySet[] = Object.values(state.sets)
    .filter(s => s.status === 'done' && s.workout_id !== excludeWorkoutId)
    .map(s => ({ ...s, date: state.workouts[s.workout_id]?.started_at ?? s.performed_at, session_name: state.workouts[s.workout_id]?.session_name ?? '' }))
  const all = [...local, ...state.history.filter(h => !state.sets[h.id] && h.workout_id !== excludeWorkoutId)]
    .filter(s => exerciseIdentity(s) === id)
  if (!all.length) return null
  const latest = all.reduce((a, b) => (a.date > b.date ? a : b))
  return { date: latest.date, workout_id: latest.workout_id, sets: all.filter(s => s.workout_id === latest.workout_id).sort((a, b) => a.set_index - b.set_index) }
}

const pendingCount = computed(() => state.dirty.workouts.length + state.dirty.sets.length + state.dirty.deletedSets.length)

export function useTraining() {
  return {
    state, status, pendingCount,
    load, sync, refresh, persist,
    workoutFor, startSession, updateWorkout, skipSession,
    setsFor, saveSet, removeSet, previousResult,
    isDirtySet: (id: string) => state.dirty.sets.includes(id),
    reset: () => Object.assign(state, blank())
  }
}
