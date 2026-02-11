import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// =========================================================
// AUTH (Replit Auth required tables)
// =========================================================

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email").unique(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    profileImageUrl: varchar("profile_image_url"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  () => [],
);

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// =========================================================
// TRADING MVP DATA MODEL
// (MVP scope: watchlists, paper portfolio, prices, holdings)
// =========================================================

export const assetClassEnum = pgEnum("asset_class", [
  "INDIAN_STOCK",
  "US_STOCK",
  "ETF",
  "MUTUAL_FUND",
  "FOREX",
]);

export const orderSideEnum = pgEnum("order_side", ["BUY", "SELL"]);

export const orderTypeEnum = pgEnum("order_type", [
  "MARKET",
  "LIMIT",
  "STOP_LOSS",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "FILLED",
  "CANCELLED",
  "REJECTED",
]);

export const instruments = pgTable(
  "instruments",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    exchange: varchar("exchange", { length: 16 }).notNull(),
    name: text("name").notNull(),
    assetClass: assetClassEnum("asset_class").notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("instruments_symbol_exchange_unique").on(t.symbol, t.exchange)],
);

export const latestPrices = pgTable(
  "latest_prices",
  {
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    asOf: timestamp("as_of").notNull().defaultNow(),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    changeAbs: numeric("change_abs", { precision: 18, scale: 6 }),
    changePct: numeric("change_pct", { precision: 9, scale: 4 }),
  },
  (t) => [uniqueIndex("latest_prices_instrument_unique").on(t.instrumentId)],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("watchlists_user_id_idx").on(t.userId)],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("watchlist_item_unique").on(t.watchlistId, t.instrumentId)],
);

export const portfolios = pgTable(
  "portfolios",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    baseCurrency: varchar("base_currency", { length: 8 }).notNull().default("INR"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("portfolios_user_id_idx").on(t.userId)],
);

export const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    portfolioId: integer("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull().default("0"),
    avgCost: numeric("avg_cost", { precision: 18, scale: 6 }).notNull().default("0"),
  },
  (t) => [
    uniqueIndex("holdings_portfolio_instrument_unique").on(t.portfolioId, t.instrumentId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioId: integer("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    side: orderSideEnum("side").notNull(),
    type: orderTypeEnum("type").notNull(),
    status: orderStatusEnum("status").notNull().default("PENDING"),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 18, scale: 6 }),
    stopPrice: numeric("stop_price", { precision: 18, scale: 6 }),
    filledPrice: numeric("filled_price", { precision: 18, scale: 6 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_user_id_idx").on(t.userId),
    index("orders_portfolio_id_idx").on(t.portfolioId),
  ],
);

export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    source: varchar("source", { length: 64 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at").notNull(),
    summary: text("summary"),
    imageUrl: text("image_url"),
    tags: text("tags").array(),
  },
  (t) => [uniqueIndex("news_url_unique").on(t.url)],
);

export const learnArticles = pgTable(
  "learn_articles",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 96 }).notNull(),
    title: text("title").notNull(),
    level: varchar("level", { length: 16 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    content: text("content").notNull(),
  },
  (t) => [uniqueIndex("learn_slug_unique").on(t.slug)],
);

// =========================================================
// ZOD INSERT SCHEMAS + EXPLICIT API TYPES
// =========================================================

export const insertInstrumentSchema = createInsertSchema(instruments).omit({
  id: true,
});

export const insertWatchlistSchema = createInsertSchema(watchlists).omit({
  id: true,
  createdAt: true,
});

export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({
  id: true,
  createdAt: true,
});

export const insertPortfolioSchema = createInsertSchema(portfolios).omit({
  id: true,
  createdAt: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  status: true,
  filledPrice: true,
});

export const insertLearnArticleSchema = createInsertSchema(learnArticles).omit({
  id: true,
});

// Base table types
export type Instrument = typeof instruments.$inferSelect;
export type LatestPrice = typeof latestPrices.$inferSelect;
export type Watchlist = typeof watchlists.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type Portfolio = typeof portfolios.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewsArticle = typeof newsArticles.$inferSelect;
export type LearnArticle = typeof learnArticles.$inferSelect;

// Requests
export type CreateWatchlistRequest = z.infer<typeof insertWatchlistSchema>;
export type CreateWatchlistItemRequest = z.infer<typeof insertWatchlistItemSchema>;
export type CreatePortfolioRequest = z.infer<typeof insertPortfolioSchema>;
export type UpdatePortfolioRequest = Partial<CreatePortfolioRequest>;
export type CreateOrderRequest = z.infer<typeof insertOrderSchema>;
export type CreateLearnArticleRequest = z.infer<typeof insertLearnArticleSchema>;

// Responses
export type InstrumentsListResponse = Instrument[];
export type WatchlistsListResponse = (Watchlist & { itemCount: number })[];
export type WatchlistDetailResponse = Watchlist & {
  items: Array<{
    id: number;
    instrument: Instrument;
    price?: LatestPrice;
  }>;
};

export type PortfolioSummaryResponse = {
  portfolio: Portfolio;
  totals: {
    marketValue: number;
    costValue: number;
    totalPnl: number;
    totalPnlPct: number;
    dayPnl: number;
    dayPnlPct: number;
  };
  allocation: Array<{
    assetClass: typeof assetClassEnum.enumValues[number];
    value: number;
    pct: number;
  }>;
  holdings: Array<{
    holding: Holding;
    instrument: Instrument;
    price?: LatestPrice;
    marketValue: number;
    costValue: number;
    pnl: number;
    pnlPct: number;
  }>;
};

export type OrdersListResponse = Order[];
export type NewsFeedResponse = NewsArticle[];
export type LearnListResponse = LearnArticle[];
export type LearnDetailResponse = LearnArticle;

// Utility
export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}
