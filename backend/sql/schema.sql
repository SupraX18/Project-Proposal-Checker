create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists updated_at timestamptz not null default now();
alter table users alter column role set default 'student';

do $$
begin
  alter table users drop constraint if exists users_role_check;
  alter table users add constraint users_role_check check (role in ('student', 'reviewer', 'admin'));
exception
  when undefined_table then null;
end $$;

create table if not exists proposals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  domain text not null,
  scheme text not null default '',
  status text not null default 'Submitted',
  student_id uuid not null unique references users(id) on delete cascade,
  reviewer_id uuid references users(id) on delete set null,
  abstract text not null,
  problem text not null,
  objectives text[] not null default '{}',
  methodology text not null,
  tech_stack text[] not null default '{}',
  team jsonb not null default '[]'::jsonb,
  review_notes text not null default '',
  submitted_at timestamptz not null default now(),
  last_status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table proposals add column if not exists scheme text not null default '';
alter table proposals add column if not exists reviewer_id uuid references users(id) on delete set null;
alter table proposals add column if not exists team jsonb not null default '[]'::jsonb;
alter table proposals add column if not exists review_notes text not null default '';
alter table proposals add column if not exists submitted_at timestamptz not null default now();
alter table proposals add column if not exists last_status_changed_at timestamptz not null default now();
alter table proposals alter column status set default 'Submitted';

do $$
begin
  alter table proposals drop constraint if exists proposals_status_check;
exception
  when undefined_table then null;
end $$;

update proposals set status = 'Submitted' where status = 'Pending';
update proposals set status = 'Under Review' where status = 'In Review';
update proposals set status = 'Changes Requested' where status = 'Revision Requested';
update proposals set submitted_at = coalesce(submitted_at, created_at, now());
update proposals set last_status_changed_at = coalesce(last_status_changed_at, updated_at, created_at, now());

do $$
begin
  alter table proposals add constraint proposals_status_check check (
    status in ('Draft', 'Submitted', 'Under Review', 'Changes Requested', 'Approved', 'Rejected')
  );
exception
  when duplicate_object then null;
  when undefined_table then null;
end $$;

create index if not exists proposals_student_id_idx on proposals(student_id);
create index if not exists proposals_status_idx on proposals(status);
create index if not exists proposals_updated_at_idx on proposals(updated_at desc);

create table if not exists folders (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  parent_id uuid references folders(id) on delete cascade,
  proposal_id uuid not null references proposals(id) on delete cascade,
  student_id uuid not null references users(id) on delete cascade,
  scheme text not null default '',
  color text not null default '#0f766e',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table folders add column if not exists proposal_id uuid references proposals(id) on delete cascade;
alter table folders add column if not exists scheme text not null default '';
alter table folders add column if not exists color text not null default '#0f766e';

create index if not exists folders_student_id_idx on folders(student_id);
create index if not exists folders_proposal_id_idx on folders(proposal_id);
create index if not exists folders_parent_id_idx on folders(parent_id);

create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  uploaded_by uuid references users(id) on delete set null,
  name text not null,
  path text not null default 'db',
  storage_mode text not null default 'database',
  data bytea,
  mime_type text not null default 'application/octet-stream',
  size integer not null default 0,
  category text not null default 'supporting-document',
  description text not null default '',
  uploaded_at timestamptz not null default now()
);

alter table documents add column if not exists uploaded_by uuid references users(id) on delete set null;
alter table documents add column if not exists storage_mode text not null default 'database';
alter table documents add column if not exists category text not null default 'supporting-document';
alter table documents add column if not exists description text not null default '';
alter table documents alter column path set default 'db';
alter table documents alter column mime_type set default 'application/octet-stream';

create index if not exists documents_proposal_id_idx on documents(proposal_id);
create index if not exists documents_folder_id_idx on documents(folder_id);
create index if not exists documents_uploaded_at_idx on documents(uploaded_at desc);

create table if not exists proposal_status_history (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  changed_by uuid references users(id) on delete set null,
  from_status text,
  to_status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists proposal_status_history_proposal_id_idx on proposal_status_history(proposal_id);
create index if not exists proposal_status_history_created_at_idx on proposal_status_history(created_at desc);

create table if not exists activity_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx on activity_logs(created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row
execute function set_updated_at();

drop trigger if exists proposals_set_updated_at on proposals;
create trigger proposals_set_updated_at
before update on proposals
for each row
execute function set_updated_at();

drop trigger if exists folders_set_updated_at on folders;
create trigger folders_set_updated_at
before update on folders
for each row
execute function set_updated_at();
