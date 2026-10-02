<script setup lang="ts">
import { MotionConfig } from 'motion-v'

const route = useRoute()
// Screens with their own bottom actions set `hideNav` in page meta.
const showNav = computed(() => !route.meta.hideNav)
</script>

<template>
  <UApp :toaster="{ position: 'top-center' }">
    <MotionConfig reduced-motion="user">
      <NuxtPwaManifest />
      <div class="mx-auto min-h-dvh max-w-xl" :class="showNav ? 'pb-24' : ''">
        <NuxtPage />
      </div>
      <AppNav v-if="showNav" />
    </MotionConfig>
  </UApp>
</template>
