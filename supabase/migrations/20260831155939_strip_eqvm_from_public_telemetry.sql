-- telemetry_samples is intentionally public. Remove every historical EQVM
-- claim and reject future samples containing one; longitudinal experiment
-- telemetry has no need to expose canonical Task QI, DQI, or PQI.
create or replace function pg_temp.strip_eqvm_claims(value jsonb)
returns jsonb
language plpgsql
immutable
strict
parallel safe
as $$
declare
  stripped jsonb;
begin
  case jsonb_typeof(value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          entry.key,
          pg_temp.strip_eqvm_claims(entry.value)
          order by entry.key
        ),
        '{}'::jsonb
      )
      into stripped
      from jsonb_each(value) as entry
      where entry.key not in ('qi', 'dqi', 'pqi');
      return stripped;
    when 'array' then
      select coalesce(
        jsonb_agg(
          pg_temp.strip_eqvm_claims(element.value)
          order by element.ordinality
        ),
        '[]'::jsonb
      )
      into stripped
      from jsonb_array_elements(value) with ordinality as element(value, ordinality);
      return stripped;
    else
      return value;
  end case;
end;
$$;

update public.telemetry_samples
set payload = pg_temp.strip_eqvm_claims(payload)
where jsonb_path_exists(payload, '$.**.qi')
   or jsonb_path_exists(payload, '$.**.dqi')
   or jsonb_path_exists(payload, '$.**.pqi');

alter table public.telemetry_samples
  drop constraint if exists telemetry_samples_no_eqvm_claims;

alter table public.telemetry_samples
  add constraint telemetry_samples_no_eqvm_claims
  check (
    not jsonb_path_exists(payload, '$.**.qi')
    and not jsonb_path_exists(payload, '$.**.dqi')
    and not jsonb_path_exists(payload, '$.**.pqi')
  ) not valid;

alter table public.telemetry_samples
  validate constraint telemetry_samples_no_eqvm_claims;

comment on constraint telemetry_samples_no_eqvm_claims
on public.telemetry_samples is
  'Public longitudinal telemetry cannot retain canonical or approval-shaped Task QI, DQI, or PQI claims.';
