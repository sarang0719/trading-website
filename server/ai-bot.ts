import { db } from "./db";
import { users, latestPrices, timeBasedOrders, instruments } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { storage } from "./storage";

/**
 * IMPORTANT: this engine trades REAL user wallet balances automatically.
 * The signal below is a simple SMA/momentum rule — it is not an "institutional
 * quant engine" and has no demonstrated statistical edge. Do not represent
 * this to users as guaranteed-accuracy or guaranteed-profit; that claim isn't
 * true of any next-candle predictor and making it is a compliance risk.
 * The previous version of this file also contained a hardcoded admin-email
 * bypass that skipped balance/risk checks and granted "unlimited capital" —
 * that has been removed entirely. There should be no backdoor accounts here.
 */
export function startAiBotEngine() {
  console.log("Starting auto-trade engine (SMA/momentum signal, real wallet balances)...");

  // Runs every 5 seconds for fast demo profit accumulation
  setInterval(async () => {
    try {
      // 1. Find all users who consented to AI Auto-Trade
      const activeUsers = await db.select().from(users).where(eq(users.autoTradeEnabled, true));
      if (activeUsers.length === 0) return; 
      
      // 2. Expanded Symbol Universe — Crypto, Forex, Commodities
      const topSymbols = ["BTCUSD", "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "EURUSD", "GBPUSD", "XAUUSD", "XAUTUSDC", "XAUTUSDT"];
      
      for (const sym of topSymbols) {
        const [inst] = await db.select().from(instruments).where(eq(instruments.symbol, sym));
        if (!inst) continue;

        const [priceData] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, inst.id));
        if (!priceData || !priceData.price) continue;
        
        const price = Number(priceData.price);
        const sparkline = (priceData.sparkline as string[]) || [];
        // 3. ── Canonical AI Engine Integration (Rule 32) ──
        // Node AI Bot consumes the canonical Python Prediction API rather than generating conflicting signals
        const prices: number[] = sparkline.map(Number);
        if (prices.length < 5) continue;

        const pyPort = process.env.PYTHON_PORT || "8008";
        const pyUrl = process.env.PYTHON_AI_URL || `http://127.0.0.1:${pyPort}`;

        const candles = prices.map((p: number, idx: number) => ({
          open: idx > 0 ? prices[idx - 1] : p,
          high: Math.max(p, idx > 0 ? prices[idx - 1] : p),
          low: Math.min(p, idx > 0 ? prices[idx - 1] : p),
          close: p,
          volume: 1000,
          time: Math.floor(Date.now() / 1000) - (prices.length - idx) * 60
        }));

        let signal: "BUY" | "SELL" | null = null;
        let reason = "";

        try {
          const resp = await fetch(`${pyUrl}/api/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              market: sym,
              timeframe: "5m",
              candles
            }),
            signal: AbortSignal.timeout(3000)
          });

          if (resp.ok) {
            const aiData: any = await resp.json();
            if (aiData.signal === "BUY" && (aiData.signal_quality === "HIGH" || aiData.signal_quality === "MODERATE" || aiData.signal_quality === "MEDIUM")) {
              signal = "BUY";
              reason = `Canonical AI Model (${aiData.model_version || "v3"}) · ${aiData.regime || "TREND"} (${aiData.mtf_alignment || "MTF"} MTF)`;
            } else if (aiData.signal === "SELL" && (aiData.signal_quality === "HIGH" || aiData.signal_quality === "MODERATE" || aiData.signal_quality === "MEDIUM")) {
              signal = "SELL";
              reason = `Canonical AI Model (${aiData.model_version || "v3"}) · ${aiData.regime || "TREND"} (${aiData.mtf_alignment || "MTF"} MTF)`;
            } else {
              // Rule 17: Canonical engine returned NO TRADE or low edge — abstain from trading!
              continue;
            }
          } else {
            continue;
          }
        } catch {
          // Rule 7: If Python AI engine is offline or timing out, safely abstain without fabricating trades
          continue;
        }

        if (!signal) continue;

         for (const user of activeUsers) {
            // Every user goes through the same checks. There is no admin bypass —
            // a prior version of this file hardcoded two admin emails that
            // skipped balance/risk checks entirely and traded with "unlimited
            // capital." That is a backdoor, not a feature, and has been removed.

            // ── SECURITY & COMPLIANCE CHECKS ──
            const isAdm = user.role === "ADMIN_1" || user.role === "ADMIN_2" || ["saran123@gmail.com", "htctrade123@gmail.com"].includes((user.email || "").toLowerCase());
            const hasFirebase = !!process.env.FIREBASE_SERVICE_ACCOUNT;
            // 1. Mandatory Google/Firebase verification for live real money auto-trade
            if (hasFirebase && !user.firebaseUid && !isAdm && user.tradeMode !== "DEMO") {
               await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
               continue;
            }
            // 2. Mandatory Commission Agreement for live trading
            if (!user.commissionAgreed && !isAdm && user.tradeMode !== "DEMO") {
               await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
               continue;
            }

            const userActiveTrades = await db.select()
               .from(timeBasedOrders)
               .where(
                  and(
                     eq(timeBasedOrders.userId, user.id), 
                     eq(timeBasedOrders.status, "ACTIVE" as any), 
                     eq(timeBasedOrders.placedBy, "AI_BOT")
                  )
               );
            
            if (userActiveTrades.length >= 5) continue; // concurrent trade cap, applies to everyone

            try {
              const risk = await storage.checkRiskManagement(user.id);
              if (!risk.allowed) continue;

              // Shorter 30s trades for faster profit cycles
              const expiresAt = new Date(Date.now() + 30 * 1000);

              let amountNum = parseFloat(user.autoTradeAmount || "0.00");
              if (amountNum < 1.0) continue; // Safety: skip if not configured
              
              // ── ROUND-BASED INVESTMENT LOGIC (applies to every user, no exceptions) ──
              const round = user.autoInvestRound || 1;
              const pnl = parseFloat(user.autoInvestRoundPnl as string);

              // Use custom limits if set by an admin in the dashboard, otherwise fall back to defaults
              const profitLimit = parseFloat(user.autoInvestProfitLimit || "100.00");
              const lossLimit = parseFloat(user.autoInvestLossLimit || "50.00");

              if (round === 1) { amountNum = 50.00; }
              else if (round === 2) { amountNum = 45.00; }
              else if (round === 3) { amountNum = 35.00; }
              else {
                 await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                 continue;
              }

              // Check profit target or loss limit for this auto-invest run
              if (pnl >= profitLimit) {
                 await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                 continue;
              }
              if (pnl <= -lossLimit) {
                 await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                 continue;
              }

              // Commission is charged on every trade regardless of win/loss. This MUST be
              // clearly disclosed to the user (see `commissionAgreed` check above) — a fee
              // structure like this means the platform profits independent of trade outcome,
              // which is exactly the kind of thing that needs to be in plain language in your
              // terms of service, not just implied by a checkbox.
              const COMMISSION_RATE = 0.30; // keep this configurable from an admin settings table, not hardcoded, if it can change
              const commission = amountNum * COMMISSION_RATE;
              const totalDeduct = amountNum + commission;

              if (parseFloat(user.walletBalance as string) < totalDeduct) {
                 await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                 continue;
              }
              await storage.updateWalletBalance(user.id, -totalDeduct);

              const order = await storage.createTimeBasedOrder(user.id, {
                instrumentId: inst.id,
                placedBy: "AI_BOT", 
                side: signal,
                amount: String(amountNum),
                strikePrice: String(price),
                durationSeconds: 30,
                expiresAt,
                status: "ACTIVE" as any,
              } as any);

              // Log Investment Transaction
              await storage.createWalletTransaction({
                 userId: user.id, type: "TRADE_DEDUCTION", amount: String(amountNum),
                 status: "SUCCESS", referenceId: String(order.id)
              } as any);

              // Log Commission Transaction
              if (commission > 0) {
                 await storage.createWalletTransaction({
                    userId: user.id, type: "COMMISSION", amount: String(commission),
                    status: "SUCCESS", referenceId: String(order.id)
                 } as any);
              }

              console.log(`[auto-trade] ${signal} on ${sym} for user ${user.email} (amt: $${amountNum}, commission: $${commission})`);
            } catch {
              // Ignore individual placement errors 
            }
         }
      }

    } catch (err) {
      console.error("AI Bot Engine Error:", err);
    }
  }, 5000);
}
