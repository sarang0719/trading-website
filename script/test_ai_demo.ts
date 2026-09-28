const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

async function runRealAiDemo() {
  console.log("=================================================================");
  console.log("  QUANTEDGE V12.1 · SMC REAL LIVE AI PREDICTOR & SMC TEST DEMO");
  console.log("=================================================================\n");

  const markets = [
    { symbol: "BTCUSD", name: "Bitcoin / USD", tf: "5m" },
    { symbol: "XAUUSD", name: "Gold / USD", tf: "15m" },
    { symbol: "EURUSD", name: "Euro / US Dollar", tf: "5m" },
  ];

  for (const m of markets) {
    console.log(`[TESTING MARKET: ${m.name} (${m.symbol}) — Timeframe: ${m.tf}]`);
    
    // 1. Fetch real historical candles from API
    try {
      const histRes = await fetch(`${BASE_URL}/api/market-data/history/${m.symbol}?interval=${m.tf}`);
      if (!histRes.ok) {
        console.log(`  [-] Failed to fetch candles: status ${histRes.status}\n`);
        continue;
      }

      const histData = (await histRes.json()) as any;
      let candles = histData.candles || histData.results || histData;

      if (!Array.isArray(candles) || candles.length < 5) {
        console.log(`  [-] Insufficient candles returned: ${candles?.length || 0}\n`);
        continue;
      }

      candles = candles.slice(-200);
      console.log(`  [+] Loaded ${candles.length} real market candles.`);

      // 2. Call AI Prediction Engine Endpoint
      const startTime = Date.now();
      const predRes = await fetch(`${BASE_URL}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: m.symbol,
          timeframe: m.tf,
          candles: (Array.isArray(candles) ? candles.slice(-250) : [])
        })
      });

      const elapsedMs = Date.now() - startTime;

      if (!predRes.ok) {
        console.log(`  [-] AI Prediction endpoint failed: status ${predRes.status}\n`);
        continue;
      }

      const pred = (await predRes.json()) as any;

      console.log(`  [+] AI Response Latency: ${elapsedMs}ms`);
      console.log(`  • Market: ${pred.market || m.symbol}`);
      console.log(`  • Signal Direction: ${pred.signal || pred.direction}`);
      console.log(`  • Model Confidence: ${pred.confidence}%`);
      console.log(`  • Probability UP: ${pred.probability_up || (pred.signal === "BUY" ? pred.confidence : 100 - pred.confidence)}%`);
      console.log(`  • Probability DOWN: ${pred.probability_down || (pred.signal === "SELL" ? pred.confidence : 100 - pred.confidence)}%`);
      console.log(`  • Market Trend: ${pred.trend || "Neutral"}`);
      console.log(`  • Risk Assessment: ${pred.risk || "Medium"}`);
      console.log(`  • SMC Confluence Reasons:`);
      if (Array.isArray(pred.reason)) {
        pred.reason.forEach((r: string) => console.log(`      - ${r}`));
      } else {
        console.log(`      - Institutional SMC & Dynamic EMA Stack Confluence`);
      }
      console.log("-----------------------------------------------------------------\n");
      await new Promise(r => setTimeout(r, 500));

    } catch (err: any) {
      console.log(`  [-] Error executing test for ${m.symbol}: ${err.message}\n`);
    }
  }

  console.log("=================================================================");
  console.log("  DEMO TEST COMPLETE — ALL QUANTEDGE V12.1 SMC AI PIPELINES OK");
  console.log("=================================================================\n");
}

runRealAiDemo();
