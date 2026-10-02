<script setup lang="ts">
import { whoopExport, type PlanExercise } from '#shared/training'

definePageMeta({ hideNav: true })

const route = useRoute()
const toast = useToast()
const { state, workoutFor, startSession, updateWorkout, setsFor, saveSet } = useTraining()

const key = computed(() => String(route.params.key))
const session = computed(() => state.block?.plan.sessions.find(s => s.key === key.value))
const workout = computed(() => workoutFor(key.value))
const live = computed(() => workout.value && workout.value.status !== 'skipped' ? workout.value : undefined)
const guides = computed(() => state.programme?.data.guides ?? [])
const warmup = computed(() => guides.value.find(g => g.kind === 'warmup'))
const finisher = computed(() => guides.value.find(g => g.kind === 'finisher'))
const absGuide = computed(() => guides.value.find(g => g.kind === 'abs'))
const abs = computed(() => state.block?.plan.abs ?? [])

const exercises = computed<{ ex: PlanExercise, optional: boolean }[]>(() => [
  ...(session.value?.exercises ?? []).map(ex => ({ ex, optional: false })),
  ...(live.value?.abs_included ? abs.value.map(ex => ({ ex, optional: true })) : [])
])

function remaining(ex: PlanExercise) {
  if (!live.value) return ex.sets
  const logged = setsFor(live.value.id, ex.key)
  return Math.max(0, ex.sets - logged.length)
}

const openKey = ref<string | null>(null)
watch([exercises, live], () => {
  if (openKey.value === null && live.value) openKey.value = exercises.value.find(e => remaining(e.ex) > 0)?.ex.key ?? null
}, { immediate: true })

