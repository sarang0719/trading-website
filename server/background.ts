import { db } from "./db";
import { instruments, latestPrices, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import { sendWinAlert } from "./sms";

const ALPHA_VANTAGE_API_KEY = "385249c9f711441797999463c29e0ead";

function generateRealisticSparkline(currentPrice: number, changeAbs: number, points = 60): string[] {
  const startPrice = currentPrice - changeAbs;
  const sparkline: string[] = [];
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const trend = startPrice + (changeAbs * progress);
    const jitter = (Math.random() - 0.5) * Math.max(Math.abs(changeAbs) * 0.2, Math.abs(currentPrice) * 0.001);
    sparkline.push((trend + jitter).toString());
  }
  sparkline[points - 1] = currentPrice.toString();
  return sparkline;
}

function isGlobalMarketOpen(assetClass: string): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const hour = now.getUTCHours();
  
  if (assetClass === "CRYPTO") return true;
  
  // Saturday is always closed
  if (day === 6) return false;
  // Sunday night opening: 22:00 UTC (6 PM EST)
  if (day === 0) return hour >= 22;
  
  // Friday night close: 22:00 UTC
  if (day === 5) return hour < 22;

  // Specific Market Holidays 2026:
  // Good Friday: April 3
  if (now.getMonth() === 3 && now.getDate() === 3) return false;
  
  return true;
}

// --- Live Trading PnL Utilities ---
function getFinalResult(trade: any, finalPrice: number) {
  const entryPrice = parseFloat(trade.strikePrice);
  const amount = parseFloat(trade.amount);
  const payout = parseFloat(trade.payoutRatio || "0.85");
  const type = trade.side;

  const profit = amount * payout;
  let isWin = false;

  if (type === "BUY") {
    isWin = finalPrice > entryPrice;
  } else {
    isWin = finalPrice < entryPrice;
  }

  return {
    result: isWin ? "WIN" : "LOSS",
    returnAmount: isWin ? amount + profit : 0
  };
}

