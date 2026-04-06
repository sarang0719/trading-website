import { drizzle as drizzleRemote } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePGLite } from "drizzle-orm/pglite";

// v40.0 INSTITUTIONAL DIRECT DATABASE ENGINE
// Optimized for Vercel Serverless & High-Concurrency

const isProduction = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost");

let clientInstance: any;
let dbInstance: any;

if (isProduction) {
  // PRODUCTION: Direct Node-Postgres Pool
  console.log("[DB] Connecting to Production Postgres...");
  clientInstance = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30000,
  });
  dbInstance = drizzleRemote(clientInstance, { schema });
} else {
  // DEVELOPMENT/EMERGENCY: PGlite for local testing
  if (process.env.NODE_ENV === "production") {
    console.warn("[DB] WARNING: No DATABASE_URL detected in production. Using ephemeral PGlite.");
  } else {
    console.log("[DB] Connecting to Local PGlite...");
  }
  clientInstance = new PGlite();
  dbInstance = drizzlePGLite(clientInstance, { schema });
}

export const db = dbInstance;
export const client = clientInstance;

let migrationsDone = false;

export async function runMigrations() {
  if (migrationsDone && process.env.NODE_ENV === "production") return;

  const q = async (sql: string) => {
    try {
      if (clientInstance.query) {
        await clientInstance.query(sql);
      } else {
        await clientInstance.exec(sql);
      }
    } catch (e: any) {
      // Log all critical schema errors for diagnostics
      if (!sql.includes("CREATE TYPE") && !sql.includes("ALTER TABLE") && !sql.includes("IF NOT EXISTS")) {
        console.error(`[DB Migration Error] FAILED: ${sql.substring(0, 100)}...`);
        console.error(`[DB Migration Error] Reason: ${e.message}`);
        throw e; // Definitive failure for base tables like 'instruments'
      }
    }
  };

  // --- PHASE 1: SEQUENTIAL ESSENTIALS (Types & Core Tables) ---
  await q(`CREATE TABLE IF NOT EXISTS sessions (sid varchar PRIMARY KEY, sess jsonb NOT NULL, expire timestamp NOT NULL)`);
  await q(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions(expire)`);
  await q(`CREATE TABLE IF NOT EXISTS users (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), email varchar UNIQUE, password text, first_name varchar, last_name varchar, profile_image_url varchar, firebase_uid varchar UNIQUE, auto_trade_enabled boolean, auto_trade_amount varchar DEFAULT '5.00', free_predictions_used integer NOT NULL DEFAULT 0, paid_credits integer NOT NULL DEFAULT 0, is_blocked boolean DEFAULT false, is_ai_blocked boolean DEFAULT false, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`);
  
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN CREATE TYPE asset_class AS ENUM ('INDIAN_STOCK','US_STOCK','ETF','MUTUAL_FUND','FOREX','CRYPTO'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_side') THEN CREATE TYPE order_side AS ENUM ('BUY','SELL'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_type') THEN CREATE TYPE order_type AS ENUM ('MARKET','LIMIT','STOP_LOSS'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN CREATE TYPE order_status AS ENUM ('PENDING','FILLED','CANCELLED','REJECTED'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_trade_status') THEN CREATE TYPE time_trade_status AS ENUM ('ACTIVE','WIN','LOSS','TIE'); END IF; END $$`);
  await q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_mode') THEN CREATE TYPE trade_mode AS ENUM ('DEMO','REAL'); END IF; END $$`);
  
  await q(`CREATE TABLE IF NOT EXISTS instruments (id serial PRIMARY KEY, symbol varchar(32) NOT NULL, exchange varchar(16) NOT NULL, name text NOT NULL, asset_class asset_class NOT NULL, currency varchar(8) NOT NULL, country varchar(2) NOT NULL, is_active boolean NOT NULL DEFAULT true, image_url text, CONSTRAINT instruments_symbol_exchange_unique UNIQUE(symbol, exchange))`);

  // --- PHASE 2: PARALLEL DEPENDENTS ---
  await Promise.all([
     q(`CREATE TABLE IF NOT EXISTS latest_prices (instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, as_of timestamp NOT NULL DEFAULT now(), price numeric(18,6) NOT NULL, change_abs numeric(18,6), change_pct numeric(9,4), is_open boolean NOT NULL DEFAULT true, sparkline numeric(18,6)[], CONSTRAINT latest_prices_instrument_unique UNIQUE(instrument_id))`),
     q(`CREATE TABLE IF NOT EXISTS login_history (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip varchar, device varchar, browser varchar, created_at timestamp DEFAULT now())`),
     q(`CREATE TABLE IF NOT EXISTS user_activities (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, action varchar NOT NULL, details text, created_at timestamp DEFAULT now())`),
     q(`CREATE TABLE IF NOT EXISTS watchlists (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, name varchar(64) NOT NULL, created_at timestamp NOT NULL DEFAULT now())`),
     q(`CREATE TABLE IF NOT EXISTS portfolios (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, name varchar(64) NOT NULL, base_currency varchar(8) NOT NULL DEFAULT 'USD', created_at timestamp NOT NULL DEFAULT now())`),
     q(`CREATE TABLE IF NOT EXISTS news_articles (id serial PRIMARY KEY, source varchar(64) NOT NULL, title text NOT NULL, url text NOT NULL, published_at timestamp NOT NULL, summary text, image_url text, tags text[], CONSTRAINT news_url_unique UNIQUE(url))`),
     q(`CREATE TABLE IF NOT EXISTS learn_articles (id serial PRIMARY KEY, slug varchar(96) NOT NULL, title text NOT NULL, level varchar(16) NOT NULL, category varchar(32) NOT NULL, content text NOT NULL, CONSTRAINT learn_slug_unique UNIQUE(slug))`),
     q(`CREATE TABLE IF NOT EXISTS time_based_orders (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, placed_by varchar NOT NULL DEFAULT 'USER', instrument_id integer NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, side order_side NOT NULL, amount numeric(18,2) NOT NULL, payout_ratio numeric(5,2) NOT NULL DEFAULT '0.85', strike_price numeric(18,6) NOT NULL, settle_price numeric(18,6), duration_seconds integer NOT NULL, expires_at timestamp NOT NULL, status time_trade_status NOT NULL DEFAULT 'ACTIVE', created_at timestamp NOT NULL DEFAULT now())`)
  ]);

  // --- PHASE 3: PARALLEL COLUMN UPDATES & TYPES ---
  await Promise.all([
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance numeric(18,2) NOT NULL DEFAULT '0.00'`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_balance numeric(18,2) NOT NULL DEFAULT '10000.00'`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trade_mode trade_mode NOT NULL DEFAULT 'DEMO'`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number varchar(20)`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_invest_round integer NOT NULL DEFAULT 1`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_invest_round_pnl numeric(18,2) NOT NULL DEFAULT '0.00'`),
     q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_agreed boolean NOT NULL DEFAULT false`),
     q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'WITHDRAW', 'TRADE_DEDUCTION', 'TRADE_WIN', 'TRADE_REFUND', 'DEMO_RESET', 'COMMISSION'); END IF; END $$`),
     q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED'); END IF; END $$`),
     q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN CREATE TYPE withdrawal_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'); END IF; END $$`)
  ]);

  // --- FINAL WALLET TABLES ---
  await Promise.all([
     q(`CREATE TABLE IF NOT EXISTS wallet_transactions (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, type transaction_type NOT NULL, amount numeric(18,2) NOT NULL, status transaction_status NOT NULL DEFAULT 'SUCCESS', mode varchar(8) DEFAULT 'REAL', reference_id varchar, created_at timestamp DEFAULT now() NOT NULL)`),
     q(`CREATE TABLE IF NOT EXISTS withdrawal_requests (id serial PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount numeric(18,2) NOT NULL, method varchar(50) NOT NULL, details text NOT NULL, status withdrawal_status NOT NULL DEFAULT 'PENDING', admin_notes text, processed_at timestamp, created_at timestamp DEFAULT now() NOT NULL)`)
  ]);

  migrationsDone = true;
  console.log("[DB] Migrations synchronized successfully.");
}
