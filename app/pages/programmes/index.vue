<script setup lang="ts">
const sb = useSupabase()
const toast = useToast()
const { state, status } = useTraining()

interface Job { id: string, subject_id: string, status: 'running' | 'done' | 'failed', error: string | null, result_id: string | null, created_at: string }
interface Row { id: string, title: string, kind: string, created_at: string, programmes: { id: string, version: number, status: string, name: string }[] }

const rows = ref<Row[]>([])
const jobs = ref<Record<string, Job>>({})
const loading = ref(true)
const loadError = ref('')

async function load() {
  const [s, j] = await Promise.all([
    sb.from('sources').select('id, title, kind, created_at, programmes(id, version, status, name)').order('created_at', { ascending: false }),
    sb.from('ai_jobs').select('*').eq('kind', 'interpret').order('created_at', { ascending: false }).limit(50)
  ])
  loading.value = false
  if (s.error) {
    loadError.value = status.online ? s.error.message : 'Programmes need a connection.'
    return
  }
  rows.value = (s.data ?? []) as Row[]
  const latest: Record<string, Job> = {}
  for (const job of (j.data ?? []) as Job[]) latest[job.subject_id] ??= job
  jobs.value = latest
}
onMounted(load)

// Poll while any document is being read; the job row survives closing the app.
const STALE_MS = 6 * 60 * 1000
const jobState = (id: string) => {
  const job = jobs.value[id]
  if (!job) return null
  if (job.status === 'running') return Date.now() - +new Date(job.created_at) > STALE_MS ? 'interrupted' : 'running'
  return job.status
}
let timer: ReturnType<typeof setInterval> | undefined
watchEffect(() => {
  const any = rows.value.some(r => jobState(r.id) === 'running')
  clearInterval(timer)
  if (any) timer = setInterval(load, 4000)
})
onBeforeUnmount(() => clearInterval(timer))

async function interpret(sourceId: string) {
  jobs.value[sourceId] = { id: '', subject_id: sourceId, status: 'running', error: null, result_id: null, created_at: new Date().toISOString() }
  try {
    const { programmeId } = await api<{ programmeId: string }>('/api/interpret', { sourceId })
    toast.add({ title: 'Programme read', description: 'Review it before use.', icon: 'i-lucide-file-check' })
    await navigateTo(`/programmes/${programmeId}`)
  } catch (e) {
    toast.add({ title: 'Could not read the programme', description: apiError(e), color: 'error' })
    await load()
  }
}

// Adding a programme: pasted text and any number of files, together or alone.
const adding = ref(false)
const title = ref('')
const text = ref('')
const files = ref<File[]>([])
const addError = ref('')
const busy = ref(false)
const ACCEPT = ['pdf', 'docx', 'txt', 'md']
const extOf = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? ''

function pickFiles(e: Event) {
  addError.value = ''
  const input = e.target as HTMLInputElement
  for (const f of input.files ?? []) {
    const ext = extOf(f)
    if (!ACCEPT.includes(ext)) {
      addError.value = ext === 'doc'
        ? `${f.name}: old Word files (.doc) are not supported. Save it as .docx or PDF.`
        : `${f.name}: this file type is not supported. Use PDF, Word (.docx) or plain text.`
      continue
    }
    if (f.size > 20 * 1024 * 1024) {
      addError.value = `${f.name} is larger than 20 MB. Export a smaller PDF or paste the text.`
      continue
    }
    if (!files.value.some(x => x.name === f.name && x.size === f.size)) files.value.push(f)
  }
  input.value = ''
  if (!title.value && files.value[0]) title.value = files.value[0].name.replace(/\.[^.]+$/, '')
}

