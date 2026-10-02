<script setup lang="ts">
const sb = useSupabase()
const toast = useToast()
const { status } = useTraining()

const list = ref<{ id: string, title: string, updated_at: string, context: { exercise?: unknown } }[] | null>(null)
const question = ref('')
const busy = ref(false)

onMounted(async () => {
  const { data } = await sb.from('conversations').select('id, title, updated_at, context').order('updated_at', { ascending: false }).limit(50)
  list.value = data ?? []
})

async function startConversation() {
  const text = question.value.trim()
  if (!text) return
  busy.value = true
  const { data, error } = await sb.from('conversations').insert({ title: text.slice(0, 80) }).select('id').single()
  const msg = error ? { error } : await sb.from('messages').insert({ conversation_id: data.id, role: 'user', content: text })
  busy.value = false
  if (error || msg.error) return toast.add({ title: 'Not sent', description: apiError(error ?? msg.error), color: 'error' })
  question.value = ''
  await navigateTo(`/assistant/${data!.id}`)
}
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="pt-2">
      <h1 class="font-display text-5xl leading-none font-extrabold text-highlighted">
        Assistant
      </h1>
      <p class="mt-1 text-sm text-muted">
        Ask about your programme and its files, logged sessions, exercises, technique and progress. It reads your records but never changes your plan.
      </p>
    </header>

    <UAlert v-if="!status.online" class="mt-4" color="warning" variant="subtle" icon="i-lucide-wifi-off" description="The assistant needs a connection. Logging still works offline." />

    <form class="mt-5 flex gap-2" @submit.prevent="startConversation">
      <UTextarea v-model="question" :rows="2" autoresize class="flex-1" placeholder="e.g. Why did my squat stall? What does my programme say about deloads?" aria-label="Your question" :disabled="!status.online" @keydown.enter.exact.prevent="startConversation" />
      <UButton type="submit" icon="i-lucide-send" size="lg" aria-label="Send" :loading="busy" :disabled="!status.online || !question.trim()" />
    </form>

    <USkeleton v-if="!list && status.online" class="mt-6 h-32 w-full" />
    <p v-else-if="list && !list.length" class="mt-8 text-muted">
      No conversations yet. Ask a question above, or open an exercise in Progress and choose Ask about this exercise.
    </p>
    <ul v-else-if="list" class="mt-6 divide-y divide-default rounded-xl border border-default bg-elevated">
      <li v-for="c in list" :key="c.id">
        <NuxtLink :to="`/assistant/${c.id}`" class="flex items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <UIcon :name="c.context?.exercise ? 'i-lucide-chart-line' : 'i-lucide-message-circle'" class="size-5 shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate">{{ c.title }}</span>
          <span class="text-xs text-muted">{{ fmtDate(c.updated_at) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
