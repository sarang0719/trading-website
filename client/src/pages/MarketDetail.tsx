import { useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { useInstrumentDetail } from "@/hooks/use-instruments";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, BarChart, Bar, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip } from "recharts";
import { ArrowLeft, Bell, Bookmark, Search, ChevronDown, Info, BarChart2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import OrderTicketDialog from "@/components/OrderTicketDialog";

const Candlestick = (props: any) => {
  const {
    x, y, width, height, low, high, openClose: [open, close],
  } = props;
  const o = Number(open);
  const c = Number(close);
  const isGrowing = c >= o;
  const color = isGrowing ? "hsl(var(--accent))" : "hsl(var(--destructive))";

  // Recharts provides height and y.
  // If height is negative, SVG rect will break.
  const absHeight = Math.max(1, Math.abs(height)); // at least 1px height
  const actualY = height < 0 ? y + height : y;

  // Calculate vertical pixels per unit of price
  const priceDiff = Math.abs(o - c);
  const ratio = priceDiff === 0 ? 0 : absHeight / priceDiff;

  const topWickHeight = Math.max(0, (high - Math.max(o, c)) * ratio);
  const bottomWickHeight = Math.max(0, (Math.min(o, c) - low) * ratio);

  return (
    <g stroke={color} fill={color} strokeWidth="2">
      {/* Top Wick */}
      <line
        x1={x + width / 2}
        y1={actualY}
        x2={x + width / 2}
        y2={actualY - topWickHeight}
      />
      {/* Bottom Wick */}
      <line
        x1={x + width / 2}
        y1={actualY + absHeight}
        x2={x + width / 2}
        y2={actualY + absHeight + bottomWickHeight}
      />
      {/* Body */}
      <rect
        x={x}
        y={actualY}
        width={Math.max(1, width)}
        height={absHeight}
        fill={color}
        stroke={color}
      />
    </g>
  );
};


function fmtUsd(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2
  }).format(n);
}

function fmtPct(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function MarketDetail() {
  const [, params] = useRoute("/app/markets/:id");
  const id = params?.id ? Number(params.id) : undefined;
  const { toast } = useToast();

  const instrumentQuery = useInstrumentDetail(id);
  const data = instrumentQuery.data;

  const [ticketOpen, setTicketOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("1D");
  const [chartType, setChartType] = useState<"line" | "candle">("line");

  const instrument = data?.instrument;
  const priceData = data?.price;

  const chartData = useMemo(() => {
    if (!priceData?.sparkline) return [];

    return priceData.sparkline.map((v: string, i: number) => {
      const val = Number(v);
      const isUp = Math.random() > 0.4; // fake some candle math
      const range = val * 0.005;
      const open = isUp ? val - range : val + range;
      const close = val;
      const high = Math.max(open, close) + range * Math.random();
      const low = Math.min(open, close) - range * Math.random();

      return {
        value: val,
        time: i,
        // For candlestick:
        openClose: [open, close],
        high,
        low
      };
    });
  }, [priceData]);

  if (instrumentQuery.isLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!instrument) {
    return (
      <AppShell>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold">Instrument not found</h2>
          <Link href="/app/markets" className="text-primary hover:underline mt-4 block">Back to Markets</Link>
        </div>
      </AppShell>
    );
  }

  const isUp = Number(priceData?.changePct ?? 0) >= 0;

  return (
    <AppShell>
      <Seo title={`${instrument.symbol} • ${instrument.name} • Aurum Paper`} />

      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header Navigation */}
        <div className="flex items-center justify-between">
          <Link href="/app/markets" className="p-2 hover:bg-secondary/50 rounded-full transition-colors">
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div className="flex items-center gap-4">
            <Bell className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
            <Bookmark className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
            <Search className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
          </div>
        </div>

        {/* Title & Price Section */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground uppercase tracking-widest">
              {instrument.symbol} • {instrument.exchange} <ChevronDown className="h-4 w-4" />
            </div>
            <h1 className="text-2xl font-bold mt-1">{instrument.name}</h1>
          </div>

          <div>
            <div className="text-4xl font-bold tracking-tighter">
              {fmtUsd(Number(priceData?.price))}
            </div>
            <div className={cn(
              "text-sm font-bold mt-1",
              isUp ? "text-accent" : "text-destructive"
            )}>
              {isUp ? "+" : ""}{Number(priceData?.changeAbs).toFixed(2)} ({fmtPct(Number(priceData?.changePct))}) <span className="text-muted-foreground ml-1">1D</span>
            </div>
          </div>
        </div>

        {/* Chart Section */}
        <div className="h-80 w-full relative">
          {chartData.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/20 rounded-2xl">
              <BarChart2 className="h-8 w-8 mb-2 opacity-50" />
              <p>Generating live chart data...</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "line" ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isUp ? "hsl(var(--accent))" : "hsl(var(--destructive))"} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={isUp ? "hsl(var(--accent))" : "hsl(var(--destructive))"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <ReTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="glass px-3 py-1.5 rounded-xl border border-border/50 text-xs font-bold">
                            {fmtUsd(payload[0].value as number)}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={isUp ? "hsl(var(--accent))" : "hsl(var(--destructive))"}
                    strokeWidth={3}
                    fill="url(#chartGradient)"
                    animationDuration={1000}
                  />
                </AreaChart>
              ) : (
                <ComposedChart data={chartData}>
                  <XAxis dataKey="time" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <ReTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="glass px-3 py-1.5 rounded-xl border border-border/50 text-xs font-bold">
                            {fmtUsd(payload[0].payload.value as number)}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="openClose"
                    fill="#8884d8"
                    shape={<Candlestick />}
                    animationDuration={1000}
                  />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          )}
        </div>

        {/* Timeframe Selectors & Chart Toggles */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-b border-border/40 pb-4 gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-none">
            {["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "All"].map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
                  timeframe === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto self-start sm:self-auto">
            <Button
              variant={chartType === "line" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChartType("line")}
              className="rounded-xl h-8 px-3 text-xs"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              Line
            </Button>
            <Button
              variant={chartType === "candle" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setChartType("candle")}
              className="rounded-xl h-8 px-3 text-xs"
            >
              <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
              Candle
            </Button>
          </div>
        </div>

        {/* Performance Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2">
              Performance <Info className="h-4 w-4 text-muted-foreground" />
            </h3>
            <ChevronDown className="h-5 w-5" />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-[80px_1fr_1fr] gap-4 pt-4">
            <Button variant="outline" className="h-14 rounded-xl font-bold">SIP</Button>
            <Button
              variant="outline"
              className="h-14 rounded-xl font-bold bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive hover:text-white"
              onClick={() => setTicketOpen(true)}
            >
              Sell
            </Button>
            <Button
              className="h-14 rounded-xl font-bold bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => setTicketOpen(true)}
            >
              Buy
            </Button>
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
