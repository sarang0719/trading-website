const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

async function runApiTestSuite() {
  console.log("=======================================================");
  console.log("  HTC TRADING PLATFORM — COMPREHENSIVE API TEST SUITE");
  console.log("=======================================================\n");

  let passed = 0;
  let failed = 0;

  async function testEndpoint(name: string, fn: () => Promise<boolean>) {
    try {
      const ok = await fn();
      if (ok) {
        console.log(`  [PASS] ${name}`);
        passed++;
      } else {
        console.log(`  [FAIL] ${name}`);
        failed++;
      }
    } catch (e: any) {
      console.log(`  [ERROR] ${name}: ${e.message}`);
      failed++;
    }
  }

  // 1. Check /api/instruments
  await testEndpoint("GET /api/instruments (Instruments Catalog)", async () => {
    const res = await fetch(`${BASE_URL}/api/instruments`);
    if (!res.ok) return false;
    const data = await res.json() as any[];
    return Array.isArray(data) && data.length > 0 && !!data[0].symbol;
  });

  // 2. Check /api/market-data/history/BTCUSD
  await testEndpoint("GET /api/market-data/history/BTCUSD (Crypto Candles)", async () => {
    const res = await fetch(`${BASE_URL}/api/market-data/history/BTCUSD?interval=1m`);
    if (!res.ok) return false;
    const data = await res.json() as any;
    const candles = data.candles || data.results || data;
    return Array.isArray(candles) && candles.length > 0 && typeof candles[0].close === "number";
  });

  // 3. Check /api/market-data/history/XAUUSD
  await testEndpoint("GET /api/market-data/history/XAUUSD (Gold Commodities)", async () => {
    const res = await fetch(`${BASE_URL}/api/market-data/history/XAUUSD?interval=15m`);
    if (!res.ok) return false;
    const data = await res.json() as any;
    const candles = data.candles || data.results || data;
    return Array.isArray(candles) && candles.length > 0 && typeof candles[0].close === "number";
  });

  // 4. Check /api/market-data/history/EURUSD
  await testEndpoint("GET /api/market-data/history/EURUSD (Forex Candles)", async () => {
    const res = await fetch(`${BASE_URL}/api/market-data/history/EURUSD?interval=1m`);
    if (!res.ok) return false;
    const data = await res.json() as any;
    const candles = data.candles || data.results || data;
    return Array.isArray(candles) && candles.length > 0;
  });

  // 5. Check AI Predict API (Local Node/Python endpoint)
  await testEndpoint("POST /api/predict (AI Next Candle Predictor)", async () => {
    const sampleCandles = Array.from({ length: 20 }, (_, i) => ({
      timestamp: Date.now() - (20 - i) * 60000,
      open: 65000 + i * 10,
      high: 65020 + i * 10,
      low: 64990 + i * 10,
      close: 65015 + i * 10,
      volume: 150 + i * 5
    }));

    const res = await fetch(`${BASE_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: "BTCUSD",
        timeframe: "1m",
        candles: sampleCandles
      })
    });
    
    if (!res.ok) {
      console.log("    Response status:", res.status);
      return false;
    }
    const data = await res.json() as any;
    return !!data.signal && (data.signal === "BUY" || data.signal === "SELL" || data.signal === "MONITORING");
  });

  console.log("\n=======================================================");
  console.log(`  TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) process.exit(1);
}

runApiTestSuite();
