// Format large numbers
export const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num?.toString() || '0';
};

// Format Puter units to dollars (1M units = $1)
export const formatDollars = (units) => {
  if (!units) return '$0.00';
  const dollars = units / 1000000;
  if (dollars >= 1) return '$' + dollars.toFixed(2);
  if (dollars >= 0.01) return '$' + dollars.toFixed(3);
  return '$' + dollars.toFixed(4);
};

// Estimate cost based on tokens (rough average: $0.002 per 1K tokens)
export const estimateCost = (tokens) => {
  if (!tokens) return '$0.00';
  const cost = (tokens / 1000) * 0.002;
  if (cost >= 1) return '$' + cost.toFixed(2);
  if (cost >= 0.01) return '$' + cost.toFixed(3);
  return '$' + cost.toFixed(4);
};

// Get usage percentage
export const getUsagePercent = (used, allowance) => {
  if (!allowance) return 0;
  return Math.min(100, (used / allowance) * 100);
};
