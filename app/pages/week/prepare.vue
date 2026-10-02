<script setup lang="ts">
import { blockFromProgramme, formatWeight, summariseBlock } from '#shared/training'

const sb = useSupabase()
const toast = useToast()
const { state, status, pendingCount, sync } = useTraining()

const block = computed(() => state.block)
const summary = computed(() => block.value
  ? summariseBlock(block.value.plan, Object.values(state.workouts).filter(w => w.block_id === block.value!.id), Object.values(state.sets))
  : null)
const comment = ref('')
const busy = ref(false)
const error = ref('')

interface Job { status: 'running' | 'done' | 'failed', error: string | null, created_at: string, result_id: string | null }
const job = ref<Job | null>(null)
async function loadJob() {
  if (!block.value || !status.online) return
  const { data } = await sb.from('ai_jobs').select('*').eq('subject_id', block.value.id).eq('kind', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
  job.value = data as Job | null
}
onMounted(loadJob)
const jobRunning = computed(() => job.value?.status === 'running' && Date.now() - +new Date(job.value.created_at) < 6 * 60 * 1000)
const jobInterrupted = computed(() => job.value?.status === 'running' && !jobRunning.value)
let timer: ReturnType<typeof setInterval> | undefined
watch(jobRunning, (r) => {
  clearInterval(timer)
  if (r && !busy.value) timer = setInterval(loadJob, 4000)
}, { immediate: true })
watch(job, (j) => { if (j?.status === 'done' && j.result_id && !busy.value) navigateTo(`/week/${j.result_id}`) })
onBeforeUnmount(() => clearInterval(timer))

async function ensureSynced() {
  await sync()
  if (pendingCount.value) throw new Error('Some sets are only on this device. Connect so they sync, then try again.')
}

async function draft() {
  error.value = ''
  busy.value = true
  try {
    await ensureSynced()
    const { blockId } = await api<{ blockId: string }>('/api/draft', { blockId: block.value!.id, comment: comment.value })
    await navigateTo(`/week/${blockId}`)
  } catch (e) {
    error.value = (e as Error).message && !(e as { data?: unknown }).data ? (e as Error).message : apiError(e)
    await loadJob()
  } finally {
    busy.value = false
  }
}

// Works without the assistant: the programme's next week as written, keeping this week's weights.
async function repeatTargets() {
  busy.value = true
  try {
    await ensureSynced()
    const plan = blockFromProgramme(state.programme!.data, block.value!.week_number + 1)
    for (const s of plan.sessions) {
      for (const e of s.exercises) {
        const cur = block.value!.plan.sessions.find(x => x.key === s.key)?.exercises.find(x => x.key === e.key)
        e.target_weight = cur?.target_weight ?? null
        e.target_reps = cur?.target_reps ?? e.target_reps
      }
    }
    const { data, error: err } = await sb.from('blocks').insert({
      programme_id: block.value!.programme_id, week_number: block.value!.week_number + 1, plan, comment: comment.value || null, summary: summary.value
    }).select('id').single()
    if (err) throw err
    await navigateTo(`/week/${data.id}`)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

const sessionStarted = (key: string) => summary.value?.sessions.find(s => s.key === key)?.status !== 'not_started'
const label = { completed: 'Completed', in_progress: 'In progress', interrupted: 'Interrupted', skipped: 'Skipped', not_started: 'Not done' } as const
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/" aria-label="Back to Train" />
      <h1 class="flex-1 font-display text-3xl font-extrabold text-highlighted">
        Prepare next week
      </h1>
    </header>

    <p v-if="!block" class="mt-8 text-muted">
      There is no active week to build on.
    </p>

    <template v-else-if="summary">
      <section class="mt-4" aria-labelledby="done-title">
        <h2 id="done-title" class="font-display text-2xl font-bold">
          Week {{ block.week_number }}: {{ summary.completed_sessions }} of {{ summary.sessions.length }} sessions completed
        </h2>
        <ul class="mt-2 space-y-1">
          <li v-for="s in summary.sessions" :key="s.key" class="flex items-center justify-between rounded-md bg-elevated px-3 py-2">
            <span>{{ s.name }}</span>
            <span class="flex items-center gap-1 text-sm" :class="s.status === 'completed' ? 'text-success' : 'text-muted'">
              <UIcon :name="s.status === 'completed' ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="size-4" />
              {{ label[s.status] }}
            </span>
          </li>
        </ul>
      </section>

      <section class="mt-6">
        <h2 class="font-display text-2xl font-bold">
          Results
        </h2>
        <ul class="mt-2 divide-y divide-default rounded-xl border border-default bg-elevated">
          <li v-for="e in summary.exercises" :key="e.session_key + e.exercise_key" class="px-3 py-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-bold">{{ e.name }}<span v-if="e.variant" class="font-normal text-muted"> ({{ e.variant }})</span></span>
              <span class="shrink-0 text-xs" :class="e.hit_target ? 'text-success' : 'text-muted'">
                {{ e.hit_target ? 'Target met' : e.done.length ? 'Below target' : 'Not done' }}
              </span>
            </div>
            <p class="num text-lg">
              <template v-if="e.done.length">
                {{ e.done.map(d => `${formatWeight(d.weight)}×${d.reps}`).join(', ') }}
              </template>
              <span v-else class="text-muted">–</span>
              <span v-if="e.skipped && sessionStarted(e.session_key)" class="ml-2 font-sans text-sm text-muted">{{ e.skipped }} skipped</span>
            </p>
          </li>
        </ul>
      </section>

      <section class="mt-6 space-y-4 pb-8">
        <UFormField label="Comment for next week (optional)" hint="e.g. shoulder felt tight, short on time Thursday">
          <UTextarea v-model="comment" :rows="3" class="w-full" />
        </UFormField>

        <p v-if="pendingCount" class="text-sm text-warning">
          {{ pendingCount }} changes are saved on this device only. They will sync before drafting.
        </p>
        <div v-if="jobRunning && !busy" class="flex items-center gap-2 text-sm" role="status">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin motion-reduce:animate-none" />
          A draft is being prepared. This page opens it when ready.
        </div>
        <UAlert v-if="jobInterrupted && !busy" color="warning" variant="subtle" icon="i-lucide-circle-pause" description="The last draft was interrupted before it finished. Nothing was saved from it. Draft again." />
        <UAlert v-if="error || job?.status === 'failed'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Draft failed" :description="error || job?.error || undefined" />

        <UButton size="xl" block icon="i-lucide-sparkles" :loading="busy" :disabled="!status.online || jobRunning" @click="draft">
          Draft week {{ block.week_number + 1 }}
        </UButton>
        <p v-if="busy" class="text-center text-sm text-muted" role="status">
          Applying the programme's rules to your results. This can take a minute.
        </p>
        <p v-if="!status.online" class="text-center text-sm text-warning">
          Drafting needs a connection.
        </p>
        <UButton v-if="error || job?.status === 'failed' || jobInterrupted" size="lg" block color="neutral" variant="outline" :disabled="busy || !status.online" @click="repeatTargets">
          Use the programme as written instead
        </UButton>
      </section>
    </template>
  </main>
</template>
