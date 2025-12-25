// Shared cache module for reducing Firestore reads
// Cache TTL: 24 hours, invalidated on key changes or API calls

const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in ms

// Caches
export const userCache = new Map();
export const usageCache = new Map();
export const puterUsageCache = new Map();

// TTL values
export const USER_CACHE_TTL = ONE_DAY;
export const USAGE_CACHE_TTL = ONE_DAY;
export const PUTER_CACHE_TTL = ONE_DAY;

// Get cached user
export function getCachedUser(uid) {
  const cached = userCache.get(uid);
  if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

// Set cached user
export function setCachedUser(uid, data) {
  userCache.set(uid, { data, timestamp: Date.now() });
}

// Invalidate user cache
export function invalidateUserCache(uid) {
  userCache.delete(uid);
  // Also invalidate related usage caches
  usageCache.delete(`usage_${uid}`);
}

// Invalidate usage cache for a user
export function invalidateUsageCache(uid) {
  usageCache.delete(`usage_${uid}`);
}

// Invalidate all caches for a user (call after API requests)
export function invalidateAllUserCaches(uid) {
  userCache.delete(uid);
  usageCache.delete(`usage_${uid}`);
}

// Invalidate puter usage cache for a specific key
export function invalidatePuterKeyCache(key) {
  puterUsageCache.delete(key);
}

// Clear all puter usage caches
export function clearPuterUsageCache() {
  puterUsageCache.clear();
}
