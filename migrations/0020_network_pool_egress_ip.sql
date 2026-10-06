-- The pool's public egress address, captured by the health probe.
--
-- The probe dials a trace endpoint THROUGH the pool, so the address it reports
-- is the one the outside world sees, not the local DNS answer for the
-- endpoint's hostname. NULL until the pool has been probed successfully.
ALTER TABLE network_pools ADD COLUMN IF NOT EXISTS egress_ip text;
