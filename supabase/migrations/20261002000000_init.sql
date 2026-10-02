-- Owned records. Every table has user_id and owner-only RLS.

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  proposals_enabled boolean not null default true,
  unit text not null default 'kg' check (unit in ('kg', 'lb')),
  updated_at timestamptz not null default now()
);

-- Uploaded documents or pasted programme text.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  kind text not null check (kind in ('text', 'pdf', 'docx')),
  storage_path text,
  text_content text,
  created_at timestamptz not null default now()
);

-- Interpreted programme versions. Approved versions are not edited; a new version is created instead.
create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  source_id uuid not null references public.sources on delete cascade,
  version int not null default 1,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- One training week. Advanced manually through Prepare next week.
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  programme_id uuid not null references public.programmes on delete cascade,
  week_number int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'discarded')),
  plan jsonb not null,
  proposals jsonb not null default '[]',
  comment text,
  summary jsonb,
  notes text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz
);
create unique index blocks_one_active on public.blocks (user_id) where status = 'active';

-- Actual sessions. IDs are generated on the device so repeated sync is idempotent.
create table public.workouts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  block_id uuid not null references public.blocks on delete cascade,
  session_key text not null,
  session_name text not null,
  status text not null check (status in ('in_progress', 'interrupted', 'completed', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  rescheduled_for date,
  abs_included boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

create table public.sets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  workout_id uuid not null references public.workouts on delete cascade,
  exercise_key text not null,
  exercise_name text not null,
  variant text,
  equipment text not null,
  set_index int not null,
  status text not null check (status in ('done', 'skipped')),
  weight numeric,
  unit text not null default 'kg',
  reps int,
  target_weight numeric,
  target_reps int,
  note text,
  performed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sets_workout on public.sets (workout_id);
create index sets_exercise on public.sets (user_id, exercise_name, variant);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  refs jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages (conversation_id, created_at);

-- Persisted status for document interpretation and plan drafting.
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('interpret', 'draft')),
  subject_id uuid not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  result_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_jobs_subject on public.ai_jobs (subject_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['settings','sources','programmes','blocks','workouts','sets','conversations','messages','ai_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Foreign-key indexes.
create index programmes_source on public.programmes (source_id);
create index blocks_programme on public.blocks (programme_id);
create index workouts_block on public.workouts (block_id);
create index conversations_user on public.conversations (user_id, updated_at desc);
create index sources_user on public.sources (user_id);
create index programmes_user on public.programmes (user_id);
create index workouts_user on public.workouts (user_id);
create index messages_user on public.messages (user_id);
create index ai_jobs_user on public.ai_jobs (user_id);

-- Private bucket for programme documents. Path: <user_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 20971520, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown'
]);

create policy sources_owner on storage.objects for all to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
