import { useEffect, useRef } from "react";

// Symbol mapping: our internal symbol → TradingView symbol
const TV_SYMBOL_MAP: Record<string, string> = {
  // Crypto
  "BTCUSDT":  "BINANCE:BTCUSDT",
  "ETHUSDT":  "BINANCE:ETHUSDT",
  "BNBUSDT":  "BINANCE:BNBUSDT",
  "SOLUSDT":  "BINANCE:SOLUSDT",
  "XRPUSDT":  "BINANCE:XRPUSDT",
  "ADAUSDT":  "BINANCE:ADAUSDT",
  "DOGEUSDT": "BINANCE:DOGEUSDT",
  "DOTUSDT":  "BINANCE:DOTUSDT",
  "AVAXUSDT": "BINANCE:AVAXUSDT",
  "MATICUSDT":"BINANCE:MATICUSDT",
  "LTCUSDT":  "BINANCE:LTCUSDT",
  "LINKUSDT": "BINANCE:LINKUSDT",
  "UNIUSDT":  "BINANCE:UNIUSDT",
  "ATOMUSDT": "BINANCE:ATOMUSDT",
  "TRXUSDT":  "BINANCE:TRXUSDT",
  // Metals (GoldAPI)
  "XAUUSD":   "TVC:GOLD",
  "XAGUSD":   "TVC:SILVER",
  "WTIUSD":   "TVC:USOIL",
  // Forex
  "EURUSD":   "FX:EURUSD",
  "GBPUSD":   "FX:GBPUSD",
  "USDJPY":   "FX:USDJPY",
  "USDCHF":   "FX:USDCHF",
  "AUDUSD":   "FX:AUDUSD",
  "NZDUSD":   "FX:NZDUSD",
  "USDCAD":   "FX:USDCAD",
  "EURJPY":   "FX:EURJPY",
  "GBPJPY":   "FX:GBPJPY",
  "EURGBP":   "FX:EURGBP",
  // Stocks
  "AAPL":     "NASDAQ:AAPL",
  "GOOGL":    "NASDAQ:GOOGL",
  "MSFT":     "NASDAQ:MSFT",
  "AMZN":     "NASDAQ:AMZN",
  "TSLA":     "NASDAQ:TSLA",
  "META":     "NASDAQ:META",
  "NVDA":     "NASDAQ:NVDA",
};

// Timeframe mapping: our internal → TradingView interval
const TV_INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "2m": "2",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1H": "60",
  "4H": "240",
  "1D": "D",
  "1W": "W",
  "1M": "M",
};

interface TradingViewChartProps {
  symbol: string;
  timeframe?: string;
  height?: number | string;
}

export default function TradingViewChart({
  symbol,
  timeframe = "1m",
  height = "100%",
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef    = useRef<HTMLScriptElement | null>(null);

  const tvSymbol   = TV_SYMBOL_MAP[symbol] || `BINANCE:${symbol}`;
  const tvInterval = TV_INTERVAL_MAP[timeframe] || "1";

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = "";

    // Outer wrapper (needed by TV widget)
    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container";
    wrapper.style.cssText = "height:100%;width:100%;position:relative;";
    containerRef.current.appendChild(wrapper);

    // Widget div
    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.cssText = "height:100%;width:100%;";
    wrapper.appendChild(widgetDiv);

    // Copyright div — hidden (no branding shown)
    const copyrightDiv = document.createElement("div");
    copyrightDiv.className = "tradingview-widget-copyright";
    copyrightDiv.style.cssText = "display:none !important;opacity:0;height:0;overflow:hidden;";
    wrapper.appendChild(copyrightDiv);

    // Build config object
    const config = {
      allow_symbol_change: false,
      autosize: true,
      calendar: false,
      details: false,
      hide_legend: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_volume: false,
      hotlist: false,
      interval: tvInterval,
      locale: "en",
      save_image: false,
      style: "1",           // 1 = candles
      symbol: tvSymbol,
      theme: "dark",
      timezone: "Etc/UTC",
      backgroundColor: "#0B1120",
      gridColor: "rgba(255,255,255,0.04)",
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
    };

    // Script tag with config
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src  = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify(config);
    wrapper.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [tvSymbol, tvInterval]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, minHeight: 0 }}
      className="tv-chart-container"
    />
  );
}
