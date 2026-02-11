import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { usePortfolioSummary } from "@/hooks/use-portfolio";
import { useMarketNews } from "@/hooks/use-market";
import { useWatchlists } from "@/hooks/use-watchlists";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError, redirectToLogin } from "@/lib/auth-utils";
import StatPill from "@/components/StatPill";
import GradientCard from "@/components/GradientCard";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, BadgeIndianRupee, BarChart3, Newspaper, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmtInr(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function toneFor(n?: number) {
  if (typeof n !== "number") return "neutral" as const;
  if (n > 0) return "good" as const;
  if (n < 0) return "bad" as const;
  return "neutral" as const;
}

const ALLOC_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function Dashboard() {
  const { toast } = useToast();
  const portfolio = usePortfolioSummary();
  const news = useMarketNews();
  const watchlists = useWatchlists();

  const p = portfolio.data as any;

  const totals = p?.totals;
  const allocation = (p?.allocation ?? []).map((a: any) => ({
    name: a.assetClass,
    value: a.value,
    pct: a.pct,
  }));

  function handle401(err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (isUnauthorizedError(e)) return redirectToLogin(toast as any);
  }

  const loading = portfolio.isLoading;

  return (
    <AppShell
      title="Dashboard"
      subtitle="A premium snapshot of your paper portfolio, watchlists and the market tape."
    >
      <Seo title="Dashboard • Aurum Paper" description="Portfolio summary, allocation, watchlists and market news." />

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5 lg:gap-7">
        <GradientCard
          title="Portfolio Pulse"
          subtitle="Market value, P&L and allocation"
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
          tone="primary"
          data-testid="dashboard-portfolio-card"
        >
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[78px] rounded-2xl" />
              ))}
              <Skeleton className="md:col-span-2 h-[240px] rounded-2xl" />
              <Skeleton className="md:col-span-2 h-[240px] rounded-2xl" />
            </div>
          ) : portfolio.isError ? (
            <EmptyState
              data-testid="dashboard-portfolio-error"
              icon={<TriangleAlert className="h-6 w-6 text-destructive" />}
              title="Couldn’t load portfolio"
              description="Your session may have expired or the backend route isn’t wired yet."
              action={
                <Button
                  type="button"
                  onClick={() => {
                    handle401(portfolio.error);
                    portfolio.refetch();
                  }}
                  data-testid="dashboard-portfolio-retry"
                  className="rounded-2xl"
                >
                  Retry
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <StatPill
                data-testid="stat-market-value"
                label="Market Value"
                value={fmtInr(totals?.marketValue)}
                hint="Estimated"
                tone="primary"
              />
              <StatPill
                data-testid="stat-day-pnl"
                label="Day P&L"
                value={fmtInr(totals?.dayPnl)}
                hint={fmtPct(totals?.dayPnlPct)}
                tone={toneFor(totals?.dayPnl)}
              />
              <StatPill
                data-testid="stat-total-pnl"
                label="Total P&L"
                value={fmtInr(totals?.totalPnl)}
                hint={fmtPct(totals?.totalPnlPct)}
                tone={toneFor(totals?.totalPnl)}
              />
              <StatPill
                data-testid="stat-cost-value"
                label="Cost Value"
                value={fmtInr(totals?.costValue)}
                hint="Capital deployed"
                tone="neutral"
              />

              <div className="md:col-span-2 glass rounded-3xl border border-border/60 p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Allocation</div>
                  <div className="text-xs text-muted-foreground">By asset class</div>
                </div>

                <div className="mt-3 h-[210px]">
                  {allocation.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <ReTooltip
                          contentStyle={{
                            borderRadius: 16,
                            border: "1px solid hsl(var(--border) / 0.7)",
                            background: "hsl(var(--card) / 0.85)",
                            backdropFilter: "blur(12px)",
                          }}
                        />
                        <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={62} outerRadius={84} paddingAngle={3}>
                          {allocation.map((_e: any, idx: number) => (
                            <Cell key={`cell-${idx}`} fill={ALLOC_COLORS[idx % ALLOC_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full grid place-items-center text-sm text-muted-foreground">
                      No allocation data yet.
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {allocation.slice(0, 4).map((a: any, idx: number) => (
                    <div key={a.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: ALLOC_COLORS[idx % ALLOC_COLORS.length] }}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto text-muted-foreground">{a.pct?.toFixed?.(1) ?? a.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 glass rounded-3xl border border-border/60 p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Holdings</div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/app/orders/new"
                      data-testid="dashboard-order-cta"
                      className="
                        inline-flex items-center justify-center gap-2
                        rounded-2xl px-3 py-2 text-xs font-semibold
                        bg-gradient-to-r from-primary to-primary/85
                        text-primary-foreground
                        shadow-md shadow-primary/20
                        hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5
                        active:translate-y-0
                        transition-all duration-300 ease-out
                      "
                    >
                      <Plus className="h-4 w-4" />
                      New order
                    </Link>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {(p?.holdings ?? []).slice(0, 6).map((h: any) => {
                    const pnl = h?.pnl;
                    const pnlTone = pnl > 0 ? "text-accent" : pnl < 0 ? "text-destructive" : "text-muted-foreground";
                    return (
                      <div
                        key={h?.holding?.id}
                        className={cn(
                          "rounded-2xl border border-border/60 bg-background/40 p-3",
                          "transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                              {h?.instrument?.symbol} <span className="text-muted-foreground font-normal">• {h?.instrument?.exchange}</span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{h?.instrument?.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">{fmtInr(h?.marketValue)}</div>
                            <div className={cn("text-xs font-medium", pnlTone)}>
                              {fmtInr(pnl)} <span className="opacity-80">({fmtPct(h?.pnlPct)})</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {(p?.holdings ?? []).length === 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                      No holdings yet. Place a paper order to begin.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </GradientCard>

        <div className="space-y-5 lg:space-y-7">
          <GradientCard
            title="Watchlists"
            subtitle="Track your edge—fast"
            icon={<BadgeIndianRupee className="h-5 w-5 text-accent" />}
            tone="accent"
            data-testid="dashboard-watchlists-card"
          >
            {watchlists.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-2xl" />
                ))}
              </div>
            ) : watchlists.isError ? (
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                Couldn’t load watchlists.
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => watchlists.refetch()}
                    data-testid="dashboard-watchlists-retry"
                    className="rounded-2xl"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(watchlists.data as any[] | undefined)?.slice(0, 5)?.map((w: any) => (
                  <Link
                    key={w.id}
                    href={`/app/watchlists/${w.id}`}
                    data-testid={`watchlist-link-${w.id}`}
                    className="
                      group flex items-center justify-between gap-3
                      rounded-2xl border border-border/60 bg-background/40 p-3
                      transition-all duration-300 ease-out
                      hover:-translate-y-0.5 hover:shadow-md hover:bg-background/55
                      focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15
                    "
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{w.name}</div>
                      <div className="text-xs text-muted-foreground">{w.itemCount} instruments</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5" />
                  </Link>
                ))}

                <div className="pt-2">
                  <Link
                    href="/app/watchlists"
                    data-testid="dashboard-watchlists-viewall"
                    className="
                      inline-flex items-center gap-2 text-sm font-semibold text-primary
                      hover:underline underline-offset-4
                    "
                  >
                    Manage watchlists <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}
          </GradientCard>

          <GradientCard
            title="Market Tape"
            subtitle="Curated headlines (MVP feed)"
            icon={<Newspaper className="h-5 w-5 text-primary" />}
            tone="neutral"
            data-testid="dashboard-news-card"
          >
            {news.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-2xl" />
                ))}
              </div>
            ) : news.isError ? (
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                Couldn’t load news.
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => news.refetch()}
                    data-testid="dashboard-news-retry"
                    className="rounded-2xl"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {(news.data ?? []).slice(0, 5).map((a: any) => (
                  <button
                    key={a.id}
                    type="button"
                    data-testid={`news-open-${a.id}`}
                    onClick={() => window.open(a.url, "_blank")}
                    className="
                      w-full text-left
                      rounded-2xl border border-border/60 bg-background/40 p-3
                      transition-all duration-300 ease-out
                      hover:-translate-y-0.5 hover:shadow-md hover:bg-background/55
                      focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15
                    "
                  >
                    <div className="text-sm font-semibold line-clamp-2">{a.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground flex items-center justify-between gap-3">
                      <span>{a.source}</span>
                      <span className="opacity-80">{new Date(a.publishedAt).toLocaleString()}</span>
                    </div>
                  </button>
                ))}

                <div className="pt-2">
                  <Link
                    href="/app/markets"
                    data-testid="dashboard-markets"
                    className="
                      inline-flex items-center gap-2 text-sm font-semibold text-primary
                      hover:underline underline-offset-4
                    "
                  >
                    Explore markets <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}
          </GradientCard>

          <GradientCard
            title="AI Insights"
            subtitle="Streaming, concise, useful"
            icon={<Sparkles className="h-5 w-5 text-chart-4" />}
            tone="primary"
            data-testid="dashboard-ai-card"
          >
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="text-sm font-semibold">Try a prompt:</div>
              <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                <li>“Scan my portfolio and highlight concentration risk.”</li>
                <li>“Summarize today’s biggest market themes.”</li>
                <li>“Give me a paper trade checklist for a breakout setup.”</li>
              </ul>
              <div className="mt-4">
                <Link
                  href="/app/insights"
                  data-testid="dashboard-open-insights"
                  className="
                    inline-flex items-center justify-center gap-2
                    rounded-2xl px-4 py-2.5 text-sm font-semibold
                    bg-gradient-to-r from-primary to-primary/85
                    text-primary-foreground
                    shadow-lg shadow-primary/20
                    hover:shadow-xl hover:shadow-primary/25 hover:-translate-y-0.5
                    active:translate-y-0
                    transition-all duration-300 ease-out
                  "
                >
                  Open AI Insights <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </GradientCard>
        </div>
      </div>
    </AppShell>
  );
}
