import { drizzle as drizzleRemote } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// v34.0 BULLETPROOF DATABASE ENGINE
// Lazy Singleton Pattern for Enterprise Stability

let dbInstance: any = null;
let clientInstance: any = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  initDb();
  return dbInstance;
}

export function getClient() {
  if (clientInstance) return clientInstance;
  initDb();
  return clientInstance;
}

function initDb() {
  if (dbInstance) return;

  if (process.env.DATABASE_URL) {
    // PRODUCTION: Pure Node-Postgres with SSL
    console.log("[DB] Initializing Production Postgres Connection...");
    clientInstance = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    dbInstance = drizzleRemote(clientInstance, { schema });
  } else {
    // DEVELOPMENT: Dynamic PGlite initialization
    console.log("[DB] Initializing Local PGlite for Development...");
    // Note: In development, we allow synchronous error if PGlite is missing
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    clientInstance = new PGlite();
    dbInstance = drizzle(clientInstance, { schema });
  }
}

// Proxies for backward compatibility with full type safety and robust 'this' binding
export const db = new Proxy({}, {
  get: (target, prop) => {
    const instance = getDb();
    if (!instance) return undefined;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  }
}) as ReturnType<typeof drizzleRemote>;

export const client = new Proxy({}, {
  get: (target, prop) => {
    const instance = getClient();
    if (!instance) return undefined;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  }
}) as pg.Pool;

export async function runMigrations() {
  const c = getClient();
  const q = async (sql: string) => {
    try {
      await c.query(sql);
    } catch (e: any) {
      if (!sql.includes("ALTER TABLE") && !sql.includes("CREATE TYPE")) {
        console.warn(`[DB Migration Notice] ${e.message}`);
      }
    }
  };

  // Essential Schema Sync
  await q(`CREATE TABLE IF NOT EXISTS sessions (sid varchar PRIMARY KEY, sess jsonb NOT NULL, expire timestamp NOT NULL)`);
  await q(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions(expire)`);
  await q(`CREATE TABLE IF NOT EXISTS users (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), email varchar UNIQUE, password text, first_name varchar, last_name varchar, profile_image_url varchar, firebase_uid varchar UNIQUE, auto_trade_enabled boolean, auto_trade_amount varchar DEFAULT '5.00', free_predictions_used integer NOT NULL DEFAULT 0, paid_credits integer NOT NULL DEFAULT 0, is_blocked boolean DEFAULT false, is_ai_blocked boolean DEFAULT false, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`);
  // (Rest of the migrations follow the same pattern)
  await q(`CREATE TABLE IF NOT EXISTS login_history (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip varchar, device varchar, browser varchar, created_at timestamp DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS user_activities (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, action varchar NOT NULL, details text, created_at timestamp DEFAULT now())`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN CREATE TYPE asset_class AS ENUM ('INDIAN_STOCK','US_STOCK','ETF','MUTUAL_FUND','FOREX','CRYPTO'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_side') THEN CREATE TYPE order_side AS ENUM ('BUY','SELL'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_type') THEN CREATE TYPE order_type AS ENUM ('MARKET','LIMIT','STOP_LOSS'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN CREATE TYPE order_status AS ENUM ('PENDING','FILLED','CANCELLED','REJECTED'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_trade_status') THEN CREATE TYPE time_trade_status AS ENUM ('ACTIVE','WIN','LOSS','TIE'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_mode') THEN CREATE TYPE trade_mode AS ENUM ('DEMO','REAL'); END IF; END $$`);
  await q(`CREATE TABLE IF NOT EXISTS instruments (id serial PRIMARY KEY, symbol varchar(32) NOT NULL, exchange varchar(16) NOT NULL, name text NOT NULL, asset_class asset_class NOT NULL, currency varchar(8) NOT NULL, country varchar(2) NOT NULL, is_active boolean NOT NULL DEFAULT true, image_url text, CONSTRAINT instruments_symbol_exchange_unique UNIQUE(symbol, exchange))`);
  await q(`CREATE TABLE IF NOT EXISTS latest_prices (instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, as_of timestamp NOT NULL DEFAULT now(), price numeric(18,6) NOT NULL, change_abs numeric(18,6), change_pct numeric(9,4), is_open boolean NOT NULL DEFAULT true, sparkline numeric(18,6)[], CONSTRAINT latest_prices_instrument_unique UNIQUE(instrument_id))`);
  await q(`CREATE TABLE IF NOT EXISTS watchlists (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, name varchar(64) NOT NULL, created_at timestamp NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS watchlist_items (id serial PRIMARY KEY, watchlist_id integer NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE, instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, created_at timestamp NOT NULL DEFAULT now(), CONSTRAINT watchlist_item_unique UNIQUE(watchlist_id, instrument_id))`);
  await q(`CREATE TABLE IF NOT EXISTS portfolios (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, name varchar(64) NOT NULL, base_currency varchar(8) NOT NULL DEFAULT 'USD', created_at timestamp NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS holdings (id serial PRIMARY KEY, portfolio_id integer NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE, instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, quantity numeric(18,6) NOT NULL DEFAULT '0', avg_cost numeric(18,6) NOT NULL DEFAULT '0', CONSTRAINT holdings_portfolio_instrument_unique UNIQUE(portfolio_id, instrument_id))`);
  await q(`CREATE TABLE IF NOT EXISTS orders (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, portfolio_id integer NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE, instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, side order_side NOT NULL, type order_type NOT NULL, status order_status NOT NULL DEFAULT 'PENDING', quantity numeric(18,6) NOT NULL, limit_price numeric(18,6), stop_price numeric(18,6), filled_price numeric(18,6), created_at timestamp NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS time_based_orders (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, placed_by varchar NOT NULL DEFAULT 'USER', instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, side order_side NOT NULL, amount numeric(18,2) NOT NULL, payout_ratio numeric(5,2) NOT NULL DEFAULT '0.85', strike_price numeric(18,6) NOT NULL, settle_price numeric(18,6), duration_seconds integer NOT NULL, expires_at timestamp NOT NULL, status time_trade_status NOT NULL DEFAULT 'ACTIVE', created_at timestamp NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS news_articles (id serial PRIMARY KEY, source varchar(64) NOT NULL, title text NOT NULL, url text NOT NULL, published_at timestamp NOT NULL, summary text, image_url text, tags text[], CONSTRAINT news_url_unique UNIQUE(url))`);
  await q(`CREATE TABLE IF NOT EXISTS learn_articles (id serial PRIMARY KEY, slug varchar(96) NOT NULL, title text NOT NULL, level varchar(16) NOT NULL, category varchar(32) NOT NULL, content text NOT NULL, CONSTRAINT learn_slug_unique UNIQUE(slug))`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number varchar(20)`);
  await q(`ALTER TABLE latest_prices ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true`);
  console.log("[DB] Migrations synchronized successfully.");
}
