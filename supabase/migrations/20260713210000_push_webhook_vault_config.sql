-- Hosted projects do not allow the API postgres role to set arbitrary
-- app.settings.* GUC values. Keep both webhook values encrypted in Vault.

create or replace function extensions.notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select ds.decrypted_secret
  into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'push_edge_url'
  order by ds.created_at desc
  limit 1;

  select ds.decrypted_secret
  into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'push_webhook_secret'
  order by ds.created_at desc
  limit 1;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hither-webhook-secret', v_secret
    ),
    body := payload
  );
end;
$$;

revoke all on function extensions.notify_push(jsonb)
  from public, anon, authenticated;
