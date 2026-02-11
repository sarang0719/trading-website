import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import Seo from "@/components/Seo";
import { useOrders, useCancelOrder } from "@/hooks/use-orders";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError, redirectToLogin } from "@/lib/auth-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Link } from "wouter";
import { Ban, Plus, Search, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(n: any) {
  if (n == null) return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
}

export default function Orders() {
  const { toast } = useToast();
  const q = useOrders();
  const cancel = useCancelOrder();

  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);

  const list = useMemo(() => {
    const items = (q.data as any[]) ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((o) => {
      const id = String(o.id);
      const side = String(o.side ?? "").toLowerCase();
      const type = String(o.type ?? "").toLowerCase();
      const status = String(o.status ?? "").toLowerCase();
      return id.includes(s) || side.includes(s) || type.includes(s) || status.includes(s);
    });
  }, [q.data, search]);

  async function doCancel() {
    if (!cancelId) return;
    try {
      await cancel.mutateAsync(cancelId);
      toast({ title: "Order cancelled", description: `Order #${cancelId} has been cancelled.` });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (isUnauthorizedError(err)) return redirectToLogin(toast as any);
      toast({ title: "Couldn’t cancel order", description: err.message, variant: "destructive" as any });
    } finally {
      setConfirmOpen(false);
      setCancelId(null);
    }
  }

  return (
    <AppShell title="Orders" subtitle="Review your paper order history and manage pending orders.">
      <Seo title="Orders • Aurum Paper" description="Orders list, cancel workflows." />

      <div className="glass rounded-3xl border border-border/60 p-4 sm:p-5 shadow-luxe">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="orders-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by id, status, side, type…"
              className="pl-10 rounded-2xl bg-background/50"
            />
          </div>

          <Link
            href="/app/orders/new"
            data-testid="orders-new"
            className="
              inline-flex items-center justify-center
              rounded-2xl px-4 py-2.5 text-sm font-semibold
              bg-gradient-to-r from-primary to-primary/85
              text-primary-foreground
              shadow-lg shadow-primary/20
              hover:shadow-xl hover:shadow-primary/25 hover:-translate-y-0.5
              active:translate-y-0
              transition-all duration-300 ease-out
            "
          >
            <Plus className="h-4 w-4 mr-2" />
            New order
          </Link>
        </div>

        <div className="mt-4">
          {q.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-2xl" />
              ))}
            </div>
          ) : q.isError ? (
            <EmptyState
              data-testid="orders-error"
              icon={<TriangleAlert className="h-6 w-6 text-destructive" />}
              title="Couldn’t load orders"
              description="Try again, or check backend routes."
              action={
                <Button type="button" onClick={() => q.refetch()} data-testid="orders-retry" className="rounded-2xl">
                  Retry
                </Button>
              }
            />
          ) : list.length === 0 ? (
            <EmptyState
              data-testid="orders-empty"
              icon={<Ban className="h-6 w-6 text-primary" />}
              title="No orders yet"
              description="Place a paper order to start building your track record."
              action={
                <Link
                  href="/app/orders/new"
                  data-testid="orders-empty-new"
                  className="
                    inline-flex items-center justify-center
                    rounded-2xl px-4 py-2.5 text-sm font-semibold
                    bg-gradient-to-r from-primary to-primary/85
                    text-primary-foreground
                    shadow-lg shadow-primary/20
                    hover:shadow-xl hover:shadow-primary/25 hover:-translate-y-0.5
                    active:translate-y-0
                    transition-all duration-300 ease-out
                  "
                >
                  Create order
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {list.map((o: any) => {
                const pending = o.status === "PENDING";
                const filled = o.status === "FILLED";
                const rejected = o.status === "REJECTED";
                const pill =
                  filled ? "bg-accent/12 text-accent border-accent/20" :
                  rejected ? "bg-destructive/12 text-destructive border-destructive/20" :
                  pending ? "bg-primary/12 text-primary border-primary/20" :
                  "bg-muted/60 text-foreground border-border/60";

                return (
                  <div
                    key={o.id}
                    data-testid={`order-row-${o.id}`}
                    className="
                      rounded-2xl border border-border/60 bg-background/40 p-3
                      transition-all duration-300 ease-out
                      hover:-translate-y-0.5 hover:shadow-md hover:bg-background/55
                    "
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">Order #{o.id}</span>
                          <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border", pill)}>
                            {o.status}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(o.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {o.side} • {o.type} • Qty {fmt(o.quantity)} • Portfolio {o.portfolioId} • Instrument {o.instrumentId}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right mr-2">
                          <div className="text-xs text-muted-foreground">Limit / Stop</div>
                          <div className="text-sm font-semibold">
                            {o.limitPrice != null ? fmt(o.limitPrice) : "—"} / {o.stopPrice != null ? fmt(o.stopPrice) : "—"}
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="secondary"
                          data-testid={`order-cancel-${o.id}`}
                          onClick={() => {
                            setCancelId(o.id);
                            setConfirmOpen(true);
                          }}
                          disabled={!pending || cancel.isPending}
                          className="
                            rounded-2xl
                            border border-border/60 bg-background/60
                            disabled:opacity-50
                          "
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel this order?"
        description={`This will attempt to cancel order #${cancelId ?? ""}.`}
        confirmText={cancel.isPending ? "Cancelling…" : "Cancel order"}
        confirmVariant="destructive"
        onConfirm={doCancel}
        data-testid="orders-cancel-confirm"
      />
    </AppShell>
  );
}
