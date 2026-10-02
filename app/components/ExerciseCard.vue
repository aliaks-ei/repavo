<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { formatWeight, repsLabel, weightMeaning, type PlanExercise } from '#shared/training'

const props = defineProps<{ ex: PlanExercise, workoutId: string | null, open: boolean, optional?: boolean }>()
const emit = defineEmits<{ toggle: [], logged: [] }>()

const { setsFor, saveSet, removeSet, previousResult, isDirtySet, state } = useTraining()

const sets = computed(() => props.workoutId ? setsFor(props.workoutId, props.ex.key) : [])
const rows = computed(() => Math.max(props.ex.sets, ...sets.value.map(s => s.set_index + 1)))
const byIndex = (i: number) => sets.value.find(s => s.set_index === i)
const currentIndex = computed(() => {
  for (let i = 0; i < rows.value; i++) if (!byIndex(i)) return i
  return -1
})
const doneCount = computed(() => sets.value.filter(s => s.status === 'done').length)
const skippedCount = computed(() => sets.value.filter(s => s.status === 'skipped').length)
const finished = computed(() => currentIndex.value === -1)
const prev = computed(() => previousResult(props.ex.name, props.ex.variant, props.workoutId ?? undefined))
const unit = computed(() => sets.value[0]?.unit ?? state.settings.unit)
const showGuide = ref(false)

// Prefill: last logged set in this session, then the plan target, then the previous result.
function prefill(i: number) {
  const before = sets.value.filter(s => s.status === 'done' && s.set_index < i).at(-1)
  const prevSet = prev.value?.sets[i] ?? prev.value?.sets.at(-1)
  return {
    weight: before?.weight ?? props.ex.target_weight ?? prevSet?.weight ?? null,
    reps: before?.reps ?? props.ex.target_reps ?? props.ex.rep_max ?? prevSet?.reps ?? null
  }
}

function log(i: number, weight: number | null, reps: number | null) {
  if (!props.workoutId) return
  saveSet(props.workoutId, props.ex, i, { status: 'done', weight, reps, performed_at: new Date().toISOString() })
  if (currentIndex.value === -1) emit('logged')
}
function skip(i: number) {
  if (!props.workoutId) return
  saveSet(props.workoutId, props.ex, i, { status: 'skipped', weight: null, reps: null })
  if (currentIndex.value === -1) emit('logged')
}
function skipRest() {
  for (let i = 0; i < rows.value; i++) if (!byIndex(i)) skip(i)
}
function addSet() {
  if (!props.workoutId) return
  const p = prefill(rows.value)
  saveSet(props.workoutId, props.ex, rows.value, { status: 'done', weight: p.weight, reps: p.reps })
}

const meaning = computed(() => weightMeaning(props.ex.equipment))
const headingId = computed(() => `ex-${props.ex.key}`)
</script>