async function add() {
  addError.value = ''
  if (!files.value.length && text.value.trim().length < 40) {
    addError.value = 'Paste the programme text, add files, or both.'
    return
  }
  busy.value = true
  const uploaded: string[] = []
  let sourceId: string | null = null
  try {
    // Text files join the pasted text; PDF and Word files are stored and read as documents.
    const docs = files.value.filter(f => ['pdf', 'docx'].includes(extOf(f)))
    const texts = await Promise.all(files.value.filter(f => !docs.includes(f)).map(async f => `--- ${f.name} ---\n${await f.text()}`))
    const content = [text.value.trim(), ...texts].filter(Boolean).join('\n\n') || null
    const kinds = new Set(docs.map(extOf))
    const kind = !docs.length ? 'text' : kinds.size === 1 && !content ? [...kinds][0] : 'mixed'

    const { data: src, error } = await sb.from('sources').insert({ title: title.value.trim() || 'Programme', kind, text_content: content }).select('id').single()
    if (error) throw error
    sourceId = src.id
    const stored: { path: string, name: string, kind: string }[] = []
    for (const [i, f] of docs.entries()) {
      const path = `${state.userId}/${src.id}-${i}.${extOf(f)}`
      const up = await sb.storage.from('sources').upload(path, f, { contentType: f.type || undefined, upsert: true })
      if (up.error) throw up.error
      uploaded.push(path)
      stored.push({ path, name: f.name, kind: extOf(f) })
    }
    if (stored.length) {
      const { error: upd } = await sb.from('sources').update({ files: stored }).eq('id', src.id)
      if (upd) throw upd
    }
    adding.value = false
    title.value = ''
    text.value = ''
    files.value = []
    await load()
    interpret(src.id)
  } catch (e) {
    addError.value = apiError(e)
    // Do not leave a half-saved source behind.
    if (uploaded.length) await sb.storage.from('sources').remove(uploaded)
    if (sourceId) await sb.from('sources').delete().eq('id', sourceId)
  } finally {
    busy.value = false
  }
}

// Deleting a whole programme: its versions, files, and any weeks planned from it.
const deleting = ref<null | { id: string, title: string, text: string }>(null)
const deletingBusy = ref(false)
async function askDelete(r: Row) {
  deleting.value = { id: r.id, title: r.title, text: describeImpact(await deletionImpact({ sourceId: r.id }), 'programme') }
}
async function confirmDelete() {
  deletingBusy.value = true
  try {
    await deleteSource(deleting.value!.id)
    toast.add({ title: 'Programme deleted' })
    deleting.value = null
    await load()
  } catch (e) {
    toast.add({ title: 'Not deleted', description: apiError(e), color: 'error' })
  } finally {
    deletingBusy.value = false
  }
}

