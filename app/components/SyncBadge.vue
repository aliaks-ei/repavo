<script setup lang="ts">
const { status, pendingCount, sync } = useTraining()

const view = computed(() => {
  if (!status.online) return { icon: 'i-lucide-cloud-off', text: pendingCount.value ? `Offline, ${pendingCount.value} saved on device` : 'Offline', tone: 'text-warning' }
  if (status.syncing) return { icon: 'i-lucide-refresh-cw', text: 'Syncing', tone: 'text-muted' }
  if (pendingCount.value) return { icon: 'i-lucide-cloud-upload', text: `${pendingCount.value} saved on device`, tone: 'text-warning' }
  return { icon: 'i-lucide-cloud-check', text: 'Synced', tone: 'text-muted' }
})
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
    :class="view.tone"
    :aria-label="`Sync status: ${view.text}. Sync now`"
    @click="sync()"
  >
    <UIcon :name="view.icon" class="size-4" :class="status.syncing ? 'animate-spin motion-reduce:animate-none' : ''" />
    <span aria-live="polite">{{ view.text }}</span>
  </button>
</template>
