import { useMemo, useState } from "react";
import { Link } from "wouter";
import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { useInstruments } from "@/hooks/use-instruments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import { CandlestickChart, Filter, Plus, Search, TriangleAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OrderTicketDialog from "@/components/OrderTicketDialog";

export default function Markets() {
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState<string>("ALL");
  const [exchange, setExchange] = useState<string>("ALL");

  const instruments = useInstruments({
    q: q.trim() || undefined,
    assetClass: assetClass === "ALL" ? undefined : assetClass,
    exchange: exchange === "ALL" ? undefined : exchange,
  });

  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketInstrument, setTicketInstrument] = useState<any>(null);

  const exchanges = useMemo(() => {
    const set = new Set<string>();
    (instruments.data ?? []).forEach((i: any) => set.add(i.exchange));
    return Array.from(set).sort();
  }, [instruments.data]);

  return (
    <AppShell title="Markets" subtitle="Search instruments and open an order ticket instantly.">
      <Seo title="Markets • Aurum Paper" description="Search instruments and place paper orders." />

      <div className="glass rounded-3xl border border-border/60 p-4 sm:p-5 shadow-luxe">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px_200px_auto] gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="markets-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol / company…"
              className="pl-10 rounded-2xl bg-background/50"
            />
          </div>

          <Select value={assetClass} onValueChange={setAssetClass}>
            <SelectTrigger data-testid="markets-assetclass" className="rounded-2xl bg-background/50">
              <SelectValue placeholder="Asset class" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="INDIAN_STOCK">Indian stocks</SelectItem>
              <SelectItem value="US_STOCK">US stocks</SelectItem>
              <SelectItem value="ETF">ETF</SelectItem>
              <SelectItem value="MUTUAL_FUND">Mutual fund</SelectItem>
              <SelectItem value="FOREX">Forex</SelectItem>
            </SelectContent>
          </Select>

          <Select value={exchange} onValueChange={setExchange}>
            <SelectTrigger data-testid="markets-exchange" className="rounded-2xl bg-background/50">
              <SelectValue placeholder="Exchange" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="ALL">All</SelectItem>
              {exchanges.map((ex) => (
                <SelectItem key={ex} value={ex}>
                  {ex}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="secondary"
            data-testid="markets-clear"
            onClick={() => {
              setQ("");
              setAssetClass("ALL");
              setExchange("ALL");
            }}
            className="rounded-2xl"
          >
            <Filter className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>

        <div className="mt-4">
          {instruments.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-[98px] rounded-3xl" />
              ))}
            </div>
          ) : instruments.isError ? (
            <EmptyState
              data-testid="markets-error"
              icon={<TriangleAlert className="h-6 w-6 text-destructive" />}
              title="Couldn’t load instruments"
              description="Check if /api/instruments is implemented on the backend."
              action={
                <Button type="button" onClick={() => instruments.refetch()} data-testid="markets-retry" className="rounded-2xl">
                  Retry
                </Button>
              }
            />
          ) : (instruments.data ?? []).length === 0 ? (
            <EmptyState
              data-testid="markets-empty"
              icon={<CandlestickChart className="h-6 w-6 text-primary" />}
              title="No results"
              description="Try a different search query or broaden filters."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {(instruments.data ?? []).map((i: any) => (
                <Link
                  key={i.id}
                  href={`/app/markets/${i.id}`}
                  data-testid={`market-instrument-${i.id}`}
                  className="
                    glass rounded-3xl border border-border/60 p-4 shadow-sm
                    transition-all duration-300 ease-out
                    hover:-translate-y-0.5 hover:shadow-md hover:bg-background/60
                    cursor-pointer
                  "
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {i.symbol} <span className="text-muted-foreground font-normal">• {i.exchange}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{i.name}</div>
                    </div>
                    <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      {i.assetClass}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {i.country} • {i.currency}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      data-testid={`market-trade-${i.id}`}
                      onClick={() => {
                        setTicketInstrument(i);
                        setTicketOpen(true);
                      }}
                      className="
                        rounded-2xl
                        bg-gradient-to-r from-primary to-primary/85
                        text-primary-foreground
                        shadow-md shadow-primary/20
                        hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5
                        active:translate-y-0
                        transition-all duration-300 ease-out
                      "
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Trade
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <OrderTicketDialog open={ticketOpen} onOpenChange={setTicketOpen} defaultPortfolioId={1} defaultInstrument={ticketInstrument ?? undefined} />
    </AppShell>
  );
}
