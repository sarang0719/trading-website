import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { registerImageRoutes } from "./replit_integrations/image";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerImageRoutes(app);

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

  app.get(api.market.news.path, async (_req, res) => {
    const news = await storage.getNews();
    res.json(news);
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

  return httpServer;
}
