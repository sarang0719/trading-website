import { predictNextCandle } from '../client/src/lib/candle-predictor.ts';

async function test1HAtrPerformance() {
  console.log("==========================================================");
  console.log("🏆 1H TIMEFRAME ATR RISK-REWARD BACKTEST TESTER 🏆");
  console.log("==========================================================");

  try {
    const res = await fetch("https://api3.binance.com/api/v3/klines?symbol=XAUTUSDT&interval=1h&limit=1000");
    if (!res.ok) return;
    const data = await res.json();
    const candles1h = data.map((d: any) => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5])
    }));

    let totalSignals = 0;
    let tpWins = 0;
    let slLosses = 0;

    for (let i = 50; i < candles1h.length - 10; i++) {
      const windowSoFar = candles1h.slice(0, i + 1);
      const pred = predictNextCandle(windowSoFar, 3600, undefined, "XAUUSD");

      if (pred.isConfirmed && (pred.confluenceScore ?? 0) >= 65) {
        const isBuy = pred.direction === "BUY";
        const entryPrice = pred.entryPrice || candles1h[i].close;
        const tpPrice = pred.targetPrice || (isBuy ? entryPrice + 12.0 : entryPrice - 12.0);
        const slPrice = pred.stopLossPrice || (isBuy ? entryPrice - 8.0 : entryPrice + 8.0);

        totalSignals++;

        let hitTp = false;
        let hitSl = false;

        for (let f = 1; f <= 10; f++) {
          const nextC = candles1h[i + f];
          if (!nextC) break;

          if (isBuy) {
            if (nextC.high >= tpPrice) { hitTp = true; break; }
            if (nextC.low <= slPrice) { hitSl = true; break; }
          } else {
            if (nextC.low <= tpPrice) { hitTp = true; break; }
            if (nextC.high >= slPrice) { hitSl = true; break; }
          }
        }

        if (hitTp) tpWins++;
        else if (hitSl) slLosses++;
      }
    }

    const totalDecided = tpWins + slLosses;
    const winRate = totalDecided > 0 ? ((tpWins / totalDecided) * 100).toFixed(1) : '0';

    console.log(`✅ 1H Timeframe High Confluence Backtest Results:`);
    console.log(`   - Total 1H Candles Evaluated : ${candles1h.length}`);
    console.log(`   - 1H Confirmed Trade Signals : ${totalSignals}`);
    console.log(`   - Target (TP +$12.00+) Wins  : ${tpWins}`);
    console.log(`   - Stop Loss Hits             : ${slLosses}`);
    console.log(`   - 1H High Confluence Win Rate: ${winRate}%`);
  } catch (err: any) {
    console.error("1H backtest error:", err.message);
  }

  console.log("\n==========================================================");
}

test1HAtrPerformance();
