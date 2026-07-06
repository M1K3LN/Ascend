-- Ascend 0002: RLS deny-all on every application table.
-- No policies are created: RLS enabled + zero policies = deny-all for anon /
-- authenticated. All access goes through the server (service role / postgres),
-- which bypasses RLS. Re-runnable; also revokes direct grants from client roles.

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Belt and braces: client roles get no direct table access at all.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke usage on schema public from anon, authenticated;
