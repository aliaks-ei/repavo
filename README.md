# Repavo

A phone-first training log for following a purchased strength programme.

Upload or paste your programme, review what was read, and train from it. Log sets one-handed at the gym, even offline. Each week, the app drafts the next week from your results and the programme's rules, and asks before it departs from the programme.

## What it does

- **Programmes:** upload PDF, Word or text files and paste notes in one go. The programme is read into weeks, sessions, exercises, sets and reps, in English. Fix it by hand or ask for a change, then approve it.
- **Train:** the next session is one tap away. Prescribed weights and reps are prefilled; confirm a set with one tap, correct it, skip it, pause and resume. Finish with **Copy for WHOOP**.
- **Offline:** every set is saved on the phone first and synced when online, without duplicates.
- **Weekly planning:** Prepare next week summarises done and missed work, then drafts targets from the programme. Changes outside the programme are proposals you accept or reject.
- **Progress:** per-exercise history and trend within one rep range. Exercise variants stay separate.
- **Assistant:** answers questions about your programme, its files and your logged sessions. Training topics only; it never changes your plan.

## Stack

- Nuxt 4 (client-rendered PWA), Nuxt UI, Tailwind CSS, Motion for Vue, Unovis
- Supabase: Auth (email code, Google), Postgres with owner-only row-level security, private Storage
- OpenAI Responses API with Structured Outputs and tool calling
- Cloudflare Workers

## Getting started

Requirements: Node 24 (see `.tool-versions`), a Supabase project, an OpenAI API key.

1. Install dependencies:
   ```sh
   npm install
   ```
2. Create your env file:
   ```sh
   cp .env.example .env
   ```
3. Fill in `.env`:

   | Variable | Purpose |
   | --- | --- |
   | `NUXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NUXT_PUBLIC_SUPABASE_KEY` | Supabase publishable key |
   | `NUXT_OPENAI_API_KEY` | OpenAI key, server only |
   | `NUXT_OPENAI_MODEL` | Reading programmes and drafting weeks (default `gpt-6.1-sol`) |
   | `NUXT_OPENAI_CHAT_MODEL` | Assistant chat (default `gpt-6-luna`) |

4. Apply the database migrations in `supabase/migrations/` to your project, in order.
5. Set up sign-in (below).
6. Start the dev server:
   ```sh
   npm run dev
   ```
7. Open http://localhost:3000.

## Sign-in setup (Supabase dashboard)

Sign-in uses a 6-digit email code or Google. A code works inside an installed iPhone web app; a magic link would open Safari instead.

1. Authentication → Emails: add the code to the **Magic Link** and **Confirm signup** templates, e.g.
   `<p>Your Repavo code: <strong>{{ .Token }}</strong></p><p>Or <a href="{{ .ConfirmationURL }}">sign in on this device</a>.</p>`
2. Google: create a Web OAuth client in Google Cloud with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, then enable Authentication → Sign In / Providers → Google with its client ID and secret.
3. Authentication → URL Configuration: set Site URL to the app URL and add `http://localhost:3000` and the deployed URL to Redirect URLs.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm test` | Tests for the shared training logic |
| `npm run typecheck` | Type check |
| `npm run build` | Production build for Cloudflare Workers |
| `npm run deploy` | Build and deploy with Wrangler |

## Deploy

1. `npm run deploy` (worker name `repavo`).
2. `npx wrangler secret put NUXT_OPENAI_API_KEY`
3. Add the workers.dev URL to Supabase Redirect URLs.

The Supabase URL and publishable key are read from `.env` at build time.

## Project layout

```
app/        pages, components, offline store (composables/useTraining.ts)
server/     API routes: interpret, revise, draft, chat
shared/     training logic used by app and server, with tests
supabase/   database migrations
```