// When an exercise is complete, move to the next one with work left.
function advance(from: string) {
  const i = exercises.value.findIndex(e => e.ex.key === from)
  const next = exercises.value.slice(i + 1).find(e => remaining(e.ex) > 0) ?? exercises.value.find(e => remaining(e.ex) > 0)
  openKey.value = next?.ex.key ?? null
  if (next) nextTick(() => document.getElementById(`ex-${next.ex.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function start() {
  const w = startSession(key.value)
  openKey.value = exercises.value.find(e => remaining(e.ex) > 0)?.ex.key ?? exercises.value[0]?.ex.key ?? null
  return w
}

const unlogged = computed(() => exercises.value.reduce((n, e) => n + remaining(e.ex), 0))
const finishing = ref(false)
const notes = ref('')
const copied = ref(false)

function openFinish() {
  notes.value = live.value?.notes ?? ''
  copied.value = false
  finishing.value = true
}

function finish() {
  const w = live.value!
  // Unlogged planned sets are recorded as skipped so the week summary is honest.
  for (const { ex } of exercises.value) {
    const logged = setsFor(w.id, ex.key)
    for (let i = 0; i < ex.sets; i++) {
      if (!logged.some(s => s.set_index === i)) saveSet(w.id, ex, i, { status: 'skipped', weight: null, reps: null })
    }
  }
  updateWorkout(w.id, { status: 'completed', finished_at: w.finished_at ?? new Date().toISOString(), notes: notes.value || null, rescheduled_for: null })
}

function stopForNow() {
  updateWorkout(live.value!.id, { status: 'interrupted' })
  toast.add({ title: 'Session paused', description: 'Your sets are saved. Resume it from Train.' })
  navigateTo('/')
}

const exportText = computed(() => live.value ? whoopExport(live.value, setsFor(live.value.id), exercises.value.map(e => e.ex.key)) : '')
async function copy() {
  copied.value = await copyText(exportText.value)
  toast.add(copied.value
    ? { title: 'Copied for WHOOP', icon: 'i-lucide-clipboard-check' }
    : { title: 'Copy was blocked', description: 'Select the text below and copy it.', color: 'error' })
}

let notesTimer: ReturnType<typeof setTimeout> | undefined
function saveNotes() {
  clearTimeout(notesTimer)
  notesTimer = setTimeout(() => {
    if (live.value?.status === 'completed') updateWorkout(live.value.id, { notes: notes.value || null })
  }, 600)
}
</script>

<template>
  <main class="px-4 pt-safe pb-40">
    <header class="sticky top-0 z-30 -mx-4 flex items-center gap-2 bg-default/95 px-2 pt-safe pb-2 backdrop-blur">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/" aria-label="Back to Train" />
      <h1 class="min-w-0 flex-1 truncate font-display text-3xl font-extrabold text-highlighted">
        {{ session?.name ?? 'Session' }}
      </h1>
      <SyncBadge />
    </header>

    <div v-if="!session" class="mt-10">
      <p class="text-muted">
        This session is not in the current week.
      </p>
      <UButton class="mt-4" to="/">
        Back to Train
      </UButton>
    </div>

    <template v-else>
      <UAlert
        v-if="live?.status === 'completed'"
        class="mt-2"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="`Completed ${fmtDate(live.finished_at)}`"
        description="You can still correct any set. Changes save at once."
      />
      <UAlert
        v-else-if="live?.status === 'interrupted'"
        class="mt-2"
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-pause"
        title="Session paused"
        description="Logged sets are kept. Carry on below."
      />
      <UAlert
        v-else-if="workout?.status === 'skipped'"
        class="mt-2"
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-slash"
        :title="workout.rescheduled_for ? `Moved to ${fmtDate(workout.rescheduled_for)}` : 'Skipped'"
        description="Start it to log sets."
      />

      <div class="mt-4 space-y-3">
        <GuideCard v-if="warmup" :guide="warmup" />

        <ol class="space-y-3" aria-label="Exercises">
          <ExerciseCard
            v-for="{ ex, optional } in exercises"
            :key="ex.key"
            :ex="ex"
            :optional="optional"
            :workout-id="live?.id ?? null"
            :open="openKey === ex.key"
            @toggle="openKey = openKey === ex.key ? null : ex.key"
            @logged="advance(ex.key)"
          />
        </ol>

        <section v-if="abs.length && live && !live.abs_included" class="rounded-xl border border-dashed border-default p-4">
          <p class="font-bold">
            {{ absGuide?.title ?? 'Optional abs block' }}
          </p>
          <p class="text-sm text-muted">
            {{ abs.length }} {{ abs.length === 1 ? 'exercise' : 'exercises' }}. Logged with this session when you add it.
          </p>
          <UButton class="mt-3" color="neutral" variant="outline" icon="i-lucide-plus" @click="updateWorkout(live.id, { abs_included: true })">
            Add abs block
          </UButton>
        </section>

        <GuideCard v-if="finisher" :guide="finisher" />
      </div>
    </template>

    <!-- Actions within thumb reach -->
    <div v-if="session" class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-elevated/95 backdrop-blur pb-safe">
      <div class="mx-auto flex max-w-xl gap-2 px-4 pt-3">
        <template v-if="!live">
          <UButton size="xl" block icon="i-lucide-play" @click="start">
            Start {{ session.name }}
          </UButton>
        </template>
        <template v-else-if="live.status === 'completed'">
          <UButton size="xl" block icon="i-lucide-clipboard-copy" @click="openFinish">
            Copy for WHOOP
          </UButton>
        </template>
        <template v-else>
          <UButton size="xl" color="neutral" variant="outline" @click="stopForNow">
            Stop for now
          </UButton>
          <UButton size="xl" class="flex-1 justify-center" icon="i-lucide-flag" @click="openFinish">
            Finish session
          </UButton>
        </template>
      </div>
    </div>

    <UDrawer v-model:open="finishing" :title="live?.status === 'completed' ? 'Session complete' : 'Finish session'">
      <template #body>
        <div v-if="live" class="space-y-4 pb-safe">
          <template v-if="live.status !== 'completed'">
            <p v-if="unlogged" class="text-sm">
              <UIcon name="i-lucide-triangle-alert" class="mr-1 size-4 align-text-bottom text-warning" />
              {{ unlogged }} planned {{ unlogged === 1 ? 'set is' : 'sets are' }} not logged. They will be recorded as skipped.
            </p>
            <UFormField label="Notes (optional)">
              <UTextarea v-model="notes" :rows="3" class="w-full" placeholder="How it went, pain, equipment…" />
            </UFormField>
            <UButton size="xl" block icon="i-lucide-check" @click="finish">
              Save and finish
            </UButton>
          </template>
          <template v-else>
            <UFormField label="Notes (optional)">
              <UTextarea v-model="notes" :rows="2" class="w-full" @update:model-value="saveNotes" />
            </UFormField>
            <UButton size="xl" block :icon="copied ? 'i-lucide-clipboard-check' : 'i-lucide-clipboard-copy'" @click="copy">
              {{ copied ? 'Copied' : 'Copy for WHOOP' }}
            </UButton>
            <label class="block">
              <span class="text-sm text-muted">Text that will be copied</span>
              <textarea readonly :value="exportText" rows="10" class="mt-1 w-full rounded-md border border-default bg-muted p-3 font-mono text-xs" />
            </label>
            <UButton block color="neutral" variant="ghost" to="/">
              Back to Train
            </UButton>
          </template>
        </div>
      </template>
    </UDrawer>
  </main>
</template>
