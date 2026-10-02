<script setup lang="ts">
import { formatWeight, weightMeaning, whoopExport, type SetRecord, type Workout } from '#shared/training'

const route = useRoute()
const sb = useSupabase()
const toast = useToast()
const { state } = useTraining()

const workout = ref<Workout | null>(null)
const sets = ref<SetRecord[]>([])
const loadError = ref('')

onMounted(async () => {
  const id = String(route.params.id)
  // Prefer the device copy, which may hold unsynced corrections.
  if (state.workouts[id]) {
    workout.value = state.workouts[id]!
    sets.value = Object.values(state.sets).filter(s => s.workout_id === id)
    return
  }
  const [w, s] = await Promise.all([
    sb.from('workouts').select('*').eq('id', id).single(),
    sb.from('sets').select('*').eq('workout_id', id)
  ])
  if (w.error) {
    loadError.value = 'This session could not be loaded. It needs a connection.'
    return
  }
  workout.value = w.data as Workout
  sets.value = ((s.data ?? []) as SetRecord[]).map(x => ({ ...x, weight: x.weight == null ? null : Number(x.weight) }))
})

const groups = computed(() => {
  const m = new Map<string, SetRecord[]>()
  for (const s of [...sets.value].sort((a, b) => a.set_index - b.set_index)) m.set(s.exercise_key, [...(m.get(s.exercise_key) ?? []), s])
  return [...m.values()]
})

async function copy() {
  const ok = await copyText(whoopExport(workout.value!, sets.value, groups.value.map(g => g[0]!.exercise_key)))
  toast.add(ok ? { title: 'Copied for WHOOP', icon: 'i-lucide-clipboard-check' } : { title: 'Copy was blocked', color: 'error' })
}
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" aria-label="Back" @click="$router.back()" />
      <h1 class="flex-1 truncate font-display text-3xl font-extrabold text-highlighted">
        {{ workout?.session_name ?? 'Session' }}
      </h1>
    </header>
    <UAlert v-if="loadError" class="mt-4" color="error" variant="subtle" :description="loadError" />
    <template v-else-if="workout">
      <p class="mt-1 text-muted">
        {{ fmtDate(workout.started_at, true) }}{{ workout.status !== 'completed' ? `, ${workout.status.replace('_', ' ')}` : '' }}
      </p>
      <p v-if="workout.notes" class="mt-3 rounded-lg bg-elevated p-3 text-sm">
        {{ workout.notes }}
      </p>
      <ul class="mt-4 space-y-3">
        <li v-for="g in groups" :key="g[0]!.exercise_key" class="rounded-xl border border-default bg-elevated p-3">
          <p class="font-bold">
            {{ g[0]!.exercise_name }}<span v-if="g[0]!.variant" class="font-normal text-muted"> ({{ g[0]!.variant }})</span>
          </p>
          <p class="text-xs text-muted">
            {{ g[0]!.unit }} {{ weightMeaning(g[0]!.equipment) }}
          </p>
          <ol class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <li v-for="s in g" :key="s.id" class="num text-lg" :class="s.status === 'skipped' ? 'text-muted line-through' : ''">
              <span class="sr-only">Set {{ s.set_index + 1 }}: </span>
              <template v-if="s.status === 'done'">
                {{ formatWeight(s.weight) }}×{{ s.reps }}
              </template>
              <template v-else>
                skipped
              </template>
            </li>
          </ol>
        </li>
      </ul>
      <UButton v-if="workout.status === 'completed'" class="mt-6" size="xl" block icon="i-lucide-clipboard-copy" @click="copy">
        Copy for WHOOP
      </UButton>
    </template>
    <USkeleton v-else class="mt-6 h-40 w-full" />
  </main>
</template>