<template>
  <li class="rounded-xl border bg-elevated" :class="open ? 'border-plate-500 shadow-md' : 'border-default'">
    <h3 :id="headingId">
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :aria-expanded="open"
        @click="emit('toggle')"
      >
        <span class="min-w-0 flex-1">
          <span class="block font-display leading-tight font-bold text-highlighted" :class="open ? 'text-3xl' : 'text-xl'">{{ ex.name }}</span>
          <span v-if="ex.variant || optional" class="block text-sm text-muted">{{ [ex.variant, optional ? 'Optional' : null].filter(Boolean).join(', ') }}</span>
        </span>
        <!-- Set pips: filled when logged, crossed when skipped; text alternative for screen readers -->
        <span class="flex items-center gap-1" aria-hidden="true">
          <span
            v-for="i in rows"
            :key="i"
            class="flex size-3 items-center justify-center rounded-full border-2"
            :class="byIndex(i - 1)?.status === 'done' ? 'border-success bg-success' : byIndex(i - 1)?.status === 'skipped' ? 'border-dimmed' : i - 1 === currentIndex && open ? 'border-marker bg-marker' : 'border-accented'"
          >
            <span v-if="byIndex(i - 1)?.status === 'skipped'" class="h-0.5 w-2 rotate-45 bg-dimmed" />
          </span>
        </span>
        <span class="sr-only">{{ doneCount }} of {{ ex.sets }} sets logged<template v-if="skippedCount">, {{ skippedCount }} skipped</template></span>
        <UIcon v-if="finished" :name="doneCount ? 'i-lucide-circle-check' : 'i-lucide-circle-slash'" class="size-5" :class="doneCount ? 'text-success' : 'text-muted'" />
        <UIcon v-else name="i-lucide-chevron-down" class="size-5 text-muted transition-transform motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" />
      </button>
    </h3>

    <AnimatePresence :initial="false">
      <motion.div
        v-if="open"
        key="body"
        :initial="{ height: 0, opacity: 0 }"
        :animate="{ height: 'auto', opacity: 1 }"
        :exit="{ height: 0, opacity: 0 }"
        :transition="{ duration: 0.22, ease: 'easeOut' }"
        class="overflow-hidden"
        role="region"
        :aria-labelledby="headingId"
      >
        <div class="px-4 pb-4">
          <!-- Prescription and target -->
          <dl class="grid grid-cols-3 gap-2 rounded-lg bg-muted p-3 text-sm">
            <div>
              <dt class="text-muted">
                Sets × reps
              </dt>
              <dd class="num text-xl font-bold text-highlighted">
                {{ ex.sets }} × {{ repsLabel(ex) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Target
              </dt>
              <dd class="num text-xl font-bold text-highlighted">
                {{ ex.target_weight != null ? `${formatWeight(ex.target_weight)} ${unit}` : 'Not set' }}
              </dd>
              <dd v-if="ex.target_weight != null && meaning" class="text-xs text-muted">
                {{ meaning }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Rest
              </dt>
              <dd class="num text-xl font-bold text-highlighted">
                {{ ex.rest_seconds ? `${ex.rest_seconds} s` : '–' }}
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-sm text-muted">
            <template v-if="prev">
              Last time, {{ fmtDate(prev.date) }}:
              <span class="num text-base text-default">{{ prev.sets.map(s => `${formatWeight(s.weight)}×${s.reps}`).join(', ') }}</span>
            </template>
            <template v-else>
              No earlier result for this exercise.
            </template>
          </p>
          <p v-if="ex.notes" class="mt-1 text-sm text-muted">
            {{ ex.notes }}
          </p>

          <p v-if="!workoutId" class="mt-3 text-sm text-muted">
            Start the session to log sets.
          </p>
          <ol v-else class="mt-3 space-y-1" :aria-label="`${ex.name} sets`">
            <SetRow
              v-for="i in rows"
              :key="i"
              :index="i - 1"
              :ex="ex"
              :record="byIndex(i - 1)"
              :current="i - 1 === currentIndex"
              :prefill="prefill(i - 1)"
              :unit="unit"
              :unsynced="!!byIndex(i - 1) && isDirtySet(byIndex(i - 1)!.id)"
              @log="(w, r) => log(i - 1, w, r)"
              @skip="skip(i - 1)"
              @undo="removeSet(byIndex(i - 1)!.id)"
              @update="p => saveSet(workoutId!, ex, i - 1, p)"
            />
          </ol>

          <div class="mt-3 flex flex-wrap gap-2">
            <UButton v-if="workoutId" size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addSet">
              Add set
            </UButton>
            <UButton v-if="workoutId && !finished" size="sm" color="neutral" variant="soft" icon="i-lucide-skip-forward" @click="skipRest">
              Skip remaining
            </UButton>
            <UButton v-if="ex.technique" size="sm" color="neutral" variant="soft" icon="i-lucide-info" :aria-expanded="showGuide" @click="showGuide = !showGuide">
              Technique
            </UButton>
            <UButton v-if="ex.video_url" size="sm" color="neutral" variant="soft" icon="i-lucide-video" :to="ex.video_url" target="_blank">
              Video
            </UButton>
          </div>
          <p v-if="showGuide && ex.technique" class="mt-3 rounded-lg bg-muted p-3 text-sm whitespace-pre-line">
            {{ ex.technique }}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  </li>
</template>
