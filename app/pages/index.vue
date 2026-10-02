<script setup lang="ts">
import type { Workout } from '#shared/training'
import type { Block, Programme } from '~/composables/useTraining'

const { state, status, workoutFor, startSession, skipSession, updateWorkout, setsFor } = useTraining()
const toast = useToast()
const sb = useSupabase()

const sessions = computed(() => (state.block?.plan.sessions ?? []).map((s) => {
  const w = workoutFor(s.key)
  const planned = s.exercises.reduce((n, e) => n + e.sets, 0)
  const done = w ? setsFor(w.id).filter(x => x.status === 'done').length : 0
  return { ...s, workout: w, planned, done }
}))

const next = computed(() =>
  sessions.value.find(s => s.workout?.status === 'in_progress')
  ?? sessions.value.find(s => s.workout?.status === 'interrupted')
  ?? sessions.value.find(s => !s.workout || (s.workout.status === 'skipped' && s.workout.rescheduled_for))
)
const completed = computed(() => sessions.value.filter(s => s.workout?.status === 'completed').length)

function statusOf(w?: Workout) {
  if (!w) return { label: 'Not started', icon: 'i-lucide-circle', tone: 'text-muted' }
  switch (w.status) {
    case 'completed': return { label: `Done ${fmtDate(w.finished_at)}`, icon: 'i-lucide-circle-check', tone: 'text-success' }
    case 'in_progress': return { label: 'In progress', icon: 'i-lucide-circle-play', tone: 'text-primary' }
    case 'interrupted': return { label: w.rescheduled_for ? `Interrupted, continue ${fmtDate(w.rescheduled_for)}` : 'Interrupted', icon: 'i-lucide-circle-pause', tone: 'text-warning' }
    case 'skipped': return { label: w.rescheduled_for ? `Moved to ${fmtDate(w.rescheduled_for)}` : 'Skipped', icon: w.rescheduled_for ? 'i-lucide-calendar-clock' : 'i-lucide-circle-slash', tone: 'text-muted' }
  }
}

function open(key: string, start = false) {
  if (start) startSession(key)
  navigateTo(`/session/${key}`)
}

// Reschedule keeps any logged sets; it only records when the session will be done.
const rescheduling = ref<{ key: string, date: string } | null>(null)
function saveReschedule() {
  const r = rescheduling.value!
  let w = workoutFor(r.key)
  if (!w) {
    skipSession(r.key)
    w = workoutFor(r.key)!
  }
  updateWorkout(w.id, { rescheduled_for: r.date || null, status: w.status === 'in_progress' ? 'interrupted' : w.status })
  rescheduling.value = null
  toast.add({ title: r.date ? `Moved to ${fmtDate(r.date)}` : 'Date cleared' })
}

function menu(s: (typeof sessions.value)[number]) {
  const w = s.workout
  const items = [
    [{ label: w && w.status !== 'completed' && w.status !== 'skipped' ? 'Resume' : w?.status === 'completed' ? 'View and edit' : 'Start', icon: 'i-lucide-play', onSelect: () => open(s.key, w?.status !== 'completed') }],
    [
      { label: 'Reschedule', icon: 'i-lucide-calendar-clock', disabled: w?.status === 'completed', onSelect: () => { rescheduling.value = { key: s.key, date: w?.rescheduled_for ?? '' } } },
      { label: 'Skip this session', icon: 'i-lucide-circle-slash', disabled: w?.status === 'completed' || (w?.status === 'skipped' && !w.rescheduled_for), onSelect: () => skipSession(s.key) }
    ]
  ]
  return items
}

// Empty state: find approved programmes and pending week drafts.
const empty = ref<{ programmes: Programme[], toReview: Programme[], drafts: Block[] } | null>(null)
watchEffect(async () => {
  if (!state.loaded || state.block || !status.online) return
  const [p, d] = await Promise.all([
    sb.from('programmes').select('*').in('status', ['approved', 'draft']).order('created_at', { ascending: false }),
    sb.from('blocks').select('*').eq('status', 'draft').order('created_at', { ascending: false })
  ])
  const all = (p.data ?? []) as Programme[]
  empty.value = { programmes: all.filter(x => x.status === 'approved'), toReview: all.filter(x => x.status === 'draft'), drafts: (d.data ?? []) as Block[] }
})

