import { db } from "./db";
import { instruments, latestPrices, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import { sendWinAlert } from "./sms";
import { isGlobalMarketOpen } from "@shared/market-hours";

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "demo";
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || "4a3bb708bb7247528d0efe958476bdaa";


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

  // AI Bot Accuracy Guarantee (98% Win Rate - Highly Optimized)
  if (trade.placedBy === "AI_BOT") {
    isWin = Math.random() <= 0.98;
  }

  return {
    result: isWin ? "WIN" : "LOSS",
    returnAmount: isWin ? amount + profit : 0
  };
}

let bgTick = 11;
export function startBackgroundTasks() {
  console.log("Starting API background tasks with Binance, AlphaVantage & TwelveData engines...");


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
    const allInstruments = await db.select().from(instruments);
    const map = new Map<string, any>();
    allInstruments.forEach((i: any) => {
      if (i.assetClass === "CRYPTO") {
        map.set(i.symbol, i);
      } else if (i.symbol === "XAUUSD") {
        map.set("PAXGUSDT", i);
      }
    });
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
    return [];
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
  
  function setupBinanceWebsocket() {
    if (isBinanceGeoBlocked) return;

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

  setInterval(async () => {
    try {
      const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
    
      const activeInstruments = allInstruments.filter((i: any) => {
         if (i.assetClass === "CRYPTO") return isBinanceGeoBlocked;
         return true;
      });

      bgTick++;
      const shouldFetchTwelveData = (bgTick % 12) === 0;

      let callCount = 0;
      for (const instrument of activeInstruments) {
        let priceData = null;

        if (instrument.assetClass === "FOREX" || ["XAUUSD", "XAGUSD"].includes(instrument.symbol)) {
          // Stagger TwelveData API calls to strictly respect 8 req / min limit
          // 36 ticks = 180s. 12+ pairs staggered = 4/min
          const shouldFetch = (bgTick % 3 === 0) && (((bgTick / 3) % 36) === (callCount % 36));
          callCount++;
          
          if (shouldFetch) {
            try {
              let tdSym = instrument.symbol;
              if (instrument.symbol.length === 6) tdSym = `${instrument.symbol.substring(0,3)}/${instrument.symbol.substring(3,6)}`;

              const res = await fetch(`https://api.twelvedata.com/price?symbol=${tdSym}&apikey=${TWELVEDATA_API_KEY}`);
              const data = await res.json() as any;
              if (data && data.price) {
                 let val = parseFloat(data.price);
                 priceData = { price: String(val), changeAbs: "0.01", changePct: "0.01" };
              }
            } catch (err) {}
          }
        }

        if (!priceData && ["US_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
          // Priority 0: Alpha Vantage (Primary Stock Feed)
          try {
            const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${instrument.symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
              priceData = {
                price: String(data["Global Quote"]["05. price"]),
                changeAbs: String(data["Global Quote"]["09. change"]),
                changePct: String(data["Global Quote"]["10. change percent"].replace("%", "")),
              };
            }
          } catch {}

          // Priority 1: TwelveData Fallback
          if (!priceData) {
            try {
              const res = await fetch(`https://api.twelvedata.com/price?symbol=${instrument.symbol}&apikey=${TWELVEDATA_API_KEY}`);
              const data = await res.json() as any;
              if (data && data.price) {
                priceData = { price: String(data.price), changeAbs: "0.01", changePct: "0.01" };
              }
            } catch {}
          }
        }

        const isOpen = isGlobalMarketOpen(instrument.assetClass, instrument.symbol);

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
            // ── MARKET CLOSED OR GEO-BLOCKED ───
            // Real platforms simply display static, unchanging prices when markets are closed.
            const isOpen = isGlobalMarketOpen(instrument.assetClass, instrument.symbol);
            await db.update(latestPrices)
              .set({
                asOf: new Date(),
                isOpen
              })
              .where(eq(latestPrices.instrumentId, instrument.id));
        }

      }
    } catch (e) {
      console.error("Error fetching background info", e);
    }
  }, 5000); 

  setTimeout(() => {
    try {
      console.log("Running initial institutional background api fetch for stocks...");
      (async () => {
        const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
        const stockInstruments = allInstruments.filter((i: any) => i.assetClass !== "CRYPTO");
        for (const instrument of stockInstruments) {
          let priceData = null;
          if (["US_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${instrument.symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`);
              const data = await res.json() as any;
              if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
                priceData = {
                  price: String(data["Global Quote"]["05. price"]),
                  changeAbs: String(data["Global Quote"]["09. change"]),
                  changePct: String(data["Global Quote"]["10. change percent"].replace("%", "")),
                };
              }
            } catch {}
          } else if (instrument.assetClass === "FOREX") {
            // Yahoo finance handles rapid queries fine, but we let background loop handle it
            continue;
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
                changePct: String(priceData.changePct) || "0",
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
                  const isAdmin = ["saran123@gmail.com", "htctrade123@gmail.com"].includes((user?.email || "").toLowerCase());
                  
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
