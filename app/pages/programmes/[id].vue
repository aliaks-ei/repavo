<script setup lang="ts">
import { blockFromProgramme, EQUIPMENT, repsLabel } from '#shared/training'
import type { Programme } from '~/composables/useTraining'

definePageMeta({ hideNav: true })

const route = useRoute()
const sb = useSupabase()
const toast = useToast()
const { status } = useTraining()

const p = ref<Programme | null>(null)
const source = ref<{ id: string, title: string, text_content: string | null, files: { path: string, name: string }[] } | null>(null)
const fileLinks = ref<Record<string, string>>({})
const hasBlocks = ref(false)
const loadError = ref('')
const dirty = ref(false)
const busy = ref(false)
const week = ref(1)
const startWeek = ref(1)

async function load() {
  const { data, error } = await sb.from('programmes').select('*, sources(id, title, text_content, files)').eq('id', route.params.id).single()
  if (error) {
    loadError.value = status.online ? 'This programme could not be found.' : 'Programmes need a connection.'
    return
  }
  const { sources, ...rest } = data
  p.value = rest as Programme
  source.value = sources
  week.value = rest.data.current_week ?? rest.data.weeks?.[0]?.week ?? 1
  startWeek.value = week.value
  // Signed links are made up front: iOS blocks opening a new tab after an async call.
  const paths = (sources?.files ?? []).map((f: { path: string }) => f.path)
  fileLinks.value = paths.length ? Object.fromEntries(((await sb.storage.from('sources').createSignedUrls(paths, 3600)).data ?? []).map(l => [l.path, l.signedUrl])) : {}
  const { count } = await sb.from('blocks').select('id', { count: 'exact', head: true }).eq('programme_id', rest.id).neq('status', 'discarded')
  hasBlocks.value = (count ?? 0) > 0
  dirty.value = false
}
onMounted(load)
watch(() => p.value?.data, (_, old) => { if (old) dirty.value = true }, { deep: true })

// Programmes read before the weekly format need to be read again.
const legacy = computed(() => !!p.value && !Array.isArray(p.value.data.weeks))
const editable = computed(() => p.value?.status === 'draft' && !legacy.value)
const data = computed(() => p.value!.data)
const weeks = computed(() => legacy.value ? [] : [...data.value.weeks].sort((a, b) => a.week - b.week))
const shown = computed(() => weeks.value.find(w => w.week === week.value))
const exercise = (key: string) => data.value.exercises.find(e => e.key === key)
const openIssues = computed(() => legacy.value ? 0 : data.value.issues.filter(i => !i.resolved).length)

const field = 'mt-1 block w-full rounded-md border border-default bg-default px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary'
const text = (ev: Event) => (ev.target as HTMLInputElement).value.trim() || null
const num = (ev: Event) => parseNum((ev.target as HTMLInputElement).value)
const editingRow = ref<string | null>(null)
const editingExercise = ref<string | null>(null)

async function save() {
  busy.value = true
  const { error } = await sb.from('programmes').update({ name: p.value!.name, data: p.value!.data }).eq('id', p.value!.id)
  busy.value = false
  if (error) return toast.add({ title: 'Not saved', description: apiError(error), color: 'error' })
  dirty.value = false
  toast.add({ title: 'Changes saved' })
}

// Ask the model to change the draft; it checks the change against the source files.
const instruction = ref('')
const revising = ref(false)
const reviseError = ref('')
async function revise() {
  if (dirty.value) await save()
  revising.value = true
  reviseError.value = ''
  try {
    await api('/api/revise', { programmeId: p.value!.id, instruction: instruction.value })
    instruction.value = ''
    await load()
    toast.add({ title: 'Draft updated', description: 'Check the change before approving.', icon: 'i-lucide-sparkles' })
  } catch (e) {
    reviseError.value = apiError(e)
  } finally {
    revising.value = false
  }
}

