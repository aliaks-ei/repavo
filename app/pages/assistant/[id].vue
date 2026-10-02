<script setup lang="ts">
const route = useRoute()
const sb = useSupabase()
const { status } = useTraining()

interface Msg { id: string, role: 'user' | 'assistant', content: string, refs: { workout_id: string, label: string }[], created_at: string }
const conv = ref<{ id: string, title: string, context: { exercise?: { name: string, variant: string | null } } } | null>(null)
const messages = ref<Msg[]>([])
const text = ref('')
const thinking = ref(false)
const error = ref('')
const loadError = ref('')
const bottom = ref<HTMLElement>()

const scroll = () => nextTick(() => bottom.value?.scrollIntoView({ behavior: 'smooth' }))

async function load() {
  const id = String(route.params.id)
  const [c, m] = await Promise.all([
    sb.from('conversations').select('*').eq('id', id).single(),
    sb.from('messages').select('*').eq('conversation_id', id).order('created_at')
  ])
  if (c.error) {
    loadError.value = status.online ? 'This conversation could not be found.' : 'The assistant needs a connection.'
    return
  }
  conv.value = c.data
  messages.value = (m.data ?? []) as Msg[]
  scroll()
  // A question saved without an answer (new, failed or interrupted) gets answered now.
  if (messages.value.at(-1)?.role === 'user') answer()
}
onMounted(load)

async function answer() {
  error.value = ''
  thinking.value = true
  scroll()
  try {
    const msg = await api<Msg>('/api/chat', { conversationId: conv.value!.id })
    messages.value.push(msg)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    thinking.value = false
    scroll()
  }
}

async function send() {
  const content = text.value.trim()
  if (!content || thinking.value) return
  const { data, error: err } = await sb.from('messages').insert({ conversation_id: conv.value!.id, role: 'user', content }).select().single()
  if (err) {
    error.value = apiError(err)
    return
  }
  text.value = ''
  messages.value.push(data as Msg)
  await answer()
}

const progressLink = computed(() => conv.value?.context?.exercise
  ? { path: '/progress/exercise', query: { name: conv.value.context.exercise.name, variant: conv.value.context.exercise.variant ?? undefined } }
  : null)
</script>

<template>
  <main class="flex min-h-[calc(100dvh-6rem)] flex-col px-4 pt-safe">
    <header class="sticky top-0 z-30 -mx-4 flex items-center gap-2 bg-default/95 px-2 pt-safe pb-2 backdrop-blur">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/assistant" aria-label="All conversations" />
      <h1 class="min-w-0 flex-1 truncate font-display text-2xl font-bold text-highlighted">
        {{ conv?.title ?? 'Conversation' }}
      </h1>
      <UButton v-if="progressLink" :to="progressLink" icon="i-lucide-chart-line" color="neutral" variant="ghost" aria-label="Open exercise progress" />
    </header>

    <UAlert v-if="loadError" class="mt-4" color="error" variant="subtle" :description="loadError" />

    <div class="flex-1 space-y-4 py-4" aria-live="polite">
      <p v-if="conv?.context?.exercise && !messages.length" class="text-muted">
        Ask about {{ conv.title }}. Answers use your logged sets and the statistics calculated from them.
      </p>
      <div v-for="m in messages" :key="m.id" :class="m.role === 'user' ? 'flex justify-end' : ''">
        <div
          class="max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-line"
          :class="m.role === 'user' ? 'rounded-br-sm bg-primary text-inverted' : 'rounded-bl-sm bg-elevated'"
        >
          <span class="sr-only">{{ m.role === 'user' ? 'You' : 'Assistant' }}: </span>{{ m.content }}
          <ul v-if="m.refs?.length" class="mt-2 flex flex-wrap gap-1.5">
            <li v-for="r in m.refs" :key="r.workout_id">
              <NuxtLink :to="`/workout/${r.workout_id}`" class="inline-flex items-center gap-1 rounded-full border border-default px-2 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
                <UIcon name="i-lucide-dumbbell" class="size-3" />{{ r.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="thinking" class="flex items-center gap-2 text-sm text-muted" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin motion-reduce:animate-none" />
        Looking at your records…
      </div>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="No answer"
        :description="`${error} Your question is saved.`"
        :actions="status.online ? [{ label: 'Try again', icon: 'i-lucide-rotate-cw', onClick: answer }] : []"
      />
      <div ref="bottom" />
    </div>

    <form class="sticky bottom-24 flex gap-2 bg-default/95 py-2 backdrop-blur" @submit.prevent="send">
      <UTextarea v-model="text" :rows="1" autoresize :maxrows="5" class="flex-1" placeholder="Ask a follow-up" aria-label="Your message" :disabled="!status.online || !conv" @keydown.enter.exact.prevent="send" />
      <UButton type="submit" icon="i-lucide-send" size="lg" aria-label="Send" :disabled="!status.online || !text.trim() || thinking" />
    </form>
  </main>
</template>
