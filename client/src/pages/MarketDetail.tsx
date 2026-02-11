import { useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { useInstruments } from "@/hooks/use-instruments";
import { usePortfolioSummary } from "@/hooks/use-portfolio";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip } from "recharts";
import { ArrowLeft, Bell, Bookmark, Search, ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import OrderTicketDialog from "@/components/OrderTicketDialog";

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
  
  const instruments = useInstruments();
  const portfolio = usePortfolioSummary();
  
  const [ticketOpen, setTicketOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("1D");

  const instrument = useMemo(() => {
    return (instruments.data ?? []).find((i: any) => i.id === id);
  }, [instruments.data, id]);

  const p = portfolio.data as any;
  const priceData = p?.holdings?.find((h: any) => h.instrument.id === id)?.price;
  
  const chartData = useMemo(() => {
    if (!priceData?.sparkline) return [];
    return priceData.sparkline.map((v: string, i: number) => ({
      value: Number(v),
      time: i
    }));
  }, [priceData]);

  if (instruments.isLoading) {
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

  const isUp = (priceData?.changePct ?? 0) >= 0;

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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isUp ? "hsl(var(--accent))" : "hsl(var(--destructive))"} stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={isUp ? "hsl(var(--accent))" : "hsl(var(--destructive))"} stopOpacity={0}/>
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
          </ResponsiveContainer>
        </div>

        {/* Timeframe Selectors */}
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          {["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "All"].map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                timeframe === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
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
