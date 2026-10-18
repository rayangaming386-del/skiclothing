-- Privé-opslag voor afspraakfoto's en profielfoto's (alleen actieve teamleden).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage-schema ontbreekt (lokale test zonder Supabase), overgeslagen';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('appointment-photos', 'appointment-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
    ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy "team leest foto's" on storage.objects for select to authenticated
      using (bucket_id in ('appointment-photos', 'avatars') and public.is_active_member())
  $p$;
  execute $p$
    create policy "team uploadt afspraakfoto's" on storage.objects for insert to authenticated
      with check (bucket_id = 'appointment-photos' and public.is_active_member())
  $p$;
  execute $p$
    create policy "eigen profielfoto uploaden" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and public.is_active_member() and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$
    create policy "eigen profielfoto vervangen" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and public.is_active_member() and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$
    create policy "eigen upload verwijderen" on storage.objects for delete to authenticated
      using (bucket_id in ('appointment-photos', 'avatars') and public.is_active_member()
             and (owner_id = auth.uid()::text or public.is_owner()))
  $p$;
end $$;
