<script setup lang="ts">
import type { Block } from '~/composables/useTraining'

const sb = useSupabase()
const { status } = useTraining()
const blocks = ref<(Block & { programmes: { name: string } | null })[] | null>(null)

onMounted(async () => {
  const { data } = await sb.from('blocks').select('*, programmes(name)').neq('status', 'discarded').order('created_at', { ascending: false })
  blocks.value = (data ?? []) as typeof blocks.value
})

const statusText = { draft: 'Draft', active: 'Active', completed: 'Completed', discarded: 'Discarded' }
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/" aria-label="Back to Train" />
      <h1 class="flex-1 font-display text-4xl font-extrabold text-highlighted">
        All weeks
      </h1>
    </header>
    <p v-if="!status.online" class="mt-4 text-sm text-warning">
      Past weeks need a connection.
    </p>
    <USkeleton v-if="!blocks && status.online" class="mt-6 h-40 w-full" />
    <p v-else-if="blocks && !blocks.length" class="mt-8 text-muted">
      No weeks yet. Approve a programme and plan week 1.
    </p>
    <ul v-else-if="blocks" class="mt-6 divide-y divide-default rounded-xl border border-default bg-elevated">
      <li v-for="b in blocks" :key="b.id">
        <NuxtLink :to="`/week/${b.id}`" class="flex items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span class="num w-12 text-3xl font-extrabold">{{ b.week_number }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ b.programmes?.name }}</span>
            <span class="block text-sm text-muted">{{ fmtDate(b.activated_at ?? b.created_at, true) }}</span>
          </span>
          <UBadge :color="b.status === 'active' ? 'primary' : b.status === 'draft' ? 'warning' : 'neutral'" variant="subtle">
            {{ statusText[b.status] }}
          </UBadge>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
