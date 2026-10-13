-- Migration : rôles de consultation (superviseur, lecteur), annulation de la validation lors d'une modification par la DRH.
-- À exécuter une fois sur une base déjà créée avec schema.sql (le fichier schema.sql contient déjà cet état final).

alter table public.collaborateurs drop constraint if exists collaborateurs_role_check;
alter table public.collaborateurs add constraint collaborateurs_role_check
  check (role in ('employe','admin','superviseur','lecteur'));

alter table public.validations add column if not exists reouvert_le timestamptz;

create or replace function public.est_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = r and actif from public.collaborateurs where user_id = auth.uid() limit 1), false)
$$;

-- Une modification d'un jour par l'administration annule la validation du mois (revalidation par le collaborateur).
create or replace function public.verrou_mois() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; j date;
begin
  cid := coalesce(new.collaborateur_id, old.collaborateur_id);
  j   := coalesce(new.jour, old.jour);
  if public.est_admin() then
    update public.validations
       set valide = false, visa = null, signature = null, empreinte = null, signe_le = null, reouvert_le = now()
     where collaborateur_id = cid and mois = to_char(j, 'YYYY-MM') and valide;
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.validations v where v.collaborateur_id = cid and v.mois = to_char(j, 'YYYY-MM') and v.valide) then
    raise exception 'Mois validé : modification impossible. Contactez la DRH.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.validations_garde() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.est_admin() then
    if new.valide and (tg_op = 'INSERT' or not old.valide) then new.signe_le := now(); new.reouvert_le := null; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.valide then
    raise exception 'Mois déjà validé. Contactez la DRH.' using errcode = '42501';
  end if;
  if new.visa is not null then
    raise exception 'Le visa est réservé à la DRH.' using errcode = '42501';
  end if;
  if new.valide then new.signe_le := now(); new.reouvert_le := null; end if;
  return new;
end $$;

-- Consultation : les superviseurs voient les directeurs, les lecteurs voient tous les plannings.
-- Ni adresses e-mail, ni entretiens, ni déclarations : les arrêts maladie / accidents du travail sont masqués en « ABS ».
create or replace function public.consultation_collaborateurs()
returns table (id uuid, nom text, fonction text, categorie text, restaurant text, n1 text)
language sql stable security definer set search_path = public as $$
  select c.id, c.nom, c.fonction, c.categorie, c.restaurant, c.n1
    from public.collaborateurs c
   where c.actif and (public.est_role('lecteur') or (public.est_role('superviseur') and c.categorie = 'Directeur'))
$$;

create or replace function public.consultation_quotas()
returns table (collaborateur_id uuid, cycle int, plafond int, cp int, rtt int)
language sql stable security definer set search_path = public as $$
  select q.collaborateur_id, q.cycle, q.plafond, q.cp, q.rtt
    from public.quotas q join public.collaborateurs c on c.id = q.collaborateur_id
   where c.actif and (public.est_role('lecteur') or (public.est_role('superviseur') and c.categorie = 'Directeur'))
$$;

create or replace function public.consultation_jours(d1 date, d2 date)
returns table (collaborateur_id uuid, jour date, prevu text, reel text)
language sql stable security definer set search_path = public as $$
  select j.collaborateur_id, j.jour,
         case when j.prevu in ('AM','AT') then 'ABS' else j.prevu end,
         case when j.reel  in ('AM','AT') then 'ABS' else j.reel  end
    from public.jours j join public.collaborateurs c on c.id = j.collaborateur_id
   where j.jour between d1 and d2 and c.actif
     and (public.est_role('lecteur') or (public.est_role('superviseur') and c.categorie = 'Directeur'))
$$;

revoke execute on function public.consultation_collaborateurs() from public, anon;
revoke execute on function public.consultation_quotas() from public, anon;
revoke execute on function public.consultation_jours(date, date) from public, anon;
grant execute on function public.consultation_collaborateurs() to authenticated;
grant execute on function public.consultation_quotas() to authenticated;
grant execute on function public.consultation_jours(date, date) to authenticated;
