import { predictNextCandle, scanMultiTimeframeConfluence } from '../client/src/lib/candle-predictor.ts';
import type { Candle } from '../client/src/lib/strategy-engine.ts';

async function trainAiModelFast() {
  console.log("==========================================================");
  console.log("🤖 QUANT-EDGE AI WEIGHT TRAINING & ACCURACY OPTIMIZER 🤖");
  console.log("==========================================================");

  let candles1m: Candle[] = [];
  try {
    const res = await fetch("https://api3.binance.com/api/v3/klines?symbol=XAUTUSDT&interval=1m&limit=1000");
    if (res.ok) {
      const data = await res.json();
      candles1m = data.map((d: any) => ({
        time: Math.floor(d[0]/1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));
    }
  } catch (err: any) {
    console.error("Failed to fetch historical market data:", err.message);
    return;
  }

  console.log(`✅ Loaded ${candles1m.length} candles for training.`);

  let bestWinRate = 0;
  let bestWeights: any = null;
  let bestSampleSize = 0;
  let bestWins = 0;
  let bestLosses = 0;

  const W_OPTIONS = [2, 3, 4, 5, 6, 7];

  for (let trial = 1; trial <= 50; trial++) {
    const candidateWeights = {
      SMC_OB_FVG: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      EXHAUSTION: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      BOS_CHOCH: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      EMA_STACK: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      VOLUMETRIC: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      RSI_ACCEL: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      ST_CHANNEL: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
      MACD_FLOW: W_OPTIONS[Math.floor(Math.random() * W_OPTIONS.length)],
    };

    let wins = 0;
    let losses = 0;

    for (let i = 100; i < candles1m.length - 15; i++) {
      const windowSoFar = candles1m.slice(0, i + 1);
      const mtf = scanMultiTimeframeConfluence(windowSoFar, "XAUUSD");
      const pred = predictNextCandle(windowSoFar, 60, candidateWeights, "XAUUSD");

      // Dual-Engine 100% Agreement & 4/4 MTF Confluence
      if (mtf.alignedCount === 4 && mtf.direction !== "MONITORING" && pred.isConfirmed && pred.direction === mtf.direction && (pred.confluenceScore ?? 0) >= 18) {
        const isBuy = mtf.direction === "BUY";
        const entryPrice = candles1m[i].close;

        let atrSum = 0;
        for (let k = i - 14; k <= i; k++) {
          atrSum += Math.max(0.5, candles1m[k].high - candles1m[k].low);
        }
        const atr = atrSum / 14;

        const tpPrice = isBuy ? entryPrice + Math.max(3.00, atr * 1.8) : entryPrice - Math.max(3.00, atr * 1.8);
        const slPrice = isBuy ? entryPrice - Math.max(2.50, atr * 1.5) : entryPrice + Math.max(2.50, atr * 1.5);

        let hitTp = false;
        let hitSl = false;

        for (let f = 1; f <= 15; f++) {
          const nextC = candles1m[i + f];
          if (!nextC) break;
          if (isBuy) {
            if (nextC.high >= tpPrice) { hitTp = true; break; }
            if (nextC.low <= slPrice)  { hitSl = true; break; }
          } else {
            if (nextC.low <= tpPrice)  { hitTp = true; break; }
            if (nextC.high >= slPrice) { hitSl = true; break; }
          }
        }

        if (hitTp) wins++;
        else if (hitSl) losses++;
      }
    }

    const total = wins + losses;
    if (total >= 10) {
      const winRate = (wins / total) * 100;
      if (winRate > bestWinRate) {
        bestWinRate = winRate;
        bestWeights = candidateWeights;
        bestSampleSize = total;
        bestWins = wins;
        bestLosses = losses;
        console.log(`🎯 Iteration ${trial}: New Highest Win Rate: ${winRate.toFixed(1)}% (${wins} Wins / ${losses} Losses out of ${total} trades)`);
      }
    }
  }

  console.log("\n==========================================================");
  console.log(`🏆 OPTIMAL TRAINED AI WEIGHTS RESULT:`);
  console.log(`   - Maximum Win Rate Achieved  : ${bestWinRate.toFixed(1)}%`);
  console.log(`   - Total Executed A+ Trades   : ${bestSampleSize} Trades (${bestWins} Wins / ${bestLosses} Losses)`);
  console.log(`   - Trained Weights Matrix     : ${JSON.stringify(bestWeights, null, 2)}`);
  console.log("==========================================================");
}

trainAiModelFast();
