// Format large numbers
export const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num?.toString() || '0';
};

// Format Puter units to dollars
// Puter uses 100,000,000 units = $1 (1e8 = $1)
export const formatDollars = (units) => {
  if (!units) return '$0.00';
  const dollars = units / 100000000;
  if (dollars >= 1) return '$' + dollars.toFixed(2);
  if (dollars >= 0.01) return '$' + dollars.toFixed(3);
  if (dollars >= 0.0001) return '$' + dollars.toFixed(4);
  return '$' + dollars.toFixed(6);
};

// Format cost from log entries (stored in Puter units)
export const formatLogCost = (cost) => {
  if (!cost) return '$0.0000';
  const dollars = cost / 100000000;
  if (dollars >= 1) return '$' + dollars.toFixed(2);
  if (dollars >= 0.01) return '$' + dollars.toFixed(3);
  if (dollars >= 0.0001) return '$' + dollars.toFixed(4);
  return '$' + dollars.toFixed(6);
};

// Estimate cost based on tokens (fallback when actual cost unavailable)
// Average rate: ~$0.01 per 1K tokens (mix of input/output)
export const estimateCost = (tokens) => {
  if (!tokens) return '$0.00';
  const cost = (tokens / 1000) * 0.01;
  if (cost >= 1) return '$' + cost.toFixed(2);
  if (cost >= 0.01) return '$' + cost.toFixed(3);
  return '$' + cost.toFixed(4);
};

// Get usage percentage
export const getUsagePercent = (used, allowance) => {
  if (!allowance) return 0;
  return Math.min(100, (used / allowance) * 100);
};
