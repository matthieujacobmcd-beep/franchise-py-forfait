-- Franchise PY · Suivi forfait jours (218 jours, cycle juin → mai)
-- À exécuter une fois dans Supabase : SQL Editor > New query > Run.
-- La sécurité repose sur la RLS (Row Level Security) : chaque salarié ne lit et n'écrit que ses lignes,
-- l'administration (DRH) voit tout. Même si quelqu'un contourne l'interface, la base refuse.

create extension if not exists pgcrypto;

-- ============ Tables ============
create table if not exists public.collaborateurs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete set null,
  email       text,
  nom         text not null,
  fonction    text,
  categorie   text check (categorie in ('Directeur','Cadre')),
  restaurant  text,
  n1          text,
  role        text not null default 'employe' check (role in ('employe','admin')),
  actif       boolean not null default true,
  entretien   date,
  created_at  timestamptz not null default now()
);
create unique index if not exists collaborateurs_email_uq on public.collaborateurs (lower(email)) where email is not null;

create table if not exists public.parametres (
  id        int primary key default 1 check (id = 1),
  cycle     int  not null default 2026,
  plafond   int  not null default 218,
  cp        int  not null default 30,
  rtt       int  not null default 8,
  preavis   int  not null default 60,
  arret_compte boolean not null default true
);
insert into public.parametres (id) values (1) on conflict do nothing;

create table if not exists public.quotas (
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  cycle   int not null,
  plafond int,
  cp      int,
  rtt     int,
  primary key (collaborateur_id, cycle)
);

create table if not exists public.jours (
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  jour  date not null,
  prevu text check (prevu in ('JT','OFF','RTT','CP','JF','AM','AT')),
  reel  text check (reel  in ('JT','OFF','RTT','CP','JF','AM','AT')),
  primary key (collaborateur_id, jour)
);

create table if not exists public.validations (
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  mois        text not null check (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  valide      boolean not null default false,
  signe_le    timestamptz,
  empreinte   text,
  signature   jsonb,
  visa        jsonb,
  primary key (collaborateur_id, mois),
  constraint valide_signe check (not valide or (empreinte is not null and signature is not null))
);

-- ============ Fonctions utilitaires (SECURITY DEFINER : pas de récursion RLS) ============
create or replace function public.mon_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.collaborateurs where user_id = auth.uid() and actif limit 1
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and actif from public.collaborateurs where user_id = auth.uid() limit 1), false)
$$;

-- Rattache le compte connecté à sa fiche, par adresse e-mail confirmée.
create or replace function public.lier_compte() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then return; end if;
  update public.collaborateurs
     set user_id = auth.uid()
   where user_id is null
     and email is not null
     and lower(email) = lower(auth.jwt() ->> 'email');
end $$;

-- ============ Verrous métier côté serveur ============
-- Un mois validé ne peut plus être modifié par le salarié (seule l'administration le peut).
create or replace function public.verrou_mois() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; j date;
begin
  if public.est_admin() then return coalesce(new, old); end if;
  cid := coalesce(new.collaborateur_id, old.collaborateur_id);
  j   := coalesce(new.jour, old.jour);
  if exists (select 1 from public.validations v where v.collaborateur_id = cid and v.mois = to_char(j, 'YYYY-MM') and v.valide) then
    raise exception 'Mois validé : modification impossible. Contactez la DRH.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists jours_verrou on public.jours;
create trigger jours_verrou before insert or update or delete on public.jours
  for each row execute function public.verrou_mois();

-- Validation : horodatage serveur, visa réservé à l'administration, mois validé figé.
create or replace function public.validations_garde() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.est_admin() then
    if new.valide and (tg_op = 'INSERT' or not old.valide) then new.signe_le := now(); end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.valide then
    raise exception 'Mois déjà validé. Contactez la DRH.' using errcode = '42501';
  end if;
  if new.visa is not null then
    raise exception 'Le visa est réservé à la DRH.' using errcode = '42501';
  end if;
  if new.valide then new.signe_le := now(); end if;
  return new;
end $$;
drop trigger if exists validations_garde on public.validations;
create trigger validations_garde before insert or update on public.validations
  for each row execute function public.validations_garde();

-- ============ RLS ============
alter table public.collaborateurs enable row level security;
alter table public.parametres     enable row level security;
alter table public.quotas         enable row level security;
alter table public.jours          enable row level security;
alter table public.validations    enable row level security;

revoke all on all tables in schema public from anon;
revoke execute on function public.lier_compte() from public, anon;
grant  execute on function public.lier_compte() to authenticated;

-- collaborateurs : lecture de sa propre fiche ou de toutes (admin) ; écriture admin uniquement
drop policy if exists collab_select on public.collaborateurs;
create policy collab_select on public.collaborateurs for select to authenticated
  using (public.est_admin() or user_id = auth.uid());
drop policy if exists collab_write on public.collaborateurs;
create policy collab_write on public.collaborateurs for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- paramètres : lecture pour tout compte connecté, écriture admin
drop policy if exists param_select on public.parametres;
create policy param_select on public.parametres for select to authenticated using (true);
drop policy if exists param_write on public.parametres;
create policy param_write on public.parametres for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- quotas : lecture des siens ou de tous (admin) ; écriture admin
drop policy if exists quotas_select on public.quotas;
create policy quotas_select on public.quotas for select to authenticated
  using (public.est_admin() or collaborateur_id = public.mon_id());
drop policy if exists quotas_write on public.quotas;
create policy quotas_write on public.quotas for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- jours : le salarié lit et écrit les siens ; l'admin lit tout et peut corriger
drop policy if exists jours_select on public.jours;
create policy jours_select on public.jours for select to authenticated
  using (public.est_admin() or collaborateur_id = public.mon_id());
drop policy if exists jours_own_write on public.jours;
create policy jours_own_write on public.jours for all to authenticated
  using (collaborateur_id = public.mon_id()) with check (collaborateur_id = public.mon_id());
drop policy if exists jours_admin_write on public.jours;
create policy jours_admin_write on public.jours for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- validations : le salarié lit les siennes, crée / met à jour tant que le mois n'est pas validé ; l'admin gère tout
drop policy if exists val_select on public.validations;
create policy val_select on public.validations for select to authenticated
  using (public.est_admin() or collaborateur_id = public.mon_id());
drop policy if exists val_own_insert on public.validations;
create policy val_own_insert on public.validations for insert to authenticated
  with check (collaborateur_id = public.mon_id());
drop policy if exists val_own_update on public.validations;
create policy val_own_update on public.validations for update to authenticated
  using (collaborateur_id = public.mon_id() and not valide) with check (collaborateur_id = public.mon_id());
drop policy if exists val_admin on public.validations;
create policy val_admin on public.validations for all to authenticated
  using (public.est_admin()) with check (public.est_admin());
