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
      
      const order = await storage.createTimeBasedOrder(userId, input as any);
      res.status(201).json(order);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0]?.message ?? "Invalid request",
          field: err.errors[0]?.path?.join("."),
        });
      }
      // Return 400 for Risk Management or other custom errors
      return res.status(400).json({ message: err.message || "Invalid request" });
    }
  });

  app.get(api.market.news.path, async (_req, res) => {
    const news = await storage.getNews();
    res.json(news);
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
        key_id:    process.env.RAZORPAY_KEY_ID    || "rzp_test_placeholder",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "placeholder_secret",
      });
      const order = await rzp.orders.create({
        amount: plan.amountPaise, currency: "INR",
        notes: { planId, userId: req.user.claims.sub },
      });
      return res.json({ orderId: order.id, amount: plan.amountPaise, currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
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
      const secret = process.env.RAZORPAY_KEY_SECRET || "placeholder_secret";
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
