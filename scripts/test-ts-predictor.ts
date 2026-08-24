import { backtestPredictor } from "../client/src/lib/candle-backtest";
import type { Candle } from "../client/src/lib/strategy-engine";

// Generate synthetic test market candles with trend, mean-reversion, and realistic noise
function generateTestCandles(count: number = 1000): Candle[] {
  const candles: Candle[] = [];
  let price = 50000.0;
  let now = Math.floor(Date.now() / 1000) - count * 60;
  let trend = 1;

  for (let i = 0; i < count; i++) {
    if (i % 80 === 0) trend = Math.random() > 0.5 ? 1 : -1;
    
    const changePct = (Math.random() * 0.004 - 0.0018) + (trend * 0.0008);
    const open = price;
    const close = Math.max(10, open * (1 + changePct));
    const high = Math.max(open, close) + (Math.random() * 15.0);
    const low = Math.min(open, close) - (Math.random() * 15.0);
    const volume = Math.floor(Math.random() * 500 + 100);

    candles.push({
      time: now + i * 60,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume
    });

    price = close;
  }

  return candles;
}

console.log("\n=======================================================");
console.log("  TYPESCRIPT TECHNICAL CONFLUENCE & MTF BACKTEST");
console.log("=======================================================");

const testDataset = generateTestCandles(1200);
const res = backtestPredictor(testDataset, 60);

console.log(`  • Total Candles Tested: ${res.totalCandlesSeen}`);
console.log(`  • Confirmed Signal Sample Size: ${res.sampleSize}`);
console.log(`  • Wins: ${res.wins} | Losses: ${res.losses}`);
console.log(`  • Empirical Walk-Forward Accuracy: ${res.accuracy}%`);
console.log(`  • Breakdown by Signal Strength:`);
console.log(`    - STRONG Signals : Wins ${res.byStrength.STRONG.wins} / Losses ${res.byStrength.STRONG.losses} (${res.byStrength.STRONG.wins + res.byStrength.STRONG.losses > 0 ? ((res.byStrength.STRONG.wins / (res.byStrength.STRONG.wins + res.byStrength.STRONG.losses)) * 100).toFixed(1) : 0}%)`);
console.log(`    - NORMAL Signals : Wins ${res.byStrength.NORMAL.wins} / Losses ${res.byStrength.NORMAL.losses} (${res.byStrength.NORMAL.wins + res.byStrength.NORMAL.losses > 0 ? ((res.byStrength.NORMAL.wins / (res.byStrength.NORMAL.wins + res.byStrength.NORMAL.losses)) * 100).toFixed(1) : 0}%)`);
console.log(`    - WEAK Signals   : Wins ${res.byStrength.WEAK.wins} / Losses ${res.byStrength.WEAK.losses}`);
console.log("=======================================================\n");
