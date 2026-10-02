<script setup lang="ts">
import { exerciseIdentity, formatWeight } from '#shared/training'
import type { HistorySet } from '~/composables/useTraining'

const sb = useSupabase()
const { state, status } = useTraining()
const rows = ref<HistorySet[] | null>(null)
const query = ref('')

onMounted(async () => {
  const { data, error } = await sb.from('sets').select('*, workouts!inner(started_at, session_name)').eq('status', 'done').order('performed_at', { ascending: false }).limit(5000)
  // Offline: fall back to the history cached on this device.
  rows.value = error
    ? state.history
    : (data ?? []).map(({ workouts: w, ...s }) => ({ ...s, weight: s.weight == null ? null : Number(s.weight), date: w.started_at ?? s.performed_at, session_name: w.session_name }))
})

const exercises = computed(() => {
  const m = new Map<string, { name: string, variant: string | null, latest: HistorySet, sessions: Set<string> }>()
  for (const s of rows.value ?? []) {
    const id = exerciseIdentity(s)
    const cur = m.get(id)
    if (!cur) m.set(id, { name: s.exercise_name, variant: s.variant, latest: s, sessions: new Set([s.workout_id]) })
    else {
      cur.sessions.add(s.workout_id)
      if (s.date > cur.latest.date || (s.workout_id === cur.latest.workout_id && (s.weight ?? 0) > (cur.latest.weight ?? 0))) cur.latest = s
    }
  }
  const q = query.value.trim().toLowerCase()
  return [...m.values()]
    .filter(e => !q || `${e.name} ${e.variant ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date))
})
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center justify-between pt-2">
      <h1 class="font-display text-5xl leading-none font-extrabold text-highlighted">
        Progress
      </h1>
      <SyncBadge />
    </header>
    <p v-if="!status.online" class="mt-2 text-sm text-warning">
      Offline: showing recent history saved on this device.
    </p>

    <USkeleton v-if="!rows" class="mt-6 h-48 w-full" />
    <section v-else-if="!rows.length" class="mt-10">
      <h2 class="font-display text-3xl font-bold">
        No results yet
      </h2>
      <p class="mt-2 text-muted">
        Log your first session and each exercise appears here with its history and trend.
      </p>
      <UButton class="mt-6" size="xl" block to="/" icon="i-lucide-dumbbell">
        Go to Train
      </UButton>
    </section>
    <template v-else>
      <UInput v-model="query" class="mt-4 w-full" size="lg" icon="i-lucide-search" placeholder="Find an exercise" aria-label="Find an exercise" />
      <ul class="mt-4 divide-y divide-default rounded-xl border border-default bg-elevated">
        <li v-for="e in exercises" :key="e.name + e.variant">
          <NuxtLink
            :to="{ path: '/progress/exercise', query: { name: e.name, variant: e.variant ?? undefined } }"
            class="flex items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate font-bold text-highlighted">{{ e.name }}</span>
              <span v-if="e.variant" class="block truncate text-sm text-muted">{{ e.variant }}</span>
            </span>
            <span class="text-right">
              <span class="num block text-xl font-bold">{{ formatWeight(e.latest.weight) }}×{{ e.latest.reps }}</span>
              <span class="block text-xs text-muted">{{ fmtDate(e.latest.date) }}, {{ e.sessions.size }} {{ e.sessions.size === 1 ? 'session' : 'sessions' }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </main>
</template>
