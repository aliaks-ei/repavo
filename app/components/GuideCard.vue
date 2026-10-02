<script setup lang="ts">
import type { Guide } from '#shared/training'

defineProps<{ guide: Guide }>()
const open = ref(false)
</script>

<template>
  <section class="rounded-xl border border-dashed border-default">
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :aria-expanded="open"
      @click="open = !open"
    >
      <UIcon :name="guide.kind === 'warmup' ? 'i-lucide-flame' : 'i-lucide-flag'" class="size-5 text-muted" />
      <span class="flex-1 font-bold">{{ guide.title }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-5 text-muted transition-transform motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="px-4 pb-4">
      <ol class="list-decimal space-y-1 pl-5 text-sm">
        <li v-for="(s, i) in guide.steps" :key="i">
          {{ s }}
        </li>
      </ol>
      <UButton v-if="guide.video_url" class="mt-3" size="sm" color="neutral" variant="soft" icon="i-lucide-video" :to="guide.video_url" target="_blank">
        Video
      </UButton>
    </div>
  </section>
</template>
