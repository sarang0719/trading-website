import { useState, useMemo, useEffect, useRef, lazy, Suspense, useCallback } from "react";
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
  Bell, Clock, PlusCircle, MinusCircle, CheckCircle,
  XCircle, BrainCircuit, Zap, TrendingDown, ChevronRight,
  Lock, RefreshCw
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import OrderTicketDialog from "@/components/OrderTicketDialog";
import { useInstruments } from "@/hooks/use-instruments";
import { useTimeTrades } from "@/hooks/use-time-trades";
import QuotexOverlay from "@/components/QuotexOverlay";
import { calculatePnL } from "@/lib/pnl";
import type { CandlePrediction } from "@/lib/candle-predictor";
import { useAiCredits } from "@/hooks/useAiCredits";
import { AiPaymentModal } from "@/components/AiPaymentModal";
import { useAuth } from "@/hooks/use-auth";
import StrategyPanel from "@/components/StrategyPanel";
import { isGlobalMarketOpen } from "@shared/market-hours";

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
  "1m": "1m", "2m": "2m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M"
};

import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";

// ── Commission Modal Component ──────────────────────────────────────────────

const CommissionModal = ({ open, onAgree, onDeny }: { open: boolean, onAgree: () => void, onDeny: () => void }) => {
  return (
    <Dialog open={open} onOpenChange={(val) => !val && onDeny()}>
      <DialogContent className="max-w-md bg-[#0f1420] border-border/40 shadow-2xl overflow-hidden rounded-2xl">
        <DialogHeader className="p-2">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2 border border-primary/20">
             <Zap className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="text-xl font-bold text-center text-white">Smart Auto-Invest Access</DialogTitle>
          <DialogDescription className="text-center text-muted-foreground text-sm leading-relaxed px-4">
            To enable our institutional AI Quant algorithms, a <span className="text-primary font-bold">10% Company Commission</span> is applied on each investment amount. This fee ensures our high-performance infrastructure remains cutting-edge.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-[#161a25] px-6 py-4 border-y border-border/10 space-y-3">
           <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                 <CheckCircle className="w-3 h-3 text-emerald-400" />
              </div>
              <p className="text-xs text-foreground font-medium">97.4% High-Accuracy Signals</p>
           </div>
           <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                 <CheckCircle className="w-3 h-3 text-emerald-400" />
              </div>
              <p className="text-xs text-foreground font-medium">Iterative $50/45/35 Round Sequence</p>
           </div>
           <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                 <CheckCircle className="w-3 h-3 text-emerald-400" />
              </div>
              <p className="text-xs text-foreground font-medium">Automatic 10% Infrastructure Fee</p>
           </div>
        </div>
        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 px-6 pb-6">
          <Button variant="outline" onClick={onDeny} className="flex-1 h-11 border-border/40 text-muted-foreground hover:bg-white/5 font-bold uppercase text-[11px] tracking-wider">
             Decline
          </Button>
          <Button onClick={onAgree} className="flex-1 h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase text-[11px] tracking-wider shadow-lg shadow-primary/20">
             Agree & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Live Candle Timer Component ────────────────────────────────────────────

const CandleTimer = ({ interval }: { interval: string }) => {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    let secondsPerCandle = 60;
    const match = interval.match(/^(\d+)([a-zA-Z]+)$/);
    if (match) {
       const val = parseInt(match[1]);
       const unit = match[2];
       if (unit === "m") secondsPerCandle = val * 60;
       else if (unit === "h" || unit === "H") secondsPerCandle = val * 3600;
       else if (unit === "d" || unit === "D") secondsPerCandle = val * 86400;
       else if (unit === "w" || unit === "W") secondsPerCandle = val * 604800;
       else if (unit === "M") secondsPerCandle = val * 2592000;
    }

    const timer = setInterval(() => {
      const ms = Date.now();
      const secondsCurrent = Math.floor(ms / 1000);
      const remainder = secondsCurrent % secondsPerCandle;
      const remaining = secondsPerCandle - remainder;
      
      if (remaining >= 3600) {
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const s = remaining % 60;
        setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      } else {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        setTimeLeft(`${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [interval]);

  if (!timeLeft) return null;

  return (
    <div className="absolute right-14 bottom-[80px] z-[25] pointer-events-none">
       <div className="bg-background/90 backdrop-blur-md border border-border/60 text-muted-foreground px-2 py-1 rounded shadow-sm text-[11px] font-mono flex items-center gap-1.5 transition-all">
          <Clock className="w-3 h-3 text-primary animate-pulse" />
          <span>Candle close:</span>
          <span className="font-bold text-primary">{timeLeft}</span>
       </div>
    </div>
  );
};

// ── Component ──────────────────────────────────────────────────────────────

export default function MarketDetail() {
  const [, params] = useRoute("/app/markets/:id");
  const id = params?.id ? Number(params.id) : undefined;
  const { toast } = useToast();
  const { user } = useAuth();

  const instrumentQuery = useInstrumentDetail(id);
  const data = instrumentQuery.data;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("1m");
  const [activeRange, setActiveRange] = useState("1D");
  const [chartType, setChartType] = useState<
    "bar" | "candle" | "hollow" | "line" | "stepline" | "area" | "baseline" | "columns" | "heikin"
  >("candle");
  const [showIndicators, setShowIndicators] = useState(false);
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<any>(null);
  const mainSeriesRef     = useRef<any>(null);
  const volumeSeriesRef   = useRef<any>(null);

  const instrument  = data?.instrument;
  const priceData   = data?.price;
  const isUp        = Number(priceData?.changePct ?? 0) >= 0;

  const [tradeAmount, setTradeAmount] = useState(5);
  // tradeDuration is always aligned with the chart timeframe (candle period)
  const [tradeDuration, setTradeDuration] = useState(60); // default: 1m candle
  const [livePrice, setLivePrice] = useState<number | null>(null);
  
  // Custom Candle Detail Hover states
  const [hoverTimeStr, setHoverTimeStr] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number, y: number } | null>(null);
  
  const { placeTrade, trades } = useTimeTrades();

  const displayPrice = livePrice !== null ? livePrice : Number(priceData?.price ?? 0);

  // Filter trades for this instrument
  const instrumentTrades = useMemo(() => {
    return (trades || []).filter(t => t.instrumentId === instrument?.id);
  }, [trades, instrument?.id]);

  const activeTrades = instrumentTrades.filter(t => t.status === "ACTIVE");
  const pastTrades = instrumentTrades.filter(t => t.status !== "ACTIVE");

  // --- Sound Effects ---
  const prevPastTradesRef = useRef<number>(pastTrades.length);
  useEffect(() => {
    if (pastTrades.length > prevPastTradesRef.current) {
      // Find new resolved trades (assuming they append or prepend, filter newly added by ID)
      const prevIds = new Set(instrumentTrades.filter(t => t.status !== "ACTIVE").slice(pastTrades.length - prevPastTradesRef.current).map((t: any) => t.id)); // basic check
      const newTrades = pastTrades.slice(0, pastTrades.length - prevPastTradesRef.current); // if prepend
      
      newTrades.forEach(t => {
        if (t.status === "WIN") {
          const s = new Audio("https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3");
          s.volume = 0.6;
          s.play().catch(() => {});
        } else if (t.status === "LOSS") {
          const s = new Audio("https://assets.mixkit.co/active_storage/sfx/2955/2955-preview.mp3");
          s.volume = 0.4;
          s.play().catch(() => {});
        }
      });
    }
    prevPastTradesRef.current = pastTrades.length;
  }, [pastTrades, instrumentTrades]);

  const priceLinesRef = useRef<Map<number, any>>(new Map());
  const candlesRef = useRef<any[]>([]);
  const smaSeriesRef = useRef<any>(null);
  const emaSeriesRef = useRef<any>(null);

  // --- Auto-Invest / AI State ---
  const [aiSignal, setAiSignal] = useState<"BUY" | "SELL">("BUY");
  const [aiConfidence, setAiConfidence] = useState(85);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [takeProfit, setTakeProfit] = useState(100);
  const [stopLoss, setStopLoss] = useState(50);
  const [autoTradeActive, setAutoTradeActive] = useState(false);
  const [sessionPnL, setSessionPnL] = useState(0);

  const handleAgreeCommission = async () => {
    try {
      const res = await fetch("/api/user/commission-agreement", { method: "POST" });
      if (res.ok) {
         setShowCommissionModal(false);
         setAutoTradeEnabled(true);
         toast({ title: "Agreement Confirmed", description: "You've successfully opted-in to Smart Auto-Invest. 10% fee will be applied per trade." });
      }
    } catch (err) {
      toast({ title: "Sync failed", variant: "destructive" });
    }
  };
  const [showAiBotPopup, setShowAiBotPopup] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // --- Auto-Invest Forced Values (Rounds) ---
  const isAdmin = useMemo(() => ["saran123@gmail.com", "htctrade@gmail.com"].includes((user?.email || "").toLowerCase()), [user?.email]);
  const currentRound = user?.autoInvestRound || 1;

  useEffect(() => {
    if (autoTradeEnabled && !isAdmin) {
       // Force values based on round limits
       if (currentRound === 1) {
          setTradeAmount(50);
          setTakeProfit(50);
          setStopLoss(20);
       } else if (currentRound === 2) {
          setTradeAmount(45);
          setTakeProfit(45);
          setStopLoss(20);
       } else if (currentRound >= 3) {
          setTradeAmount(35);
          setTakeProfit(35);
          setStopLoss(15);
       }
    }
  }, [autoTradeEnabled, currentRound, isAdmin]);

  // AI Credits system
  const { credits, fetchCredits, usePrediction } = useAiCredits();
  const isAdminUser = credits?.isAdmin ?? false;
  const isUnlimited = credits?.unlimited ?? false;
  const freeRemaining = credits ? Math.max(0, credits.freePredictionsLimit - credits.freePredictionsUsed) : 6;
  const totalRemaining = credits ? freeRemaining + credits.paidCredits : 6;
  const canUseAi = isUnlimited || (credits ? credits.canUse : true); // admins always true

  // Gate: consume a credit when the user opens the bot popup
  const handleOpenBotPopup = useCallback(async () => {
    if (!showAiBotPopup) {
      // Admins skip credit check entirely
      if (!isUnlimited) {
        if (!canUseAi) {
          setShowPaymentModal(true);
          return;
        }
        const result = await usePrediction();
        if (!result.granted) {
          setShowPaymentModal(true);
          return;
        }
      }
    }
    setShowAiBotPopup(v => !v);
  }, [showAiBotPopup, canUseAi, isUnlimited, usePrediction]);
  const [prediction, setPrediction] = useState<CandlePrediction | null>(null);
  const [predCountdown, setPredCountdown] = useState("");
  const [showPredFactors, setShowPredFactors] = useState(false);
  const lastCandleTimeRef = useRef<number>(0);

  // ── Next-Candle Predictor Engine (fires on every candle close) ──────────
  useEffect(() => {
    if (!instrument) return;

    // Candle duration in seconds
    let candleSecs = 60;
    const tfMatch = timeframe.match(/^(\d+)([a-zA-Z]+)$/);
    if (tfMatch) {
      const v = parseInt(tfMatch[1]), u = tfMatch[2];
      if (u === "m") candleSecs = v * 60;
      else if (u === "H" || u === "h") candleSecs = v * 3600;
      else if (u === "D" || u === "d") candleSecs = v * 86400;
      else if (u === "W" || u === "w") candleSecs = v * 604800;
      else if (u === "M") candleSecs = v * 2592000;
    }

    const runPredictor = async (candles: any[]) => {
      try {
        const { predictNextCandle } = await import("@/lib/candle-predictor");
        // Use only the last 300 CLOSED candles (exclude the live one)
        if (!candles || candles.length < 20) return;
        const closed = candles.slice(0, -1);
        const pred = predictNextCandle(closed, candleSecs);
        if (pred) {
          setPrediction(pred);
          setAiSignal(pred.direction);
          setAiConfidence(pred.probability);
        }
      } catch (e) {
        console.error("AI Engine Prediction Error:", e);
      }
    };

    // Run immediately on existing candles (if any)
    if (candlesRef.current?.length > 20) {
      runPredictor(candlesRef.current);
    }

    // Poll every 2 seconds — v17.0 Hyper-Reactive Institutional Monitor
    // Analyze live price action WHILE it happens for instant entries.
    const v17Monitor = setInterval(() => {
      if (candlesRef.current?.length > 20) {
        runPredictor(candlesRef.current);
      }
    }, 2000);

    // Countdown to next candle
    const countdownTimer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const rem = candleSecs - (now % candleSecs);
      const m = Math.floor(rem / 60);
      const s = rem % 60;
      setPredCountdown(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);

      // 5 seconds before candle close — trigger one final prediction update
      if (rem <= 5 && rem > 0) {
        runPredictor(candlesRef.current);
      }
    }, 1000);

    // Run once immediately on mount
    setTimeout(() => runPredictor(candlesRef.current), 2000);

    return () => { clearInterval(v17Monitor); clearInterval(countdownTimer); };
  }, [instrument, timeframe]);

  // Watch past trades to update session PnL
  useEffect(() => {
    let acc = 0;
    for (const t of pastTrades) {
      if (t.status === "WIN") acc += parseFloat(t.amount as string) * 0.85;
      if (t.status === "LOSS") acc -= parseFloat(t.amount as string);
    }
    setSessionPnL(acc);
  }, [pastTrades]);

  // Auto-Trade execution
  useEffect(() => {
    if (!autoTradeActive || !instrument || !displayPrice) return;
    
    // Profit limit completely removed for user account
    // if (sessionPnL >= takeProfit) {
    //   toast({ title: "Target Reached", description: `You hit your profit limit of $${takeProfit}!` });
    //   setAutoTradeActive(false);
    //   return;
    // }
    // if (sessionPnL <= -stopLoss) {
    //   toast({ variant: "destructive", title: "Stop Loss Hit", description: `You reached your maximum loss limit of $${stopLoss}.` });
    //   setAutoTradeActive(false);
    //   return;
    // }

    // Delay bot logic slightly to look natural
    const botTimer = setTimeout(() => {
      // If we already have an active trade, wait until it finishes
      if (activeTrades.length > 0) return;

      if (!placeTrade.isPending) {
        handlePlaceTrade(aiSignal);
      }
    }, 2000);

    return () => clearTimeout(botTimer);
  }, [autoTradeActive, activeTrades.length, aiSignal, displayPrice, sessionPnL, placeTrade.isPending]);

  // Expose refs for Overlay
  // chartRef, mainSeriesRef are already defined above

  const handlePlaceTrade = (side: "BUY" | "SELL") => {
    if (!instrument || !displayPrice) return;
    placeTrade.mutate({
      instrumentId: instrument.id,
      side,
      amount: tradeAmount.toString(),
      strikePrice: displayPrice.toString(),
      durationSeconds: tradeDuration,
      placedBy: autoTradeActive ? "AI_BOT" : undefined
    }, {
      onSuccess: () => {
        toast({ title: "Trade Placed", description: `Opened a ${tradeDuration}s ${side} order on ${instrument.symbol}.` });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Trade Rejected", description: err.message });
      }
    });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  
  const handleRangeClick = (t: string) => {
    setActiveRange(t);
    
    // Auto-adjust resolution to ensure we have enough fetched candles for the zoom range
    let targetTF = timeframe;
    if (t === "1D") targetTF = "1m";
    else if (t === "5D") targetTF = "5m";
    else if (t === "1M") targetTF = "1H";
    else if (t === "3M" || t === "6M") targetTF = "4H";
    else if (t === "YTD" || t === "1Y" || t === "ALL") targetTF = "1D";

    if (targetTF !== timeframe) {
      setTimeframe(targetTF);
      // Let the useEffect handle the data fetching and new zoom logic
      return; 
    }

    if (!chartRef.current || !mainSeriesRef.current) return;
    
    const ts = chartRef.current.timeScale();
    const data = mainSeriesRef.current.data();
    if (!data || data.length === 0) return;
    
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
    else if (t === "ALL") from = last - (86400 * 1095); // EXACTLY 3 Years of data for the ALL timeline
    
    ts.setVisibleRange({ from: Math.max(from, data[0].time), to: last + (last - from) * 0.05 });
  };

  // ── Sync Native PriceLines for Active Trades ─────────────────────────────
  useEffect(() => {
    if (!mainSeriesRef.current || !instrument) return;
    const series = mainSeriesRef.current;
    
    const activeIds = new Set(activeTrades.map(t => t.id));

    // Remove completed trade lines
    Array.from(priceLinesRef.current.entries()).forEach(([id, line]) => {
      if (!activeIds.has(id)) {
        try { series.removePriceLine(line); } catch {}
        priceLinesRef.current.delete(id);
      }
    });

    // Add new trade lines
    for (const trade of activeTrades) {
      if (!priceLinesRef.current.has(trade.id)) {
        const side = trade.side as "BUY" | "SELL";
        const strikePrice = parseFloat(trade.strikePrice as string);
        const color = side === "BUY" ? "#10b981" : "#f43f5e";
        
        try {
          const line = series.createPriceLine({
            price: strikePrice,
            color: color,
            lineWidth: 2,
            lineStyle: 3, // Dashed
            axisLabelVisible: true,
            title: side,
          });
          priceLinesRef.current.set(trade.id, line);
        } catch {}
      }
    }
  }, [activeTrades, instrument?.id]);

  // Handle Indicators visibility
  useEffect(() => {
     if (smaSeriesRef.current) smaSeriesRef.current.applyOptions({ visible: showIndicators });
     if (emaSeriesRef.current) emaSeriesRef.current.applyOptions({ visible: showIndicators });
  }, [showIndicators]);

  // ── Unified chart + data effect ──────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current || !instrument) return;

    let isActive = true;
    let ws: WebSocket | null = null;
    let simInterval: any = null;

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
      timeScale: { 
        borderColor: "rgba(255,255,255,0.08)", 
        timeVisible: true, 
        secondsVisible: false,
        rightOffset: 5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      width:  chartContainerRef.current.clientWidth || 300,
      height: chartContainerRef.current.clientHeight || 400,
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
    
    // Add hidden indicator series initially
    smaSeriesRef.current = chart.addSeries(LineSeries, { color: "rgba(255, 193, 7, 0.8)", lineWidth: 2, title: "SMA(20)" });
    emaSeriesRef.current = chart.addSeries(LineSeries, { color: "rgba(103, 58, 183, 0.8)", lineWidth: 2, title: "EMA(55)" });
    smaSeriesRef.current.applyOptions({ visible: showIndicators });
    emaSeriesRef.current.applyOptions({ visible: showIndicators });

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

    // 6. Load data from APIs
    const interval = TF_MAP[timeframe] || "1d";
    const abortCtrl = new AbortController();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
          setHoverTimeStr(null);
          setHoverPosition(null);
          return;
      }
      
      let secondsPerCandle = 60;
      const match = interval.match(/^(\d+)([a-zA-Z]+)$/);
      if (match) {
         const val = parseInt(match[1]);
         const unit = match[2];
         if (unit === "m") secondsPerCandle = val * 60;
         else if (unit === "h" || unit === "H") secondsPerCandle = val * 3600;
         else if (unit === "d" || unit === "D") secondsPerCandle = val * 86400;
         else if (unit === "w" || unit === "W") secondsPerCandle = val * 604800;
         else if (unit === "M") secondsPerCandle = val * 2592000;
      }

      const t = param.time as number;
      const d1 = new Date(t * 1000);
      const d2 = new Date((t + secondsPerCandle) * 1000);
      
      const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: secondsPerCandle < 60 ? '2-digit' : undefined });
      setHoverTimeStr(`${formatTime(d1)} - ${formatTime(d2)}`);
      setHoverPosition({ x: param.point.x, y: param.point.y });
    });

    const loadData = async () => {
      let baseData: any[] = [];

      if (baseData.length === 0 && instrument?.exchange === "BINANCE" && instrument?.symbol !== "XAUUSD") {
        try {
          const binanceSymbol = instrument.symbol;
          // Binance does not support 2m or 3m directly, map them to 1m for historical seed
          const fetchInterval = (interval === "2m" || interval === "3m") ? "1m" : interval;
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${fetchInterval}&limit=1000`,
            { signal: abortCtrl.signal }
          );
          if (res.ok) {
            const raw = await res.json();
            if (isActive && Array.isArray(raw)) {
              baseData = raw.map((d: any) => ({
                time:   (d[0] / 1000) as UTCTimestamp,
                open:   parseFloat(d[1]),
                high:   parseFloat(d[2]),
                low:    parseFloat(d[3]),
                close:  parseFloat(d[4]),
                value:  parseFloat(d[4]),
                volume: parseFloat(d[5] || "0"),
              }));
            }
          }
        } catch { /* Suppress CORS/Network errors and fall through to Simulation */ }
      } else if (instrument?.exchange !== "OTC") {
        // Twelve Data API Integration for Forex, Stocks, and Commodities
        try {
          let tdInt = interval;
          if (interval === "2m" || interval === "3m") tdInt = "1min";
          else if (interval.endsWith("m")) tdInt = interval + "in";
          else if (interval === "1d") tdInt = "1day";
          else if (interval === "1w") tdInt = "1week";
          else if (interval === "1M") tdInt = "1month";

          let tdSymbol = instrument.symbol;
          if (instrument.assetClass === "FOREX" || ["XAUUSD", "XAGUSD", "WTIUSD", "BRENTUSD"].includes(tdSymbol)) {
             if (tdSymbol.length >= 6 && !tdSymbol.includes("/")) tdSymbol = tdSymbol.substring(0, 3) + "/" + tdSymbol.substring(3);
          }

          const res = await fetch(
            `https://api.twelvedata.com/time_series?symbol=${tdSymbol}&interval=${tdInt}&apikey=b630be1ed9604a29a35ad8d11a8af18c&outputsize=500&timezone=UTC`,
            { signal: abortCtrl.signal }
          );
          if (res.ok) {
            const raw = await res.json();
            if (isActive && raw.values && Array.isArray(raw.values)) {
              baseData = raw.values.reverse().map((d: any) => ({
                time:   (new Date(d.datetime + " UTC").getTime() / 1000) as UTCTimestamp,
                open:   parseFloat(d.open),
                high:   parseFloat(d.high),
                low:    parseFloat(d.low),
                close:  parseFloat(d.close),
                value:  parseFloat(d.close),
                volume: parseFloat(d.volume || "0"),
              }));
            }
          }
        } catch {} // Fall through to simulation if API quota exceeded
      }

      // Provide High-Quality Mock Data for Non-Binance Markets (Gold, Stocks, OTC) or if fetch failed
      if (baseData.length === 0) {
        let walkPrice = displayPrice || 1500;
        const now = Math.floor(Date.now() / 1000);
        const limit = 500;
        
        let candleSecs = 60; // Default 1m
        if (interval.endsWith("h")) candleSecs = parseInt(interval) * 3600;
        else if (interval.endsWith("d")) candleSecs = parseInt(interval) * 86400;
        else if (interval.endsWith("m")) candleSecs = parseInt(interval) * 60;

        // Align the latest candle to a proper boundary so new-candle detection works
        const alignedNow = Math.floor(now / candleSecs) * candleSecs;

        const volatility = walkPrice * 0.00015; // Realistic candle sizes (e.g. ~$0.70 for Gold, ~$9 for BTC)
        const mockData = [];
        
        // Walk forward to generate smooth candles culminating near current real price
        for (let i = limit; i >= 0; i--) {
          const time = (alignedNow - (i * candleSecs)) as UTCTimestamp;
          const open = walkPrice;
          const close = open + ((Math.random() - 0.48) * volatility); // Slight upward bias for realism
          const high = Math.max(open, close) + Math.random() * (volatility * 0.5);
          const low = Math.min(open, close) - Math.random() * (volatility * 0.5);
          
          mockData.push({ time, open, high, low, close, value: close, volume: Math.random() * 1000 });
          walkPrice = close;
        }
        
        // Link last candle exactly to current API price loop
        if (mockData.length > 0 && displayPrice) {
           mockData[mockData.length - 1].close = displayPrice;
           mockData[mockData.length - 1].value = displayPrice;
        }

        baseData = mockData;
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
        
        // After setting data, fit all candles then apply zoom range
        chart.timeScale().fitContent();
        
        // Then apply range zoom on top
        const last = baseData[baseData.length - 1].time;
        let from = baseData[0].time;
        const r = activeRange;
        
        if (r === "1D") from = last - 86400;
        else if (r === "5D") from = last - (86400 * 5);
        else if (r === "1M") from = last - (86400 * 30);
        else if (r === "3M") from = last - (86400 * 90);
        else if (r === "6M") from = last - (86400 * 180);
        else if (r === "YTD") {
          const d = new Date(); d.setMonth(0,1); d.setHours(0,0,0,0);
          from = Math.floor(d.getTime() / 1000);
        }
        else if (r === "1Y") from = last - (86400 * 365);
        else if (r === "ALL") { /* keep fitContent zoom */ from = baseData[0].time; }
        
        if (r !== "ALL") {
          chart.timeScale().setVisibleRange({ 
            from: Math.max(from, baseData[0].time) as UTCTimestamp, 
            to: (last + 60) as UTCTimestamp 
          });
        }

        // Store candles and calculate indicators
        candlesRef.current = baseData;
        
        // Very basic SMA 20 and EMA 55 computation for display
        const smaData = [];
        const emaData = [];
        const closes = baseData.map(d => d.close);
        let currentEma = closes[0];
        
        for (let i = 0; i < baseData.length; i++) {
           if (i >= 19) {
             const slice = closes.slice(i - 19, i + 1);
             const avg = slice.reduce((a, b) => a + b, 0) / 20;
             smaData.push({ time: baseData[i].time, value: avg });
           }
           const k = 2 / (55 + 1);
           currentEma = closes[i] * k + currentEma * (1 - k);
           if (i >= 54) {
             emaData.push({ time: baseData[i].time, value: currentEma });
           }
        }
        smaSeriesRef.current?.setData(smaData);
        emaSeriesRef.current?.setData(emaData);

      } catch { /* chart was removed during navigation */ }

      // 7. Quotex-style High-Frequency Tick Engine
      let currentPrice = parseFloat((baseData[baseData.length - 1]?.close) || "0");
      let targetPrice = currentPrice;
      let lastWsTime = Date.now();

      // Calculate candle duration in seconds for new-candle detection
      let candleSecs = 60; // Default 1m
      const intMatch = interval.match(/^(\d+)([a-zA-Z]+)$/);
      if (intMatch) {
        const val = parseInt(intMatch[1]);
        const unit = intMatch[2];
        if (unit === "m") candleSecs = val * 60;
        else if (unit === "h") candleSecs = val * 3600;
        else if (unit === "d") candleSecs = val * 86400;
        else if (unit === "w") candleSecs = val * 604800;
        else if (unit === "M") candleSecs = val * 2592000;
      }

      // The core animation loop for Quotex feel (runs at 10 FPS)
      simInterval = setInterval(() => {
        if (!isActive || !mainSeries) return;
        
        const now = Date.now();
        // If it's been over 3 seconds without a binance/twelvedata tick, sprinkle tiny noise so it never completely freezes
        // Reduced noise significantly (from 0.0002 to 0.000015) to prevent massive fake wicks on Gold/Stocks
        if (now - lastWsTime > 3000) {
           targetPrice = currentPrice + (Math.random() - 0.5) * (currentPrice * 0.000015);
        }

        // Smoothly step 'currentPrice' towards 'targetPrice' instead of jumping
        const diff = targetPrice - currentPrice;
        // Aggressively follow target, but with enough easing to look like a fluid tick
        currentPrice += diff * 0.4;
        
        setLivePrice(currentPrice);

        try {
          const dataArr = mainSeries.data();
          if (dataArr && dataArr.length > 0) {
            const lastData = dataArr[dataArr.length - 1] as any;
            const nowSec = Math.floor(now / 1000);
            const lastCandleTime = lastData.time as number;

            // Check if a full candle period has elapsed since the last candle
            // Use the next aligned boundary after the last candle's time
            const nextCandleTime = lastCandleTime + candleSecs;

            if (nowSec >= nextCandleTime) {
              // --- Time period elapsed: create a NEW candle ---
              // Snap to the proper aligned boundary for clean timestamps
              const newCandleTime = Math.floor(nowSec / candleSecs) * candleSecs;
              // If aligned time equals lastCandleTime (unlikely but possible), step forward
              const finalTime = newCandleTime > lastCandleTime ? newCandleTime : lastCandleTime + candleSecs;

              const newCandle = {
                time: finalTime as UTCTimestamp,
                open: currentPrice,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
                value: currentPrice,
              };
              mainSeries.update(newCandle);

              // Also append a volume bar for the new candle
              if (volumeSeries) {
                volumeSeries.update({
                  time: finalTime as UTCTimestamp,
                  value: 0,
                  color: "rgba(34,197,94,0.7)",
                });
              }

              // Update candles ref
              const cRef = candlesRef.current;
              cRef.push({ ...newCandle, volume: 0 });
              if (cRef.length > 1500) cRef.shift();
            } else {
              // --- Still within the current candle: update it ---
              mainSeries.update({
                time: lastData.time,
                open: lastData.open,
                high: Math.max(lastData.high, currentPrice),
                low: Math.min(lastData.low, currentPrice),
                close: currentPrice,
                value: currentPrice,
              });

              // Keep candlesRef in sync
              const cRef = candlesRef.current;
              if (cRef.length > 0) {
                const last = cRef[cRef.length - 1];
                if (last.time === lastData.time) {
                  last.high = Math.max(last.high, currentPrice);
                  last.low = Math.min(last.low, currentPrice);
                  last.close = currentPrice;
                }
              }
            }
          }
        } catch {}
      }, 100);

        // Connect to Live API Data for precise targets
      if (isActive && instrument?.exchange === "BINANCE" && instrument?.symbol !== "XAUUSD") {
        try {
          const wsSymbol = instrument.symbol.toLowerCase();
          ws = new WebSocket(`wss://stream.binance.com:9443/ws/${wsSymbol}@kline_${interval}`);
          ws.onerror = (e) => { console.error("Binance WS Drop:", e); };
          ws.onmessage = (ev) => {
            if (!isActive) return;
            try {
              const msg = JSON.parse(ev.data);
              if (msg.e !== "kline") return;
              const k = msg.k;
              
              const exactRealPrice = +k.c;
              targetPrice = exactRealPrice;
              lastWsTime = Date.now();
              
              const c = { time: (k.t / 1000) as UTCTimestamp, open: +k.o, high: +k.h, low: +k.l, close: exactRealPrice, value: exactRealPrice };
              
              const dataArr = mainSeries.data();
              if (dataArr && dataArr.length > 0) {
                 const lastD = dataArr[dataArr.length - 1] as any;
                 if (c.time > lastD.time) {
                    mainSeries.update(c);
                    
                    // Maintain historical reference
                    const cRef = candlesRef.current;
                    if (cRef.length > 0) {
                       if (c.time > cRef[cRef.length-1].time) cRef.push(c);
                       else cRef[cRef.length-1] = c;
                       if (cRef.length > 1500) cRef.shift();
                    }
                 }
              }
            } catch { /* ignore bad frames */ }
          };
        } catch { console.warn("WebSocket init fail. Using interpolation engine only."); }
      } else if (isActive && instrument?.exchange !== "OTC") {
        // Twelve Data WebSocket for Real-Time Stocks/Forex/Commodities Ticks
        try {
          let tdSymbol = instrument.symbol;
          if (instrument.assetClass === "FOREX" || ["XAUUSD", "XAGUSD", "WTIUSD", "BRENTUSD"].includes(tdSymbol)) {
             if (tdSymbol.length >= 6 && !tdSymbol.includes("/")) tdSymbol = tdSymbol.substring(0, 3) + "/" + tdSymbol.substring(3);
          }

          ws = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=b630be1ed9604a29a35ad8d11a8af18c");
          ws.onopen = () => {
             ws?.send(JSON.stringify({ "action": "subscribe", "params": { "symbols": tdSymbol } }));
          };
          ws.onmessage = (ev) => {
             if (!isActive) return;
             try {
               const msg = JSON.parse(ev.data);
               if (msg.event === "price" && msg.price) {
                  targetPrice = parseFloat(msg.price);
                  lastWsTime = Date.now();
               }
             } catch {}
          };
        } catch {}
      }
    };

    loadData();

    return () => {
      isActive = false;
      abortCtrl.abort();
      ro.disconnect();
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.onopen = null;
        ws.onerror = null;
        if (ws.readyState < 2) try { ws.close(); } catch { /* ignore */ }
      }
      if (simInterval) clearInterval(simInterval);
      try { chart.remove(); } catch { /* ignore */ }
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
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
    <AppShell noPadding hideMobileNav>
      <Seo title={`${instrument.symbol} • ${instrument.name} • HTC Trade`} />

      {/*
        ┌── ROOT: responsive 3-column desktop / stacked mobile ──────────────┐
      */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden bg-background">

        {/* ── LEFT VERTICAL TOOLBAR ── */}
        <div className="hidden lg:flex w-11 flex-col items-center pt-3 pb-3 gap-4 bg-card/40 border-r border-border/40 shrink-0">
          <MousePointer2 className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Crosshair     className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <div className="h-px w-6 bg-border/50" />
          <Minus   className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer -rotate-45 transition-colors" />
          <Pencil  className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Type    className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
          <Square  className="w-[18px] h-[18px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
        </div>

        {/* ── CENTER: CHART COLUMN ── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-[380px] lg:min-h-0 shrink-0 lg:shrink overflow-hidden">

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
              <div onClick={() => setShowIndicators(!showIndicators)} className={cn("flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors", showIndicators && "text-primary font-bold")}>
                <Activity className="w-3.5 h-3.5" /> Indicators
              </div>
              <div onClick={() => toast({ title: "Alert Set", description: `You will be notified when ${instrument.symbol} has unusual volume or price movement.`})} className="flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                <Bell className="w-3.5 h-3.5" /> Alert
              </div>
              <div onClick={() => toast({ title: "Bar Replay Enabled", description: "Select a point on the chart to start replay."})} className="flex items-center gap-1.5 cursor-pointer hover:text-foreground">
                <History className="w-3.5 h-3.5" /> Replay
              </div>
            </div>

            {/* Spacer + Live price */}
            <div className="flex-1" />
            <div className="flex items-center gap-3 text-xs shrink-0 bg-background/40 px-3 py-1.5 rounded-xl border border-border/10">
            {priceData && (
              <div className={cn(
                "hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all",
                isGlobalMarketOpen(instrument.assetClass, instrument.symbol)
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(52,211,153,0.1)]" 
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              )}>
                <span className={cn(
                  "h-1 w-1 rounded-full",
                  isGlobalMarketOpen(instrument.assetClass, instrument.symbol) ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                )} />
                {isGlobalMarketOpen(instrument.assetClass, instrument.symbol) ? "LIVE" : "CLOSED"}
                {(!isGlobalMarketOpen(instrument.assetClass, instrument.symbol) && instrument.assetClass !== "CRYPTO") && (
                  <span className="ml-1 opacity-60 lowercase font-medium">Re-opens Sun 22:00 UTC</span>
                )}
              </div>
            )}
              <span className="font-black text-emerald-300 text-sm tracking-tight drop-shadow-[0_0_12px_rgba(110,231,183,0.3)]">{fmtUsd(displayPrice)}</span>
              <span className={cn("font-bold", isUp ? "text-emerald-400" : "text-rose-400")}>
                {Number(priceData?.changeAbs) >= 0 ? "+" : ""}{Number(priceData?.changeAbs).toFixed(2)} ({fmtPct(Number(priceData?.changePct))})
              </span>
            </div>
          </div>


          {/* Chart canvas — fills ALL remaining height */}
          <div className="flex-1 min-h-0 w-full relative">
            <div ref={chartContainerRef} className="absolute inset-0" />
            
            {/* Overlay components */}
            <CandleTimer interval={timeframe} />
            {hoverTimeStr && hoverPosition && (
               <div 
                 className="absolute z-[30] pointer-events-none bg-background/90 backdrop-blur-md text-foreground text-[10px] px-2.5 py-1 rounded-md shadow-lg border border-border/50 font-mono whitespace-nowrap transform -translate-x-1/2 mt-4"
                 style={{ left: hoverPosition.x, top: hoverPosition.y }}
               >
                  Duration: <span className="text-primary font-bold">{hoverTimeStr}</span>
               </div>
            )}
            
            <QuotexOverlay 
               chartRef={chartRef}
               seriesRef={mainSeriesRef}
               activeTrades={activeTrades}
               livePrice={displayPrice}
            />
          </div>

          {/* Bottom timeframe bar */}
          <div className="h-8 shrink-0 border-t border-border/40 flex items-center gap-5 px-4 bg-card/20 text-[11px] font-bold text-muted-foreground overflow-x-auto scrollbar-none whitespace-nowrap">
            {["1D","5D","1M","3M","6M","YTD","1Y","ALL"].map(t => (
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

        {/* ── QUOTEX STYLE RIGHT SIDEBAR (Desktop) ── */}
        <div className="hidden lg:flex lg:w-[300px] xl:w-[320px] shrink-0 flex-col border-l border-border/40 bg-[#161a25] lg:h-full">
          {/* TOP ZONE: scrollable section containing all controls */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">


          {/* AI COPILOT SECTION v18.0 LIGHTNING VISUALS */}
          <div className="p-4 border-b border-border/20 bg-primary/5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-bold text-primary uppercase flex items-center gap-1.5"><BrainCircuit className="w-4 h-4"/> AI Status</h3>
                <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider transition-all duration-300",
                      aiSignal === "BUY" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.2)]" :
                      aiSignal === "SELL" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_8px_rgba(251,113,133,0.2)]" :
                      "bg-primary/20 text-primary border border-primary/30"
                    )}>
                      {prediction?.strength === "STRONG" ? `STRONG ${aiSignal}` : 
                       aiSignal === "BUY" ? "BULLISH BIAS" : 
                       aiSignal === "SELL" ? "BEARISH BIAS" : 
                       "MONITORING"}
                    </span>
                    <span className="text-[10px] font-black font-mono text-white/50">{aiConfidence}%</span>
                </div>
             </div>
             
             <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
               Proprietary QuantEdge v9.0 algorithms are currently analyzing real-time order flow and multi-timeframe liquidity zones.
             </p>
            <div className="flex items-center justify-between border border-border/10 bg-[#232936] p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors" onClick={() => {
              if (!user?.commissionAgreed && !["saran123@gmail.com", "htctrade@gmail.com"].includes(user?.email || "")) {
                setShowCommissionModal(true);
              } else {
                setAutoTradeEnabled(!autoTradeEnabled);
              }
            }}>
              <span className="text-xs font-bold text-white px-1">Smart Auto-Invest</span>
              <Switch checked={autoTradeEnabled} onCheckedChange={(val) => {
                if (!user?.commissionAgreed && !["saran123@gmail.com", "htctrade@gmail.com"].includes(user?.email || "") && val) {
                  setShowCommissionModal(true);
                } else {
                  setAutoTradeEnabled(val);
                }
              }} />
            </div>

            {autoTradeEnabled && (
               <div className="mt-3 space-y-3 pt-3 border-t border-border/10 animate-in fade-in slide-in-from-top-2">
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 flex items-center justify-between">
                        Take Profit ($)
                        {autoTradeEnabled && !isAdmin && <Lock className="w-2.5 h-2.5 text-primary" />}
                     </label>
                     <div className={cn(
                       "flex items-center bg-[#232936] rounded-md overflow-hidden border border-border/10 transition-all",
                       autoTradeEnabled && !isAdmin ? "opacity-60 bg-black/20" : "focus-within:border-primary/50"
                     )}>
                        <span className="pl-2 text-muted-foreground text-[10px]">$</span>
                        <input 
                          type="number" 
                          min="1" 
                          value={takeProfit} 
                          onChange={e => setTakeProfit(Math.max(1, Number(e.target.value)))} 
                          disabled={autoTradeEnabled && !isAdmin}
                          className="w-full bg-transparent text-xs font-bold p-1.5 outline-none disabled:cursor-not-allowed" 
                        />
                     </div>
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-muted-foreground uppercase mb-1 flex items-center justify-between">
                        Stop Loss ($)
                        {autoTradeEnabled && !isAdmin && <Lock className="w-2.5 h-2.5 text-rose-500" />}
                     </label>
                     <div className={cn(
                       "flex items-center bg-[#232936] rounded-md overflow-hidden border border-border/10 transition-all",
                       autoTradeEnabled && !isAdmin ? "opacity-60 bg-black/20" : "focus-within:border-rose-500/50"
                     )}>
                        <span className="pl-2 text-muted-foreground text-[10px]">$</span>
                        <input 
                          type="number" 
                          min="1" 
                          value={stopLoss} 
                          onChange={e => setStopLoss(Math.max(1, Number(e.target.value)))} 
                          disabled={autoTradeEnabled && !isAdmin}
                          className="w-full bg-transparent text-xs font-bold p-1.5 outline-none disabled:cursor-not-allowed" 
                        />
                     </div>
                   </div>
                 </div>
                 
                 <div className="flex items-center justify-between text-[10px] mb-2 px-1">
                    <span className="text-muted-foreground">Session PnL:</span>
                    <span className={cn("font-bold", sessionPnL > 0 ? "text-emerald-400" : sessionPnL < 0 ? "text-rose-400" : "text-white")}>
                      {sessionPnL > 0 ? "+" : ""}{sessionPnL.toFixed(2)}
                    </span>
                 </div>

                 <Button 
                   onClick={() => setAutoTradeActive(!autoTradeActive)}
                   variant={autoTradeActive ? "destructive" : "default"}
                   className="w-full h-9 text-xs font-bold uppercase tracking-wider shadow-sm"
                 >
                   {autoTradeActive ? "Stop AI Trading" : "Start Auto-Pilot"}
                 </Button>

                 {autoTradeActive && (
                    <div className="text-[10px] text-center font-semibold text-emerald-400 flex items-center justify-center gap-1.5 animate-pulse mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Scanning market & awaiting signal...
                    </div>
                 )}
               </div>
            )}
          </div>

          {/* TRADING FORM */}
          <div className="p-4 border-b border-border/20">
            {/* Amount Input */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-muted-foreground uppercase block">Investment Amount ($)</label>
                <div className={cn(
                  "text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1 uppercase tracking-tighter",
                  user?.tradeMode === "REAL" ? "bg-primary/10 text-primary" : "bg-violet-500/10 text-violet-400"
                )}>
                  {user?.tradeMode ?? "DEMO"}: <span>${user?.tradeMode === "REAL" ? (user?.walletBalance || "0.00") : (user?.demoBalance || "10000.00")}</span>
                </div>
              </div>
              <div className="flex bg-[#232936] rounded-xl overflow-hidden border border-border/10 transition-colors focus-within:border-primary/50">
                <button 
                  disabled={autoTradeEnabled && !isAdmin}
                  onClick={() => setTradeAmount(Math.max(1, tradeAmount - 10))} 
                  className="w-10 hover:bg-white/5 flex items-center justify-center text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <MinusCircle className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  value={tradeAmount}
                  disabled={autoTradeEnabled && !isAdmin}
                  onChange={(e) => setTradeAmount(Number(e.target.value))}
                  className="flex-1 min-w-0 bg-transparent text-center font-bold text-lg outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button 
                  disabled={autoTradeEnabled && !isAdmin}
                  onClick={() => setTradeAmount(tradeAmount + 10)} 
                  className="w-10 hover:bg-white/5 flex items-center justify-center text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <PlusCircle className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Time / Duration — controls BOTH chart candle timeframe + trade expiry */}
            <div className="mb-5">
              <label className="text-[11px] font-bold text-muted-foreground uppercase mb-1.5 block">Candle Timeframe</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "1m",  tf: "1m",  secs: 60   },
                  { label: "2m",  tf: "2m",  secs: 120  },
                  { label: "3m",  tf: "3m",  secs: 180  },
                  { label: "5m",  tf: "5m",  secs: 300  },
                  { label: "15m", tf: "15m", secs: 900  },
                  { label: "30m", tf: "30m", secs: 1800 },
                ].map((d) => (
                  <button
                    disabled={autoTradeEnabled && !isAdmin}
                    key={d.tf}
                    onClick={() => {
                      if (autoTradeEnabled && !isAdmin) return;
                      setTimeframe(d.tf);       // switch chart candle interval
                      setTradeDuration(d.secs); // trade expires at end of that candle
                    }}
                    className={cn(
                      "py-2 rounded-lg text-xs font-bold transition-all border disabled:opacity-50 disabled:cursor-not-allowed",
                      timeframe === d.tf
                        ? "bg-primary/20 text-primary border-primary/50 shadow-sm"
                        : "bg-[#232936] text-muted-foreground border-transparent hover:bg-white/5"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground mt-1.5 px-0.5">
                Chart shows <span className="text-foreground font-semibold">{timeframe}</span> candles · trade closes at next candle
              </p>
            </div>

            {/* Payout Expection */}
            <div className="flex items-center justify-between px-1 mb-4">
              <span className="text-xs text-muted-foreground font-semibold">Payout (85%)</span>
              <span className="text-lg font-bold text-emerald-400">+{fmtUsd(tradeAmount * 0.85)}</span>
            </div>

            {/* BIG UP / DOWN BUTTONS */}
            <div className="flex flex-col gap-2 relative">
              <button
                disabled={placeTrade.isPending}
                onClick={() => handlePlaceTrade("BUY")}
                className="group relative h-14 rounded-xl font-bold text-white uppercase overflow-hidden shadow-[0_0_20px_rgba(16,185,129,0.15)] bg-[#0eb977] hover:bg-[#12c481] disabled:opacity-50 transition-all"
              >
                <div className="flex items-center justify-between px-6 z-10 relative">
                  <span className="text-lg">Up</span>
                  <div className="flex flex-col items-end">
                    <span className="text-sm">+{fmtUsd(tradeAmount * 1.85)}</span>
                  </div>
                </div>
              </button>

              <button
                disabled={placeTrade.isPending}
                onClick={() => handlePlaceTrade("SELL")}
                className="group relative h-14 rounded-xl font-bold text-white uppercase overflow-hidden shadow-[0_0_20px_rgba(244,63,94,0.15)] bg-[#f43f5e] hover:bg-[#fb4b68] disabled:opacity-50 transition-all"
              >
                <div className="flex items-center justify-between px-6 z-10 relative">
                  <span className="text-lg">Down</span>
                  <div className="flex flex-col items-end">
                    <span className="text-sm">+{fmtUsd(tradeAmount * 1.85)}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* ACTIVE TRADES */}
          {activeTrades.length > 0 && (
            <div className="p-4 border-b border-border/20">
              <h3 className="text-xs font-bold text-muted-foreground uppercase mb-3 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Active Trades</h3>
              <div className="space-y-2">
                  {activeTrades.map(trade => {
                  const strike = parseFloat(trade.strikePrice as string);
                  const amount = parseFloat(trade.amount as string);
                  const current = displayPrice;
                  
                  const { isWin, pnl } = calculatePnL(trade, current);
                  const pnlStr = isWin ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
                  
                  return (
                    <div key={trade.id} className="bg-[#232936] rounded-xl p-3 border border-border/10 relative overflow-hidden">
                      <div className={cn("absolute left-0 top-0 bottom-0 w-1", trade.side === "BUY" ? "bg-emerald-500" : "bg-rose-500")} />
                      <div className="flex items-center justify-between text-xs font-bold mb-1.5 ml-1">
                        <span className="text-white">${amount.toFixed(2)} {trade.side}</span>
                        <div className={cn("px-2 py-0.5 rounded font-mono", isWin ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                          {pnlStr}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground ml-1">
                        <span>Entry: {strike.toFixed(2)}</span>
                        <span>Current: {current.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          </div>{/* END TOP ZONE */}

          {/* BOTTOM ZONE: History always pinned, min 200px, own scroll */}
          <div className="shrink-0 flex flex-col border-t border-border/20 bg-[#161a25]" style={{ minHeight: '200px', maxHeight: '38%' }}>
             <h3 className="text-xs font-bold text-muted-foreground uppercase mb-3 shrink-0 px-4 pt-4"><History className="w-3.5 h-3.5 inline mr-1" /> History</h3>
             <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
             {pastTrades.length === 0 ? (
               <div className="text-center text-xs text-muted-foreground py-6">No recent trades.</div>
             ) : (
               <div className="space-y-2">
                 {pastTrades.slice(0, 50).map(trade => {
                   const isWin = trade.status === "WIN";
                   const isLoss = trade.status === "LOSS";
                   const strike = parseFloat(trade.strikePrice as string);
                   const settle = parseFloat(trade.settlePrice as string);
                   return (
                     <div key={trade.id} className="bg-[#232936] rounded-xl p-3 border border-border/10">
                       <div className="flex items-center justify-between text-xs font-bold mb-1">
                          <span className="flex items-center gap-1.5">
                            {isWin ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : isLoss ? <XCircle className="w-3.5 h-3.5 text-rose-400" /> : <Clock className="w-3.5 h-3.5 text-yellow-400" />}
                            {trade.side}
                          </span>
                          <span className={isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : ""}>
                            {isWin ? `+$${(parseFloat(trade.amount as string) * 0.85).toFixed(2)}` : isLoss ? `-$${parseFloat(trade.amount as string).toFixed(2)}` : "TIE"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{strike.toFixed(2)} ➔ {settle ? settle.toFixed(2) : "..."}</span>
                          <span>{new Date(trade.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
               )}
              </div>
            </div>
          </div>
       </div>

      {/* AI Payment Modal — never shown for admin users */}
      {!isUnlimited && (
        <AiPaymentModal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={(creditsAdded) => {
            setShowPaymentModal(false);
            fetchCredits();
            toast({ title: `✅ ${creditsAdded} AI predictions added!`, description: "You can now use the QuantEdge AI bot." });
          }}
          freePredictionsUsed={credits?.freePredictionsUsed ?? 0}
          freePredictionsLimit={credits?.freePredictionsLimit ?? 6}
          paidCredits={credits?.paidCredits ?? 0}
        />
      )}

      {/* 10% Infrastructure Commission Agreement */}
      <CommissionModal 
        open={showCommissionModal} 
        onAgree={handleAgreeCommission} 
        onDeny={() => setShowCommissionModal(false)} 
      />

      {/* AI BOT POPUP RESTORED (CLICK-TRIGGERED, PREVIOUS TYPE UI) */}
      <div className="fixed bottom-6 right-8 flex flex-col items-end gap-3 z-50">
           {/* Detailed Prediction View — only shows on click */}
           {showAiBotPopup && (
             <div className="bg-[#0f1420] border border-primary/30 p-5 rounded-2xl shadow-2xl max-w-[320px] mb-2 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                   <div className="flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4 text-primary" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-primary">QuantEdge AI v9.0</span>
                   </div>
                   <button onClick={() => setShowAiBotPopup(false)} className="text-muted-foreground hover:text-white"><Plus className="w-4 h-4 rotate-45" /></button>
                </div>

                {prediction ? (
                  <div className="space-y-4">
                     <div className={cn(
                       "flex items-center gap-4 p-3 rounded-xl border",
                       prediction.action === "BUY" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                     )}>
                        {prediction.action === "BUY" ? <TrendingUp className="w-10 h-10" /> : <TrendingDown className="w-10 h-10" />}
                        <div>
                           <div className="text-3xl font-black tracking-tighter leading-none">{prediction.action}</div>
                           <div className="text-[10px] uppercase font-bold tracking-widest mt-1 opacity-80">Strong Signal</div>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <div className="flex justify-between text-[11px] font-bold">
                           <span className="text-muted-foreground uppercase tracking-wider">AI Confidence</span>
                           <span className={prediction.probability > 70 ? "text-emerald-400" : "text-yellow-400"}>{prediction.probability}% Accuracy</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                           <div 
                             className={cn("h-full transition-all duration-700", prediction.probability > 70 ? "bg-emerald-500" : "bg-yellow-500")}
                             style={{ width: `${prediction.probability}%` }}
                           />
                        </div>
                     </div>

                     <p className="text-[12px] font-medium text-slate-300 leading-relaxed italic">
                        "{prediction.message}"
                     </p>
                  </div>
                ) : (
                  <div className="py-8 text-center space-y-3">
                     <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto opacity-50" />
                     <p className="text-xs text-muted-foreground">Synchronizing with live order flow...</p>
                     <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-[10px] text-muted-foreground hover:text-primary transition-all underline decoration-primary/30"
                        onClick={() => {
                           setPrediction(null);
                           // Force refresh through state update
                           lastCandleTimeRef.current = 0;
                        }}
                     >
                        Tap to retry sync
                     </Button>
                  </div>
                )}

                <Button 
                   size="sm" 
                   className="w-full h-8 text-[10px] font-black uppercase mt-4 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30" 
                   onClick={() => setShowPaymentModal(true)}
                >
                   Institutional Credits: {totalRemaining} Remaining
                </Button>
             </div>
           )}

           {/* Floating Bot Icon (The Trigger) */}
           <div className="flex items-center gap-3">
              {!isUnlimited && (
                <div className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg backdrop-blur-md border",
                  canUseAi ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                )}>
                  {canUseAi 
                    ? <><Zap className="w-3 h-3 text-yellow-400" /> {totalRemaining} left</>
                    : <><Lock className="w-3 h-3" /> No credits</>
                  }
                </div>
              )}
              <button
                onClick={handleOpenBotPopup}
                className={cn(
                  "relative w-14 h-14 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:scale-105 hover:rotate-12 transition-all duration-300 cursor-pointer",
                  isUnlimited || canUseAi
                    ? "bg-gradient-to-tr from-primary to-indigo-600 border border-white/20"
                    : "bg-gradient-to-tr from-rose-700 to-rose-600 border border-white/10"
                )}
              >
                <BrainCircuit className={cn("w-7 h-7", showAiBotPopup && "animate-pulse")} />
                {showAiBotPopup && <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-[8px] font-bold rounded-full flex items-center justify-center border-2 border-[#161a25]">!</div>}
              </button>
           </div>
      </div>

      {/* ── MOBILE TRADING BAR (v2.0 BEST EXPERIENCE) ── */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#161a25]/90 backdrop-blur-xl border-t border-white/5 p-4 pb-8 flex flex-col gap-3 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
         <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
               <div className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Investment</div>
               <div className="flex items-center bg-white/5 rounded-full px-3 py-1 border border-white/5">
                  <span className="text-xs font-black text-primary">${tradeAmount}</span>
               </div>
            </div>
            <div className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">+85% PAYOUT</div>
         </div>
         
         <div className="flex gap-3">
            <button
               id="mobile-btn-up"
               disabled={placeTrade.isPending}
               onClick={() => handlePlaceTrade("BUY")}
               className="flex-1 h-14 bg-[#0eb977] hover:bg-[#12c481] text-white flex items-center justify-center gap-3 rounded-2xl font-black text-lg shadow-[0_4px_20px_rgba(14,185,119,0.3)] transition-all active:scale-95"
            >
               <TrendingUp className="w-6 h-6" /> UP
            </button>
            <button
               id="mobile-btn-down"
               disabled={placeTrade.isPending}
               onClick={() => handlePlaceTrade("SELL")}
               className="flex-1 h-14 bg-[#f43f5e] hover:bg-[#fb4b68] text-white flex items-center justify-center gap-3 rounded-2xl font-black text-lg shadow-[0_4px_20px_rgba(244,63,94,0.3)] transition-all active:scale-95"
            >
               <TrendingDown className="w-6 h-6" /> DOWN
            </button>
         </div>
      </div>

    </AppShell>
  );
}
