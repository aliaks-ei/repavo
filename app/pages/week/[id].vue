<script setup lang="ts">
import { applyProposal, formatWeight, repsLabel, weightMeaning, type Proposal, type Workout } from '#shared/training'
import type { Block } from '~/composables/useTraining'

definePageMeta({ hideNav: true })

const route = useRoute()
const sb = useSupabase()
const toast = useToast()
const { state, status, refresh } = useTraining()

const block = ref<Block | null>(null)
const programmeName = ref('')
const workouts = ref<Workout[]>([])
const loadError = ref('')
const busy = ref(false)

async function load() {
  const { data, error } = await sb.from('blocks').select('*, programmes(name)').eq('id', route.params.id).single()
  if (error) {
    loadError.value = status.online ? 'This week could not be found.' : 'Reviewing weeks needs a connection.'
    return
  }
  const { programmes, ...b } = data
  block.value = b as Block
  programmeName.value = programmes?.name ?? ''
  if (b.status !== 'draft') workouts.value = ((await sb.from('workouts').select('*').eq('block_id', b.id).order('started_at')).data ?? []) as Workout[]
}
onMounted(load)

const isDraft = computed(() => block.value?.status === 'draft')
const pending = computed(() => block.value?.proposals.filter(p => p.decision === 'pending') ?? [])
const unit = computed(() => state.settings.unit)

async function persist(patch: Partial<Block>) {
  const { error } = await sb.from('blocks').update(patch).eq('id', block.value!.id)
  if (error) toast.add({ title: 'Not saved', description: apiError(error), color: 'error' })
}

const saveTargets = (() => {
  let t: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(t)
    t = setTimeout(() => persist({ plan: block.value!.plan }), 500)
  }
})()

function setTarget(sKey: string, eKey: string, field: 'target_weight' | 'target_reps', v: string) {
  const ex = block.value!.plan.sessions.find(s => s.key === sKey)!.exercises.find(e => e.key === eKey)!
  const n = parseNum(v)
  ex[field] = field === 'target_reps' && n != null ? Math.round(n) : n
  saveTargets()
}

async function decide(p: Proposal, decision: 'accepted' | 'rejected', stopAsking = false) {
  const b = block.value!
  p.decision = decision
  if (decision === 'accepted') b.plan = applyProposal(toRaw(b.plan), p)
  if (stopAsking) {
    for (const x of b.proposals) if (x.decision === 'pending') x.decision = 'rejected'
    await sb.from('settings').update({ proposals_enabled: false, updated_at: new Date().toISOString() }).eq('user_id', state.userId!)
    state.settings.proposals_enabled = false
    toast.add({ title: 'Changes outside the programme will not be suggested', description: 'Turn them back on in Settings.' })
  }
  await persist({ plan: b.plan, proposals: b.proposals })
}

async function activate() {
  busy.value = true
  const now = new Date().toISOString()
  // One active week at a time; the previous one stays available as history.
  const prev = await sb.from('blocks').update({ status: 'completed', completed_at: now }).eq('status', 'active')
  const res = prev.error ? prev : await sb.from('blocks').update({ status: 'active', activated_at: now }).eq('id', block.value!.id)
  busy.value = false
  if (res.error) return toast.add({ title: 'Not activated', description: apiError(res.error), color: 'error' })
  await refresh()
  toast.add({ title: `Week ${block.value!.week_number} is active`, icon: 'i-lucide-calendar-check' })
  await navigateTo('/')
}

async function discard() {
  await persist({ status: 'discarded' })
  await navigateTo('/')
}

const statusText = { draft: 'Draft', active: 'Active', completed: 'Completed', discarded: 'Discarded' }
</script>

