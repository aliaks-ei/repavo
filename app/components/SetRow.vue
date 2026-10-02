<script setup lang="ts">
import { motion } from 'motion-v'
import { weightMeaning, type PlanExercise, type SetRecord } from '#shared/training'

const props = defineProps<{
  index: number
  ex: PlanExercise
  record?: SetRecord
  current: boolean
  prefill: { weight: number | null, reps: number | null }
  unit: string
  unsynced: boolean
}>()
const emit = defineEmits<{
  log: [weight: number | null, reps: number | null]
  update: [patch: Partial<SetRecord>]
  undo: []
  skip: []
}>()

const weight = ref('')
const reps = ref('')
watch(() => [props.record?.weight, props.record?.reps, props.prefill.weight, props.prefill.reps], () => {
  weight.value = String(props.record?.status === 'done' ? props.record.weight ?? '' : props.prefill.weight ?? '')
  reps.value = String(props.record?.status === 'done' ? props.record.reps ?? '' : props.prefill.reps ?? '')
}, { immediate: true })

const done = computed(() => props.record?.status === 'done')
const skipped = computed(() => props.record?.status === 'skipped')
const meaning = computed(() => weightMeaning(props.ex.equipment))
const n = computed(() => props.index + 1)
const noLoad = computed(() => props.ex.equipment === 'bodyweight')

// Corrections to a logged set save as soon as the field is left.
function commit() {
  if (!done.value) return
  const w = parseNum(weight.value)
  const r = parseNum(reps.value)
  if (w !== props.record!.weight || r !== props.record!.reps) emit('update', { weight: w, reps: r == null ? null : Math.round(r) })
}

function log() {
  const r = parseNum(reps.value)
  emit('log', parseNum(weight.value), r == null ? null : Math.round(r))
}

const inputBase = 'num w-full rounded-md border bg-default text-center text-highlighted outline-none focus-visible:ring-2 focus-visible:ring-primary'
</script>

<template>
  <!-- Current set: largest controls on screen -->
  <li v-if="current && !record" class="rounded-lg border-l-4 border-marker bg-default p-3">
    <p class="text-sm font-bold text-highlighted">
      Set {{ n }} <span class="font-normal text-muted">of {{ ex.sets }}</span>
    </p>
    <div class="mt-2 flex items-end gap-2">
      <label class="flex-1">
        <span class="sr-only">Set {{ n }} weight, {{ unit }} {{ meaning }}</span>
        <input
          v-model="weight"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :placeholder="noLoad ? '0' : '–'"
          :class="[inputBase, 'h-16 border-default text-5xl font-extrabold']"
        >
        <span class="mt-1 block text-center text-xs text-muted" aria-hidden="true">{{ unit }} {{ meaning }}</span>
      </label>
      <span class="num pb-7 text-3xl text-muted" aria-hidden="true">×</span>
      <label class="w-28">
        <span class="sr-only">Set {{ n }} reps</span>
        <input
          v-model="reps"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="–"
          :class="[inputBase, 'h-16 border-default text-5xl font-extrabold']"
        >
        <span class="mt-1 block text-center text-xs text-muted" aria-hidden="true">reps</span>
      </label>
    </div>
    <div class="mt-3 flex gap-2">
      <UButton size="xl" class="flex-1 justify-center" icon="i-lucide-check" @click="log">
        Log set {{ n }}
      </UButton>
      <UButton size="xl" color="neutral" variant="outline" @click="emit('skip')">
        Skip
      </UButton>
    </div>
  </li>

  <!-- Logged, skipped or upcoming set -->
  <li v-else class="flex items-center gap-2 py-1.5" :class="skipped ? 'text-muted' : ''">
    <span class="w-12 shrink-0 text-sm" :class="done ? 'font-bold text-highlighted' : 'text-muted'">Set {{ n }}</span>
    <template v-if="skipped">
      <span class="flex-1 text-sm line-through decoration-1">Skipped</span>
    </template>
    <template v-else>
      <label class="w-20">
        <span class="sr-only">Set {{ n }} weight, {{ unit }} {{ meaning }}</span>
        <input
          v-model="weight"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :disabled="!done"
          :class="[inputBase, 'h-11 border-transparent text-2xl font-bold disabled:text-dimmed', done ? 'border-default' : '']"
          @change="commit"
        >
      </label>
      <span class="num text-lg text-muted" aria-hidden="true">×</span>
      <label class="w-14">
        <span class="sr-only">Set {{ n }} reps</span>
        <input
          v-model="reps"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :disabled="!done"
          :class="[inputBase, 'h-11 border-transparent text-2xl font-bold disabled:text-dimmed', done ? 'border-default' : '']"
          @change="commit"
        >
      </label>
      <span class="flex-1" />
    </template>

    <span v-if="record && unsynced" class="text-warning" title="Saved on this device, not synced yet">
      <UIcon name="i-lucide-cloud-upload" class="size-4" />
      <span class="sr-only">Saved on this device, not synced yet</span>
    </span>
    <motion.span
      v-if="done"
      :initial="{ scale: 0.4, opacity: 0 }"
      :animate="{ scale: 1, opacity: 1 }"
      :transition="{ type: 'spring', stiffness: 500, damping: 22 }"
      class="flex items-center gap-1 text-sm font-bold text-success"
    >
      <UIcon name="i-lucide-circle-check" class="size-5" />Done
    </motion.span>
    <UButton
      v-if="record"
      icon="i-lucide-undo-2"
      color="neutral"
      variant="ghost"
      size="sm"
      :aria-label="`Undo set ${n}`"
      @click="emit('undo')"
    />
  </li>
</template>
