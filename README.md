# Repavo

Phone-first training log PWA: programme import and review, offline set logging, weekly planning, progress and an assistant.

Stack: Nuxt 4 (SPA) + Nuxt UI, Supabase (Auth, Postgres, private Storage), OpenAI Responses API, Cloudflare Workers.

## Setup

1. `npm install` (Node 24, see `.tool-versions`)
2. `cp .env.example .env`
3. Set `NUXT_OPENAI_API_KEY` in `.env`
4. `npm run dev` → http://localhost:3000

Schema: `supabase/migrations/20261002000000_init.sql` (already applied to project `vecinruxgehbxzxxnlvw`).

## Models

- `NUXT_OPENAI_MODEL` (default `gpt-6.1-sol`): programme interpretation and next-week drafts
- `NUXT_OPENAI_CHAT_MODEL` (default `gpt-6-luna`): assistant chat
- Both run with `reasoning.effort: "medium"`

## Sign-in setup (Supabase dashboard)

Sign-in is an emailed 6-digit code or Google. Codes work inside the installed iPhone app; a magic link would open Safari instead.

1. Authentication → Emails → **Magic Link** and **Confirm signup** templates: add the code, e.g.
   `<p>Your Repavo code: <strong>{{ .Token }}</strong></p><p>Or <a href="{{ .ConfirmationURL }}">sign in on this device</a>.</p>`
   (new users get Confirm signup on their first code)
2. Google: create an OAuth client (Web) in Google Cloud, add `https://vecinruxgehbxzxxnlvw.supabase.co/auth/v1/callback` as redirect URI, then enable Authentication → Sign In / Providers → Google with its client ID and secret
3. Authentication → URL Configuration: set Site URL to the app URL and add `http://localhost:3000` and the workers.dev URL to Redirect URLs

## Deploy (Cloudflare Workers)

1. `npm run deploy` (builds, then `wrangler deploy` as worker `repavo`)
2. `npx wrangler secret put NUXT_OPENAI_API_KEY`
3. Add the workers.dev URL in Supabase (see Sign-in setup, step 3)

The Supabase URL and publishable key are read from `.env` at build time.

## Checks

- `npm test`: shared training logic (WHOOP export, week summary, programme departures, variants)
- `npm run typecheck`
