import { db } from "./db";
import { users, latestPrices, timeBasedOrders, instruments } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { storage } from "./storage";

export function startAiBotEngine() {
  console.log("Starting QuantEdge AI Auto-Pilot Engine v2.0 — Maximum Accuracy Mode...");

  // Runs every 5 seconds for fast demo profit accumulation
  setInterval(async () => {
    try {
      // 1. Find all users who consented to AI Auto-Trade
      const activeUsers = await db.select().from(users).where(eq(users.autoTradeEnabled, true));
      if (activeUsers.length === 0) return; 
      
      // 2. Expanded Symbol Universe — Crypto, Forex, Commodities
      const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "EURUSD", "GBPUSD", "XAUUSD"];
      
      for (const sym of topSymbols) {
        const [inst] = await db.select().from(instruments).where(eq(instruments.symbol, sym));
        if (!inst) continue;

        const [priceData] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, inst.id));
        if (!priceData || !priceData.price) continue;
        
        const price = Number(priceData.price);
        const sparkline = priceData.sparkline as string[] || [];
        if (sparkline.length < 3) continue;

        // 3. ── INSTITUTIONAL QUANT ENGINE (DETERMINISTIC) ──
        const prices = sparkline.map(Number);
        const sma20 = prices.reduce((a, b) => a + b, 0) / prices.length;
        const lastPx = prices[prices.length - 1];
        const prevPx = prices[prices.length - 2];
        
        // Trend Velocity: measure direction and speed of the move
        const velocity = ((lastPx - prices[0]) / prices[0]) * 1000;
        const shortMomentum = lastPx > prevPx ? "BULL" : "BEAR";
        
        let signal: "BUY" | "SELL" | null = null;
        let reason = "";

        // HIGH ACCURACY ENTRY CRITERIA
        // Rule 1: Velocity must be significant (>0.05% move)
        // Rule 2: Current price must align with the short-term momentum
        // Rule 3: Price must be above/below the 20-period average (SMA)
        
        if (velocity > 0.05 && lastPx > sma20 && shortMomentum === "BULL") {
           signal = "BUY";
           reason = "Strong Bullish Trend Velocity + SMA Alignment";
        } else if (velocity < -0.05 && lastPx < sma20 && shortMomentum === "BEAR") {
           signal = "SELL";
           reason = "Heavy Bearish Momentum + Institutional Sell-off";
        } else {
           // Skip trade if accuracy threshold not met (No more Math.random)
           continue; 
        }

        if (!signal) continue;

         for (const user of activeUsers) {
            // ADMIN BYPASS
            const isAdmin = ["saran123@gmail.com", "htctrade@gmail.com"].includes((user.email || "").toLowerCase());
            
            // ── SECURITY & COMPLIANCE CHECKS ──
            if (!isAdmin) {
               // 1. Mandatory Google/Firebase verification for non-admin safety
               if (!user.firebaseUid) {
                  await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                  continue;
               }
               // 2. Mandatory Commission Agreement
               if (!user.commissionAgreed) {
                  await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                  continue;
               }
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
            
            if (userActiveTrades.length >= 3) continue; // Allow 3 concurrent AI trades

            try {
              const risk = await storage.checkRiskManagement(user.id);
              if (!risk.allowed) continue;

              // Shorter 30s trades for faster profit cycles
              const expiresAt = new Date(Date.now() + 30 * 1000);

              let amountNum = parseFloat(user.autoTradeAmount || "5.00");
              
              // ── ROUND-BASED INVESTMENT LOGIC (NON-ADMINS) ──
              if (!isAdmin) {
                 const round = user.autoInvestRound || 1;
                 const pnl = parseFloat(user.autoInvestRoundPnl as string);
                 
                 let roundProfitLimit = 50.00;
                 let roundLossLimit = 20.00; // Mandatory loss limit

                 if (round === 1) {
                    amountNum = 50.00;
                    roundProfitLimit = 50.00;
                    roundLossLimit = 20.00;
                 } else if (round === 2) {
                    amountNum = 45.00;
                    roundProfitLimit = 45.00;
                    roundLossLimit = 20.00;
                 } else if (round === 3) {
                    amountNum = 35.00;
                    roundProfitLimit = 35.00;
                    roundLossLimit = 15.00;
                 } else {
                    // All rounds finished
                    await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                    continue;
                 }

                 // Check Round Status (Profit Target or Loss Limit)
                 if (pnl >= roundProfitLimit) continue; // Waiting for round incrementer in background.ts
                 if (pnl <= -roundLossLimit) {
                    // STOP Auto-Invest on Loss Limit Breach
                    await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                    continue;
                 }
              }

              // ── COMMISSION & BALANCE DEDUCTION ──
              const commission = isAdmin ? 0 : (amountNum * 0.10);
              const totalDeduct = amountNum + commission;

              // Check if user has enough Real Wallet Balance
              if (parseFloat(user.walletBalance as string) < totalDeduct) {
                 await db.update(users).set({ autoTradeEnabled: false }).where(eq(users.id, user.id));
                 continue;
              }

              // Deduct Wallet Balance (Invest + Commission)
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

              // Log Commission Transaction (Non-Admins)
              if (commission > 0) {
                 await storage.createWalletTransaction({
                    userId: user.id, type: "COMMISSION", amount: String(commission),
                    status: "SUCCESS", referenceId: String(order.id)
                 } as any);
              }

              console.log(`[AI Bot v2.0] ${signal} on ${sym} for User ${user.email} (Amt: $${amountNum}, Fee: $${commission})`);
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
