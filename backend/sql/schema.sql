-- Minimal schema for Proposal Checker (PERN demo)

create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('student', 'admin', 'coadmin')),
  created_at timestamptz not null default now()
);

create table if not exists proposals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  domain text not null,
  status text not null check (status in ('Pending', 'In Review', 'Approved', 'Revision Requested', 'Rejected')),
  student_id uuid not null references users(id) on delete cascade,
  reviewer_id uuid references users(id) on delete set null,
  abstract text not null,
  problem text not null,
  objectives text[] not null default '{}',
  methodology text not null,
  tech_stack text[] not null default '{}',
  team jsonb not null default '[]'::jsonb,
  document_name text,
  document_path text,
  document_data bytea,
  document_mime_type text,
  document_size integer,
  document_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposals_student_id_idx on proposals(student_id);
create index if not exists proposals_status_idx on proposals(status);

create table if not exists proposal_evaluations (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null unique references proposals(id) on delete cascade,
  evaluator_id uuid not null references users(id) on delete cascade,
  criteria jsonb not null,
  overall_score numeric(4,1) not null,
  recommendation text not null check (recommendation in ('Approve', 'Revise', 'Reject')),
  strengths text not null,
  risks text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposal_evaluations_evaluator_id_idx on proposal_evaluations(evaluator_id);

create table if not exists workspace_settings (
  id text primary key,
  submission_deadline timestamptz,
  review_deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into workspace_settings (id)
values ('default')
on conflict (id) do nothing;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists proposals_set_updated_at on proposals;
create trigger proposals_set_updated_at
before update on proposals
for each row
execute function set_updated_at();

drop trigger if exists proposal_evaluations_set_updated_at on proposal_evaluations;
create trigger proposal_evaluations_set_updated_at
before update on proposal_evaluations
for each row
execute function set_updated_at();

drop trigger if exists workspace_settings_set_updated_at on workspace_settings;
create trigger workspace_settings_set_updated_at
before update on workspace_settings
for each row
execute function set_updated_at();

