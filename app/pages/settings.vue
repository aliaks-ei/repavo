<script setup lang="ts">
const sb = useSupabase()
const toast = useToast()
const colorMode = useColorMode()
const { state, status, pendingCount, sync, reset } = useTraining()
const email = ref('')
onMounted(async () => {
  email.value = (await sb.auth.getSession()).data.session?.user.email ?? ''
})

async function saveSetting(patch: Partial<typeof state.settings>) {
  const before = { ...state.settings }
  Object.assign(state.settings, patch)
  const { error } = await sb.from('settings').upsert({ user_id: state.userId, ...state.settings, updated_at: new Date().toISOString() })
  if (error) {
    Object.assign(state.settings, before)
    toast.add({ title: 'Not saved', description: apiError(error), color: 'error' })
  }
}

const confirmSignOut = ref(false)
async function signOut() {
  await sb.auth.signOut()
  localStorage.removeItem('repavo:uid')
  reset()
  await navigateTo('/login')
}
</script>

<template>
  <main class="px-4 pt-safe">
    <header class="flex items-center gap-2 pt-2">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" to="/" aria-label="Back to Train" />
      <h1 class="font-display text-4xl font-extrabold text-highlighted">
        Settings
      </h1>
    </header>

    <section class="mt-6 space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p id="proposals-label" class="font-bold">
            Suggest changes outside the programme
          </p>
          <p class="text-sm text-muted">
            When off, Prepare next week keeps the programme exactly as written.
          </p>
        </div>
        <USwitch
          :model-value="state.settings.proposals_enabled"
          aria-labelledby="proposals-label"
          :disabled="!status.online"
          @update:model-value="v => saveSetting({ proposals_enabled: v })"
        />
      </div>

      <UFormField label="Weight unit" description="Used for new sets. Logged sets keep their own unit.">
        <URadioGroup
          :model-value="state.settings.unit"
          orientation="horizontal"
          :items="[{ label: 'Kilograms', value: 'kg' }, { label: 'Pounds', value: 'lb' }]"
          :disabled="!status.online"
          @update:model-value="v => saveSetting({ unit: v as 'kg' | 'lb' })"
        />
      </UFormField>

      <UFormField label="Appearance">
        <URadioGroup
          v-model="colorMode.preference"
          orientation="horizontal"
          :items="[{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]"
        />
      </UFormField>
    </section>

    <section class="mt-8 rounded-xl border border-default bg-elevated p-4">
      <h2 class="font-bold">
        Data on this device
      </h2>
      <p class="mt-1 text-sm">
        <template v-if="pendingCount">
          {{ pendingCount }} changes are saved on this device and not synced yet.
        </template>
        <template v-else>
          Everything is synced.
        </template>
        <template v-if="state.lastSync">
          Last sync {{ new Date(state.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) }}.
        </template>
      </p>
      <p v-if="status.error" class="mt-1 text-sm text-error">
        Last sync error: {{ status.error }}
      </p>
      <p class="mt-2 text-sm text-muted">
        The phone can clear app storage when space is low, so unsynced sets are not permanent. Open the app with a connection after training to sync them.
      </p>
      <UButton class="mt-3" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="status.syncing" :disabled="!status.online" @click="sync()">
        Sync now
      </UButton>
    </section>

    <section class="mt-8 space-y-2 pb-8">
      <UButton block color="neutral" variant="ghost" to="/programmes" icon="i-lucide-file-text" class="justify-start">
        Programmes
      </UButton>
      <UButton block color="neutral" variant="ghost" to="/week" icon="i-lucide-calendar-range" class="justify-start">
        All weeks
      </UButton>
      <p class="pt-4 text-sm text-muted">
        Signed in as {{ email }}
      </p>
      <UButton block color="error" variant="soft" icon="i-lucide-log-out" @click="pendingCount ? (confirmSignOut = true) : signOut()">
        Sign out
      </UButton>
    </section>

    <UModal v-model:open="confirmSignOut" title="Sign out with unsynced sets?" :description="`${pendingCount} changes are only on this device and will be lost.`">
      <template #footer>
        <UButton color="neutral" variant="outline" @click="confirmSignOut = false">
          Stay signed in
        </UButton>
        <UButton color="error" @click="signOut">
          Sign out and lose them
        </UButton>
      </template>
    </UModal>
  </main>
</template>
