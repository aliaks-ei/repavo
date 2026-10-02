-- A programme source can combine pasted text with several uploaded files.
alter table public.sources add column files jsonb not null default '[]';
update public.sources
set files = jsonb_build_array(jsonb_build_object('path', storage_path, 'name', title || '.' || kind, 'kind', kind))
where storage_path is not null;
alter table public.sources drop constraint sources_kind_check;
alter table public.sources add constraint sources_kind_check check (kind in ('text', 'pdf', 'docx', 'mixed'));
