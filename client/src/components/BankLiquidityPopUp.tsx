import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ShieldAlert, TrendingUp, TrendingDown, Landmark, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BankLiquiditySweepData {
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  supLevel?: number | null;
  resLevel?: number | null;
  sweptLo: boolean;
  sweptHi: boolean;
  time: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BankLiquiditySweepData | null;
  onExecuteTrade?: () => void;
}

export function BankLiquidityPopUp({ open, onOpenChange, data, onExecuteTrade }: Props) {
  if (!data) return null;

  const { symbol, direction, entryPrice: initialEntryPrice, stopLoss: initialStopLoss, takeProfit: initialTakeProfit, supLevel, resLevel, sweptLo, sweptHi } = data;

  const [liveEntryPrice, setLiveEntryPrice] = React.useState<number>(initialEntryPrice);
  const [lastUpdatedTime, setLastUpdatedTime] = React.useState<string>("");

  // Sync initial entry price when data changes
  React.useEffect(() => {
    setLiveEntryPrice(initialEntryPrice);
    setLastUpdatedTime(new Date().toLocaleTimeString());
  }, [data, initialEntryPrice]);

  // Live Auto-Refresh Ticker Engine (1.5s interval while popup is open)
  React.useEffect(() => {
    if (!open || !symbol) return;

    let isMounted = true;
    const fetchLatestPrice = async () => {
      try {
        const symUpper = symbol.toUpperCase();
        const res = await fetch(`/api/market-data/price/${symUpper}`);
        if (res.ok && isMounted) {
          const json = await res.json();
          if (json && json.price) {
            const parsed = parseFloat(json.price);
            if (!isNaN(parsed) && parsed > 0) {
              setLiveEntryPrice(parsed);
              setLastUpdatedTime(new Date().toLocaleTimeString());
            }
          }
        }
      } catch (err) {
        // Fallback silently if offline or rate limited
      }
    };

    // Initial immediate fetch
    fetchLatestPrice();

    const intervalId = setInterval(fetchLatestPrice, 1500);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [open, symbol]);

  const entryPrice = liveEntryPrice || initialEntryPrice;
  const isBuy = direction === "BUY";
  const symUpper = symbol.toUpperCase();
  const isForex = symUpper.includes("EUR") || symUpper.includes("GBP") || (symUpper.includes("USD") && !symUpper.includes("XAU") && !symUpper.includes("BTC") && !symUpper.includes("ETH") && symUpper.length === 6);
  const isGold = symUpper.includes("XAU");

  // Dynamic calculation based on live updated entry price
  const slDiff = Math.abs(entryPrice - initialStopLoss);
  const tpDiff = Math.abs(initialTakeProfit - entryPrice);

  let ptsStr = "";
  let pipsStr = "";
  let tpPtsStr = "";
  let tpPipsStr = "";

  if (isForex) {
    ptsStr = `${(slDiff * 100000).toFixed(0)} pts`;
    pipsStr = `${(slDiff * 10000).toFixed(1)} pips`;
    tpPtsStr = `${(tpDiff * 100000).toFixed(0)} pts`;
    tpPipsStr = `${(tpDiff * 10000).toFixed(1)} pips`;
  } else if (isGold) {
    ptsStr = `$${slDiff.toFixed(2)} pts`;
    pipsStr = `${(slDiff * 10).toFixed(1)} pips`;
    tpPtsStr = `$${tpDiff.toFixed(2)} pts`;
    tpPipsStr = `${(tpDiff * 10).toFixed(1)} pips`;
  } else {
    ptsStr = `${slDiff > 100 ? slDiff.toFixed(0) : slDiff.toFixed(2)} pts`;
    pipsStr = `${(slDiff * 10).toFixed(0)} pips`;
    tpPtsStr = `${tpDiff > 100 ? tpDiff.toFixed(0) : tpDiff.toFixed(2)} pts`;
    tpPipsStr = `${(tpDiff * 10).toFixed(0)} pips`;
  }

  const sweepType = sweptLo
    ? "Sell-Stop Liquidity Sweep (Low)"
    : sweptHi
    ? "Buy-Stop Liquidity Sweep (High)"
    : "Institutional Liquidity Hunt";

  const targetLevel = sweptLo
    ? (supLevel ? `$${supLevel.toLocaleString()}` : `$${initialStopLoss.toLocaleString()}`)
    : (resLevel ? `$${resLevel.toLocaleString()}` : `$${initialStopLoss.toLocaleString()}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-zinc-950/95 border-2 border-amber-500/40 text-white shadow-2xl backdrop-blur-xl rounded-2xl p-6">
        <DialogHeader className="space-y-3 text-center sm:text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black tracking-tight text-amber-400 flex items-center gap-1.5">
                  ⚡ Bank Liquidity Sweep Alert!
                </DialogTitle>
                <DialogDescription className="text-xs text-amber-200/70">
                  Institutional Stop-Loss Collection Engine
                </DialogDescription>
              </div>
            </div>
            {/* Live Auto Refresh Status Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-[10px] font-mono text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>LIVE AUTO-REFRESH</span>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Main Hero Card */}
          <div className="bg-gradient-to-br from-amber-500/10 via-zinc-900 to-zinc-950 border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{symbol}</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-black tracking-wider flex items-center gap-1 ${
                isBuy ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
              }`}>
                {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {direction} REVERSAL
              </span>
            </div>

            {/* Institutional Entry vs Live Market Entry Dual Data Box */}
            <div className="grid grid-cols-2 gap-2 bg-black/50 p-2.5 rounded-lg border border-amber-500/30 text-xs">
              <div className="flex flex-col">
                <span className="text-[10px] text-amber-400/90 uppercase font-bold tracking-wider">Institutional Bank Entry</span>
                <span className="font-mono font-black text-amber-300 text-sm">${initialEntryPrice.toLocaleString()}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-[10px] text-emerald-400/90 uppercase font-bold tracking-wider flex items-center justify-end gap-1">
                  Live Market Entry <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                </span>
                <span className="font-mono font-black text-emerald-400 text-sm">${entryPrice.toLocaleString()}</span>
              </div>
            </div>

            <div className="border-t border-amber-500/20 pt-2 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Sweep Classification</span>
              <span className="font-semibold text-amber-300">{sweepType}</span>
            </div>
          </div>

          {/* Points & Pips Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 text-center space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-widest text-amber-400/80">
                Points Collected
              </div>
              <div className="text-2xl font-black tracking-tight text-amber-300">
                {ptsStr}
              </div>
              <div className="text-[10px] text-amber-400/60 font-mono">
                Total Price Distance Swept
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 text-center space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-widest text-amber-400/80">
                Pips Collected
              </div>
              <div className="text-2xl font-black tracking-tight text-amber-300">
                {pipsStr}
              </div>
              <div className="text-[10px] text-amber-400/60 font-mono">
                Standard Pip Sweep
              </div>
            </div>
          </div>

          {/* Static Live Bank Data Box (Unchanged until updated) */}
          <div className="bg-amber-950/60 border-2 border-amber-400/60 rounded-xl p-3.5 space-y-2 text-xs shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
              <span className="font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                🏛️ Live Bank Data (Static Level)
              </span>
              <span className="bg-amber-400/20 text-amber-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-amber-400/40">
                🔒 LOCKED (STATIC)
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-black/60 p-2 rounded border border-amber-500/20">
                <div className="text-[10px] text-amber-400/80 font-bold uppercase">Bank Entry Level</div>
                <div className="font-mono font-black text-amber-300 text-sm mt-0.5">
                  ${initialEntryPrice.toLocaleString()}
                </div>
              </div>
              <div className="bg-black/60 p-2 rounded border border-amber-500/20">
                <div className="text-[10px] text-amber-400/80 font-bold uppercase">Targeted Sweep Zone</div>
                <div className="font-mono font-black text-amber-300 text-sm mt-0.5">
                  {targetLevel}
                </div>
              </div>
            </div>

            <div className="text-[10px] text-amber-200/70 font-medium italic pt-0.5">
              ✓ This Bank Level is locked and will never change before a new institutional signal is updated.
            </div>
          </div>

          {/* Level Details */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Targeted Liquidity Level:</span>
              <span className="font-mono font-bold text-amber-400">{targetLevel}</span>
            </div>
            <div className="flex justify-between items-center bg-amber-500/10 px-2 py-1 rounded border border-amber-500/30">
              <span className="text-amber-300 font-bold">Institutional Entry Level:</span>
              <span className="font-mono font-black text-amber-300 text-xs">${initialEntryPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 flex items-center gap-1">
                Current Updated Entry:
                <span className="text-[9px] text-emerald-400 animate-pulse font-semibold">(Live)</span>
              </span>
              <span className="font-mono font-bold text-emerald-400">${entryPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Suggested Stop Loss:</span>
              <span className="font-mono font-bold text-rose-400">${initialStopLoss.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Target Take Profit (+{tpPtsStr}):</span>
              <span className="font-mono font-bold text-emerald-400">${initialTakeProfit.toLocaleString()}</span>
            </div>
          </div>

          {/* Institutional Note */}
          <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-xl text-[11px] text-amber-200/80 leading-relaxed flex items-start gap-2">
            <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>Bank Order Flow Insight:</strong> Commercial banks swept retail stop-loss orders around <span className="font-mono text-amber-300">{targetLevel}</span>. Live Entry updated at <span className="font-mono text-emerald-300 font-bold">${entryPrice.toLocaleString()}</span> ({lastUpdatedTime}). Target <span className="font-mono text-emerald-300">${initialTakeProfit.toLocaleString()}</span> (+{tpPtsStr} / {tpPipsStr}).
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            Dismiss
          </Button>
          {onExecuteTrade && (
            <Button
              onClick={() => {
                onExecuteTrade();
                onOpenChange(false);
              }}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20"
            >
              Follow Bank Signal <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