<template>
  <main class="px-4 pt-safe" :class="isDraft ? 'pb-32' : ''">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/week" aria-label="All weeks" />
      <h1 class="flex-1 font-display text-3xl font-extrabold text-highlighted">
        {{ block ? `Week ${block.week_number}` : 'Week' }}
      </h1>
      <UBadge v-if="block" :color="block.status === 'active' ? 'primary' : block.status === 'draft' ? 'warning' : 'neutral'" variant="subtle">
        {{ statusText[block.status] }}
      </UBadge>
    </header>

    <UAlert v-if="loadError" class="mt-4" color="error" variant="subtle" :description="loadError" />
    <USkeleton v-else-if="!block" class="mt-6 h-64 w-full" />

    <template v-else>
      <p class="mt-1 text-sm text-muted">
        {{ programmeName }}
      </p>
      <p v-if="isDraft" class="mt-3 text-sm">
        Review the targets. Weight is {{ unit }}; dumbbell weight is per dumbbell, barbell weight is the total including the bar. Nothing changes until you activate this week.
      </p>
      <p v-if="block.comment" class="mt-3 rounded-lg bg-elevated p-3 text-sm">
        <span class="font-bold">Your comment:</span> {{ block.comment }}
      </p>
      <p v-if="block.notes" class="mt-3 text-sm text-muted">
        {{ block.notes }}
      </p>

      <!-- Departures from the programme need an explicit decision -->
      <section v-if="block.proposals.length" class="mt-6" aria-labelledby="proposals-title">
        <h2 id="proposals-title" class="font-display text-2xl font-bold">
          Suggested changes outside the programme
        </h2>
        <p class="text-sm text-muted">
          The programme stays as written unless you accept a change.
        </p>
        <ul class="mt-3 space-y-3">
          <li v-for="p in block.proposals" :key="p.id" class="rounded-xl border p-4" :class="p.decision === 'pending' ? 'border-warning bg-warning/10' : 'border-default'">
            <p class="font-bold">
              {{ p.title }}
            </p>
            <p class="text-sm">
              {{ p.detail }}
            </p>
            <p class="mt-1 text-sm text-muted">
              Why: {{ p.reason }}
            </p>
            <div v-if="p.decision === 'pending' && isDraft" class="mt-3 flex flex-wrap gap-2">
              <UButton size="sm" icon="i-lucide-check" @click="decide(p, 'accepted')">
                Accept
              </UButton>
              <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-x" @click="decide(p, 'rejected')">
                Reject
              </UButton>
              <UButton size="sm" color="neutral" variant="ghost" @click="decide(p, 'rejected', true)">
                Don't show again
              </UButton>
            </div>
            <p v-else class="mt-2 flex items-center gap-1 text-sm font-bold" :class="p.decision === 'accepted' ? 'text-success' : 'text-muted'">
              <UIcon :name="p.decision === 'accepted' ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" class="size-4" />
              {{ p.decision === 'accepted' ? 'Accepted' : p.decision === 'rejected' ? 'Rejected' : 'Not decided' }}
            </p>
          </li>
        </ul>
      </section>

      <section v-for="s in block.plan.sessions" :key="s.key" class="mt-8">
        <h2 class="font-display text-2xl font-bold">
          {{ s.name }}
        </h2>
        <ul class="mt-2 divide-y divide-default rounded-xl border border-default bg-elevated">
          <li v-for="e in s.exercises" :key="e.key" class="p-3">
            <p class="font-bold">
              {{ e.name }}<span v-if="e.variant" class="font-normal text-muted"> ({{ e.variant }})</span>
            </p>
            <div class="mt-1 flex items-center gap-2">
              <span class="num text-lg">{{ e.sets }} × {{ repsLabel(e) }}</span>
              <span class="flex-1" />
              <template v-if="isDraft">
                <label class="flex items-center gap-1">
                  <span class="sr-only">{{ e.name }} target weight, {{ unit }} {{ weightMeaning(e.equipment) }}</span>
                  <input
                    :value="e.target_weight ?? ''"
                    type="text"
                    inputmode="decimal"
                    placeholder="–"
                    class="num h-11 w-20 rounded-md border border-default bg-default text-center text-xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    @change="setTarget(s.key, e.key, 'target_weight', ($event.target as HTMLInputElement).value)"
                  >
                  <span class="text-xs text-muted" aria-hidden="true">{{ unit }}</span>
                </label>
                <span class="num text-muted" aria-hidden="true">×</span>
                <label>
                  <span class="sr-only">{{ e.name }} target reps</span>
                  <input
                    :value="e.target_reps ?? ''"
                    type="text"
                    inputmode="numeric"
                    placeholder="–"
                    class="num h-11 w-14 rounded-md border border-default bg-default text-center text-xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    @change="setTarget(s.key, e.key, 'target_reps', ($event.target as HTMLInputElement).value)"
                  >
                </label>
              </template>
              <span v-else class="num text-lg font-bold">{{ formatWeight(e.target_weight) }} {{ unit }} × {{ e.target_reps ?? '–' }}</span>
            </div>
            <p v-if="e.target_weight != null && weightMeaning(e.equipment)" class="text-right text-xs text-muted">
              {{ weightMeaning(e.equipment) }}
            </p>
            <p v-if="e.rationale" class="mt-1 text-sm text-muted">
              {{ e.rationale }}
            </p>
            <p v-if="e.rule_ref" class="text-xs text-muted italic">
              Rule: {{ e.rule_ref }}
            </p>
          </li>
        </ul>
      </section>

      <section v-if="!isDraft" class="mt-8 pb-6">
        <h2 class="font-display text-2xl font-bold">
          Sessions logged
        </h2>
        <p v-if="!workouts.length" class="mt-2 text-muted">
          No sessions were logged in this week.
        </p>
        <ul v-else class="mt-2 divide-y divide-default rounded-xl border border-default bg-elevated">
          <li v-for="w in workouts" :key="w.id">
            <NuxtLink :to="`/workout/${w.id}`" class="flex items-center justify-between px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span>{{ w.session_name }}</span>
              <span class="text-sm text-muted">{{ w.status === 'completed' ? fmtDate(w.finished_at) : w.status }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <div v-if="isDraft" class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-elevated/95 backdrop-blur pb-safe">
        <div class="mx-auto flex max-w-xl flex-col gap-2 px-4 pt-3">
          <p v-if="pending.length" class="text-center text-sm text-warning">
            Decide on {{ pending.length }} suggested {{ pending.length === 1 ? 'change' : 'changes' }} first.
          </p>
          <div class="flex gap-2">
            <UButton size="xl" color="neutral" variant="outline" @click="discard">
              Discard
            </UButton>
            <UButton size="xl" class="flex-1 justify-center" icon="i-lucide-calendar-check" :disabled="pending.length > 0 || !status.online" :loading="busy" @click="activate">
              Activate week {{ block.week_number }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>
