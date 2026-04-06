export function isGlobalMarketOpen(assetClass: string, symbol: string): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const hour = now.getUTCHours();
  
  if (assetClass === "CRYPTO") return true;
  
  // 24/5 for Forex & Gold
  if (assetClass === "FOREX" || ["XAUUSD", "XAGUSD", "WTIUSD", "BRENTUSD"].includes(symbol)) {
    if (day === 6) return false;
    if (day === 0) return hour >= 22;
    if (day === 5) return hour < 22;
    return true;
  }

  // Stocks (Standard NYSE Hours fallback approx)
  if (day === 0 || day === 6) return false;
  return hour >= 13 && hour <= 21; 
}
