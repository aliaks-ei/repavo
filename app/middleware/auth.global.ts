export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const { data } = await useSupabase().auth.getSession()
  let uid = data.session?.user.id
  // Offline with an expired token: keep the device's data usable; sync resumes after sign-in refreshes.
  if (!uid && !navigator.onLine) uid = localStorage.getItem('repavo:uid') ?? undefined
  if (!uid) {
    // Failed email-link or Google redirects return an error in the URL; show it on the login screen.
    const error = new URLSearchParams(to.hash.slice(1)).get('error_description') ?? to.query.error_description
    return navigateTo({ path: '/login', query: error ? { error: String(error) } : {} })
  }
  localStorage.setItem('repavo:uid', uid)
  await useTraining().load(uid)
})
