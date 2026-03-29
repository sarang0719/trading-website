import { db } from "./db";
import { instruments, latestPrices } from "@shared/schema";
import { eq } from "drizzle-orm";
import WebSocket from "ws";

const ALPHA_VANTAGE_API_KEY = "385249c9f711441797999463c29e0ead";

function generateRealisticSparkline(currentPrice: number, changeAbs: number, points = 60): string[] {
  const startPrice = currentPrice - changeAbs;
  const sparkline: string[] = [];
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const trend = startPrice + (changeAbs * progress);
    const jitter = (Math.random() - 0.5) * Math.max(Math.abs(changeAbs) * 0.2, Math.abs(currentPrice) * 0.001);
    sparkline.push((trend + jitter).toString());
  }
  sparkline[points - 1] = currentPrice.toString();
  return sparkline;
}

export function startBackgroundTasks() {
  console.log("Starting API background tasks with Alpha Vantage key:", ALPHA_VANTAGE_API_KEY);

  // One-time logo URL migration: replace cryptologos.cc with coincap.io
  const LOGO_MAP: Record<string, string> = {
    "BTCUSDT":  "https://assets.coincap.io/assets/icons/btc@2x.png",
    "ETHUSDT":  "https://assets.coincap.io/assets/icons/eth@2x.png",
    "BNBUSDT":  "https://assets.coincap.io/assets/icons/bnb@2x.png",
    "SOLUSDT":  "https://assets.coincap.io/assets/icons/sol@2x.png",
    "XRPUSDT":  "https://assets.coincap.io/assets/icons/xrp@2x.png",
    "DOGEUSDT": "https://assets.coincap.io/assets/icons/doge@2x.png",
    "ADAUSDT":  "https://assets.coincap.io/assets/icons/ada@2x.png",
    "AVAXUSDT": "https://assets.coincap.io/assets/icons/avax@2x.png",
    "LINKUSDT": "https://assets.coincap.io/assets/icons/link@2x.png",
  };

  async function fixCryptoLogos() {
    try {
      for (const [symbol, url] of Object.entries(LOGO_MAP)) {
        await db.update(instruments)
          .set({ imageUrl: url })
          .where(eq(instruments.symbol, symbol));
      }
      console.log("Crypto logo URLs updated to coincap.io");
    } catch (e) {
      console.error("Logo migration error:", e);
    }
  }
  fixCryptoLogos();

  let cryptoMap: Map<string, number> | null = null;
  const sparklinesCache = new Map<number, string[]>();

  async function refreshCryptoMap() {
    const allInstruments = await db.select().from(instruments).where(eq(instruments.assetClass, "CRYPTO"));
    const map = new Map<string, number>();
    allInstruments.forEach(i => map.set(i.symbol, i.id));
    cryptoMap = map;
  }

  async function updateCachedSparkline(instrumentId: number, currentPrice: number, changeAbs: number): Promise<string[]> {
    let line = sparklinesCache.get(instrumentId);
    if (!line) {
      const [row] = await db.select().from(latestPrices).where(eq(latestPrices.instrumentId, instrumentId));
      line = (row?.sparkline as string[]) || [];
    }
    
    const lastPrice = line.length > 0 ? parseFloat(line[line.length - 1]) : currentPrice;
    const isWildlyOutdated = currentPrice > 0 && Math.abs(lastPrice - currentPrice) / currentPrice > 0.5;

    if (line.length < 60 || isWildlyOutdated) {
      line = generateRealisticSparkline(currentPrice, changeAbs, 60);
    } else {
      line.push(currentPrice.toString());
      if (line.length > 60) line.shift();
    }
    sparklinesCache.set(instrumentId, line);
    return line;
  }

  // 1. Setup Binance WebSocket for Crypto
  function setupBinanceWebsocket() {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/!miniTicker@arr");

    ws.on("open", async () => {
      console.log("Connected to live Binance WebSocket for Cryptos!");
      await refreshCryptoMap();
    });

    ws.on("message", async (data: string) => {
      try {
        if (!cryptoMap) return;

        const events = JSON.parse(data);
        if (!Array.isArray(events)) return;

        for (const ev of events) {
          const symbol = ev.s;
          if (cryptoMap.has(symbol)) {
            const instId = cryptoMap.get(symbol)!;
            const price = parseFloat(ev.c);
            const openPrice = parseFloat(ev.o);
            const changeAbs = price - openPrice;
            const changePct = openPrice > 0 ? (changeAbs / openPrice) * 100 : 0;
            
            const newSparkline = await updateCachedSparkline(instId, price, changeAbs);

            await db.update(latestPrices)
              .set({
                price: String(price),
                changeAbs: String(changeAbs),
                changePct: String(changePct),
                sparkline: newSparkline,
                asOf: new Date()
              })
              .where(eq(latestPrices.instrumentId, instId));
          }
        }
      } catch (err) { }
    });

    ws.on("close", () => {
      console.log("Binance WebSocket closed. Reconnecting in 5s...");
      setTimeout(setupBinanceWebsocket, 5000);
    });

    ws.on("error", (err) => {
      console.error("Binance WS error:", err);
    });
  }

  setupBinanceWebsocket();

  // 2. Setup periodic polling for Stocks using Alpha vantage
  setInterval(async () => {
    try {
      const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
      const stockInstruments = allInstruments.filter(i => i.assetClass !== "CRYPTO");

      let callCount = 0;
      for (const instrument of stockInstruments) {
        let priceData = null;

        if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
          callCount++;
          const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
          try {
            const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
              priceData = {
                price: data["Global Quote"]["05. price"],
                changeAbs: data["Global Quote"]["09. change"],
                changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
              };
            }
          } catch (e) {
            console.error(`Failed to fetch for ${sym}`, e);
          }
        } else if (instrument.assetClass === "FOREX") {
          callCount++;
          const fromC = instrument.symbol.substring(0, 3);
          const toC = instrument.symbol.substring(3, 6);
          try {
            const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Realtime Currency Exchange Rate"]) {
              priceData = {
                price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
                changeAbs: "0",
                changePct: "0"
              };
            }
          } catch (e) {
            console.error(`Failed to fetch forex for ${fromC}-${toC}`, e);
          }
        }

        if (priceData) {
          const currentPrice = parseFloat(priceData.price);
          const changeAbs = parseFloat(priceData.changeAbs);
          const newSparkline = await updateCachedSparkline(instrument.id, currentPrice, changeAbs);

          console.log(`Updated ${instrument.symbol} to $${priceData.price}`);
          await db.update(latestPrices)
            .set({
              price: String(priceData.price),
              changeAbs: String(priceData.changeAbs),
              changePct: String(priceData.changePct),
              sparkline: newSparkline,
              asOf: new Date()
            })
            .where(eq(latestPrices.instrumentId, instrument.id));
        }
      }
    } catch (e) {
      console.error("Error fetching background info", e);
    }
  }, 180000); 

  setTimeout(() => {
    try {
      console.log("Running initial background api fetch for stocks...");
      (async () => {
        const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
        const stockInstruments = allInstruments.filter(i => i.assetClass !== "CRYPTO");
        let callCount = 0;
        for (const instrument of stockInstruments) {
          let priceData = null;
          if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
            callCount++;
            const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
              const data = await res.json() as any;
              if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
                priceData = {
                  price: data["Global Quote"]["05. price"],
                  changeAbs: data["Global Quote"]["09. change"],
                  changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
                };
              }
            } catch (e) {
              console.error(`Initial fetch failed for ${sym}`, e);
            }
          } else if (instrument.assetClass === "FOREX") {
            callCount++;
            const fromC = instrument.symbol.substring(0, 3);
            const toC = instrument.symbol.substring(3, 6);
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
              const data = await res.json() as any;
              if (data && data["Realtime Currency Exchange Rate"]) {
                priceData = {
                  price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
                  changeAbs: "0",
                  changePct: "0"
                };
              }
            } catch (e) {
               console.error(`Initial fetch failed forex for ${fromC}-${toC}`, e);
            }
          }
          if (priceData) {
            const currentPrice = parseFloat(priceData.price);
            const changeAbs = parseFloat(priceData.changeAbs);
            const newSparkline = await updateCachedSparkline(instrument.id, currentPrice, changeAbs);

            console.log(`Initial fetch: Updated ${instrument.symbol} to $${priceData.price}`);
            await db.update(latestPrices)
              .set({
                price: String(priceData.price),
                changeAbs: String(priceData.changeAbs),
                changePct: String(priceData.changePct),
                sparkline: newSparkline,
                asOf: new Date()
              })
              .where(eq(latestPrices.instrumentId, instrument.id));
          }
        }
      })();
    } catch (err) { }
  }, 5000);
}