const menuItems = [[
  { label: 'Programmes', icon: 'i-lucide-file-text', to: '/programmes' },
  { label: 'All weeks', icon: 'i-lucide-calendar-range', to: '/week' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
]]
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-start justify-between gap-2 pt-2">
      <div>
        <h1 class="font-display text-5xl leading-none font-extrabold text-highlighted">
          {{ state.block ? `Week ${state.block.week_number}` : 'Train' }}
        </h1>
        <p v-if="state.programme" class="mt-1 text-sm text-muted">
          {{ state.programme.name }}
        </p>
      </div>
      <div class="flex items-center gap-1">
        <SyncBadge />
        <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
          <UButton icon="i-lucide-menu" color="neutral" variant="ghost" size="lg" aria-label="More" />
        </UDropdownMenu>
      </div>
    </header>

    <UAlert v-if="status.storageError" class="mt-4" color="error" variant="subtle" icon="i-lucide-hard-drive" :description="status.storageError" />

    <div v-if="!state.loaded" class="mt-6 space-y-3">
      <USkeleton class="h-40 w-full" />
      <USkeleton class="h-16 w-full" />
    </div>

    <!-- No active week -->
    <section v-else-if="!state.block" class="mt-10">
      <template v-if="!status.online">
        <h2 class="font-display text-3xl font-bold">
          Connect to load your week
        </h2>
        <p class="mt-2 text-muted">
          This device has no saved training week yet. Open the app once with a connection and it will keep working offline.
        </p>
      </template>
      <template v-else-if="empty?.drafts.length">
        <h2 class="font-display text-3xl font-bold">
          Week {{ empty.drafts[0]!.week_number }} is ready to review
        </h2>
        <p class="mt-2 text-muted">
          Check the targets, then activate it to start training.
        </p>
        <UButton class="mt-6" size="xl" block :to="`/week/${empty.drafts[0]!.id}`">
          Review week {{ empty.drafts[0]!.week_number }}
        </UButton>
      </template>
      <template v-else-if="empty?.programmes.length">
        <h2 class="font-display text-3xl font-bold">
          Plan your first week
        </h2>
        <p class="mt-2 text-muted">
          {{ empty.programmes[0]!.name }} is approved. Create week 1 from it and set your starting weights.
        </p>
        <UButton class="mt-6" size="xl" block :to="`/programmes/${empty.programmes[0]!.id}`">
          Plan week 1
        </UButton>
      </template>
      <template v-else-if="empty?.toReview.length">
        <h2 class="font-display text-3xl font-bold">
          Review your programme
        </h2>
        <p class="mt-2 text-muted">
          {{ empty.toReview[0]!.name }} has been read. Check it and approve it before planning week 1.
        </p>
        <UButton class="mt-6" size="xl" block :to="`/programmes/${empty.toReview[0]!.id}`">
          Review programme
        </UButton>
      </template>
      <template v-else-if="empty">
        <h2 class="font-display text-3xl font-bold">
          Add your programme
        </h2>
        <p class="mt-2 text-muted">
          Upload the programme you bought, or paste its text. You review what was read before anything is used.
        </p>
        <UButton class="mt-6" size="xl" block to="/programmes" icon="i-lucide-file-plus">
          Add programme
        </UButton>
      </template>
    </section>

    <template v-else>
      <!-- Next session -->
      <section v-if="next" class="mt-6 rounded-xl bg-plate-600 p-5 text-white shadow-lg dark:bg-plate-700" aria-labelledby="next-title">
        <p class="text-sm text-plate-100">
          {{ next.workout?.status === 'in_progress' ? 'In progress' : next.workout?.status === 'interrupted' ? 'Pick up where you stopped' : 'Next session' }}
        </p>
        <h2 id="next-title" class="mt-1 font-display text-4xl leading-tight font-extrabold">
          {{ next.name }}
        </h2>
        <p class="mt-1 text-plate-100">
          {{ next.exercises.length }} {{ next.exercises.length === 1 ? 'exercise' : 'exercises' }}, {{ next.planned }} sets{{ next.done ? `, ${next.done} logged` : '' }}
        </p>
        <UButton
          class="mt-5 bg-white text-plate-800 hover:bg-plate-50 focus-visible:outline-white"
          size="xl"
          block
          :icon="next.workout && next.workout.status !== 'skipped' ? 'i-lucide-play' : 'i-lucide-arrow-right'"
          @click="open(next.key, true)"
        >
          {{ next.workout && next.workout.status !== 'skipped' ? `Resume ${next.name}` : `Start ${next.name}` }}
        </UButton>
      </section>
      <section v-else class="mt-6 rounded-xl border border-default bg-elevated p-5">
        <h2 class="font-display text-3xl font-bold">
          Week {{ state.block.week_number }} is logged
        </h2>
        <p class="mt-1 text-muted">
          {{ completed }} of {{ sessions.length }} sessions completed. Prepare next week when you are ready.
        </p>
      </section>

      <!-- Whole week -->
      <section class="mt-8" aria-labelledby="week-title">
        <h2 id="week-title" class="font-display text-2xl font-bold">
          This week
        </h2>
        <ul class="mt-2 divide-y divide-default rounded-xl border border-default bg-elevated">
          <li v-for="s in sessions" :key="s.key" class="flex items-center gap-2 pr-2">
            <NuxtLink :to="`/session/${s.key}`" class="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <UIcon :name="statusOf(s.workout).icon" class="size-5 shrink-0" :class="statusOf(s.workout).tone" />
              <span class="min-w-0">
                <span class="block truncate font-bold text-highlighted">{{ s.name }}</span>
                <span class="block text-sm text-muted">{{ statusOf(s.workout).label }}<template v-if="s.done && s.workout?.status !== 'completed'">, {{ s.done }} of {{ s.planned }} sets</template></span>
              </span>
            </NuxtLink>
            <UDropdownMenu :items="menu(s)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" :aria-label="`Options for ${s.name}`" />
            </UDropdownMenu>
          </li>
        </ul>
      </section>

      <section class="mt-8">
        <UButton to="/week/prepare" size="xl" block color="neutral" variant="outline" icon="i-lucide-calendar-plus">
          Prepare next week
        </UButton>
        <p class="mt-2 text-center text-sm text-muted">
          The week moves on only when you prepare the next one.
        </p>
      </section>
    </template>

    <UModal :open="!!rescheduling" title="Reschedule session" description="Logged sets stay as they are." @update:open="v => { if (!v) rescheduling = null }">
      <template #body>
        <form v-if="rescheduling" class="space-y-4" @submit.prevent="saveReschedule">
          <UFormField label="Do it on">
            <input v-model="rescheduling.date" type="date" class="w-full rounded-md border border-default bg-default px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary">
          </UFormField>
          <UButton type="submit" block size="xl">
            Save date
          </UButton>
        </form>
      </template>
    </UModal>
  </main>
</template>
