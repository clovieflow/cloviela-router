-- Operator-set egress allowance per pool, in bytes.
--
-- NULL means "no quota": the pool is unmetered and its usage bar shows a
-- running total with no denominator. Kept in bytes rather than GB so the
-- comparison against measured traffic never needs a lossy round-trip.
ALTER TABLE network_pools ADD COLUMN IF NOT EXISTS quota_bytes bigint;
