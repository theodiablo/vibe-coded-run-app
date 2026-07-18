-- Delivered-response recovery for the coach agent.
--
-- The dominant coach failure in production is a DELIVERY failure, not a model
-- failure: the round completes server-side (a valid proposal lands in
-- agent_rounds) but the streamed HTTP response dies before the body reaches
-- the phone — the client shows "coach unavailable" while the model call and
-- the rate-limit charge are already spent. To let the client recover the
-- finished round instead of re-running the model:
--
--   * client_request_id — a client-generated UUID sent with each propose/
--     critique. It is the lookup key for the new no-model `result` action;
--     the edge function (service role) stamps it on the round it writes.
--   * response — the exact JSON body the round tried to send. Stored verbatim
--     so `result` replays it byte-identical (status, diff ids, memory
--     suggestion ids) rather than reconstructing it from row fields.
--
-- Same trust model as the rest of agent_rounds: service-role writes only; the
-- existing user read-own SELECT policy already covers the new columns, and
-- the `result` action re-checks trajectory ownership before returning a row.
alter table public.agent_rounds
  add column if not exists client_request_id uuid,
  add column if not exists response jsonb;

-- Partial index: only recovery-capable rounds carry a request id, and lookups
-- are always by exact id.
create index if not exists agent_rounds_client_request_idx
  on public.agent_rounds (client_request_id)
  where client_request_id is not null;