async function readAgain() {
  busy.value = true
  try {
    const { programmeId } = await api<{ programmeId: string }>('/api/interpret', { sourceId: p.value!.source_id })
    await navigateTo(`/programmes/${programmeId}`)
    await load()
  } catch (e) {
    toast.add({ title: 'Could not read the programme', description: apiError(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function approve() {
  if (dirty.value) await save()
  busy.value = true
  await sb.from('programmes').update({ status: 'archived' }).eq('source_id', p.value!.source_id).eq('status', 'approved')
  const { error } = await sb.from('programmes').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', p.value!.id)
  busy.value = false
  if (error) return toast.add({ title: 'Not approved', description: apiError(error), color: 'error' })
  toast.add({ title: 'Programme approved', icon: 'i-lucide-badge-check' })
  await load()
}

async function newVersion() {
  busy.value = true
  const { data: latest } = await sb.from('programmes').select('version').eq('source_id', p.value!.source_id).order('version', { ascending: false }).limit(1)
  const { data: created, error } = await sb.from('programmes').insert({
    source_id: p.value!.source_id, version: (latest?.[0]?.version ?? p.value!.version) + 1, name: p.value!.name, data: p.value!.data
  }).select('id').single()
  busy.value = false
  if (error) return toast.add({ title: 'Could not create a new version', description: apiError(error), color: 'error' })
  await navigateTo(`/programmes/${created.id}`)
  await load()
}

async function planWeek() {
  busy.value = true
  const { data: block, error } = await sb.from('blocks').insert({ programme_id: p.value!.id, week_number: startWeek.value, plan: blockFromProgramme(data.value, startWeek.value) }).select('id').single()
  busy.value = false
  if (error) return toast.add({ title: `Could not create week ${startWeek.value}`, description: apiError(error), color: 'error' })
  await navigateTo(`/week/${block.id}`)
}

// Deleting
const deleting = ref<null | { what: 'draft' | 'programme', text: string }>(null)
async function askDelete(what: 'draft' | 'programme') {
  const impact = await deletionImpact(what === 'draft' ? { programmeId: p.value!.id } : { sourceId: p.value!.source_id })
  deleting.value = { what, text: describeImpact(impact, what) }
}
async function confirmDelete() {
  busy.value = true
  try {
    if (deleting.value!.what === 'draft') await deleteProgramme(p.value!.id)
    else await deleteSource(p.value!.source_id)
    toast.add({ title: deleting.value!.what === 'draft' ? 'Draft deleted' : 'Programme deleted' })
    deleting.value = null
    await navigateTo('/programmes')
  } catch (e) {
    toast.add({ title: 'Not deleted', description: apiError(e), color: 'error' })
  } finally {
    busy.value = false
  }
}
const menu = computed(() => [[
  ...(p.value?.status === 'draft' ? [{ label: 'Delete this draft', icon: 'i-lucide-trash', onSelect: () => askDelete('draft') }] : []),
  { label: 'Delete programme', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => askDelete('programme') }
]])
</script>

<template>
  <main class="px-4 pt-safe pb-36">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/programmes" aria-label="Back to programmes" />
      <h1 class="flex-1 truncate font-display text-3xl font-extrabold text-highlighted">
        {{ p?.name ?? 'Programme' }}
      </h1>
      <UDropdownMenu v-if="p" :items="menu" :content="{ align: 'end' }">
        <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="lg" aria-label="Programme options" />
      </UDropdownMenu>
    </header>

    <UAlert v-if="loadError" class="mt-4" color="error" variant="subtle" :description="loadError" />
    <USkeleton v-else-if="!p" class="mt-6 h-64 w-full" />

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="p.status === 'approved' ? 'success' : p.status === 'draft' ? 'warning' : 'neutral'" variant="subtle">
          {{ p.status === 'approved' ? 'Approved' : p.status === 'draft' ? 'Draft' : 'Older version' }}
        </UBadge>
        <span class="text-sm text-muted">Version {{ p.version }}</span>
      </div>

      <UAlert
        v-if="legacy"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="Read this programme again"
        description="It was read with an older format that does not hold week-by-week plans."
        :actions="[{ label: 'Read again', loading: busy, onClick: readAgain }]"
      />

      <template v-else>
        <UInput v-if="editable" v-model="p.name" class="mt-3 w-full" aria-label="Programme name" />
        <p v-if="data.summary" class="mt-2 text-sm text-muted">
          {{ data.summary }}
        </p>

        <!-- Only issues that change what to do -->
        <ul v-if="data.issues.length" class="mt-4 space-y-2" aria-label="Things to check">
          <li v-for="(issue, i) in data.issues" :key="i" class="flex items-start gap-3 rounded-lg p-3" :class="issue.resolved ? 'bg-elevated text-muted' : 'bg-warning/10'">
            <UCheckbox v-model="issue.resolved" :disabled="!editable" :aria-label="`Mark checked: ${issue.message}`" class="mt-0.5" />
            <p class="text-sm">
              {{ issue.message }}
            </p>
          </li>
        </ul>

        <!-- Week picker -->
        <div role="tablist" aria-label="Programme week" class="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            v-for="w in weeks"
            :key="w.week"
            type="button"
            role="tab"
            :aria-selected="week === w.week"
            class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="week === w.week ? 'border-primary bg-primary font-bold text-inverted' : 'border-default'"
            @click="week = w.week"
          >
            Week {{ w.week }}<span v-if="data.current_week === w.week"> (now)</span>
          </button>
        </div>

        <section v-for="s in shown?.sessions ?? []" :key="s.key" class="mt-5">
          <h2 class="font-display text-2xl font-bold">
            {{ s.name }}
          </h2>
          <ul class="mt-1 divide-y divide-default rounded-xl border border-default bg-elevated">
            <li v-for="(rx, i) in s.items" :key="i" class="px-3 py-2.5">
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-bold text-highlighted">
                    {{ exercise(rx.exercise_key)?.name }}<span v-if="exercise(rx.exercise_key)?.variant" class="ml-1 font-normal text-muted">{{ exercise(rx.exercise_key)?.variant }}</span>
                  </p>
                  <p v-if="rx.load" class="truncate text-xs text-muted">
                    {{ rx.load }}
                  </p>
                </div>
                <UBadge v-if="rx.method" color="neutral" variant="soft" size="sm">
                  {{ rx.method }}
                </UBadge>
                <span class="num text-xl font-bold" :class="rx.sets == null || (rx.rep_min == null && rx.rep_max == null) ? 'text-warning' : ''">
                  {{ rx.sets ?? '?' }} × {{ repsLabel(rx) === '–' ? '?' : repsLabel(rx) }}
                </span>
                <UButton
                  v-if="editable"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  :icon="editingRow === `${s.key}:${i}` ? 'i-lucide-chevron-up' : 'i-lucide-pencil'"
                  :aria-label="`Edit ${exercise(rx.exercise_key)?.name} in ${s.name}`"
                  :aria-expanded="editingRow === `${s.key}:${i}`"
                  @click="editingRow = editingRow === `${s.key}:${i}` ? null : `${s.key}:${i}`"
                />
              </div>
              <div v-if="editingRow === `${s.key}:${i}`" class="mt-2 grid grid-cols-3 gap-2 text-sm">
                <label>Sets
                  <input :value="rx.sets ?? ''" inputmode="numeric" :class="field" @change="rx.sets = num($event)">
                </label>
                <label>Reps from
                  <input :value="rx.rep_min ?? ''" inputmode="numeric" :class="field" @change="rx.rep_min = num($event)">
                </label>
                <label>Reps to
                  <input :value="rx.rep_max ?? ''" inputmode="numeric" :class="field" @change="rx.rep_max = num($event)">
                </label>
                <label>Method
                  <select :value="rx.method ?? ''" :class="field" @change="rx.method = text($event)">
                    <option value="">None</option>
                    <option v-for="m in data.methods" :key="m.name" :value="m.name">{{ m.name }}</option>
                  </select>
                </label>
                <label class="col-span-2">Load
                  <input :value="rx.load ?? ''" :class="field" placeholder="e.g. RPE 8" @change="rx.load = text($event)">
                </label>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="data.methods.length" class="mt-8">
          <h2 class="font-display text-2xl font-bold">
            Methods
          </h2>
          <dl class="mt-1 space-y-2">
            <div v-for="m in data.methods" :key="m.name" class="rounded-lg bg-elevated p-3">
              <dt class="font-bold">
                {{ m.name }}
              </dt>
              <dd class="text-sm">
                {{ m.description }}
              </dd>
            </div>
          </dl>
        </section>

        <section v-if="data.rules.length" class="mt-8">
          <h2 class="font-display text-2xl font-bold">
            Rules
          </h2>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
            <li v-for="(r, i) in data.rules" :key="i">
              {{ r }}
            </li>
          </ul>
        </section>

        <section v-if="data.guides.length" class="mt-8 space-y-2">
          <h2 class="font-display text-2xl font-bold">
            Guides
          </h2>
          <GuideCard v-for="g in data.guides" :key="g.key" :guide="g" />
        </section>

        <!-- Exercise details apply to every week -->
        <details class="mt-8 rounded-xl border border-default">
          <summary class="cursor-pointer px-4 py-3 font-bold">
            Exercises ({{ data.exercises.length }})
          </summary>
          <ul class="divide-y divide-default border-t border-default">
            <li v-for="e in data.exercises" :key="e.key" class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1">
                  <span class="font-bold">{{ e.name }}</span><span v-if="e.variant" class="ml-1 text-muted">{{ e.variant }}</span>
                  <span class="block text-xs text-muted">{{ e.equipment }}{{ e.rest_seconds ? `, rest ${e.rest_seconds} s` : '' }}</span>
                </p>
                <UButton
                  v-if="editable"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  :icon="editingExercise === e.key ? 'i-lucide-chevron-up' : 'i-lucide-pencil'"
                  :aria-label="`Edit ${e.name}`"
                  :aria-expanded="editingExercise === e.key"
                  @click="editingExercise = editingExercise === e.key ? null : e.key"
                />
              </div>
              <div v-if="editingExercise === e.key" class="mt-2 grid grid-cols-2 gap-2 text-sm">
                <label class="col-span-2">Name
                  <input v-model="e.name" :class="field">
                </label>
                <label>Variant
                  <input :value="e.variant ?? ''" :class="field" @change="e.variant = text($event)">
                </label>
                <label>Equipment
                  <select v-model="e.equipment" :class="field">
                    <option v-for="eq in EQUIPMENT" :key="eq" :value="eq">{{ eq }}</option>
                  </select>
                </label>
                <label>Rest (s)
                  <input :value="e.rest_seconds ?? ''" inputmode="numeric" :class="field" @change="e.rest_seconds = num($event)">
                </label>
                <label>Video link
                  <input :value="e.video_url ?? ''" type="url" :class="field" @change="e.video_url = text($event)">
                </label>
                <label class="col-span-2">Technique
                  <textarea :value="e.technique ?? ''" rows="2" :class="field" @change="e.technique = text($event)" />
                </label>
              </div>
            </li>
          </ul>
        </details>

        <!-- Change the draft by asking -->
        <section v-if="editable" class="mt-8 rounded-xl border border-default p-4">
          <h2 class="font-bold">
            Ask for a change
          </h2>
          <p class="text-sm text-muted">
            Describe what to fix. The draft is updated and checked against your files.
          </p>
          <UTextarea v-model="instruction" class="mt-3 w-full" :rows="2" autoresize placeholder="e.g. Workout 4: the second row is a wide-grip lat pulldown" :disabled="revising" />
          <UAlert v-if="reviseError" class="mt-2" color="error" variant="subtle" :description="reviseError" />
          <UButton class="mt-3" icon="i-lucide-sparkles" :loading="revising" :disabled="!instruction.trim() || !status.online" @click="revise">
            {{ revising ? 'Updating the draft…' : 'Apply change' }}
          </UButton>
        </section>
      </template>

      <section v-if="source?.files?.length || source?.text_content" class="mt-8 space-y-1">
        <h2 class="text-sm font-bold text-muted">
          Sources
        </h2>
        <UButton
          v-for="f in source?.files ?? []"
          :key="f.path"
          color="neutral"
          variant="soft"
          icon="i-lucide-file"
          trailing-icon="i-lucide-external-link"
          class="w-full"
          :to="fileLinks[f.path]"
          target="_blank"
          :disabled="!fileLinks[f.path]"
        >
          <span class="min-w-0 flex-1 truncate text-left">{{ f.name }}</span>
        </UButton>
        <details v-if="source?.text_content" class="rounded-lg bg-elevated px-3 py-2">
          <summary class="cursor-pointer text-sm">
            Pasted text
          </summary>
          <pre class="mt-2 max-h-96 overflow-auto text-xs whitespace-pre-wrap">{{ source.text_content }}</pre>
        </details>
      </section>

      <div v-if="!legacy" class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-elevated/95 backdrop-blur pb-safe">
        <div class="mx-auto flex max-w-xl flex-col gap-2 px-4 pt-3">
          <template v-if="editable">
            <p v-if="openIssues" class="text-center text-sm text-warning">
              Check {{ openIssues }} {{ openIssues === 1 ? 'item' : 'items' }} above before approving.
            </p>
            <div class="flex gap-2">
              <UButton size="xl" color="neutral" variant="outline" :disabled="!dirty" :loading="busy" @click="save">
                Save
              </UButton>
              <UButton size="xl" class="flex-1 justify-center" icon="i-lucide-badge-check" :disabled="openIssues > 0" :loading="busy" @click="approve">
                Approve
              </UButton>
            </div>
          </template>
          <div v-else class="flex items-center gap-2">
            <UButton size="xl" color="neutral" variant="outline" :loading="busy" @click="newVersion">
              Edit
            </UButton>
            <template v-if="p.status === 'approved' && !hasBlocks">
              <label class="sr-only" for="start-week">Start at week</label>
              <select id="start-week" v-model.number="startWeek" class="h-11 rounded-md border border-default bg-default px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <option v-for="w in weeks" :key="w.week" :value="w.week">Week {{ w.week }}</option>
              </select>
              <UButton size="xl" class="flex-1 justify-center" icon="i-lucide-calendar-plus" :loading="busy" @click="planWeek">
                Plan week {{ startWeek }}
              </UButton>
            </template>
          </div>
        </div>
      </div>
    </template>

    <UModal :open="!!deleting" :title="deleting?.what === 'draft' ? 'Delete this draft?' : 'Delete this programme?'" :description="deleting?.text" @update:open="v => { if (!v) deleting = null }">
      <template #footer>
        <UButton color="neutral" variant="outline" @click="deleting = null">
          Keep it
        </UButton>
        <UButton color="error" :loading="busy" @click="confirmDelete">
          Delete
        </UButton>
      </template>
    </UModal>
  </main>
</template>
