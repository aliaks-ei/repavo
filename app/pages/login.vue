<script setup lang="ts">
definePageMeta({ hideNav: true })

const sb = useSupabase()
const route = useRoute()
const step = ref<'email' | 'code'>('email')
const email = ref('')
const code = ref('')
const busy = ref(false)
const error = ref(route.query.error ? String(route.query.error) : '')
const resendAt = ref(0)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => clearInterval(ticker))
const resendIn = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)))

const offline = () => !navigator.onLine && 'You are offline. Signing in needs a connection.'

async function sendCode() {
  busy.value = true
  error.value = ''
  const { error: err } = await sb.auth.signInWithOtp({
    email: email.value.trim(),
    options: { shouldCreateUser: true, emailRedirectTo: window.location.origin }
  })
  busy.value = false
  if (err) {
    error.value = offline() || err.message
    return
  }
  step.value = 'code'
  code.value = ''
  // Supabase allows one code request per 60 seconds.
  resendAt.value = Date.now() + 60_000
  clearInterval(ticker)
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
}

async function verify() {
  busy.value = true
  error.value = ''
  const { error: err } = await sb.auth.verifyOtp({ email: email.value.trim(), token: code.value.replace(/\D/g, ''), type: 'email' })
  busy.value = false
  if (err) {
    error.value = offline() || 'That code did not work. Check the latest email, or send a new code.'
    return
  }
  await navigateTo('/')
}

async function google() {
  error.value = ''
  // Avoid sending the user to a raw provider error page when Google is not turned on in Supabase.
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  const settings = await $fetch<{ external?: Record<string, boolean> }>(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } }).catch(() => null)
  if (settings && !settings.external?.google) {
    error.value = 'Google sign-in is not turned on yet. Use an email code for now.'
    return
  }
  const { error: err } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  if (err) error.value = offline() || err.message
}
</script>

<template>
  <main class="flex min-h-dvh flex-col justify-center px-4 pt-safe pb-safe">
    <h1 class="font-display text-6xl leading-none font-extrabold text-highlighted">
      Repavo
    </h1>
    <p class="mt-2 mb-8 text-muted">
      Your training log, programme and next week in one place.
    </p>

    <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendCode">
      <UFormField label="Email" name="email">
        <UInput v-model="email" type="email" autocomplete="email" required size="xl" class="w-full" />
      </UFormField>
      <UButton type="submit" block size="xl" icon="i-lucide-mail" :loading="busy">
        Email me a sign-in code
      </UButton>
    </form>

    <form v-else class="space-y-4" @submit.prevent="verify">
      <p>
        We sent a code to <span class="font-bold">{{ email }}</span>. Enter it here. On a computer you can also open the link in the email.
      </p>
      <label class="block">
        <span class="text-sm font-medium">Sign-in code</span>
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          maxlength="10"
          required
          class="num mt-1 h-16 w-full rounded-md border border-default bg-default text-center text-4xl font-extrabold tracking-[0.3em] text-highlighted outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
      </label>
      <UButton type="submit" block size="xl" :loading="busy" :disabled="code.replace(/\D/g, '').length < 6">
        Sign in
      </UButton>
      <div class="flex justify-between">
        <UButton variant="link" color="neutral" @click="step = 'email'">
          Use a different email
        </UButton>
        <UButton variant="link" color="neutral" :disabled="resendIn > 0 || busy" @click="sendCode">
          {{ resendIn > 0 ? `New code in ${resendIn} s` : 'Send a new code' }}
        </UButton>
      </div>
    </form>

    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

    <USeparator label="or" class="my-6" />

    <UButton block size="xl" color="neutral" variant="outline" @click="google">
      <svg viewBox="0 0 48 48" class="size-5" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </UButton>
  </main>
</template>
