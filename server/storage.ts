import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  holdings,
  instruments,
  latestPrices,
  newsArticles,
  orders,
  portfolios,
  watchlistItems,
  watchlists,
  learnArticles,
  type CreateOrderRequest,
  type CreatePortfolioRequest,
  type CreateWatchlistItemRequest,
  type CreateWatchlistRequest,
  type InstrumentsListResponse,
  type LearnDetailResponse,
  type LearnListResponse,
  type NewsFeedResponse,
  type OrdersListResponse,
  type Order,
  type PortfolioSummaryResponse,
  type WatchlistDetailResponse,
  type WatchlistsListResponse,
  type Instrument,
} from "@shared/schema";

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface IStorage {
  listInstruments(input?: {
    q?: string;
    assetClass?: string;
    exchange?: string;
  }): Promise<InstrumentsListResponse>;

  listWatchlists(userId: string): Promise<WatchlistsListResponse>;
  createWatchlist(userId: string, input: CreateWatchlistRequest): Promise<number>;
  getWatchlistDetail(userId: string, id: number): Promise<WatchlistDetailResponse | undefined>;
  addWatchlistItem(userId: string, watchlistId: number, input: CreateWatchlistItemRequest): Promise<void>;
  removeWatchlistItem(userId: string, watchlistId: number, itemId: number): Promise<void>;

  ensureDefaultPortfolio(userId: string): Promise<number>;
  createPortfolio(userId: string, input: CreatePortfolioRequest): Promise<number>;
  getPortfolioSummary(userId: string): Promise<PortfolioSummaryResponse>;

  listOrders(userId: string): Promise<OrdersListResponse>;
  createOrder(userId: string, input: CreateOrderRequest): Promise<Order>;
  cancelOrder(userId: string, orderId: number): Promise<Order | undefined>;

  getNews(): Promise<NewsFeedResponse>;
  listLearn(): Promise<LearnListResponse>;
  getLearn(id: number): Promise<LearnDetailResponse | undefined>;

  seed(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async listInstruments(input?: { q?: string; assetClass?: string; exchange?: string }): Promise<Instrument[]> {
    const where: any[] = [eq(instruments.isActive, true)];
    if (input?.q) {
      const q = `%${input.q}%`;
      where.push(or(ilike(instruments.symbol, q), ilike(instruments.name, q)));
    }
    if (input?.assetClass) where.push(eq(instruments.assetClass as any, input.assetClass as any));
    if (input?.exchange) where.push(eq(instruments.exchange, input.exchange));

    return db
      .select()
      .from(instruments)
      .where(and(...(where as any)))
      .orderBy(instruments.exchange, instruments.symbol)
      .limit(200);
  }

  async listWatchlists(userId: string): Promise<WatchlistsListResponse> {
    const rows = await db
      .select({
        id: watchlists.id,
        userId: watchlists.userId,
        name: watchlists.name,
        createdAt: watchlists.createdAt,
        itemCount: sql<number>`count(${watchlistItems.id})::int`.as("itemCount"),
      })
      .from(watchlists)
      .leftJoin(watchlistItems, eq(watchlistItems.watchlistId, watchlists.id))
      .where(eq(watchlists.userId, userId))
      .groupBy(watchlists.id)
      .orderBy(desc(watchlists.createdAt));
    return rows as any;
  }

  async createWatchlist(userId: string, input: CreateWatchlistRequest): Promise<number> {
    const [wl] = await db
      .insert(watchlists)
      .values({ userId, name: input.name })
      .returning();
    return wl.id;
  }

  async getWatchlistDetail(userId: string, id: number): Promise<WatchlistDetailResponse | undefined> {
    const [wl] = await db
      .select()
      .from(watchlists)
      .where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)));
    if (!wl) return undefined;

    const rows = await db
      .select({
        itemId: watchlistItems.id,
        instrument: instruments,
        price: latestPrices,
      })
      .from(watchlistItems)
      .innerJoin(instruments, eq(instruments.id, watchlistItems.instrumentId))
      .leftJoin(latestPrices, eq(latestPrices.instrumentId, instruments.id))
      .where(eq(watchlistItems.watchlistId, id))
      .orderBy(instruments.exchange, instruments.symbol);

    return {
      ...wl,
      items: rows.map((r) => ({
        id: r.itemId,
        instrument: r.instrument,
        price: r.price ?? undefined,
      })),
    };
  }

  async addWatchlistItem(userId: string, watchlistId: number, input: CreateWatchlistItemRequest): Promise<void> {
    const [wl] = await db
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
    if (!wl) return;
    await db
      .insert(watchlistItems)
      .values({ watchlistId, instrumentId: input.instrumentId as any })
      .onConflictDoNothing();
  }

  async removeWatchlistItem(userId: string, watchlistId: number, itemId: number): Promise<void> {
    const [wl] = await db
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
    if (!wl) return;
    await db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId)));
  }

  async ensureDefaultPortfolio(userId: string): Promise<number> {
    const [p] = await db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .orderBy(desc(portfolios.createdAt))
      .limit(1);
    if (p) return p.id;
    const [created] = await db
      .insert(portfolios)
      .values({ userId, name: "Main Portfolio", baseCurrency: "USD" })
      .returning();
    return created.id;
  }

  async createPortfolio(userId: string, input: CreatePortfolioRequest): Promise<number> {
    const [p] = await db
      .insert(portfolios)
      .values({
        userId,
        name: input.name,
        baseCurrency: input.baseCurrency ?? "USD",
      })
      .returning();
    return p.id;
  }

  async getPortfolioSummary(userId: string): Promise<PortfolioSummaryResponse> {
    const portfolioId = await this.ensureDefaultPortfolio(userId);
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId));

    const rows = await db
      .select({
        holding: holdings,
        instrument: instruments,
        price: latestPrices,
      })
      .from(holdings)
      .innerJoin(instruments, eq(instruments.id, holdings.instrumentId))
      .leftJoin(latestPrices, eq(latestPrices.instrumentId, instruments.id))
      .where(eq(holdings.portfolioId, portfolioId));

    const enriched = rows.map((r) => {
      const qty = num(r.holding.quantity);
      const avg = num(r.holding.avgCost);
      const px = r.price ? num(r.price.price) : 0;
      const marketValue = qty * px;
      const costValue = qty * avg;
      const pnl = marketValue - costValue;
      const pnlPct = costValue > 0 ? pnl / costValue : 0;
      return {
        holding: r.holding,
        instrument: r.instrument,
        price: r.price ?? undefined,
        marketValue,
        costValue,
        pnl,
        pnlPct,
      };
    });

    const marketValue = enriched.reduce((a, b) => a + b.marketValue, 0);
    const costValue = enriched.reduce((a, b) => a + b.costValue, 0);
    const totalPnl = marketValue - costValue;
    const totalPnlPct = costValue > 0 ? totalPnl / costValue : 0;

    const dayPnl = enriched.reduce((a, b) => {
      const chg = b.price ? num(b.price.changeAbs) : 0;
      const qty = num(b.holding.quantity);
      return a + chg * qty;
    }, 0);
    const dayBase = marketValue - dayPnl;
    const dayPnlPct = dayBase > 0 ? dayPnl / dayBase : 0;

    const allocMap = new Map<string, number>();
    for (const h of enriched) {
      const k = h.instrument.assetClass;
      allocMap.set(k, (allocMap.get(k) ?? 0) + h.marketValue);
    }
    const allocation = Array.from(allocMap.entries()).map(([assetClass, value]) => ({
      assetClass: assetClass as any,
      value,
      pct: marketValue > 0 ? value / marketValue : 0,
    }));

    return {
      portfolio: portfolio!,
      totals: {
        marketValue,
        costValue,
        totalPnl,
        totalPnlPct,
        dayPnl,
        dayPnlPct,
      },
      allocation,
      holdings: enriched,
    };
  }

  async listOrders(userId: string): Promise<OrdersListResponse> {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(200);
  }

  async createOrder(userId: string, input: CreateOrderRequest): Promise<Order> {
    const portfolioId = await this.ensureDefaultPortfolio(userId);
    const [order] = await db
      .insert(orders)
      .values({
        userId,
        portfolioId,
        instrumentId: input.instrumentId as any,
        side: input.side as any,
        type: input.type as any,
        quantity: input.quantity as any,
        limitPrice: (input as any).limitPrice ?? null,
        stopPrice: (input as any).stopPrice ?? null,
        status: "FILLED" as any,
        filledPrice: (await this.getLatestPriceNumber(input.instrumentId as any))?.toString() ?? null,
      })
      .returning();

    await this.applyFillToHoldings(order);
    return order;
  }

  async cancelOrder(userId: string, orderId: number): Promise<Order | undefined> {
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!existing) return undefined;
    if (existing.status !== "PENDING") return existing as any;

    const [updated] = await db
      .update(orders)
      .set({ status: "CANCELLED" as any })
      .where(eq(orders.id, orderId))
      .returning();
    return updated as any;
  }

  async getNews(): Promise<NewsFeedResponse> {
    return db.select().from(newsArticles).orderBy(desc(newsArticles.publishedAt)).limit(20);
  }

  async listLearn(): Promise<LearnListResponse> {
    return db.select().from(learnArticles).orderBy(learnArticles.category, learnArticles.title).limit(50);
  }

  async getLearn(id: number): Promise<LearnDetailResponse | undefined> {
    const [a] = await db.select().from(learnArticles).where(eq(learnArticles.id, id));
    return a;
  }

  private async getLatestPriceNumber(instrumentId: number): Promise<number | undefined> {
    const [p] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, instrumentId));
    if (!p) return undefined;
    return num(p.price);
  }

  private async applyFillToHoldings(order: Order): Promise<void> {
    const qty = num(order.quantity);
    const px = num(order.filledPrice);
    const signedQty = order.side === "BUY" ? qty : -qty;

    const [existing] = await db
      .select()
      .from(holdings)
      .where(and(eq(holdings.portfolioId, order.portfolioId), eq(holdings.instrumentId, order.instrumentId)));

    if (!existing) {
      if (signedQty <= 0) return;
      await db.insert(holdings).values({
        portfolioId: order.portfolioId,
        instrumentId: order.instrumentId,
        quantity: String(signedQty),
        avgCost: String(px),
      });
      return;
    }

    const oldQty = num(existing.quantity);
    const oldAvg = num(existing.avgCost);
    const newQty = oldQty + signedQty;
    if (newQty <= 0) {
      await db
        .update(holdings)
        .set({ quantity: "0", avgCost: "0" })
        .where(eq(holdings.id, existing.id));
      return;
    }

    let newAvg = oldAvg;
    if (order.side === "BUY") {
      const newCost = oldQty * oldAvg + qty * px;
      newAvg = newCost / newQty;
    }
    await db
      .update(holdings)
      .set({ quantity: String(newQty), avgCost: String(newAvg) })
      .where(eq(holdings.id, existing.id));
  }

  async seed(): Promise<void> {
    const existing = await db.select({ id: instruments.id }).from(instruments).limit(1);
    if (existing.length > 0) return;

    const seededInstruments: Omit<Instrument, "id">[] = [
      { symbol: "BTC", exchange: "BINANCE", name: "Bitcoin", assetClass: "CRYPTO" as any, currency: "USD", country: "US", isActive: true, imageUrl: "https://cryptologos.cc/logos/bitcoin-btc-logo.png" },
      { symbol: "ETH", exchange: "BINANCE", name: "Ethereum", assetClass: "CRYPTO" as any, currency: "USD", country: "US", isActive: true, imageUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png" },
      { symbol: "BNB", exchange: "BINANCE", name: "Binance Coin", assetClass: "CRYPTO" as any, currency: "USD", country: "US", isActive: true, imageUrl: "https://cryptologos.cc/logos/binance-coin-bnb-logo.png" },
      { symbol: "DOGE", exchange: "BINANCE", name: "Dogecoin", assetClass: "CRYPTO" as any, currency: "USD", country: "US", isActive: true, imageUrl: "https://cryptologos.cc/logos/dogecoin-doge-logo.png" },
      { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc.", assetClass: "US_STOCK" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },
      { symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries", assetClass: "INDIAN_STOCK" as any, currency: "INR", country: "IN", isActive: true, imageUrl: null },
    ];

    const inserted = await db.insert(instruments).values(seededInstruments as any).returning();

    const priceRows = inserted.map((inst) => {
      const base = inst.assetClass === "CRYPTO" ? 10000 : 150;
      const price = base + Math.random() * base * 0.2;
      const changeAbs = (Math.random() - 0.5) * base * 0.05;
      const changePct = (changeAbs / price) * 100;
      const sparkline = Array.from({ length: 20 }, () => (price * (0.95 + Math.random() * 0.1)).toString());
      
      return {
        instrumentId: inst.id,
        asOf: new Date(),
        price: String(price),
        changeAbs: String(changeAbs),
        changePct: String(changePct),
        sparkline,
      };
    });
    await db.insert(latestPrices).values(priceRows as any);

    await db.insert(newsArticles).values([
      {
        source: "Market Brief",
        title: "BTC Hits New High Amid Institutional Inflow",
        url: "https://example.com/btc-news",
        publishedAt: new Date(),
        summary: "Bitcoin price action shows strength as more ETFs go live.",
        imageUrl: null,
        tags: ["crypto", "btc"],
      },
    ] as any);
  }
}

export const storage = new DatabaseStorage();
