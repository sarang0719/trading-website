import { db } from "./server/db";
import { instruments, latestPrices } from "./shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    const seededInstruments = [
        // ETFs
        { symbol: "SPY", exchange: "NYSE", name: "SPDR S&P 500 ETF Trust", assetClass: "ETF" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },
        { symbol: "QQQ", exchange: "NASDAQ", name: "Invesco QQQ Trust", assetClass: "ETF" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },
        { symbol: "VTI", exchange: "NYSE", name: "Vanguard Total Stock Market ETF", assetClass: "ETF" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },

        // Mutual Funds (US specific mutual funds available on Alpha Vantage)
        { symbol: "VFIAX", exchange: "MUTUAL", name: "Vanguard 500 Index Fund Admiral Shares", assetClass: "MUTUAL_FUND" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },
        { symbol: "FXAIX", exchange: "MUTUAL", name: "Fidelity 500 Index Fund", assetClass: "MUTUAL_FUND" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },

        // FOREX
        { symbol: "EURUSD", exchange: "FOREX", name: "Euro / US Dollar", assetClass: "FOREX" as any, currency: "USD", country: "US", isActive: true, imageUrl: null },
        { symbol: "GBPUSD", exchange: "FOREX", name: "British Pound / US Dollar", assetClass: "FOREX" as any, currency: "USD", country: "UK", isActive: true, imageUrl: null },
        { symbol: "USDJPY", exchange: "FOREX", name: "US Dollar / Japanese Yen", assetClass: "FOREX" as any, currency: "JPY", country: "JP", isActive: true, imageUrl: null },
    ];

    for (const item of seededInstruments) {
        const existing = await db.select().from(instruments).where(eq(instruments.symbol, item.symbol));
        if (existing.length === 0) {
            console.log("Inserting missing instrument:", item.symbol);
            const inserted = await db.insert(instruments).values(item).returning();

            const priceRows = inserted.map((inst) => {
                const base = 150;
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
        }
    }

    console.log("Done seeding missing instruments.");
    process.exit(0);
}

main().catch(console.error);
