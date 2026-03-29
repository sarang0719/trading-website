import { useState } from "react";
import { useInstruments } from "@/hooks/use-instruments";
import { usePortfolioSummary } from "@/hooks/use-portfolio";
import { useCreateOrder } from "@/hooks/use-orders";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { runEngine, type EngineConfig } from "@/lib/strategy-engine";
import { Bot, Loader2, Rocket, TrendingUp } from "lucide-react";

export default function SmartAutoPilot() {
  const [analyzing, setAnalyzing] = useState(false);
  const [log, setLog] = useState<{ msg: string; time: string }[]>([]);
  
  const instrumentsQuery = useInstruments();
  const portfolio = usePortfolioSummary();
  const createOrder = useCreateOrder();
  const { toast } = useToast();

  const addLog = (msg: string) => {
    setLog(prev => [{ msg, time: new Date().toLocaleTimeString() }, ...prev]);
  };

  async function startPilot() {
    setAnalyzing(true);
    setLog([]);
    addLog("🤖 Smart Pilot Initiated...");
    addLog("Fetching user wallet balance and available crypto markets...");
    
    try {
      if (!instrumentsQuery.data || !portfolio.data) {
         addLog("Error: Could not load wallet or market data.");
         return;
      }

      const p = portfolio.data as any;
      const marketValue = p?.totals?.marketValue || 10000; 
      addLog(`Wallet analysis complete. Available Equity: $${marketValue.toLocaleString()}`);

      // 1. Get Top Markets
      const cryptos = instrumentsQuery.data.filter((i: any) => i.assetClass === "CRYPTO");
      const topPairs = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT"];
      const targetInsts = cryptos.filter((c: any) => topPairs.includes(c.symbol));

      addLog(`Evaluating optimal returns for top ${targetInsts.length} markets...`);
      
      const config: EngineConfig = {};

      let bestSignal = null;
      let bestInst = null;

      // 1D timeframe gives stronger signals vs noise. We use 1D for Smart Pilot mapping.
      for (const inst of targetInsts) {
         addLog(`Scanning ${inst.symbol} on 1d timeframe...`);
         const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${inst.symbol}&interval=1d&limit=300`);
         if (!res.ok) continue;
         const data = await res.json();
         const rawInput = data.map((d: any) => ({
           time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]),
           low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
         }));
         
         const engineResults = runEngine(rawInput, config);
         if (engineResults.length > 0) {
            const latest = engineResults[engineResults.length - 1];
            addLog(`-> ${inst.symbol} analyzed. Signal: ${latest.direction} (Confidence: ${latest.confidence}%)`);
            
            if (latest.direction !== "HOLD" && (!bestSignal || latest.confidence > bestSignal.confidence)) {
               bestSignal = latest;
               bestInst = inst;
            }
         }
      }

      if (!bestSignal || !bestInst) {
         addLog("No high-probability setups found right now across top markets. Returning to standby to protect capital.");
         return;
      }

      // 2. We found a setup! Let's allocate 25% of the portfolio.
      const allocation = marketValue * 0.25;
      const quantity = (allocation / bestSignal.entryPrice).toFixed(4);
      
      addLog(`🎯 Highest Return Potential Found: ${bestInst.symbol} with ${bestSignal.confidence}% confidence score.`);
      addLog(`Investing $${allocation.toLocaleString()} (25% wallet size) into ${bestInst.symbol} @ $${bestSignal.entryPrice.toFixed(2)} automatically...`);

      await createOrder.mutateAsync({
         userId: "me",
         portfolioId: 1,
         instrumentId: bestInst.id,
         side: bestSignal.direction as any,
         type: "MARKET",
         quantity
      });

      addLog(`✅ Order successfully executed. Profit tracking started.`);
      toast({ title: "Smart Pilot Executed", description: `Automatically invested in ${bestInst.symbol}` });

    } catch (err: any) {
      addLog(`Failed during execution: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="glass rounded-3xl border border-border/60 p-5 shadow-luxe mb-6">
       <div className="flex items-center gap-2 mb-4">
         <span className="text-base font-bold">🧠 Smart Wallet Auto-Pilot</span>
         <span className="text-[10px] uppercase tracking-widest bg-accent/20 text-accent px-2 py-0.5 rounded-full">Automated ROI Investing</span>
       </div>
       <p className="text-sm text-muted-foreground mb-4">
         The bot will analyze your wallet balance and scan all top markets for the highest return opportunities. It automatically sizes and places a trade for you when a highly profitable setup pattern is found.
       </p>
       
       <Button onClick={startPilot} disabled={analyzing} className="rounded-2xl bg-gradient-to-r from-accent to-accent/80 text-accent-foreground shadow-md mb-4 w-full sm:w-auto">
         {analyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
         {analyzing ? "Analyzing Markets & Wallet..." : "Initiate Smart Pilot Trade"}
       </Button>

       {log.length > 0 && (
         <div className="bg-background/50 rounded-2xl p-4 font-mono text-xs overflow-y-auto max-h-48 border border-border/50">
           {log.map((l, i) => (
             <div key={i} className="mb-1 text-muted-foreground space-x-2">
                <span className="opacity-50">[{l.time}]</span>
                <span className="text-foreground">{l.msg}</span>
             </div>
           ))}
         </div>
       )}
    </div>
  );
}
