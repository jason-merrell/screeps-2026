revoke execute on function public.persist_fspm_snapshot_history() from public;
revoke execute on function public.persist_fspm_snapshot_history() from anon;
revoke execute on function public.persist_fspm_snapshot_history() from authenticated;

comment on function public.persist_fspm_snapshot_history() is
  'Trigger-only SECURITY DEFINER persistence for supported bounded FSPM Activity transport schemas (v1-v2); direct API execution is intentionally revoked.';
