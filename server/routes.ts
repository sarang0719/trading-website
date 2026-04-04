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

  return httpServer;
}
