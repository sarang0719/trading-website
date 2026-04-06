export function isGlobalMarketOpen(assetClass: string, symbol: string): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const hour = now.getUTCHours();
  
  const cls = (assetClass || "").toUpperCase();
  const sym = (symbol || "").toUpperCase();

  if (cls === "CRYPTO") return true;
  
  // 24/5 for Forex, Metals & Commodities
  if (cls === "FOREX" || cls === "METAL" || cls === "COMMODITY" || ["XAUUSD", "XAGUSD", "WTIUSD", "BRENTUSD"].includes(sym)) {
    if (day === 6) return false; // Saturday
    if (day === 0) return hour >= 22; // Sunday 10 PM UTC opening
    if (day === 5) return hour < 22; // Friday 10 PM UTC closing
    return true; // Mon-Thu is always open
  }

  // Stocks (Standard NYSE Hours fallback approx 13:30 - 20:00 UTC)
  if (day === 0 || day === 6) return false;
  return hour >= 13 && hour <= 21; 
}
