<script setup lang="ts">
const route = useRoute()
const items = [
  { to: '/', label: 'Train', icon: 'i-lucide-dumbbell', match: (p: string) => p === '/' || p.startsWith('/week') || p.startsWith('/workout') },
  { to: '/progress', label: 'Progress', icon: 'i-lucide-chart-line', match: (p: string) => p.startsWith('/progress') },
  { to: '/assistant', label: 'Assistant', icon: 'i-lucide-message-circle', match: (p: string) => p.startsWith('/assistant') }
]
</script>

<template>
  <nav aria-label="Main" class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-elevated/95 backdrop-blur pb-safe">
    <ul class="mx-auto grid max-w-xl grid-cols-3">
      <li v-for="item in items" :key="item.to">
        <NuxtLink
          :to="item.to"
          :aria-current="item.match(route.path) ? 'page' : undefined"
          class="relative flex flex-col items-center gap-0.5 pt-2.5 pb-1 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-primary aria-[current=page]:font-bold aria-[current=page]:text-highlighted"
        >
          <span
            class="absolute inset-x-8 top-0 h-0.5 rounded-full bg-primary transition-opacity"
            :class="item.match(route.path) ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          />
          <UIcon :name="item.icon" class="size-6" />
          {{ item.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
