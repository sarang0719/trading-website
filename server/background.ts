import { db } from "./db";
import { instruments, latestPrices } from "@shared/schema";
import { eq } from "drizzle-orm";
import WebSocket from "ws";

const ALPHA_VANTAGE_API_KEY = "QE1K79P5G7B01Z0W";

export function startBackgroundTasks() {
  console.log("Starting API background tasks with Alpha Vantage key:", ALPHA_VANTAGE_API_KEY);

  let cryptoMap: Map<string, number> | null = null;

  async function refreshCryptoMap() {
    const allInstruments = await db.select().from(instruments).where(eq(instruments.assetClass, "CRYPTO"));
    const map = new Map<string, number>();
    allInstruments.forEach(i => map.set(i.symbol, i.id));
    cryptoMap = map;
  }

  // 1. Setup Binance WebSocket for Crypto
  function setupBinanceWebsocket() {
    // Only subscribe to mini ticker for all symbols, incredibly lightweight and live
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
          const symbol = ev.s; // Symbol (e.g. BTCUSDT)
          if (cryptoMap.has(symbol)) {
            const price = parseFloat(ev.c); // current price
            const openPrice = parseFloat(ev.o);
            const changeAbs = price - openPrice;
            const changePct = openPrice > 0 ? (changeAbs / openPrice) * 100 : 0;

            await db.update(latestPrices)
              .set({
                price: String(price),
                changeAbs: String(changeAbs),
                changePct: String(changePct),
                asOf: new Date()
              })
              .where(eq(latestPrices.instrumentId, cryptoMap.get(symbol)!));
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

  // Start the websocket
  setupBinanceWebsocket();

  // 2. Setup periodic polling for Stocks using Alpha vantage
  setInterval(async () => {
    try {
      const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
      const stockInstruments = allInstruments.filter(i => i.assetClass !== "CRYPTO");

      let callCount = 0;
      for (const instrument of stockInstruments) {
        if (callCount >= 4) {
          console.log("Waiting 60s for Alpha Vantage rate limit...");
          await new Promise(resolve => setTimeout(resolve, 60000));
          callCount = 0;
        }

        let priceData = null;

        if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
          callCount++;
          const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
          const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
          const data = await res.json() as any;
          if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
            priceData = {
              price: data["Global Quote"]["05. price"],
              changeAbs: data["Global Quote"]["09. change"],
              changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
            };
          }
        } else if (instrument.assetClass === "FOREX") {
          callCount++;
          const fromC = instrument.symbol.substring(0, 3);
          const toC = instrument.symbol.substring(3, 6);
          const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
          const data = await res.json() as any;
          if (data && data["Realtime Currency Exchange Rate"]) {
            priceData = {
              price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
              changeAbs: "0",
              changePct: "0"
            };
          }
        }

        if (priceData) {
          console.log(`Updated ${instrument.symbol} to $${priceData.price}`);
          await db.update(latestPrices)
            .set({
              price: String(priceData.price),
              changeAbs: String(priceData.changeAbs),
              changePct: String(priceData.changePct),
              asOf: new Date()
            })
            .where(eq(latestPrices.instrumentId, instrument.id));
        }
      }
    } catch (e) {
      console.error("Error fetching background info", e);
    }
  }, 180000); // every 3 minutes

  // also run once immediately
  setTimeout(() => {
    try {
      console.log("Running initial background api fetch for stocks...");
      (async () => {
        const allInstruments = await db.select().from(instruments).where(eq(instruments.isActive, true));
        const stockInstruments = allInstruments.filter(i => i.assetClass !== "CRYPTO");
        let callCount = 0;
        for (const instrument of stockInstruments) {
          if (callCount >= 4) {
            await new Promise(resolve => setTimeout(resolve, 60000));
            callCount = 0;
          }
          let priceData = null;
          if (["US_STOCK", "INDIAN_STOCK", "ETF", "MUTUAL_FUND"].includes(instrument.assetClass)) {
            callCount++;
            const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
            const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Global Quote"] && data["Global Quote"]["05. price"]) {
              priceData = {
                price: data["Global Quote"]["05. price"],
                changeAbs: data["Global Quote"]["09. change"],
                changePct: data["Global Quote"]["10. change percent"] ? data["Global Quote"]["10. change percent"].replace("%", "") : "0",
              };
            }
          } else if (instrument.assetClass === "FOREX") {
            callCount++;
            const fromC = instrument.symbol.substring(0, 3);
            const toC = instrument.symbol.substring(3, 6);
            const res = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromC}&to_currency=${toC}&apikey=${ALPHA_VANTAGE_API_KEY}`);
            const data = await res.json() as any;
            if (data && data["Realtime Currency Exchange Rate"]) {
              priceData = {
                price: data["Realtime Currency Exchange Rate"]["5. Exchange Rate"],
                changeAbs: "0",
                changePct: "0"
              };
            }
          }
          if (priceData) {
            console.log(`Initial fetch: Updated ${instrument.symbol} to $${priceData.price}`);
            await db.update(latestPrices)
              .set({
                price: String(priceData.price),
                changeAbs: String(priceData.changeAbs),
                changePct: String(priceData.changePct),
                asOf: new Date()
              })
              .where(eq(latestPrices.instrumentId, instrument.id));
          }
        }
      })();
    } catch (err) { }
  }, 5000);
}