const statusLabel: Record<string, string> = { draft: 'Needs review', approved: 'Approved', archived: 'Older version' }
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/" aria-label="Back" />
      <h1 class="flex-1 font-display text-4xl font-extrabold text-highlighted">
        Programmes
      </h1>
      <UButton icon="i-lucide-plus" :disabled="!status.online" @click="adding = true">
        Add
      </UButton>
    </header>

    <p v-if="!status.online" class="mt-4 text-sm text-warning">
      You are offline. Adding and reading programmes needs a connection.
    </p>
    <UAlert v-if="loadError" class="mt-4" color="error" variant="subtle" :description="loadError" />

    <div v-if="loading" class="mt-6 space-y-3">
      <USkeleton class="h-20 w-full" />
    </div>
    <section v-else-if="!rows.length && !loadError" class="mt-10">
      <h2 class="font-display text-3xl font-bold">
        No programmes yet
      </h2>
      <p class="mt-2 text-muted">
        Upload the programme you bought (PDF, Word or text) or paste it. The app reads sessions, exercises, sets, rest and progression rules, and flags anything missing or conflicting for you to check.
      </p>
      <UButton class="mt-6" size="xl" block icon="i-lucide-file-plus" :disabled="!status.online" @click="adding = true">
        Add programme
      </UButton>
    </section>

    <ul v-else class="mt-6 space-y-3">
      <li v-for="r in rows" :key="r.id" class="rounded-xl border border-default bg-elevated p-4">
        <div class="flex items-start gap-3">
          <UIcon :name="r.kind === 'text' ? 'i-lucide-file-text' : r.kind === 'mixed' ? 'i-lucide-files' : 'i-lucide-file'" class="mt-1 size-5 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="font-bold text-highlighted">
              {{ r.title }}
            </p>
            <p class="text-sm text-muted">
              Added {{ fmtDate(r.created_at, true) }}
            </p>
          </div>
          <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" :aria-label="`Delete ${r.title}`" :disabled="!status.online" @click="askDelete(r)" />
        </div>

        <div v-if="jobState(r.id) === 'running'" class="mt-3 flex items-center gap-2 text-sm" role="status">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin motion-reduce:animate-none" />
          Reading the programme. This can take a minute; you can leave this screen.
        </div>
        <UAlert
          v-else-if="jobState(r.id) === 'failed' || jobState(r.id) === 'interrupted'"
          class="mt-3"
          color="error"
          variant="subtle"
          icon="i-lucide-file-x"
          :title="jobState(r.id) === 'failed' ? 'Reading failed' : 'Reading was interrupted'"
          :description="jobState(r.id) === 'failed' ? (jobs[r.id]?.error ?? undefined) : 'The app was closed or lost connection before it finished. Nothing was saved from that attempt.'"
          :actions="[{ label: 'Try again', icon: 'i-lucide-rotate-cw', onClick: () => interpret(r.id) }]"
        />

        <ul v-if="r.programmes.length" class="mt-3 space-y-1">
          <li v-for="p in [...r.programmes].sort((a, b) => b.version - a.version)" :key="p.id">
            <NuxtLink :to="`/programmes/${p.id}`" class="flex items-center justify-between rounded-md px-2 py-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary outline-none">
              <span>{{ p.name }} <span class="text-muted">v{{ p.version }}</span></span>
              <UBadge :color="p.status === 'approved' ? 'success' : p.status === 'draft' ? 'warning' : 'neutral'" variant="subtle">
                {{ statusLabel[p.status] }}
              </UBadge>
            </NuxtLink>
          </li>
        </ul>
        <UButton
          v-if="!r.programmes.length && (!jobState(r.id) || jobState(r.id) === 'done')"
          class="mt-3"
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-scan-text"
          @click="interpret(r.id)"
        >
          Read programme
        </UButton>
      </li>
    </ul>

    <UModal :open="!!deleting" :title="`Delete ${deleting?.title ?? 'programme'}?`" :description="deleting?.text" @update:open="v => { if (!v) deleting = null }">
      <template #footer>
        <UButton color="neutral" variant="outline" @click="deleting = null">
          Keep it
        </UButton>
        <UButton color="error" :loading="deletingBusy" @click="confirmDelete">
          Delete
        </UButton>
      </template>
    </UModal>

    <UDrawer v-model:open="adding" title="Add programme" description="Paste text, add PDF, Word (.docx) or text files, or both.">
      <template #body>
        <form class="space-y-4 pb-safe" @submit.prevent="add">
          <UFormField label="Name">
            <UInput v-model="title" class="w-full" placeholder="e.g. Strength block 2" />
          </UFormField>
          <UFormField label="Programme text" hint="Optional if you add files">
            <UTextarea v-model="text" :rows="6" class="w-full" placeholder="Paste sessions, exercises, sets, reps, rest, progression rules or extra notes" />
          </UFormField>
          <div>
            <p class="text-sm font-medium">
              Files <span class="font-normal text-muted">(optional, up to 20 MB each)</span>
            </p>
            <ul v-if="files.length" class="mt-2 space-y-1">
              <li v-for="(f, i) in files" :key="f.name + f.size" class="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-sm">
                <UIcon :name="extOf(f) === 'pdf' ? 'i-lucide-file' : 'i-lucide-file-text'" class="size-4 shrink-0 text-muted" />
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Remove ${f.name}`" @click="files.splice(i, 1)" />
              </li>
            </ul>
            <label class="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-default px-3 py-3 text-sm font-bold focus-within:ring-2 focus-within:ring-primary">
              <UIcon name="i-lucide-paperclip" class="size-4" />
              {{ files.length ? 'Add more files' : 'Add files' }}
              <input type="file" multiple accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" class="sr-only" @change="pickFiles">
            </label>
          </div>
          <UAlert v-if="addError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="addError" />
          <UButton type="submit" size="xl" block :loading="busy">
            Add and read
          </UButton>
        </form>
      </template>
    </UDrawer>
  </main>
</template>
