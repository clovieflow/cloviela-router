/** Redis scripts and key builders behind pool admission and cooldown accounting. */

export function proxyInflightKey(poolId: string): string {
  return `proxy:inflight:${poolId}`;
}

export function proxyCooldownKey(poolId: string, providerId: string): string {
  return `proxy:cooldown:${poolId}:${providerId.toLowerCase()}`;
}

export function proxyCooldownProvidersKey(poolId: string): string {
  return `proxy:cooldown:providers:${poolId}`;
}

/** Compare-and-increment admission gate keyed by capacity + TTL. */
export const POOL_ADMIT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

/** Decrement a held inflight slot, or release the key when it reaches zero. */
export const POOL_RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then redis.call('DEL', KEYS[1]); return 0 end
return redis.call('DECR', KEYS[1])
`;

/** One cooldown marker plus its index entry, written atomically. */
export const COOLDOWN_FLAG_SCRIPT = `
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('SADD', KEYS[2], ARGV[3])
  -- The index set must outlive every marker it lists, or it is evicted while
  -- a cooldown is still active and the pair becomes invisible to other
  -- processes. EXPIRE ... GT only ever extends, so a later short cooldown
  -- cannot shorten a longer one already indexed.
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then
    local current = redis.call('TTL', KEYS[2])
    if current < 0 or ttl > current then redis.call('EXPIRE', KEYS[2], ttl) end
  end
  return 1
`;

/** Clears one cooldown marker and its index entry atomically. */
export const COOLDOWN_CLEAR_SCRIPT = `
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[1])
  return 1
`;
