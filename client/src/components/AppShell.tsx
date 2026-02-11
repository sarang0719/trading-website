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

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  testId: string;
};

export default function AppShell(props: { children: ReactNode; title?: string; subtitle?: string }) {
  const { children, title, subtitle } = props;
  const [loc] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const nav: NavItem[] = useMemo(
    () => [
      { href: "/app", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, testId: "nav-dashboard" },
      { href: "/app/portfolio", label: "Portfolio", icon: <Wallet className="h-4 w-4" />, testId: "nav-portfolio" },
      { href: "/app/watchlists", label: "Watchlists", icon: <Activity className="h-4 w-4" />, testId: "nav-watchlists" },
      { href: "/app/markets", label: "Markets", icon: <CandlestickChart className="h-4 w-4" />, testId: "nav-markets" },
      { href: "/app/orders", label: "Orders", icon: <ListChecks className="h-4 w-4" />, testId: "nav-orders" },
      { href: "/app/learn", label: "Learn", icon: <BookOpen className="h-4 w-4" />, testId: "nav-learn" },
      { href: "/app/insights", label: "AI Insights", icon: <Sparkles className="h-4 w-4" />, testId: "nav-insights" },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-background bg-mesh grain">
      <div className="relative z-10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
            {/* Sidebar */}
            <aside className="sticky top-8 self-start">
              <div className="flex items-center gap-3 mb-10 px-2">
                <div className="h-10 w-10 rounded-xl bg-primary shadow-[0_0_20px_rgba(185,95,55,0.3)] grid place-items-center">
                  <Wallet className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="font-bold text-xl tracking-tight">Ledgerly</div>
              </div>

              <div className="space-y-8">
                <div>
                  <div className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">General</div>
                  <nav className="space-y-1">
                    {nav.slice(0, 1).map((item) => {
                      const active = loc === item.href;
                      return (
                        <Link key={item.href} href={item.href} className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all",
                          active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        )}>
                          {item.icon}
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>

                <div>
                  <div className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Wallet</div>
                  <nav className="space-y-1">
                    {nav.slice(1, 5).map((item) => {
                      const active = loc.startsWith(item.href);
                      return (
                        <Link key={item.href} href={item.href} className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all",
                          active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        )}>
                          {item.icon}
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>

                <div>
                  <div className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Insights</div>
                  <nav className="space-y-1">
                    {nav.slice(5).map((item) => {
                      const active = loc.startsWith(item.href);
                      return (
                        <Link key={item.href} href={item.href} className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all",
                          active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        )}>
                          {item.icon}
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              </div>

              <div className="mt-20 px-2">
                <div className="glass rounded-[1.5rem] p-4 bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 grid place-items-center mb-3">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-xs font-bold mb-1">AI Crypto Predictions</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">Unlock advanced analysis for your portfolio.</div>
                </div>
              </div>

              <div className="mt-8 px-2 flex items-center gap-3 pt-6 border-t border-border/40">
                <Avatar className="h-10 w-10 ring-1 ring-border/60">
                  <AvatarImage src={user?.profileImageUrl ?? undefined} />
                  <AvatarFallback>{(user?.firstName?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold">{user?.firstName || "Account"}</div>
                  <button onClick={() => logout()} disabled={isLoggingOut} className="text-[10px] font-bold text-muted-foreground hover:text-destructive transition-colors">Sign out</button>
                </div>
                <ThemeToggle />
              </div>
            </aside>

            {/* Main */}
            <main className="min-w-0">
              <header className="mb-8 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight font-sans">{title ?? "Dashboard"}</h1>
                  {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative hidden md:block">
                     <input type="text" placeholder="Smart Search" className="bg-secondary/50 border border-border/50 rounded-xl px-4 py-2 text-xs font-bold w-64 focus:outline-none focus:ring-1 focus:ring-primary/50" />
                     <div className="absolute right-3 top-2 text-[10px] font-bold text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/50">⌘ K</div>
                  </div>
                </div>
              </header>

              <div className="animate-in-up">
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
