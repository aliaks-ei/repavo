<script setup lang="ts">
import { exerciseIdentity, exerciseStats, formatWeight, REP_BUCKETS, repBucket, weightMeaning } from '#shared/training'
import type { HistorySet } from '~/composables/useTraining'

const route = useRoute()
const sb = useSupabase()
const toast = useToast()
const { state, status } = useTraining()

const name = computed(() => String(route.query.name ?? ''))
const variant = computed(() => (route.query.variant ? String(route.query.variant) : null))
const rows = ref<HistorySet[] | null>(null)

onMounted(async () => {
  let q = sb.from('sets').select('*, workouts!inner(started_at, session_name)').eq('exercise_name', name.value).order('performed_at', { ascending: false }).limit(2000)
  q = variant.value ? q.eq('variant', variant.value) : q.is('variant', null)
  const { data, error } = await q
  const id = exerciseIdentity({ exercise_name: name.value, variant: variant.value })
  rows.value = error
    ? state.history.filter(h => exerciseIdentity(h) === id)
    : (data ?? []).map(({ workouts: w, ...s }) => ({ ...s, weight: s.weight == null ? null : Number(s.weight), date: w.started_at ?? s.performed_at, session_name: w.session_name }))
})

// All numbers here are calculated from the records, never by the assistant.
const stats = computed(() => exerciseStats(rows.value ?? []))
const latest = computed(() => stats.value.sessions.at(-1))
const unit = computed(() => rows.value?.[0]?.unit ?? 'kg')
const meaning = computed(() => (rows.value?.[0] ? weightMeaning(rows.value[0].equipment) : ''))

// Compare like with like: one rep range at a time.
const buckets = computed(() => REP_BUCKETS.filter(b => stats.value.sessions.some(s => s.bucket === b.key)))
const bucket = ref<string | null>(null)
watch(latest, (l) => { if (l && !bucket.value) bucket.value = repBucket(l.top_reps ?? 0) }, { immediate: true })
const points = computed(() => stats.value.sessions.filter(s => s.bucket === bucket.value).map((s, i) => ({ i, weight: s.top_weight ?? 0, date: s.date })))
const change = computed(() => {
  const p = points.value
  if (p.length < 2) return null
  return Math.round((p.at(-1)!.weight - p[0]!.weight) * 100) / 100
})

const history = computed(() => [...stats.value.sessions].reverse())
const setsOf = (workoutId: string) => (rows.value ?? []).filter(r => r.workout_id === workoutId).sort((a, b) => a.set_index - b.set_index)

const asking = ref(false)
async function ask() {
  asking.value = true
  const title = variant.value ? `${name.value} (${variant.value})` : name.value
  const { data, error } = await sb.from('conversations').insert({ title, context: { exercise: { name: name.value, variant: variant.value } } }).select('id').single()
  asking.value = false
  if (error) return toast.add({ title: 'Could not start a conversation', description: apiError(error), color: 'error' })
  await navigateTo(`/assistant/${data.id}`)
}
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-start gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/progress" aria-label="Back to Progress" />
      <div class="min-w-0 flex-1">
        <h1 class="font-display text-4xl leading-none font-extrabold text-highlighted">
          {{ name }}
        </h1>
        <p v-if="variant" class="mt-1 text-muted">
          {{ variant }}
        </p>
      </div>
    </header>

    <USkeleton v-if="!rows" class="mt-6 h-48 w-full" />
    <p v-else-if="!stats.sessions.length" class="mt-8 text-muted">
      No logged sets for this exercise yet.
    </p>

    <template v-else>
      <section v-if="latest" class="mt-5 rounded-xl bg-elevated p-4" aria-labelledby="latest-title">
        <h2 id="latest-title" class="text-sm text-muted">
          Latest, {{ fmtDate(latest.date, true) }}
        </h2>
        <p class="num mt-1 text-5xl font-extrabold text-highlighted">
          {{ formatWeight(latest.top_weight) }}<span class="text-2xl text-muted"> {{ unit }}</span> × {{ latest.top_reps }}
        </p>
        <p class="text-sm text-muted">
          {{ meaning ? `Top set, ${meaning}.` : 'Top set.' }} All sets: <span class="num text-base text-default">{{ latest.sets }}</span>
        </p>
      </section>

      <section class="mt-6" aria-labelledby="trend-title">
        <h2 id="trend-title" class="font-display text-2xl font-bold">
          Top set trend
        </h2>
        <div role="radiogroup" aria-label="Rep range" class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="b in buckets"
            :key="b.key"
            type="button"
            role="radio"
            :aria-checked="bucket === b.key"
            class="rounded-full border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="bucket === b.key ? 'border-primary bg-primary font-bold text-inverted' : 'border-default'"
            @click="bucket = b.key"
          >
            {{ b.label }}
          </button>
        </div>
        <p class="mt-2 text-sm text-muted">
          <template v-if="points.length >= 2">
            {{ points.length }} sessions in this rep range.
            {{ change === 0 ? 'Top weight unchanged.' : `Top weight ${change! > 0 ? 'up' : 'down'} ${formatWeight(Math.abs(change!))} ${unit} since ${fmtDate(points[0]!.date)}.` }}
          </template>
          <template v-else>
            One session in this rep range so far. The trend appears after the next one.
          </template>
        </p>
        <TrendChart v-if="points.length >= 2" class="mt-2" :points="points" :unit="unit" />
      </section>

      <UButton class="mt-6" size="lg" block color="neutral" variant="outline" icon="i-lucide-message-circle" :loading="asking" :disabled="!status.online" @click="ask">
        Ask about this exercise
      </UButton>

      <section class="mt-8 pb-6" aria-labelledby="history-title">
        <h2 id="history-title" class="font-display text-2xl font-bold">
          Set history
        </h2>
        <ul class="mt-2 divide-y divide-default rounded-xl border border-default bg-elevated">
          <li v-for="s in history" :key="s.workout_id" class="px-4 py-3">
            <NuxtLink :to="`/workout/${s.workout_id}`" class="flex items-baseline justify-between gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span class="font-bold">{{ fmtDate(s.date, true) }}</span>
              <span class="truncate text-sm text-muted">{{ s.session_name }}</span>
            </NuxtLink>
            <p class="num mt-1 text-lg">
              {{ setsOf(s.workout_id).map(x => `${formatWeight(x.weight)}×${x.reps}`).join(', ') }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>
