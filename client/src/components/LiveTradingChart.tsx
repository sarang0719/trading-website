/**
 * LiveTradingChart.tsx  — HTC Trade Custom Chart Engine v2.0
 *
 * Quotex-style live candlestick animation using TradingView Lightweight Charts.
 * No iframe, no TradingView embed. Fully custom, fully controlled.
 *
 * Architecture:
 *   ┌─ Historical OHLC  ──── Backend proxy  → setData()
 *   ├─ Live WebSocket   ──── Binance kline / TwelveData → targetPrice
 *   ├─ REST Poller      ──── /api/market-data/price/:sym (metals / forex)
 *   └─ 100ms Loop       ──── Interpolate currentPrice → series.update()
 *
 * Candle State Machine (Quotex-identical):
 *   New candle:  open = close_of_last  high = low = open
 *   Each tick:   close = price, high = max(high,price), low = min(low,price)
 *   Candle end:  freeze, create new
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

// ── Types ──────────────────────────────────────────────────────────────────
interface CandleOHLC {
  time:   UTCTimestamp;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume?: number;
}

export interface PriceLevel {
  id: number;
  price: number;
  color: string;    // e.g. "#10b981" for BUY, "#f43f5e" for SELL
  title: string;    // e.g. "BUY" | "SELL"
}

interface LiveTradingChartProps {
  symbol:     string;
  exchange:   string;   // "BINANCE" | "FOREX" | "NASDAQ" etc
  assetClass: string;   // "CRYPTO" | "FOREX" | "US_STOCK" etc
  timeframe:  string;   // "1m" | "5m" | "15m" | "30m" | "1H"
  onPriceUpdate?: (price: number, direction: "up" | "down" | null) => void;
  priceLevels?: PriceLevel[];  // Active trade entry lines
  activeIndicators?: string[]; // Array of selected indicators (SMA, EMA, RSI, MACD)
}

// ── Math / Indicator Functions ─────────────────────────────────────────────
function calculateSMA(data: CandleOHLC[], period: number) {
  const result: any[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

function calculateEMA(data: CandleOHLC[], period: number) {
  const result: any[] = [];
  const k = 2 / (period + 1);
  let ema = data[0].close;
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

function calculateRSI(data: CandleOHLC[], period: number) {
  const result: any[] = [];
  if (data.length < period) return result;
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i-1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period; i < data.length; i++) {
    const diff = data[i].close - data[i-1].close;
    if (i > period) {
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    result.push({ time: data[i].time, value: rsi });
  }
  return result;
}

function calculateMACD(data: CandleOHLC[], fast = 12, slow = 26, signal = 9) {
  const fastEma = calculateEMA(data, fast);
  const slowEma = calculateEMA(data, slow);
  
  const macdLine = [];
  const mapSlow = new Map(slowEma.map(s => [s.time, s.value]));
  
  for (const f of fastEma) {
    if (mapSlow.has(f.time)) {
      macdLine.push({ time: f.time, close: f.value - mapSlow.get(f.time)! }); // mock OHLC for EMA
    }
  }
  
  const signalLine = calculateEMA(macdLine as any, signal);
  const sigMap = new Map(signalLine.map(s => [s.time, s.value]));
  
  const result: any[] = [];
  for (const m of macdLine) {
    if (sigMap.has(m.time)) {
      const s = sigMap.get(m.time)!;
      result.push({
        time: m.time,
        macd: m.close,
        signal: s,
        hist: m.close - s,
      });
    }
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TF_SECS: Record<string, number> = {
  "1m": 60, "2m": 120, "3m": 180, "5m": 300, "15m": 900,
  "30m": 1800, "1H": 3600, "4H": 14400, "1D": 86400,
};
const TF_BIN: Record<string, string> = {
  "1m": "1m", "2m": "1m", "3m": "3m", "5m": "5m",
  "15m": "15m", "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d",
};
const TF_TWELVE: Record<string, string> = {
  "1m": "1min", "2m": "1min", "3m": "5min", "5m": "5min",
  "15m": "15min", "30m": "30min", "1H": "1h", "4H": "4h", "1D": "1day",
};

const bucketTime = (secs: number, candleSecs: number): UTCTimestamp =>
  (Math.floor(secs / candleSecs) * candleSecs) as UTCTimestamp;

const fmtPrice = (v: number, sym: string): string => {
  if (!v) return "—";
  const dec = sym === "USDJPY" || sym === "GBPJPY" || sym === "EURJPY" ? 3
    : sym.endsWith("USDT") ? (v < 1 ? 6 : v < 10 ? 4 : 2) : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

// ── Component ──────────────────────────────────────────────────────────────
function LiveTradingChartComponent({
  symbol, exchange, assetClass, timeframe, onPriceUpdate, priceLevels = [], activeIndicators = [],
}: LiveTradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Track drawn price lines so we can remove old ones
  const drawnLinesRef = useRef<Map<number, any>>(new Map());

  // ── Chart refs (no React state — updated via direct API for performance) ──
  const chartRef    = useRef<IChartApi | null>(null);
  const candleRef   = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef   = useRef<ISeriesApi<"Histogram">   | null>(null);
  const liveLineRef = useRef<ISeriesApi<"Line">        | null>(null);
  
  // Indicator Refs
  const indRefs = useRef<{
    sma?: ISeriesApi<"Line">, 
    ema?: ISeriesApi<"Line">,
    rsi?: ISeriesApi<"Line">,
    macdHist?: ISeriesApi<"Histogram">,
    macdSig?: ISeriesApi<"Line">,
    macdLine?: ISeriesApi<"Line">
  }>({});

  // ── Candle state machine (all refs, zero re-renders per tick) ─────────────
  const liveCandle      = useRef<CandleOHLC | null>(null);
  const targetPriceRef  = useRef<number>(0);
  const currentPriceRef = useRef<number>(0);
  const wanderRef       = useRef<number>(0);
  const prevPriceRef    = useRef<number>(0);
  const lastTickRef     = useRef<number>(Date.now());
  const candleSecsRef   = useRef<number>(60);
  const historyRef      = useRef<CandleOHLC[]>([]);

  // ── UI state (minimal re-renders) ─────────────────────────────────────────
  const [displayPrice, setDisplayPrice]   = useState(0);
  const [priceDir,     setPriceDir]       = useState<"up"|"down"|null>(null);
  const [flashKey,     setFlashKey]       = useState(0);
  const [countdown,    setCountdown]      = useState(0);
  const [ohlcInfo,     setOhlcInfo]       = useState({ o:0, h:0, l:0, c:0, v:0 });
  const [isConnected,  setIsConnected]    = useState(false);
  const [isLoading,    setIsLoading]      = useState(true);
  const [chartReady,   setChartReady]     = useState(false);

  // ── Stable ref for onPriceUpdate so the effect never re-runs due to parent re-renders
  const onPriceUpdateRef = useRef(onPriceUpdate);
  useEffect(() => { onPriceUpdateRef.current = onPriceUpdate; }, [onPriceUpdate]);

  // ── Draw/update price lines for active trades ───────────────────────────
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    const currentIds = new Set(priceLevels.map(l => l.id));

    // Remove lines for trades that no longer exist
    drawnLinesRef.current.forEach((line, id) => {
      if (!currentIds.has(id)) {
        try { series.removePriceLine(line); } catch {}
        drawnLinesRef.current.delete(id);
      }
    });

    // Add lines for new trades
    priceLevels.forEach(level => {
      if (!drawnLinesRef.current.has(level.id)) {
        try {
          const line = series.createPriceLine({
            price: level.price,
            color: level.color,
            lineWidth: 2,
            lineStyle: 1, // dashed
            axisLabelVisible: true,
            title: level.title,
          });
          drawnLinesRef.current.set(level.id, line);
        } catch {}
      }
    });
  }, [priceLevels, chartReady]);

  // ── Core: update active candle on each tick ───────────────────────────────
  // Stored in a ref (not useCallback) so it never changes identity → won't trigger effect re-run
  const updateCandleRef = useRef((price: number) => {
    if (!candleRef.current || price <= 0) return;

    const nowSec     = Math.floor(Date.now() / 1000);
    const candleSecs = candleSecsRef.current;
    const bucket     = bucketTime(nowSec, candleSecs);
    let candle       = liveCandle.current;

    if (!candle || bucket > candle.time) {
      const open = candle?.close ?? price;
      candle = { time: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: 0 };
      liveCandle.current = candle;
    } else {
      candle.close = price;
      candle.high  = Math.max(candle.high, price);
      candle.low   = Math.min(candle.low,  price);
    }

    try {
      candleRef.current.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
      liveLineRef.current?.update({ time: candle.time, value: price });
    } catch { /* ignore */ }

    setOhlcInfo({ o: candle.open, h: candle.high, l: candle.low, c: price, v: candle.volume ?? 0 });
    const remaining = candleSecs - (nowSec % candleSecs);
    setCountdown(remaining);
  });

  // ── Accept external price tick (called by WS / poller) ───────────────────
  // Also a stable ref — never changes identity, never triggers effect re-run
  const onTickRef = useRef((rawPrice: number) => {
    if (!rawPrice || rawPrice <= 0) return;
    const prev = prevPriceRef.current;
    if (prev > 0 && Math.abs(rawPrice - prev) / prev > 0.08) return; // 8% spike guard

    targetPriceRef.current  = rawPrice;
    currentPriceRef.current = rawPrice;
    lastTickRef.current     = Date.now();

    updateCandleRef.current(rawPrice);
    setDisplayPrice(rawPrice);

    const dir: "up"|"down"|null = prev > 0 ? (rawPrice > prev ? "up" : rawPrice < prev ? "down" : null) : null;
    if (dir) { setPriceDir(dir); setFlashKey(k => k + 1); }
    prevPriceRef.current = rawPrice;
    onPriceUpdateRef.current?.(rawPrice, dir);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Effect: Build chart + load history + start live engine
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerRef.current) return;
    let isActive = true;
    let ws: WebSocket | null = null;
    let animFrame: number;
    let poller: ReturnType<typeof setInterval> | null = null;
    let wsReco: ReturnType<typeof setTimeout> | null = null;
    let wsInitTimer: ReturnType<typeof setTimeout> | null = null;
    let wsDelay = 1000;
    candleSecsRef.current = TF_SECS[timeframe] ?? 60;

    // ── 1. Create lightweight chart ──────────────────────────────────────────
    // ── 1. Create lightweight chart (Quotex exact design) ───────────────────
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor:  "#8c9baa",
        fontSize:   11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)", style: 0 },
        horzLines: { color: "rgba(255,255,255,0.03)", style: 0 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.4)", labelBackgroundColor: "#1e222d", style: 2 },
        horzLine: { color: "rgba(255,255,255,0.4)", labelBackgroundColor: "#1e222d", style: 2 },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        autoScale:   true,
        scaleMargins: { top: 0.06, bottom: 0.12 },
      },
      timeScale: {
        borderColor:    "rgba(255,255,255,0.08)",
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    20,
        barSpacing:     14, // Thicker candles exactly like Quotex
        minBarSpacing:  3,
      },
      autoSize: true,
    });

    // ── 2. Add Candlestick Series (Exact Quotex Neon Green & Red) ───────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:         "#00e676", // Quotex pure bullish green
      downColor:       "#ff5252", // Quotex pure bearish red
      borderVisible:   true,
      borderUpColor:   "#00e676",
      borderDownColor: "#ff5252",
      wickUpColor:     "#00e676",
      wickDownColor:   "#ff5252",
      wickVisible:     true,
      priceLineVisible: true,
      priceLineColor:  "#2962ff",
      priceLineWidth:  1,
      priceLineStyle:  2, // Dashed line exactly right across the chart
    });

    // (Only add line series for non-candle charts; hide when showing candlesticks so chart is crystal clean)
    const liveLine = chart.addSeries(LineSeries, {
      color:          "rgba(255,255,255,0)",
      lineWidth:      1,
      lineStyle:      3,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible:        false,
    });
    
    // ── 3. Initialize Indicators Panes ───────────────────────────────────────
    indRefs.current.sma = chart.addSeries(LineSeries, { color: "rgba(255, 193, 7, 0.8)", lineWidth: 2, title: "SMA(20)", visible: activeIndicators.includes("SMA") });
    indRefs.current.ema = chart.addSeries(LineSeries, { color: "rgba(103, 58, 183, 0.8)", lineWidth: 2, title: "EMA(55)", visible: activeIndicators.includes("EMA") });
    
    indRefs.current.rsi = chart.addSeries(LineSeries, { color: "#e06cba", lineWidth: 2, priceScaleId: "rsi", title: "RSI(14)", visible: activeIndicators.includes("RSI") });
    chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, visible: activeIndicators.includes("RSI") });
    
    indRefs.current.macdHist = chart.addSeries(HistogramSeries, { priceScaleId: "macd", title: "MACD(12,26,9)", visible: activeIndicators.includes("MACD") });
    indRefs.current.macdLine = chart.addSeries(LineSeries, { color: "#2962FF", lineWidth: 1, priceScaleId: "macd", visible: activeIndicators.includes("MACD") });
    indRefs.current.macdSig = chart.addSeries(LineSeries, { color: "#FF6D00", lineWidth: 1, priceScaleId: "macd", visible: activeIndicators.includes("MACD") });
    chart.priceScale("macd").applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, visible: activeIndicators.includes("MACD") });

    chartRef.current   = chart;
    candleRef.current  = candleSeries;
    liveLineRef.current = liveLine;
    setChartReady(true);

    // ── 3. Load historical candles ───────────────────────────────────────────
    const loadHistory = async () => {
      setIsLoading(true);
      let history: CandleOHLC[] = [];

      try {
        const pr = await fetch(`/api/market-data/price/${symbol}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (pr.ok) {
          const pd = await pr.json();
          const liveP = parseFloat(pd.price);
          if (liveP > 0) {
            targetPriceRef.current  = liveP;
            currentPriceRef.current = liveP;
            prevPriceRef.current    = liveP;
          }
        }
      } catch {}

      let loadDone = false;
      const loadTimeout = setTimeout(() => {
        if (!loadDone && isActive) {
          setIsLoading(false);
          startEngine();
        }
      }, 10000);

      try {
        const res = await fetch(
          `/api/market-data/history/${symbol}?interval=${timeframe}&range=1D`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.results?.length > 3) {
            history = data.results;
          }
        }
      } catch {}

      loadDone = true;
      clearTimeout(loadTimeout);

      if (history.length === 0) {
        const seedPrice = targetPriceRef.current || currentPriceRef.current;
        if (seedPrice > 0) {
           const now = Math.floor(Date.now() / 1000);
           const cs  = candleSecsRef.current;
           const aligned = Math.floor(now / cs) * cs;
           history.push({ time: aligned as UTCTimestamp, open: seedPrice, high: seedPrice, low: seedPrice, close: seedPrice, volume: 0 });
        }
      }

      if (!isActive) return;
      historyRef.current = history;

      if (isActive && chartRef.current && candleRef.current) {
        candleRef.current.setData(history);
      }

      const last = history[history.length - 1];
      if (last) {
        currentPriceRef.current = last.close;
        targetPriceRef.current  = last.close;
        prevPriceRef.current    = last.close;
        liveCandle.current      = { ...last };
        setDisplayPrice(last.close);
        liveLine.setData(history.map(c => ({ time: c.time, value: c.close })));
        
        if (indRefs.current.sma) indRefs.current.sma.setData(calculateSMA(history, 20));
        if (indRefs.current.ema) indRefs.current.ema.setData(calculateEMA(history, 55));
        if (indRefs.current.rsi) indRefs.current.rsi.setData(calculateRSI(history, 14));
        if (indRefs.current.macdHist && indRefs.current.macdLine && indRefs.current.macdSig) {
          const macd = calculateMACD(history);
          indRefs.current.macdHist.setData(macd.map(m => ({ time: m.time, value: m.hist, color: m.hist >= 0 ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)" })));
          indRefs.current.macdLine.setData(macd.map(m => ({ time: m.time, value: m.macd })));
          indRefs.current.macdSig.setData(macd.map(m => ({ time: m.time, value: m.signal })));
        }
      }

      const cs  = candleSecsRef.current;
      const endT = last ? (last.time as number) + cs * 8 : Math.floor(Date.now() / 1000) + cs * 8;
      const fromT = endT - cs * 68;
      chart.timeScale().setVisibleRange({ from: fromT as UTCTimestamp, to: endT as UTCTimestamp });

      setIsLoading(false);
      startEngine();
    };

    const startEngine = () => {
      const loop = () => {
        if (!isActive) return;

        const nowSec     = Math.floor(Date.now() / 1000);
        const candleSecs = candleSecsRef.current;
        if (candleSecs > 0) {
          const remaining = candleSecs - (nowSec % candleSecs);
          setCountdown(remaining);
        }

        animFrame = requestAnimationFrame(loop);
      };
      animFrame = requestAnimationFrame(loop);
    };

    const connectWS = () => {
      if (!isActive) return;
      const isCrypto = exchange === "BINANCE" && !["XAUUSD", "XAGUSD"].includes(symbol);

      if (isCrypto) {
        const wsSymbol = symbol.toLowerCase();
        const interval = TF_BIN[timeframe] ?? "1m";
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${wsSymbol}@kline_${interval}`);

        ws.onopen = () => { wsDelay = 1000; setIsConnected(true); };
        ws.onmessage = (ev) => {
          if (!isActive) return;
          try {
            const msg = JSON.parse(ev.data);
            if (msg.e === "kline" && msg.k) {
              const k = msg.k;
              const time = Math.floor(k.t / 1000) as UTCTimestamp;
              const open = parseFloat(k.o);
              const high = parseFloat(k.h);
              const low  = parseFloat(k.l);
              const close = parseFloat(k.c);
              const volume = parseFloat(k.v || "0");
              
              if (candleRef.current && close > 0) {
                try {
                  candleRef.current.update({ time, open, high, low, close });
                  liveLineRef.current?.update({ time, value: close });
                } catch {}
                liveCandle.current = { time, open, high, low, close, volume };
                setOhlcInfo({ o: open, h: high, l: low, c: close, v: volume });
              }
              onTickRef.current(close);
            }
          } catch {}
        };
        ws.onclose = () => {
          setIsConnected(false);
          if (!isActive) return;
          wsReco = setTimeout(() => {
            wsDelay = Math.min(wsDelay * 2, 30000);
            connectWS();
          }, wsDelay);
        };
        ws.onerror = () => {
          if (ws) ws.onclose = null;
          setIsConnected(false);
          if (!isActive) return;
          wsReco = setTimeout(() => { wsDelay = Math.min(wsDelay * 2, 30000); connectWS(); }, wsDelay);
        };

      } else {
        const poll = async () => {
          if (!isActive) return;
          try {
            const r = await fetch(`/api/market-data/price/${symbol}`);
            if (r.ok) {
              const d = await r.json();
              if (d.price && parseFloat(d.price) > 0) {
                onTickRef.current(parseFloat(d.price));
                setIsConnected(true);
              }
            }
          } catch {}
        };
        poll();
        poller = setInterval(poll, 2000);
        setIsConnected(true);
      }
    };

    loadHistory();
    wsInitTimer = setTimeout(() => {
      if (isActive) connectWS();
    }, 150);

    return () => {
      isActive = false;
      cancelAnimationFrame(animFrame);
      if (wsInitTimer) clearTimeout(wsInitTimer);
      if (wsReco)      clearTimeout(wsReco);
      if (poller)      clearInterval(poller);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState !== WebSocket.CLOSED) {
          try { ws.close(); } catch {}
        }
      }
      try { chart.remove(); } catch {}
      chartRef.current  = null;
      candleRef.current = null;
      setChartReady(false);
    };
  }, [symbol, timeframe, assetClass, exchange]);

  // ── Sync Indicators Visibility ──────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    
    const hasRSI = activeIndicators.includes("RSI");
    const hasMACD = activeIndicators.includes("MACD");
    
    indRefs.current.sma?.applyOptions({ visible: activeIndicators.includes("SMA") });
    indRefs.current.ema?.applyOptions({ visible: activeIndicators.includes("EMA") });
    indRefs.current.rsi?.applyOptions({ visible: hasRSI });
    indRefs.current.macdHist?.applyOptions({ visible: hasMACD });
    indRefs.current.macdLine?.applyOptions({ visible: hasMACD });
    indRefs.current.macdSig?.applyOptions({ visible: hasMACD });
    
    const rightMargin = 0.06;
    if (hasRSI && hasMACD) {
      chartRef.current.priceScale("right").applyOptions({ scaleMargins: { top: rightMargin, bottom: 0.4 } });
      chartRef.current.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.65, bottom: 0.2 }, visible: true });
      chartRef.current.priceScale("macd").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: true });
    } else if (hasRSI || hasMACD) {
      chartRef.current.priceScale("right").applyOptions({ scaleMargins: { top: rightMargin, bottom: 0.25 } });
      if (hasRSI) chartRef.current.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: true });
      if (hasMACD) chartRef.current.priceScale("macd").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: true });
    } else {
      chartRef.current.priceScale("right").applyOptions({ scaleMargins: { top: rightMargin, bottom: 0.12 } });
      chartRef.current.priceScale("rsi").applyOptions({ visible: false });
      chartRef.current.priceScale("macd").applyOptions({ visible: false });
    }
  }, [activeIndicators]);

  // ── Countdown display ──────────────────────────────────────────────────────
  const fmtCountdown = (s: number): string => {
    if (s <= 0) return "00:00";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const priceColor = priceDir === "up" ? "#00e676" : priceDir === "down" ? "#ff5252" : "#e5e7eb";
  const isUp = ohlcInfo.c >= ohlcInfo.o;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#131722] overflow-hidden rounded-xl border border-white/5">

      {/* ── OHLC Info Strip (Quotex style) ──────────────────────────────── */}
      {ohlcInfo.o > 0 && (
        <div className="absolute top-2.5 left-4 z-20 flex items-center gap-3.5 text-[11px] font-mono pointer-events-none select-none bg-[#181c25]/90 px-3 py-1 rounded-md border border-white/5 backdrop-blur-sm">
          <span className="text-gray-400">O: <span className={isUp ? "text-[#00e676] font-bold" : "text-[#ff5252] font-bold"}>{fmtPrice(ohlcInfo.o, symbol)}</span></span>
          <span className="text-gray-400">H: <span className="text-[#00e676] font-bold">{fmtPrice(ohlcInfo.h, symbol)}</span></span>
          <span className="text-gray-400">L: <span className="text-[#ff5252] font-bold">{fmtPrice(ohlcInfo.l, symbol)}</span></span>
          <span className="text-gray-400">C: <span style={{ color: priceColor }} className="font-bold">{fmtPrice(ohlcInfo.c, symbol)}</span></span>
        </div>
      )}

      {/* ── Live price badge ─────────────────────────────────────────────── */}
      <div className="absolute top-2.5 right-4 z-20 flex items-center gap-2 pointer-events-none">
        {isConnected && (
          <div className="flex items-center gap-1.5 bg-[#00e676]/10 border border-[#00e676]/40 rounded-full px-2.5 py-0.5 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00e676] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00e676]" />
            </span>
            <span className="text-[10px] text-[#00e676] font-extrabold tracking-wider">LIVE DATA</span>
          </div>
        )}
      </div>

      {/* ── Loading overlay ──────────────────────────────────────────────── */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#131722]/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#00e676]/30 border-t-[#00e676] rounded-full animate-spin" />
            <span className="text-[12px] text-gray-300 font-medium tracking-wide">Loading real-time institutional market data…</span>
          </div>
        </div>
      )}

      {/* ── Chart canvas ─────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ cursor: "crosshair" }}
      />

      {/* ── Price flash overlay (Quotex-style color flash) ───────────────── */}
      <div
        key={flashKey}
        className="absolute inset-0 pointer-events-none z-10 opacity-0 animate-price-flash"
        style={{
          background: priceDir === "up"
            ? "radial-gradient(ellipse at 80% 50%, rgba(0,230,118,0.08) 0%, transparent 70%)"
            : priceDir === "down"
              ? "radial-gradient(ellipse at 80% 50%, rgba(255,82,82,0.08) 0%, transparent 70%)"
              : "transparent"
        }}
      />

      {/* ── Candle countdown timer right on the price scale level ────────── */}
      {countdown > 0 && !isLoading && (
        <div className="absolute bottom-6 right-3 z-20 pointer-events-none">
          <div className="flex items-center gap-2 bg-[#1e222d] border border-[#2962ff]/60 rounded-md px-2.5 py-1 shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#2962ff] animate-ping" />
            <span className="text-[11px] font-mono font-black text-white tabular-nums tracking-wider">
              {fmtCountdown(countdown)}
            </span>
          </div>
        </div>
      )}

      {/* ── Price direction flash CSS ────────────────────────────────────── */}
      <style>{`
        @keyframes price-flash {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        .animate-price-flash {
          animation: price-flash 0.6s ease-out forwards;
      `}</style>
    </div>
  );
}

export default React.memo(LiveTradingChartComponent);
