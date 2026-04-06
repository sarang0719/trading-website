import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startBackgroundTasks } from "./background";
import { startAiBotEngine } from "./ai-bot";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    log(`Initializing Institutional AI Trading Engine [Fast Boot]...`);
    
    // PHASE 0: Synchronize institutional database schema
    const { runMigrations } = await import("./db");
    log("Synchronizing institutional database schema...");
    await runMigrations();

    // PHASE 1: Immediate API & Static Readiness
    await registerRoutes(httpServer, app);
    
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    // PHASE 2: Immediate Port Binding (Prevents 502/504 on Render)
    const port = parseInt(process.env.PORT || "3000", 10);
    if (!process.env.VERCEL) {
      httpServer.listen({ port, host: "0.0.0.0" }, () => {
        log(`serving on port ${port} [Ready for traffic]`);
      });
    }

    // PHASE 3: Asynchronous Background Initialization
    (async () => {
       try {
         startBackgroundTasks();
         startAiBotEngine();
         log("Institutional background engines active.");

         // PHASE 4: Immediate Institutional Market Sync
         try {
           const { isGlobalMarketOpen } = await import("../shared/market-hours");
           const { instruments, latestPrices } = await import("../shared/schema");
           const { eq } = await import("drizzle-orm");
           const { db } = await import("./db");
           const allInsts = await db.select().from(instruments);
           for (const inst of allInsts) {
             const isOpen = isGlobalMarketOpen(inst.assetClass, inst.symbol);
             await db.update(latestPrices)
               .set({ isOpen, asOf: new Date() })
               .where(eq(latestPrices.instrumentId, inst.id));
           }
           log("Institutional market status synchronized.");
         } catch (syncErr) {
           console.error("[Sync Error]", syncErr);
         }
       } catch (error) {
         console.error("[Background Init Error]", error);
       }
    })();

  } catch (error: any) {
    console.error(`[Critical Error] Startup failed:`, error);
    // CRITICAL: Always return the error details for structural debugging
    app.all("/api/*path", (_req, res) => {
      res.status(500).json({ 
        message: "Initialization Failed", 
        error: error.message || String(error),
        stack: error.stack || null
      });
    });
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Detailed production logging for faster troubleshooting
    console.error(`[Fatal Error] ${status} - ${message}`);
    if (err.stack) console.error(err.stack);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ 
      message: process.env.NODE_ENV === "production" ? "Internal Server Error" : message,
      error: process.env.NODE_ENV === "production" ? undefined : err.toString()
    });
  });

  // Vercel Export Guard
  if (process.env.VERCEL) {
    log(`Exporting app for Vercel runtime`);
  }
})();

export default app;