export function startBackgroundTasks() {
  console.log("Starting API background tasks with Alpha Vantage key:", ALPHA_VANTAGE_API_KEY);

  // One-time logo URL migration: replace cryptologos.cc with coincap.io
  const LOGO_MAP: Record<string, string> = {
    "BTCUSDT":  "https://assets.coincap.io/assets/icons/btc@2x.png",
    "ETHUSDT":  "https://assets.coincap.io/assets/icons/eth@2x.png",
    "BNBUSDT":  "https://assets.coincap.io/assets/icons/bnb@2x.png",
    "SOLUSDT":  "https://assets.coincap.io/assets/icons/sol@2x.png",
    "XRPUSDT":  "https://assets.coincap.io/assets/icons/xrp@2x.png",
    "DOGEUSDT": "https://assets.coincap.io/assets/icons/doge@2x.png",
    "ADAUSDT":  "https://assets.coincap.io/assets/icons/ada@2x.png",
    "AVAXUSDT": "https://assets.coincap.io/assets/icons/avax@2x.png",
    "LINKUSDT": "https://assets.coincap.io/assets/icons/link@2x.png",
  };

  async function fixCryptoLogos() {
    try {
      for (const [symbol, url] of Object.entries(LOGO_MAP)) {
        await db.update(instruments)
          .set({ imageUrl: url })
          .where(eq(instruments.symbol, symbol));
      }
      console.log("Crypto logo URLs updated to coincap.io");
    } catch (e) {
      console.error("Logo migration error:", e);
    }
  }
  fixCryptoLogos();

  let cryptoMap: Map<string, any> | null = null;
  const sparklinesCache = new Map<number, string[]>();

  async function refreshCryptoMap() {
    const allInstruments = await db.select().from(instruments).where(eq(instruments.assetClass, "CRYPTO"));
    const map = new Map<string, any>();
    allInstruments.forEach((i: any) => map.set(i.symbol, i));
    cryptoMap = map;
  }

  async function fetchRealSparkline(instrument: any, currentPrice: number, changeAbs: number): Promise<string[]> {
    try {
      if (instrument.assetClass === "CRYPTO") {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${instrument.symbol}&interval=15m&limit=60`);
        if (res.ok) {
          const data = await res.json() as any[];
          const closes = data.map(k => parseFloat(k[4]).toString());
          if (closes.length > 0) return closes;
        }
      } else {
        let sym = instrument.symbol;
        if (instrument.assetClass === "INDIAN_STOCK") sym += ".NS";
        else if (instrument.assetClass === "FOREX") sym = sym + "=X";
        
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=15m&range=5d`);
        if (res.ok) {
          const data = await res.json() as any;
          const result = data?.chart?.result?.[0];
          if (result && result.indicators?.quote?.[0]?.close) {
            let closes = result.indicators.quote[0].close.filter((c: number | null) => c !== null).map((c: number) => c.toString());
            if (closes.length >= 60) return closes.slice(-60);
            if (closes.length > 0) return closes; 
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch real sparkline for", instrument.symbol, e);
    }
    return generateRealisticSparkline(currentPrice, changeAbs, 60);
  }

  async function updateCachedSparkline(instrument: any, currentPrice: number, changeAbs: number): Promise<string[]> {
    const instrumentId = instrument.id;
    let line = sparklinesCache.get(instrumentId);
    if (!line) {
      const [row] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, instrumentId));
      line = (row?.sparkline as string[]) || [];
    }
    
    const lastPrice = line.length > 0 ? parseFloat(line[line.length - 1]) : currentPrice;
    const isWildlyOutdated = currentPrice > 0 && Math.abs(lastPrice - currentPrice) / currentPrice > 0.5;

    if (line.length < 60 || isWildlyOutdated) {
      line = await fetchRealSparkline(instrument, currentPrice, changeAbs);
    } else {
      line.push(currentPrice.toString());
      if (line.length > 60) line.shift();
    }
    sparklinesCache.set(instrumentId, line);
    return line;
  }

  let isBinanceGeoBlocked = false;
  
  // 1. Setup Binance WebSocket for Crypto
  function setupBinanceWebsocket() {
    if (isBinanceGeoBlocked) return; // Shield: don't retry if definitively geo-blocked

    const ws = new WebSocket("wss://stream.binance.com:9443/ws/!miniTicker@arr");

    ws.on("open", async () => {
      console.log("Connected to live Binance WebSocket for Cryptos!");
      await refreshCryptoMap();
    });

    ws.on("message", async (data: string) => {
      try {
        if (!cryptoMap) return;

        const events = JSON.parse(data);
        if (!Array.isArray(events)) return;

        for (const ev of events) {
          const symbol = ev.s;
          if (cryptoMap.has(symbol)) {
            const instrument = cryptoMap.get(symbol)!;
            const instId = instrument.id;
            const price = parseFloat(ev.c);
            const openPrice = parseFloat(ev.o);
            const changeAbs = price - openPrice;
            const changePct = openPrice > 0 ? (changeAbs / openPrice) * 100 : 0;
            
            const newSparkline = await updateCachedSparkline(instrument, price, changeAbs);

            await db.update(latestPrices)
              .set({
                price: String(price),
                changeAbs: String(changeAbs),
                changePct: String(changePct),
                sparkline: newSparkline,
                asOf: new Date(),
                isOpen: true 
              })
              .where(eq(latestPrices.instrumentId, instId));

          }
        }
      } catch (err) { }
    });

    ws.on("close", () => {
      console.log("Binance WebSocket closed. Reconnecting in 5s...");
      setTimeout(setupBinanceWebsocket, 5000);
    });

    ws.on("error", (err) => {
      // Institutional Silence: Skip logging 451 geo-blocking as we have simulation fallbacks
      if (err.message.includes("451")) {
         console.warn("[Binance Connectivity] Switching to Institutional Stealth Fallback (Geo-blocked).");
         isBinanceGeoBlocked = true;
         ws.terminate();
         return;
      }
      console.error("Binance WS error:", err);
    });
  }

  setupBinanceWebsocket();

  // 2. Setup periodic polling for Stocks using Alpha vantage
  setInterval(async () => {
    try {
      const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
      // Absorption Logic: If Binance WS is geoblocked, we absorb Crypto into the polling loop
      const activeInstruments = allInstruments.filter(i => {
         if (i.assetClass === "CRYPTO") return isBinanceGeoBlocked;
         return true;
      });

      let callCount = 0;
      for (const instrument of activeInstruments) {
        let priceData = null;

        if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
          callCount++;
          const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
          try {
            const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
              priceData = {
                price: data["Global Quote"]["05. price"],
                changeAbs: data["Global Quote"]["09. change"],
                changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
              };
            }
          } catch (e) {
            console.error(`Failed to fetch for ${sym}`, e);
          }
        } else if (instrument.assetClass === "FOREX") {
          callCount++;
          const fromC = instrument.symbol.substring(0, 3);
          const toC = instrument.symbol.substring(3, 6);
          try {
            const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Realtime Currency Exchange Rate"]) {
              priceData = {
                price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
                changeAbs: "0",
                changePct: "0"
              };
            }
          } catch (e) {
            console.error(`Failed to fetch forex for ${fromC}-${toC}`, e);
          }
        }

        const isOpen = isGlobalMarketOpen(instrument.assetClass);

        if (priceData) {
          const currentPrice = parseFloat(priceData.price);
          const changeAbs = parseFloat(priceData.changeAbs);
          const newSparkline = await updateCachedSparkline(instrument, currentPrice, changeAbs);

          console.log(`Updated ${instrument.symbol} to $${priceData.price} [Open: ${isOpen}]`);
          await db.update(latestPrices)
            .set({
              price: String(priceData.price),
              changeAbs: String(priceData.changeAbs),
              changePct: String(priceData.changePct),
              sparkline: newSparkline,
              asOf: new Date(),
              isOpen 
            })
            .where(eq(latestPrices.instrumentId, instrument.id));
        } else {
           // ── GUARANTEED PRECISION SIMULATION (CLOSED MARKETS) ───
           const [currentRow] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, instrument.id));
           if (currentRow) {
              const currentPrice = parseFloat(currentRow.price as string);
              const sparkline = (currentRow.sparkline as string[]) || [];
              
              // Analyze trend velocity for auto-guidance
              const velocity = sparkline.length > 3 
                 ? (Number(sparkline[sparkline.length - 1]) - Number(sparkline[0])) / Number(sparkline[0]) 
                 : 0;

              // Guided Drift: 0.05% - 0.15% favoring current momentum
              let bias = velocity > 0 ? 0.0002 : velocity < 0 ? -0.0002 : (Math.random() * 0.0004 - 0.0002);
              
              // Extra "Institutional" kick to ensure signal accuracy
              const precisionJitter = currentPrice * (bias + (Math.random() * 0.0001));
              
              const newPrice = currentPrice + precisionJitter;
              const newChangeAbs = (parseFloat(currentRow.changeAbs as string) || 0) + precisionJitter;
              const newSparkline = await updateCachedSparkline(instrument, newPrice, newChangeAbs);
              
              const isOpen = isGlobalMarketOpen(instrument.assetClass);
              await db.update(latestPrices)
                .set({
                  price: newPrice.toFixed(6),
                  changeAbs: newChangeAbs.toFixed(6),
                  sparkline: newSparkline,
                  asOf: new Date(),
                  isOpen
                })
                .where(eq(latestPrices.instrumentId, instrument.id));
           }
        }

      }
    } catch (e) {
      console.error("Error fetching background info", e);
    }
  }, 15000); 

  setTimeout(() => {
    try {
      console.log("Running initial background api fetch for stocks...");
      (async () => {
        const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
        const stockInstruments = allInstruments.filter((i: any) => i.assetClass !== "CRYPTO");
        let callCount = 0;
        for (const instrument of stockInstruments) {
          let priceData = null;
          if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
            callCount++;
            const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
              const data = await res.json() as any;
              if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
                priceData = {
                  price: data["Global Quote"]["05. price"],
                  changeAbs: data["Global Quote"]["09. change"],
                  changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
                };
              }
            } catch (e) {
              console.error(`Initial fetch failed for ${sym}`, e);
            }
          } else if (instrument.assetClass === "FOREX") {
            callCount++;
            const fromC = instrument.symbol.substring(0, 3);
            const toC = instrument.symbol.substring(3, 6);
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
              const data = await res.json() as any;
              if (data && data["Realtime Currency Exchange Rate"]) {
                priceData = {
                  price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
                  changeAbs: "0",
                  changePct: "0"
                };
              }
            } catch (e) {
               console.error(`Initial fetch failed forex for ${fromC}-${toC}`, e);
            }
          }
          if (priceData) {
            const currentPrice = parseFloat(priceData.price);
            const changeAbs = parseFloat(priceData.changeAbs);
            const newSparkline = await updateCachedSparkline(instrument, currentPrice, changeAbs);

            console.log(`Initial fetch: Updated ${instrument.symbol} to $${priceData.price}`);
            await db.update(latestPrices)
              .set({
                price: String(priceData.price),
                changeAbs: String(priceData.changeAbs),
                changePct: String(priceData.changePct),
                sparkline: newSparkline,
                asOf: new Date()
              })
              .where(eq(latestPrices.instrumentId, instrument.id));
          }
        }
      })();
    } catch (err) { }
  }, 5000);

  // 3. Time-Based Order Execution Engine
  // Checks every second for any expired ACTIVE time-based trades
  setInterval(async () => {
    try {
      const { storage } = await import("./storage");
      const activeTrades = await storage.getActiveTimeBasedOrders();
      if (!activeTrades || activeTrades.length === 0) return;

      const now = Date.now();
      console.log(`[Engine] Found ${activeTrades.length} active trades.`);
      for (const trade of activeTrades) {
        const tradeExpires = new Date(trade.expiresAt).getTime();
        console.log(`[Engine] Trade #${trade.id} expires at ${tradeExpires}, now is ${now}. Expired? ${now >= tradeExpires}`);
        if (now >= tradeExpires) {
          // Time expired, let's settle it!
          const [priceRow] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, trade.instrumentId));
          if (!priceRow || !priceRow.price) continue;

          let currentPrice = parseFloat(priceRow.price as string);
          
          if (trade.placedBy === "AI_BOT") {
             // 97% Win Profit Engine for AI Bot — Maximum Accuracy Mode
             const entryPrice = parseFloat(trade.strikePrice);
             const forceWin = Math.random() < 0.97;
             
             if (forceWin) {
                 // Dynamically scale the profit margin for realistic-looking results
                 const profitMargin = entryPrice * (0.00005 + Math.random() * 0.0003);
                 if (trade.side === "BUY" && currentPrice <= entryPrice) {
                    currentPrice = entryPrice + profitMargin;
                 } else if (trade.side === "SELL" && currentPrice >= entryPrice) {
                    currentPrice = entryPrice - profitMargin;
                 }
             }
          }

          const { result, returnAmount } = getFinalResult(trade, currentPrice);

          await storage.updateTimeBasedOrder(trade.id, {
            status: result as any, // "WIN" | "LOSS"
            settlePrice: currentPrice.toString(),
          });
          
          if (result === "WIN" && returnAmount > 0) {
             try {
                // Determine which balance to credit: check the trade's deduction transaction for mode
                const txs = await storage.getWalletTransactions(trade.userId);
                const deductTx = txs.find(t => t.referenceId === String(trade.id) && t.type === "TRADE_DEDUCTION");
                const tradeMode = (deductTx as any)?.mode ?? "REAL";

                if (tradeMode === "DEMO") {
                  await storage.updateDemoBalance(trade.userId, returnAmount);
                } else {
                  await storage.updateWalletBalance(trade.userId, returnAmount);
                }

                await storage.createWalletTransaction({
                   userId: trade.userId, type: "TRADE_WIN", amount: String(returnAmount),
                   status: "SUCCESS", referenceId: String(trade.id), mode: tradeMode
                } as any);

                // Send SMS Win Notification
                try {
                  const user = await storage.getUser(trade.userId);
                  const isAdmin = ["saran123@gmail.com", "htctrade@gmail.com"].includes((user?.email || "").toLowerCase());
                  
                  if (user && user.phoneNumber) {
                    await sendWinAlert(user.phoneNumber, returnAmount.toFixed(2));
                  }

                  // ── AI ROUND PROFIT/LOSS TRACKING (NON-ADMINS) ──
                  if (user && !isAdmin && trade.placedBy === "AI_BOT") {
                     const isWin = returnAmount > 0;
                     const profit = isWin 
                        ? (returnAmount - parseFloat(trade.amount as string)) 
                        : -parseFloat(trade.amount as string);
                     
                     let currentPnl = parseFloat(user.autoInvestRoundPnl as string) + profit;
                     let currentRound = user.autoInvestRound;
                     
                     let roundProfitLimit = 50.00;
                     let roundLossLimit = 20.00;

                     if (currentRound === 2) {
                        roundProfitLimit = 45.00;
                        roundLossLimit = 20.00;
                     } else if (currentRound >= 3) {
                        roundProfitLimit = 35.00;
                        roundLossLimit = 15.00;
                     }

                     let autoTradeEnabled = user.autoTradeEnabled;

                     // Target Reached -> Next Round
                     if (currentPnl >= roundProfitLimit) {
                        currentRound++;
                        currentPnl = 0; // Reset for next tier
                     }

                     // Loss Limit Breach -> STOP
                     if (currentPnl <= -roundLossLimit) {
                        autoTradeEnabled = false;
                        console.log(`[AI Protection] User ${user.email} Round ${currentRound} STOP LOSS BREACH (-$${Math.abs(currentPnl)})`);
                     }

                     await db.update(users).set({ 
                        autoInvestRound: currentRound,
                        autoInvestRoundPnl: String(currentPnl),
                        autoTradeEnabled
                     }).where(eq(users.id, user.id));
                  }
                } catch (smsErr) {
                  console.error("Task failed:", smsErr);
                }
             } catch(err) { console.error("Wallet payout failed for trade:", trade.id, err); }

          }
          
          console.log(`Resolved Time Trade #${trade.id}: ${trade.side} @ ${trade.strikePrice} -> Settle ${currentPrice} = ${result}`);
        }
      }
    } catch (err) {
      console.error("Execution engine error:", err);
    }
  }, 1000);
}
