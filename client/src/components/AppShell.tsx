import { ReactNode, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  BookOpen,
  CandlestickChart,
  LayoutDashboard,
  ListChecks,
  Sparkles,
  Wallet,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  testId: string;
};

function initials(first?: string | null, last?: string | null, email?: string | null) {
  const a = (first?.[0] || "").toUpperCase();
  const b = (last?.[0] || "").toUpperCase();
  const c = (email?.[0] || "").toUpperCase();
  return (a + b || c || "U").slice(0, 2);
}

export default function AppShell(props: { children: ReactNode; title?: string; subtitle?: string }) {
  const { children, title, subtitle } = props;
  const [loc] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const nav: NavItem[] = useMemo(
    () => [
      { href: "/app", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, testId: "nav-dashboard" },
      { href: "/app/watchlists", label: "Watchlists", icon: <Activity className="h-4 w-4" />, testId: "nav-watchlists" },
      { href: "/app/markets", label: "Markets", icon: <CandlestickChart className="h-4 w-4" />, testId: "nav-markets" },
      { href: "/app/orders", label: "Orders", icon: <ListChecks className="h-4 w-4" />, testId: "nav-orders" },
      { href: "/app/learn", label: "Learn", icon: <BookOpen className="h-4 w-4" />, testId: "nav-learn" },
      { href: "/app/insights", label: "AI Insights", icon: <Sparkles className="h-4 w-4" />, testId: "nav-insights" },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-mesh grain">
      <div className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 lg:gap-8">
            {/* Sidebar */}
            <aside
              className="
                glass-strong rounded-3xl shadow-luxe
                overflow-hidden
              "
            >
              <div className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <Link
                    href="/app"
                    data-testid="brand"
                    className="group flex items-center gap-3"
                  >
                    <span
                      className="
                        grid place-items-center
                        h-11 w-11 rounded-2xl
                        bg-gradient-to-br from-primary/18 via-primary/10 to-accent/10
                        border border-border/60
                        shadow-sm
                        transition-transform duration-300 ease-out
                        group-hover:-translate-y-0.5
                      "
                    >
                      <Wallet className="h-5 w-5 text-primary" />
                    </span>
                    <div className="leading-tight">
                      <div className="text-[15px] font-semibold tracking-tight">Aurum Paper</div>
                      <div className="text-xs text-muted-foreground">Fintech sandbox</div>
                    </div>
                  </Link>

                  <ThemeToggle />
                </div>

                <Separator className="my-5 opacity-70" />

                <nav className="space-y-1.5" aria-label="Primary navigation">
                  {nav.map((item) => {
                    const active = loc === item.href || (item.href !== "/app" && loc.startsWith(item.href));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-testid={item.testId}
                        className={cn(
                          "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-out",
                          "hover:bg-sidebar-accent/60 hover:shadow-sm hover:-translate-y-[1px] active:translate-y-0",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
                          active
                            ? "bg-sidebar-accent/70 ring-1 ring-border/70"
                            : "text-foreground/90",
                        )}
                      >
                        <span
                          className={cn(
                            "grid place-items-center h-9 w-9 rounded-xl border transition-colors duration-300",
                            active
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border/60 bg-background/40 text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="flex-1">{item.label}</span>
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full transition-all duration-300",
                            active ? "bg-primary shadow-[0_0_0_4px_rgba(14,165,233,0.16)]" : "bg-border",
                          )}
                        />
                      </Link>
                    );
                  })}
                </nav>

                <Separator className="my-5 opacity-70" />

                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 ring-1 ring-border/60">
                    <AvatarImage src={user?.profileImageUrl ?? undefined} alt="Profile image" />
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-foreground">
                      {initials(user?.firstName, user?.lastName, user?.email)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {user?.firstName || user?.lastName
                        ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
                        : "Your Account"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{user?.email ?? "Signed in with Replit"}</div>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => logout()}
                    disabled={isLoggingOut}
                    data-testid="logout"
                    className="
                      rounded-xl
                      bg-secondary/70 hover:bg-secondary
                      border border-border/60
                      transition-all duration-300 ease-out
                      hover:-translate-y-0.5 active:translate-y-0
                      disabled:opacity-60 disabled:transform-none
                    "
                  >
                    {isLoggingOut ? "…" : "Logout"}
                  </Button>
                </div>
              </div>
            </aside>

            {/* Main */}
            <main className="min-w-0">
              <header className="glass rounded-3xl shadow-luxe p-5 sm:p-6 mb-5 lg:mb-7 animate-in-up">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl leading-tight">{title ?? "Dashboard"}</h1>
                    {subtitle ? (
                      <p className="mt-1.5 text-sm sm:text-base text-muted-foreground max-w-2xl">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>

                  <div className="hidden md:flex items-center gap-2">
                    <Link
                      href="/app/orders/new"
                      data-testid="header-new-order"
                      className="
                        inline-flex items-center justify-center
                        rounded-2xl px-4 py-2.5 text-sm font-semibold
                        bg-gradient-to-r from-primary to-primary/85
                        text-primary-foreground
                        shadow-lg shadow-primary/20
                        border border-primary/30
                        hover:shadow-xl hover:shadow-primary/25 hover:-translate-y-0.5
                        active:translate-y-0
                        transition-all duration-300 ease-out
                        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20
                      "
                    >
                      Place Order
                    </Link>

                    <Link
                      href="/app/insights"
                      data-testid="header-ai-insights"
                      className="
                        inline-flex items-center justify-center gap-2
                        rounded-2xl px-4 py-2.5 text-sm font-semibold
                        bg-background/50
                        border border-border/70
                        hover:bg-background/70 hover:-translate-y-0.5
                        active:translate-y-0
                        transition-all duration-300 ease-out
                        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15
                      "
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                      Insights
                    </Link>
                  </div>
                </div>
              </header>

              <div className="animate-in-up" style={{ animationDelay: "70ms" }}>
                {children}
              </div>
            </main>
          </div>
        </div>

        <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
          <div className="text-xs text-muted-foreground/80">
            Aurum Paper • Paper trading only • Market data may be delayed
          </div>
        </footer>
      </div>
    </div>
  );
}
