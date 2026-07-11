-- Tighten coach feedback inserts: the referenced trajectory must belong to the
-- inserting user, not merely match a guessed trajectory_id/round_index pair.

drop policy if exists "coach_feedback insert own" on public.coach_feedback;
create policy "coach_feedback insert own"
  on public.coach_feedback for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.agent_trajectories t
      where t.id = trajectory_id
        and t.user_id = auth.uid()
    )
  );
