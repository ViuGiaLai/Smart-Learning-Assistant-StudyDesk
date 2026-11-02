-- Defense in depth for Supabase.
--
-- The app talks to FastAPI only. FastAPI connects as the `postgres` role,
-- which bypasses RLS. The publishable key is used server-side for GoTrue, but
-- it can also reach PostgREST, so anonymous/authenticated roles must not be
-- able to read or write application tables directly.
--
-- Run after the backend has created the schema (startup calls init_db).

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'users',
        'devices',
        'sensor_readings',
        'study_plans',
        'study_sessions',
        'notifications',
        'ai_conversations'
    ]
    loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('alter table public.%I enable row level security', table_name);
            execute format(
                'revoke all on table public.%I from anon, authenticated',
                table_name
            );
        end if;
    end loop;
end
$$;

-- Future tables created by the same role must be locked down too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
