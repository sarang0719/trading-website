import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);


  await storage.seed();

  // ── HEALTH CHECK (required by Replit, Railway, and load balancers) ──────
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "HTC Trading Platform",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    });
  });
  app.get("/ping", (_req, res) => res.send("pong"));

  app.get(api.instruments.list.path, async (req, res) => {
    const input = api.instruments.list.input?.parse(req.query);
    const instruments = await storage.listInstruments(input as any);
    res.json(instruments);
  });

  app.get(api.instruments.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const detail = await storage.getInstrumentDetail(id);
    if (!detail) return res.status(404).json({ message: "Instrument not found" });
    res.json(detail);
  });

  app.get(api.watchlists.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const watchlists = await storage.listWatchlists(userId);
    res.json(watchlists);
  });

  app.post(api.watchlists.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const input = api.watchlists.create.input.parse(req.body);
      const id = await storage.createWatchlist(userId, input as any);
      res.status(201).json({ id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      throw err;
    }
  });

  app.get(api.watchlists.get.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const id = Number(req.params.id);
    const wl = await storage.getWatchlistDetail(userId, id);
    if (!wl) return res.status(404).json({ message: "Watchlist not found" });
    res.json(wl);
  });

  app.post(api.watchlists.addItem.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const watchlistId = Number(req.params.id);
      const input = api.watchlists.addItem.input.parse(req.body);
      await storage.addWatchlistItem(userId, watchlistId, input as any);
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.watchlists.removeItem.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const watchlistId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    await storage.removeWatchlistItem(userId, watchlistId, itemId);
    res.status(204).send();
  });

  app.get(api.portfolio.summary.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const summary = await storage.getPortfolioSummary(userId);
    res.json(summary);
  });

  app.post(api.portfolio.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const input = api.portfolio.create.input.parse(req.body);
      const id = await storage.createPortfolio(userId, input as any);
      res.status(201).json({ id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      throw err;
    }
  });

  app.get(api.orders.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const list = await storage.listOrders(userId);
    res.json(list);
  });

  app.post(api.orders.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const input = api.orders.create.input.parse(req.body);
      const order = await storage.createOrder(userId, input as any);
      res.status(201).json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      throw err;
    }
  });

  app.post(api.orders.cancel.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const id = Number(req.params.id);
    const updated = await storage.cancelOrder(userId, id);
    if (!updated) return res.status(404).json({ message: "Order not found" });
    res.json(updated);
  });

  app.get(api.timeTrades.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub as string;
    const list = await storage.listTimeBasedOrders(userId);
    res.json(list);
  });

  app.post(api.timeTrades.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const input = api.timeTrades.create.input.parse(req.body);

      const user = await storage.getUser(userId);
      const amountStr = input.amount as unknown as string;
      const amount = parseFloat(amountStr);
      const mode = user?.tradeMode ?? "DEMO";

      if (mode === "REAL") {
        // Real mode: deduct from realBalance
        if (!user || parseFloat(user.walletBalance as string) < amount) {
          return res.status(400).json({ message: "Insufficient Real Wallet Balance. Deposit funds to trade real markets!" });
        }
        await storage.updateWalletBalance(userId, -amount);
        const order = await storage.createTimeBasedOrder(userId, input as any);
        await storage.createWalletTransaction({
          userId, type: "TRADE_DEDUCTION", amount: String(amount),
          status: "SUCCESS", referenceId: String(order.id), mode: "REAL"
        } as any);
        res.status(201).json(order);
      } else {
        // Demo mode: deduct from demoBalance
        if (!user || parseFloat(user.demoBalance as string) < amount) {
          return res.status(400).json({ message: "Insufficient Demo Balance. Reset demo account to get $10,000 again!" });
        }
        await storage.updateDemoBalance(userId, -amount);
        const order = await storage.createTimeBasedOrder(userId, input as any);
        await storage.createWalletTransaction({
          userId, type: "TRADE_DEDUCTION", amount: String(amount),
          status: "SUCCESS", referenceId: String(order.id), mode: "DEMO"
        } as any);
        res.status(201).json(order);
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      return res.status(400).json({ message: err.message || "Invalid request" });
    }
  });

  app.post("/api/timeTrades/:id/sell", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const orderId = Number(req.params.id);
      
      const orders = await storage.getActiveTimeBasedOrders();
      const trade = orders.find(o => o.id === orderId && String(o.userId) === userId);
      
      if (!trade) {
        return res.status(404).json({ message: "Active trade not found for immediate sale." });
      }

      // Settle the trade immediately
      const { db } = await import("./db");
      const { latestPrices } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const [priceRow] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, trade.instrumentId));
      if (!priceRow || !priceRow.price) return res.status(400).json({ message: "No current price available." });

      const currentPrice = parseFloat(priceRow.price as string);
      const strike = parseFloat(trade.strikePrice as string);
      let isWin = false;
      
      if (trade.side === "BUY") isWin = currentPrice > strike;
      if (trade.side === "SELL") isWin = currentPrice < strike;
      
      const parsedAmount = parseFloat(trade.amount as string);
      let returnAmount = 0;
      let status = "LOSS";
      
      if (isWin) {
        returnAmount = parsedAmount + (parsedAmount * 0.85); // standard 85% payout
        status = "WIN";
      }

      await storage.updateTimeBasedOrder(trade.id, {
        status: status as any,
        settlePrice: currentPrice.toString(),
      });

      if (status === "WIN" && returnAmount > 0) {
          // Check original wallet mode
          const txs = await storage.getWalletTransactions(userId);
          const deductTx = txs.find(t => t.referenceId === String(trade.id) && t.type === "TRADE_DEDUCTION");
          const tradeMode = (deductTx as any)?.mode ?? "REAL";

          if (tradeMode === "DEMO") {
            await storage.updateDemoBalance(userId, returnAmount);
          } else {
            await storage.updateWalletBalance(userId, returnAmount);
          }

          await storage.createWalletTransaction({
              userId, type: "TRADE_WIN", amount: String(returnAmount),
              status: "SUCCESS", referenceId: String(trade.id), mode: tradeMode
          } as any);
      }

      res.json({ message: "Trade settled immediately.", status, returnAmount });
    } catch (err: any) {
      console.error("Manual Sell Error:", err);
      res.status(500).json({ message: "Failed to settle early." });
    }
  });

  app.get(api.market.news.path, async (_req, res) => {
    const news = await storage.getNews();
    res.json(news);
  });

  // ──────────────────────────────────────────────
  // REAL-MONEY + DEMO WALLET SYSTEM
  // ──────────────────────────────────────────────

  // GET wallet info: real balance, demo balance, current mode
  app.get("/api/wallet/info", isAuthenticated, async (req: any, res) => {
    try {
      const info = await storage.getWalletInfo(req.user.claims.sub as string);
      res.json(info ?? { realBalance: "0.00", demoBalance: "10000.00", tradeMode: "DEMO" });
    } catch { res.status(500).json({ realBalance: "0.00", demoBalance: "10000.00", tradeMode: "DEMO" }); }
  });

  // Legacy: keep /api/wallet for backward compat
  app.get("/api/wallet", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub as string);
      res.json({ balance: user?.walletBalance || "0.00" });
    } catch { res.status(500).json({ balance: "0.00" }); }
  });

  app.get("/api/wallet/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const txs = await storage.getWalletTransactions(req.user.claims.sub as string);
      res.json(txs);
    } catch { res.status(500).json([]); }
  });

  // Switch trade mode: DEMO <-> REAL
  app.post("/api/wallet/mode", isAuthenticated, async (req: any, res) => {
    try {
      const { mode } = z.object({ mode: z.enum(["DEMO", "REAL"]) }).parse(req.body);
      const userId = req.user.claims.sub as string;
      const updated = await storage.setTradeMode(userId, mode);
      return res.json({ tradeMode: updated.tradeMode, realBalance: updated.walletBalance, demoBalance: updated.demoBalance });
    } catch (e: any) { return res.status(400).json({ message: e.message }); }
  });

  // Reset demo account back to $10,000
  app.post("/api/wallet/demo/reset", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const updated = await storage.resetDemoBalance(userId);
      await storage.createWalletTransaction({
        userId, type: "DEMO_RESET" as any, amount: "10000.00",
        status: "SUCCESS", mode: "DEMO"
      } as any);
      return res.json({ demoBalance: updated.demoBalance, message: "Demo balance reset to $10,000" });
    } catch (e: any) { return res.status(500).json({ message: e.message }); }
  });

  app.post("/api/user/commission-agreement", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const updated = await storage.updateUser(userId, { commissionAgreed: true });
      return res.json({ commissionAgreed: updated.commissionAgreed });
    } catch (e: any) { return res.status(500).json({ message: e.message }); }
  });

  app.post("/api/wallet/withdraw", isAuthenticated, async (req: any, res) => {
    try {
      const { amount } = z.object({ amount: z.number().min(10) }).parse(req.body);
      const userId = req.user.claims.sub as string;
      const user = await storage.getUser(userId);
      if (!user || parseFloat(user.walletBalance as string) < amount) {
        return res.status(400).json({ message: "Insufficient balance" });
      }
      
      const updatedUser = await storage.updateWalletBalance(userId, -amount);
      const tx = await storage.createWalletTransaction({
        userId, type: "WITHDRAW", amount: String(amount), status: "SUCCESS", mode: "REAL"
      } as any);

      return res.json({ message: "Withdrawal successful", transaction: tx, newBalance: updatedUser.walletBalance });
    } catch (e: any) { return res.status(400).json({ message: e.message }); }
  });

  app.post("/api/wallet/deposit/create-order", isAuthenticated, async (req: any, res) => {
    try {
      const { amount } = z.object({ amount: z.number().min(50) }).parse(req.body);
      const Razorpay = (await import("razorpay")).default;
      const rzp = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_SYjafmuTvifatp",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "kqh3FVifvQJFCkfcv056TS6d"
      });
      const order = await rzp.orders.create({
        amount: Math.round(amount * 100), currency: "INR",
        notes: { userId: req.user.claims.sub, type: "WALLET_DEPOSIT" }
      });
      return res.json({ orderId: order.id, amount: amount * 100, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_SYjafmuTvifatp" });
    } catch (e:any) { return res.status(500).json({ message: e.message }); }
  });

  app.post("/api/wallet/deposit/verify", isAuthenticated, async (req: any, res) => {
    try {
       const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
       const crypto = await import("crypto");
       const secret = process.env.RAZORPAY_KEY_SECRET || "kqh3FVifvQJFCkfcv056TS6d";
       const expected = crypto.createHmac("sha256", secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
       if (expected !== razorpay_signature) return res.status(400).json({ message: "Signature mismatch" });

       const userId = req.user.claims.sub as string;
       // Check idempotency: don't double-credit same payment
       const existing = await storage.getWalletTransactions(userId);
       if (existing.some(t => t.referenceId === razorpay_payment_id)) {
         return res.status(409).json({ message: "Payment already processed" });
       }

       const updatedUser = await storage.updateWalletBalance(userId, amount);
       await storage.createWalletTransaction({
         userId, type: "DEPOSIT", amount: String(amount), status: "SUCCESS",
         referenceId: razorpay_payment_id, mode: "REAL"
       } as any);

       res.json({ success: true, newBalance: updatedUser.walletBalance });
    } catch (e:any) { return res.status(500).json({ message: e.message }); }
  });

  // Razorpay Webhook — auto verify and credit wallet
  app.post("/api/razorpay/webhook", async (req: any, res) => {
    try {
      const crypto = await import("crypto");
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
      const signature = req.headers["x-razorpay-signature"] as string;

      if (webhookSecret) {
        const body = JSON.stringify(req.body);
        const expected = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
        if (expected !== signature) {
          return res.status(400).json({ message: "Invalid webhook signature" });
        }
      }

      const event = req.body;
      if (event.event === "payment.captured") {
        const payment = event.payload?.payment?.entity;
        if (!payment) return res.status(200).json({ ok: true });

        const userId = payment.notes?.userId;
        const type = payment.notes?.type;
        if (!userId || type !== "WALLET_DEPOSIT") return res.status(200).json({ ok: true });

        // De-dupe: check if already processed
        const existing = await storage.getWalletTransactions(userId);
        if (existing.some(t => t.referenceId === payment.id)) {
          return res.status(200).json({ ok: true, message: "Already processed" });
        }

        const amountInRupees = payment.amount / 100;
        await storage.updateWalletBalance(userId, amountInRupees);
        await storage.createWalletTransaction({
          userId, type: "DEPOSIT", amount: String(amountInRupees),
          status: "SUCCESS", referenceId: payment.id, mode: "REAL"
        } as any);

        console.log(`[Webhook] Credited ₹${amountInRupees} to user ${userId}`);
      }
      return res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error("[Webhook] Error:", e.message);
      return res.status(500).json({ message: e.message });
    }
  });

  // ──────────────────────────────────────────────
  // AI PREDICTION CREDITS SYSTEM
  // ──────────────────────────────────────────────
  const FREE_LIMIT = 6;

  // Admin emails — unlimited access, no subscription required
  const ADMIN_EMAILS = new Set([
    "saran123@gmail.com",
    "htctrade@gmail.com",
  ]);
  const isAdmin = (email?: string | null) => !!email && ADMIN_EMAILS.has(email.toLowerCase());

  app.get("/api/ai/credits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Admins get unlimited access — no credit tracking
      if (isAdmin(user.email)) {
        return res.json({
          freePredictionsUsed: 0,
          freePredictionsLimit: FREE_LIMIT,
          paidCredits: 0,
          canUse: true,
          isFreeTier: true,
          isAdmin: true,
          unlimited: true,
        });
      }

      const freePredictionsUsed = user.freePredictionsUsed ?? 0;
      const paidCredits = user.paidCredits ?? 0;
      return res.json({
        freePredictionsUsed,
        freePredictionsLimit: FREE_LIMIT,
        paidCredits,
        canUse: freePredictionsUsed < FREE_LIMIT || paidCredits > 0,
        isFreeTier: freePredictionsUsed < FREE_LIMIT,
        isAdmin: false,
        unlimited: false,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ai/use-prediction", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.isAIBlocked) return res.status(403).json({ 
        granted: false, 
        message: "AI prediction services are currently restricted for your account. Contact support." 
      });

      // Admins: unlimited, never deduct
      if (isAdmin(user.email)) {
        return res.json({ granted: true, source: "admin", remaining: Infinity });
      }

      const used = user.freePredictionsUsed ?? 0;
      const paid = user.paidCredits ?? 0;
      if (used < FREE_LIMIT) {
        await storage.updateAiCredits(userId, { freePredictionsUsed: used + 1 });
        return res.json({ granted: true, source: "free", remaining: FREE_LIMIT - used - 1 });
      } else if (paid > 0) {
        await storage.updateAiCredits(userId, { paidCredits: paid - 1 });
        return res.json({ granted: true, source: "paid", remaining: paid - 1 });
      } else {
        return res.status(402).json({ granted: false, message: "No credits remaining. Please purchase a plan." });
      }
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── RAZORPAY ──
  const AI_PLANS: Record<string, { credits: number; amountPaise: number; label: string }> = {
    starter: { credits: 4,  amountPaise: 50000,  label: "₹500 – 4 AI Predictions" },
    pro:     { credits: 10, amountPaise: 100000, label: "₹1000 – 10 AI Predictions" },
  };

  app.post("/api/razorpay/create-order", isAuthenticated, async (req: any, res) => {
    try {
      const { planId } = z.object({ planId: z.string() }).parse(req.body);
      const plan = AI_PLANS[planId];
      if (!plan) return res.status(400).json({ message: "Invalid plan" });
      const Razorpay = (await import("razorpay")).default;
      const rzp = new Razorpay({
        key_id:    process.env.RAZORPAY_KEY_ID    || "rzp_test_SYjafmuTvifatp",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "kqh3FVifvQJFCkfcv056TS6d",
      });
      const order = await rzp.orders.create({
        amount: plan.amountPaise, currency: "INR",
        notes: { planId, userId: req.user.claims.sub },
      });
      return res.json({ orderId: order.id, amount: plan.amountPaise, currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_SYjafmuTvifatp",
        planLabel: plan.label, credits: plan.credits });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Failed to create order" });
    }
  });

  app.post("/api/razorpay/verify", isAuthenticated, async (req: any, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } =
        z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(),
          razorpay_signature: z.string(), planId: z.string() }).parse(req.body);
      const crypto = await import("crypto");
      const secret = process.env.RAZORPAY_KEY_SECRET || "kqh3FVifvQJFCkfcv056TS6d";
      const expected = crypto.createHmac("sha256", secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ message: "Payment signature mismatch" });
      const plan = AI_PLANS[planId];
      if (!plan) return res.status(400).json({ message: "Invalid plan" });
      const userId = req.user.claims.sub as string;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const newPaid = (user.paidCredits ?? 0) + plan.credits;
      await storage.updateAiCredits(userId, { paidCredits: newPaid });
      return res.json({ success: true, creditsAdded: plan.credits, totalPaidCredits: newPaid });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || "Verification failed" });
    }
  });

  app.get(api.learn.list.path, async (_req, res) => {
    const learn = await storage.listLearn();
    res.json(learn);
  });

  app.get(api.learn.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const article = await storage.getLearn(id);
    if (!article) return res.status(404).json({ message: "Article not found" });
    res.json(article);
  });

  app.post(api.settings.aiTrade.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub as string;
      const input = api.settings.aiTrade.input.parse(req.body);
      await storage.updateAiTradeConsent(userId, input.enabled, input.amount);
      res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || "Invalid request" });
    }
  });

  app.patch("/api/user/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { phoneNumber } = z.object({ phoneNumber: z.string().max(20) }).parse(req.body);
      const userId = (req.user as any).id || (req.user as any).claims?.sub;
      const updated = await storage.updateUser(userId, { phoneNumber });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // --- WITHDRAWAL ROUTES ---
  app.post("/api/wallet/withdraw", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { amount, method, details } = z.object({
        amount: z.string(),
        method: z.string(),
        details: z.string(),
      }).parse(req.body);

      const userId = (req.user as any).id || (req.user as any).claims?.sub;
      const amountVal = parseFloat(amount);

      const walletInfo = await storage.getWalletInfo(userId);

      if (!walletInfo || parseFloat(walletInfo.realBalance) < amountVal) {
        return res.status(400).json({ message: "Insufficient balance for withdrawal" });
      }

      // Deduct balance immediately and create a pending request
      // We deduct now to "freeze" the funds. If rejected, we refund.
      await storage.updateWalletBalance(userId, -amountVal);
      
      const request = await storage.createWithdrawalRequest({
        userId,
        amount,
        method,
        details,
        status: "PENDING"
      });

      await storage.createWalletTransaction({
        userId,
        type: "WITHDRAW",
        amount: String(-amountVal),
        status: "PENDING",
        mode: "REAL",
        referenceId: `WD-${request.id}`
      } as any);

      await storage.logActivity(userId, "WITHDRAWAL_REQUEST", `Requested ₹${amount} via ${method}`);
      res.json(request);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/wallet/withdrawals", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).id || (req.user as any).claims?.sub;
    const list = await storage.getUserWithdrawalRequests(userId);
    res.json(list);
  });


  // ── ADMIN CONTROL CENTER ──
  const checkAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && (req.user as any).email === "saran123@gmail.com") {
      return next();
    }
    return res.status(403).json({ message: "Access Denied: Admin privileges required." });
  };

  // 1. List all users with basic info
  app.get("/api/admin/users", checkAdmin, async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // 2. Comprehensive User Profile / Monitoring
  app.get("/api/admin/users/:id/monitoring", checkAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const loginHistory = await storage.getLoginHistory(userId);
      const activities = await storage.getUserActivities(userId);
      
      // Also get their orders/trades
      const orders = await storage.listOrders(userId); 
      const timeTrades = await storage.listTimeBasedOrders(userId);
      const transactions = await storage.getWalletTransactions(userId);

      res.json({
        user,
        loginHistory,
        activities,
        trades: {
          standard: orders,
          timeBased: timeTrades
        },
        transactions,
      });
    } catch (err: any) {
       res.status(500).json({ message: err.message });
    }
  });

  // 3. User Control: Block / Unblock / Restrict AI
  app.patch("/api/admin/users/:id/control", checkAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const { isBlocked, isAIBlocked } = z.object({
        isBlocked: z.boolean().optional(),
        isAIBlocked: z.boolean().optional(),
      }).parse(req.body);

      const updated = await storage.updateUserAdminFlags(userId, { isBlocked, isAIBlocked });
      
      // Log the change as an activity
      if (isBlocked !== undefined) {
         await storage.logActivity(userId, isBlocked ? "BLOCKED" : "UNBLOCKED", "Status changed by administrator");
      }
      if (isAIBlocked !== undefined) {
         await storage.logActivity(userId, isAIBlocked ? "AI_RESTRICTED" : "AI_ENABLED", "AI access changed by administrator");
      }

      res.json(updated);
    } catch (err: any) {
       res.status(400).json({ message: err.message });
    }
  });

  // 4. Withdrawal Management
  app.get("/api/admin/withdrawals", checkAdmin, async (_req, res) => {
    try {
      const list = await storage.getAllWithdrawalRequests();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/withdrawals/:id/status", checkAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, adminNotes } = z.object({
        status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
        adminNotes: z.string().optional()
      }).parse(req.body);

      const currentReq = (await storage.getAllWithdrawalRequests()).find(r => r.id === id);
      if (!currentReq) return res.status(404).json({ message: "Request not found" });

      if (status === "REJECTED" && currentReq.status === "PENDING") {
        // Refund the amount if rejected
        await storage.updateWalletBalance(currentReq.userId, parseFloat(currentReq.amount));
        await storage.logActivity(currentReq.userId, "WITHDRAWAL_REJECTED", `Refunded ₹${currentReq.amount} due to rejection`);
      }

      const updated = await storage.updateWithdrawalStatus(id, status, adminNotes);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // ──────────────────────────────────────────────
  // INSTITUTIONAL MARKET DATA PROXY (v67.0)
  // GoldAPI.io → Yahoo Finance fallback
  // ──────────────────────────────────────────────
  app.get("/api/market-data/price/:symbol", async (req, res) => {
    const GOLDAPI_KEY = process.env.GOLDAPI_API_KEY || "goldapi-c66smnwt4wrc-io";
    try {
      let symbol = req.params.symbol;
      const isGold   = symbol === "XAUUSD";
      const isSilver = symbol === "XAGUSD";

      // ── Tier 1: GoldAPI.io (metals only — most accurate spot price) ──────
      if (isGold || isSilver) {
        try {
          const metalSym = isGold ? "XAU" : "XAG";
          const gaRes = await fetch(
            `https://www.goldapi.io/api/${metalSym}/USD`,
            { headers: { "x-access-token": GOLDAPI_KEY, "Content-Type": "application/json" } }
          );
          if (gaRes.ok) {
            const ga = await gaRes.json() as any;
            if (ga && ga.price) {
              return res.json({
                symbol: req.params.symbol,
                price: ga.price,
                changeAbs: ga.ch ?? 0,
                changePct: ga.chp ?? 0,
                high: ga.high_price,
                low:  ga.low_price,
                open: ga.open_price,
                asOf: ga.timestamp ? new Date(ga.timestamp * 1000).toISOString() : new Date().toISOString(),
                source: "GoldAPI.io"
              });
            }
          }
        } catch { /* fall through to Yahoo */ }
      }

      // ── Tier 2: Yahoo Finance (fallback for metals + all other symbols) ──
      const yahooSym = isGold ? "GC=F" : isSilver ? "SI=F" : symbol === "WTIUSD" ? "CL=F" :
        (symbol.length === 6 && !symbol.includes("USDT")) ? `${symbol}=X` : symbol;

      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1m&range=1d`);
      if (!response.ok) throw new Error("Yahoo Finance Fetch Failed");
      const data = await response.json() as any;
      const result = data?.chart?.result?.[0];
      if (result && result.meta?.regularMarketPrice) {
        return res.json({
          symbol: req.params.symbol,
          price: result.meta.regularMarketPrice,
          changeAbs: result.meta.regularMarketPrice - result.meta.previousClose,
          changePct: ((result.meta.regularMarketPrice - result.meta.previousClose) / result.meta.previousClose) * 100,
          asOf: new Date().toISOString(),
          source: "Yahoo Finance"
        });
      }
      res.status(404).json({ message: "Price data not available" });
    } catch {
      res.status(400).json({ message: "Fallback API Timeout" });
    }
  });

  app.get("/api/market-data/history/:symbol", async (req, res) => {
    try {
      let { symbol } = req.params;
      const interval = (req.query.interval as string) || "1m";

      let results: any[] = [];
      let source = "";

      const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "demo";
      const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || "5703b6c3bb53485bbf9b57232c9c59b1";

      // 1. Check if Crypto / Gold (use Binance)
      const binanceSymbol = symbol === "XAUUSD" ? "PAXGUSDT" : symbol;
      const GOLDAPI_KEY   = process.env.GOLDAPI_API_KEY || "goldapi-c66smnwt4wrc-io";
      const isMetals = symbol === "XAUUSD" || symbol === "XAGUSD";
      const isCrypto = symbol.endsWith("USDT") && !isMetals;

      // ── Tier 0: GoldAPI.io Historical OHLC (Gold + Silver only) ─────────
      if (isMetals) {
        try {
          const metalSym = symbol === "XAUUSD" ? "XAU" : "XAG";
          // GoldAPI historical: fetch last 30 days daily bars as fallback for all intervals
          const today = new Date();
          const gaOhlcResults: any[] = [];

          // GoldAPI provides per-date endpoints — fetch last 30 days
          const promises = Array.from({ length: 30 }, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
            return fetch(`https://www.goldapi.io/api/${metalSym}/USD/${dateStr}`, {
              headers: { "x-access-token": GOLDAPI_KEY, "Content-Type": "application/json" }
            }).then(r => r.ok ? r.json() : null).catch(() => null);
          });

          const dayResults = await Promise.all(promises);
          for (const day of dayResults) {
            if (day && day.price && day.timestamp) {
              gaOhlcResults.push({
                time:   day.timestamp,
                open:   day.open_price  || day.price,
                high:   day.high_price  || day.price,
                low:    day.low_price   || day.price,
                close:  day.price,
                volume: 0
              });
            }
          }

          if (gaOhlcResults.length > 5) {
            gaOhlcResults.sort((a, b) => a.time - b.time);
            console.log(`[GoldAPI] Loaded ${gaOhlcResults.length} bars for ${symbol}`);
            return res.json({ results: gaOhlcResults, source: "GoldAPI.io" });
          }
        } catch { /* fall through to Binance/TwelveData */ }
      }

      // ── Tier 1: Binance klines (pure Crypto only, NOT metals) ────────────
      if (isCrypto) {
        source = "Binance";
        const binIntervalMap: any = {
          "1m": "1m", "2m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
          "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M"
        };
        const bInt = binIntervalMap[interval] || "1m";
        const bRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${bInt}&limit=500`);
        if (bRes.ok) {
          const data = await bRes.json();
          if (Array.isArray(data)) {
            results = data.map((d: any) => ({
              time:   Math.floor(d[0] / 1000),
              open:   parseFloat(d[1]),
              high:   parseFloat(d[2]),
              low:    parseFloat(d[3]),
              close:  parseFloat(d[4]),
              volume: parseFloat(d[5]) || 0
            }));
          }
        }

      }

      // 2. Stocks (Alpha Vantage)
      if (results.length === 0 && !isCrypto && !symbol.includes("USD") && !symbol.includes("EUR") && !symbol.includes("JPY")) {
         source = "Alpha Vantage";
         const avMap: any = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1H": "60min" };
         let fn = interval.endsWith("m") || interval === "1H" ? "TIME_SERIES_INTRADAY" : "TIME_SERIES_DAILY";
         let avIntParams = fn === "TIME_SERIES_INTRADAY" ? `&interval=${avMap[interval] || "60min"}` : "";
         
         const avRes = await fetch(`https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}${avIntParams}&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`);
         if (avRes.ok) {
           const data = await avRes.json();
           const seriesKey = Object.keys(data).find(k => k.includes("Time Series"));
           if (seriesKey) {
             const series = data[seriesKey];
             results = Object.keys(series).map(k => {
               const item = series[k];
               return {
                 time: Math.floor(new Date(k).getTime() / 1000),
                 open: parseFloat(item["1. open"]),
                 high: parseFloat(item["2. high"]),
                 low: parseFloat(item["3. low"]),
                 close: parseFloat(item["4. close"]),
                 volume: parseFloat(item["5. volume"]) || 0
               };
             }).sort((a,b) => a.time - b.time);
           }
         }
      }

      // 3. Forex / Others (TwelveData fallback)
      if (results.length === 0) {
         source = "TwelveData";
         let tdSym = symbol;
         if (symbol.length === 6 && symbol.endsWith("USD")) {
            tdSym = `${symbol.substring(0,3)}/${symbol.substring(3,6)}`;
         } else if (symbol.length === 6) {
             tdSym = `${symbol.substring(0,3)}/${symbol.substring(3,6)}`; // Forex pairs
         }

         const tdMap: any = {
           "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
           "1H": "1h", "4H": "4h", "1D": "1day", "1W": "1week", "1M": "1month"
         };
         const tdInt = tdMap[interval] || "15min";
         const tdRes = await fetch(`https://api.twelvedata.com/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=500&apikey=${TWELVEDATA_API_KEY}`);
         if (tdRes.ok) {
            const data = await tdRes.json();
            if (data && data.values) {
              results = data.values.map((v: any) => ({
                time: Math.floor(new Date(v.datetime).getTime() / 1000),
                open: parseFloat(v.open),
                high: parseFloat(v.high),
                low: parseFloat(v.low),
                close: parseFloat(v.close),
                volume: parseFloat(v.volume) || 0
              })).sort((a: any, b: any) => a.time - b.time);
            }
         }
      }

      return res.json({ results, source });
    } catch (err: any) {
      // Return 200 with empty results so frontend can generate graceful fallback instead of flashing 500 console errors
      return res.json({ results: [], source: "API Timeout/Limit Fallback" });
    }
  });


  return httpServer;
}
