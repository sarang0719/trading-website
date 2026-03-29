import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { useRoute, Link } from "wouter";
import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { useInstrumentDetail } from "@/hooks/use-instruments";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createChart, ColorType, CrosshairMode,
  CandlestickSeries, AreaSeries, LineSeries,
  HistogramSeries, BarSeries, BaselineSeries,
  type UTCTimestamp
} from "lightweight-charts";
import {
  ChevronDown, BarChart2, TrendingUp, Activity,
  Plus, History, Settings, AlignLeft, BarChart,
  MousePointer2, Crosshair, Minus, Pencil, Type, Square,
  Bell
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import OrderTicketDialog from "@/components/OrderTicketDialog";
import { useInstruments } from "@/hooks/use-instruments";

// Lazy-load heavy strategy panel
const StrategyPanel = lazy(() => import("@/components/StrategyPanel"));

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtUsd(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2
  }).format(n);
}

function fmtPct(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Timeframe Map ──────────────────────────────────────────────────────────

const TF_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M"
};

// ── Component ──────────────────────────────────────────────────────────────

export default function MarketDetail() {
  const [, params] = useRoute("/app/markets/:id");
  const id = params?.id ? Number(params.id) : undefined;
  const { toast } = useToast();

  const instrumentQuery = useInstrumentDetail(id);
  const data = instrumentQuery.data;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("1D");
  const [activeRange, setActiveRange] = useState("1Y");
  const [chartType, setChartType] = useState<
    "bar" | "candle" | "hollow" | "line" | "stepline" | "area" | "baseline" | "columns" | "heikin"
  >("candle");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<any>(null);
  const mainSeriesRef     = useRef<any>(null);
  const volumeSeriesRef   = useRef<any>(null);

  const instrument  = data?.instrument;
  const priceData   = data?.price;
  const isUp        = Number(priceData?.changePct ?? 0) >= 0;

  const instrumentsQuery     = useInstruments();
  const watchlistInstruments = (instrumentsQuery.data ?? []).slice(0, 15);

  // ── Handlers ─────────────────────────────────────────────────────────────
  
  const handleRangeClick = (t: string) => {
    setActiveRange(t);
    if (!chartRef.current || !mainSeriesRef.current) return;
    
    // Convert current visible data to determine time range
    const ts = chartRef.current.timeScale();
    const data = mainSeriesRef.current.data();
    if (!data || data.length === 0) return;
    
    // Timestamps are in seconds
    const last = data[data.length - 1].time as number; 
    let from = data[0].time as number;
    
    if (t === "1D") from = last - 86400;
    else if (t === "5D") from = last - (86400 * 5);
    else if (t === "1M") from = last - (86400 * 30);
    else if (t === "3M") from = last - (86400 * 90);
    else if (t === "6M") from = last - (86400 * 180);
    else if (t === "YTD") {
      const d = new Date(); d.setMonth(0,1); d.setHours(0,0,0,0);
      from = Math.floor(d.getTime() / 1000);
    }
    else if (t === "1Y") from = last - (86400 * 365);
    else if (t === "5Y") from = last - (86400 * 365 * 5);
    
    // Animate smoothly to the calculated range
    ts.setVisibleRange({ from: Math.max(from, data[0].time), to: last + 86400 * 2 });
  };

  // ── Unified chart + data effect ──────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current || !instrument) return;

    let isActive = true;
    let ws: WebSocket | null = null;

    // 1. Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(156,163,175,1)",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      width:  chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 500,
    });

    // 2. Add main series based on chart type
    let mainSeries: any;
    if (chartType === "candle" || chartType === "hollow" || chartType === "heikin") {
      const hollow = chartType === "hollow";
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor:        hollow ? "transparent" : "#22c55e",
        downColor:      "#ef4444",
        borderVisible:  hollow,
        borderUpColor:  "#22c55e",
        borderDownColor:"#ef4444",
        wickUpColor:    "#22c55e",
        wickDownColor:  "#ef4444",
      });
    } else if (chartType === "bar") {
      mainSeries = chart.addSeries(BarSeries, { upColor: "#22c55e", downColor: "#ef4444" });
    } else if (chartType === "area") {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: "#2962FF", topColor: "rgba(41,98,255,0.4)",
        bottomColor: "rgba(41,98,255,0)", lineWidth: 2,
      });
    } else if (chartType === "baseline") {
      mainSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: "#22c55e", topFillColor1: "rgba(34,197,94,0.28)",
        topFillColor2: "rgba(34,197,94,0.05)",
        bottomLineColor: "#ef4444", bottomFillColor1: "rgba(239,68,68,0.05)",
        bottomFillColor2: "rgba(239,68,68,0.28)",
      });
    } else if (chartType === "line" || chartType === "stepline") {
      mainSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6", lineWidth: 2,
        lineType: chartType === "stepline" ? 1 : 0,
      });
    } else {
      mainSeries = chart.addSeries(HistogramSeries, { color: "#3b82f6" });
    }

    // 3. Volume overlay
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a", priceFormat: { type: "volume" }, priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }, visible: false,
    });

    // 4. Save refs
    chartRef.current      = chart;
    mainSeriesRef.current = mainSeries;
    volumeSeriesRef.current = volumeSeries;

    // 5. Auto-resize observer
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width:  chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    ro.observe(chartContainerRef.current);

    // 6. Load data from Binance (5 years via 1000 limit or 1w) or AlphaVantage
    const isCrypto = instrument.assetClass === "CRYPTO" || instrument.symbol.endsWith("USDT");
    const interval = TF_MAP[timeframe] || "1d";
    const abortCtrl = new AbortController();

    const loadData = async () => {
      let baseData: any[] = [];

      if (isCrypto) {
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${instrument.symbol}&interval=${interval}&limit=1000`,
            { signal: abortCtrl.signal }
          );
          if (!res.ok) return;   
          const raw = await res.json();
          if (!isActive || !Array.isArray(raw)) return;
          baseData = raw.map((d: any) => ({
            time:   (d[0] / 1000) as UTCTimestamp,
            open:   parseFloat(d[1]),
            high:   parseFloat(d[2]),
            low:    parseFloat(d[3]),
            close:  parseFloat(d[4]),
            value:  parseFloat(d[4]),
            volume: parseFloat(d[5] || "0"),
          }));
        } catch { return; }
      } else {
        // Fetch real historical data for STOCKS / FOREX from Alpha Vantage (5+ years)
        try {
          const AV_KEY = "385249c9f711441797999463c29e0ead";
          let url = "";
          if (instrument.assetClass === "FOREX") {
            const fromC = instrument.symbol.substring(0, 3);
            const toC = instrument.symbol.substring(3, 6);
            url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromC}&to_symbol=${toC}&outputsize=full&apikey=${AV_KEY}`;
          } else {
             const sym = instrument.assetClass === "INDIAN_STOCK" ? `${instrument.symbol}.BSE` : instrument.symbol;
             url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=full&apikey=${AV_KEY}`;
          }
          const res = await fetch(url, { signal: abortCtrl.signal });
          const raw = await res.json();
          if (!isActive) return;
          const tsKey = Object.keys(raw).find(k => k.toLowerCase().includes("time series"));
          if (tsKey && raw[tsKey]) {
            const ts = raw[tsKey];
            const dates = Object.keys(ts).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
            // Limit to past 5 years roughly (1800 trading days)
            const sliced = dates.slice(-1800);
            baseData = sliced.map(date => {
                const dayStr = ts[date];
                return {
                    time: Math.floor(new Date(date).getTime() / 1000) as UTCTimestamp,
                    open: parseFloat(dayStr["1. open"]),
                    high: parseFloat(dayStr["2. high"]),
                    low: parseFloat(dayStr["3. low"]),
                    close: parseFloat(dayStr["4. close"]),
                    value: parseFloat(dayStr["4. close"]),
                    volume: parseFloat(dayStr["5. volume"] || dayStr["volume"] || "0"),
                };
            });
          }
        } catch (e) {
            console.error("Alpha Vantage real history fetch failed", e);
        }
      }

      // Heikin-Ashi
      if (chartType === "heikin" && baseData.length > 0) {
        let pO = baseData[0].open, pC = baseData[0].close;
        baseData = baseData.map((d: any, i: number) => {
          if (i === 0) return d;
          const haC = (d.open + d.high + d.low + d.close) / 4;
          const haO = (pO + pC) / 2;
          pO = haO; pC = haC;
          return { ...d, open: haO, high: Math.max(d.high, haO, haC), low: Math.min(d.low, haO, haC), close: haC, value: haC };
        });
      }

      if (!isActive || !mainSeries || baseData.length === 0) return;

      try {
        mainSeries.setData(baseData);
        volumeSeries.setData(baseData.map((d: any) => ({
          time:  d.time, value: d.volume,
          color: d.close >= d.open ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)",
        })));
        chart.timeScale().fitContent();
      } catch { /* chart was removed during navigation */ }

      // 7. WebSocket live ticks — only if online
      if (isCrypto && isActive && typeof navigator !== "undefined" && navigator.onLine) {
        try {
          ws = new WebSocket(`wss://stream.binance.com:9443/ws/${instrument.symbol.toLowerCase()}@kline_${interval}`);
          ws.onerror = () => { ws = null; };
          ws.onclose = () => { ws = null; };
          ws.onmessage = (ev) => {
            if (!isActive) return;
            try {
              const msg = JSON.parse(ev.data);
              if (msg.e !== "kline") return;
              const k = msg.k;
              const c = { time: (k.t / 1000) as UTCTimestamp, open: +k.o, high: +k.h, low: +k.l, close: +k.c, value: +k.c };
              mainSeries?.update(c);
              volumeSeries?.update({ time: c.time, value: +k.v, color: c.close >= c.open ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)" });
            } catch { /* ignore bad frames */ }
          };
        } catch { /* WebSocket construction failed — skip */ }
      }
    };

    loadData();

    return () => {
      isActive = false;
      abortCtrl.abort();
      ro.disconnect();
      if (ws && ws.readyState < 2) try { ws.close(); } catch { /* ignore */ }
      try { chart.remove(); } catch { /* ignore */ }
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [instrument?.symbol, timeframe, chartType]); // eslint-disable-line

  // ── Loading / Error States ─────────────────────────────────────────────
  if (instrumentQuery.isLoading) {
    return (
      <AppShell noPadding>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-12 w-48" />
        </div>
      </AppShell>
    );
  }

  if (!instrument) {
    return (
      <AppShell noPadding>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <h2 className="text-xl font-bold">Instrument not found</h2>
          <Link href="/app/markets" className="text-primary hover:underline">Back to Markets</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell noPadding>
      <Seo title={`${instrument.symbol} • ${instrument.name} • Aurum Paper`} />

      {/*
        ┌── ROOT: full height, no scroll, 3-column TV layout ──────────────┐
        │  [left toolbar]  [center chart]  [right sidebar]                 │
        └──────────────────────────────────────────────────────────────────┘
      */}
      <div className="flex flex-1 min-h-0 overflow-hidden bg-background">

        {/* ── LEFT VERTICAL TOOLBAR ── */}
        <div className="hidden sm:flex w-11 flex-col items-center pt-3 pb-3 gap-4 bg-card/40 border-r border-border/40 shrink-0">
          <MousePointer2 className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Crosshair     className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <div className="h-px w-6 bg-border/50" />
          <Minus   className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer -rotate-45 transition-colors" />
          <Pencil  className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Type    className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Square  className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
        </div>

        {/* ── CENTER: CHART COLUMN ── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

          {/* Top toolbar */}
          <div className="h-11 shrink-0 border-b border-border/40 flex items-center px-3 gap-3 bg-card/30 overflow-x-auto scrollbar-none whitespace-nowrap">

            {/* Symbol */}
            <div className="flex items-center gap-1.5 pr-3 border-r border-border/40 shrink-0">
              <div className="h-5 w-5 bg-primary/20 text-primary flex items-center justify-center rounded-full text-[9px] font-bold shrink-0">
                {instrument.symbol[0]}
              </div>
              <span className="font-bold text-sm">{instrument.symbol}</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </div>

            {/* Timeframe dropdown */}
            <div className="pr-3 border-r border-border/40 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1 outline-none text-sm font-bold hover:text-primary transition-colors">
                  {timeframe} <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-24">
                  {["1m","5m","15m","30m","1H","4H","1D","1W","1M"].map(t => (
                    <DropdownMenuItem key={t} onClick={() => setTimeframe(t)}
                      className={cn(timeframe === t && "text-primary font-bold")}>
                      {t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Chart type dropdown */}
            <div className="pr-3 border-r border-border/40 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground text-xs font-semibold">
                    {chartType === "candle"   && <BarChart2 className="h-4 w-4" />}
                    {chartType === "bar"      && <AlignLeft className="h-4 w-4" />}
                    {chartType === "hollow"   && <BarChart2 className="h-4 w-4 opacity-70" />}
                    {chartType === "line"     && <TrendingUp className="h-4 w-4" />}
                    {chartType === "stepline" && <TrendingUp className="h-4 w-4" />}
                    {chartType === "area"     && <Activity className="h-4 w-4" />}
                    {chartType === "baseline" && <Activity className="h-4 w-4" />}
                    {chartType === "columns"  && <BarChart className="h-4 w-4" />}
                    {chartType === "heikin"   && <BarChart2 className="h-4 w-4" />}
                    <span>
                      {{candle:"Candles",bar:"Bars",hollow:"Hollow",line:"Line",stepline:"Step",area:"Area",baseline:"Baseline",columns:"Columns",heikin:"Heikin Ashi"}[chartType]}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {([["bar","Bars",AlignLeft],["candle","Candles",BarChart2],["hollow","Hollow Candles",BarChart2],["line","Line",TrendingUp],["stepline","Step Line",TrendingUp],["area","Area",Activity],["baseline","Baseline",Activity],["columns","Columns",BarChart],["heikin","Heikin Ashi",BarChart2]] as any[]).map(([t,l,Icon]) => (
                    <DropdownMenuItem key={t} onClick={() => setChartType(t)} className={cn(chartType === t && "text-primary font-bold")}>
                      <Icon className="h-4 w-4 mr-2" />{l}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Indicators / Alert / Replay */}
            <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground pr-3 border-r border-border/40 shrink-0">
              <div className="flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                <Activity className="w-3.5 h-3.5" /> Indicators
              </div>
              <div className="flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                <Bell className="w-3.5 h-3.5" /> Alert
              </div>
              <div className="flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                <History className="w-3.5 h-3.5" /> Replay
              </div>
            </div>

            {/* Spacer + Live price */}
            <div className="flex-1" />
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="font-bold">{fmtUsd(Number(priceData?.price))}</span>
              <span className={isUp ? "text-emerald-400" : "text-rose-400"}>
                {Number(priceData?.changeAbs) > 0 ? "+" : ""}{Number(priceData?.changeAbs).toFixed(2)} ({fmtPct(Number(priceData?.changePct))})
              </span>
            </div>
          </div>

          {/* Chart canvas — fills ALL remaining height */}
          <div ref={chartContainerRef} className="flex-1 min-h-0 w-full" />

          {/* Bottom timeframe bar */}
          <div className="h-8 shrink-0 border-t border-border/40 flex items-center gap-5 px-4 bg-card/20 text-[11px] font-bold text-muted-foreground overflow-x-auto scrollbar-none whitespace-nowrap">
            {["1D","5D","1M","3M","6M","YTD","1Y","5Y","ALL"].map(t => (
              <span 
                key={t} 
                onClick={() => handleRangeClick(t)}
                className={cn("cursor-pointer hover:text-foreground transition-colors shrink-0", activeRange === t && "text-primary")}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── fixed width, scrollable inside ── */}
        <div className="w-[300px] xl:w-[320px] shrink-0 flex flex-col border-l border-border/40 bg-card/20 overflow-y-auto">

          {/* ── WATCHLIST ── */}
          <div className="border-b border-border/40">
            <div className="flex items-center justify-between px-4 py-2.5 font-bold text-sm">
              <span>Watchlist</span>
              <div className="flex gap-3 text-muted-foreground">
                <Plus className="w-4 h-4 cursor-pointer hover:text-foreground" />
                <Settings className="w-4 h-4 cursor-pointer hover:text-foreground" />
              </div>
            </div>
            <div className="px-4 pb-1 grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] uppercase font-bold text-muted-foreground">
              <span>Symbol</span>
              <span className="text-right w-20">Last</span>
              <span className="text-right w-14">Chg%</span>
            </div>
            <div className="px-2 pb-2">
              {watchlistInstruments.map((it: any) => (
                <Link key={it.id} href={`/app/markets/${it.id}`}>
                  <div className={cn(
                    "grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1.5 px-2 rounded-lg cursor-pointer hover:bg-secondary/40 transition-colors",
                    it.id === instrument?.id && "bg-primary/10"
                  )}>
                    <span className="font-bold text-xs truncate flex items-center gap-1.5">
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", Number(it.price?.changePct) >= 0 ? "bg-emerald-500" : "bg-rose-500")} />
                      {it.symbol}
                    </span>
                    <span className="text-xs text-right w-20 truncate font-mono">
                      {it.price?.price
                        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(it.price.price) < 1 ? 4 : 2 }).format(Number(it.price.price))
                        : "—"}
                    </span>
                    <span className={cn("text-[11px] text-right w-14 font-bold", Number(it.price?.changePct) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {Number(it.price?.changePct) >= 0 ? "+" : ""}{Number(it.price?.changePct || 0).toFixed(2)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* ── PERFORMANCE ── */}
          <div className="border-b border-border/40 px-4 py-3">
            <div className="text-sm font-bold mb-3 flex items-center justify-between">
              Performance <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(() => {
                const sl  = priceData?.sparkline ?? [];
                const len = sl.length;
                const pct = (idx: number) => len > 1
                  ? (((Number(sl[len - 1]) - Number(sl[Math.max(0, len - 1 - idx)])) / Number(sl[Math.max(0, len - 1 - idx)])) * 100).toFixed(2)
                  : "0.00";
                return [{ label: "1W", idx: 7 }, { label: "2W", idx: 14 }, { label: "1M", idx: 30 }].map(({ label, idx }) => {
                  const v = Number(pct(idx));
                  return (
                    <div key={label} className={cn("flex flex-col items-center py-2 rounded-lg text-center", v >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                      <span className="font-bold text-[11px]">{v >= 0 ? "+" : ""}{v}%</span>
                      <span className="text-[9px] opacity-70 mt-0.5">{label}</span>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Buy / Sell buttons */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                className="h-9 font-bold bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-xl border border-rose-500/20 transition-all"
                onClick={() => setTicketOpen(true)}
              >Sell</Button>
              <Button
                className="h-9 font-bold bg-emerald-600 text-white hover:bg-emerald-500 rounded-xl shadow-md shadow-emerald-500/10 transition-all"
                onClick={() => setTicketOpen(true)}
              >Buy</Button>
            </div>
          </div>

          {/* ── QUANTEDGE PANEL ── */}
          <div className="flex-1 p-0">
            <Suspense fallback={
              <div className="p-6 flex flex-col items-center gap-3 text-muted-foreground">
                <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs">Loading QuantEdge Engine…</span>
              </div>
            }>
              {instrument?.symbol && (
                <StrategyPanel symbol={instrument.symbol} interval="1d" />
              )}
            </Suspense>
          </div>
        </div>
      </div>

      <OrderTicketDialog
        open={ticketOpen}
        onOpenChange={setTicketOpen}
        defaultPortfolioId={1}
        defaultInstrument={instrument}
      />
    </AppShell>
  );
}
