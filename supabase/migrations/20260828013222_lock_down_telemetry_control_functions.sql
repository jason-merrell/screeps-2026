revoke execute on function public.enqueue_due_collection_commands(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_collection_commands(integer) to service_role;

revoke execute on function public.sync_ptr_experiment_benchmark() from public, anon, authenticated;
