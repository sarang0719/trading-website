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
    log(`Initializing Institutional AI Trading Engine...`);
    const { runMigrations } = await import("./db");
    
    // Universal schema synchronization for maximum boot resilience
    log("Synchronizing institutional database schema...");
    await runMigrations();

    startBackgroundTasks();
    startAiBotEngine();

    await registerRoutes(httpServer, app);
  } catch (error: any) {
    console.error(`[Critical Error] Initialization failed:`, error);
    // CRITICAL: Always return the error details for structural debugging
    app.all("/api/*", (_req, res) => {
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

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3000", 10);

  // Skip listen in Vercel environment (Vercel invokes exported app)
  if (process.env.VERCEL) {
    log(`Exporting app for Vercel runtime`);
  } else {
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`serving on port ${port}`);
      },
    );
  }
})();

export default app;
