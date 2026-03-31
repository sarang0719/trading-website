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
  LogOut,
  Zap
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { AlertTriangle, Power } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  testId: string;
};

export default function AppShell(props: { children: ReactNode; title?: string; subtitle?: string; noPadding?: boolean }) {
  const { children, title, subtitle, noPadding } = props;
  const [loc] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  const [isLiveMode, setIsLiveMode] = useLocalStorage("ledgerly_live_mode", false);

  const nav: NavItem[] = useMemo(
    () => [
      { href: "/app", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, testId: "nav-dashboard" },
      { href: "/app/portfolio", label: "Portfolio", icon: <Wallet className="h-4 w-4" />, testId: "nav-portfolio" },
      { href: "/app/watchlists", label: "Watchlists", icon: <Activity className="h-4 w-4" />, testId: "nav-watchlists" },
      { href: "/app/markets", label: "Markets", icon: <CandlestickChart className="h-4 w-4" />, testId: "nav-markets" },
      { href: "/app/orders", label: "Orders", icon: <ListChecks className="h-4 w-4" />, testId: "nav-orders" },
      { href: "/app/learn", label: "Learn", icon: <BookOpen className="h-4 w-4" />, testId: "nav-learn" },
      { href: "/app/insights",  label: "AI Insights", icon: <Sparkles className="h-4 w-4" />, testId: "nav-insights" },
      { href: "/app/strategy",  label: "Strategy",    icon: <Zap      className="h-4 w-4" />, testId: "nav-strategy" },
    ],
    [],
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/20">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[260px] flex-col border-r border-border/40 bg-card/30 backdrop-blur-xl">
        <div className="p-5 flex items-center gap-3 border-b border-border/40">
          <div className="h-8 w-8 rounded-lg bg-primary shadow-[0_0_15px_rgba(185,95,55,0.4)] grid place-items-center">
            <Wallet className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="font-bold text-lg tracking-tight">Ledgerly</div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 scrollbar-none">
          <div>
            <div className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-3">General</div>
            <nav className="space-y-1">
              {nav.slice(0, 1).map((item) => {
                const active = loc === item.href;
                return (
                  <Link key={item.href} href={item.href} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all",
                    active ? "bg-primary/10 text-primary shadow-[0_0_10px_rgba(185,95,55,0.1)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}>
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div>
            <div className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-3">Trading & Portfolio</div>
            <nav className="space-y-1">
              {nav.slice(1, 5).map((item) => {
                const active = loc.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all",
                    active ? "bg-primary/10 text-primary shadow-[0_0_10px_rgba(185,95,55,0.1)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}>
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div>
            <div className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 mb-3">Research</div>
            <nav className="space-y-1">
              {nav.slice(5).map((item) => {
                const active = loc.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all",
                    active ? "bg-primary/10 text-primary shadow-[0_0_10px_rgba(185,95,55,0.1)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}>
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-border/40 bg-card/20 pb-safe">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-9 w-9 ring-1 ring-border/60 shadow-sm">
              <AvatarImage src={user?.profileImageUrl ?? undefined} />
              <AvatarFallback className="bg-primary/20 text-primary font-bold">{(user?.firstName?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <Link href="/app/account" className="block truncate text-sm font-bold hover:text-primary transition-colors cursor-pointer">
                 {user?.firstName || "Account"}
              </Link>
              <button onClick={() => logout()} disabled={isLoggingOut} className="text-[11px] font-semibold text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 mt-0.5">
                 <LogOut className="h-3 w-3" /> Sign out
              </button>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <header className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-8 border-b border-border/40 bg-background/80 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-3">
              <div className="lg:hidden h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                 <Wallet className="h-4 w-4 text-primary" />
              </div>
              <div className="flex items-center gap-4">
                 <div>
                    <h1 className="text-lg lg:text-xl font-bold tracking-tight font-sans text-foreground flex items-center gap-2">
                       {title ?? "Dashboard"}
                    </h1>
                    {subtitle && <p className="text-[10px] lg:text-xs text-muted-foreground font-medium hidden sm:block">{subtitle}</p>}
                 </div>
                 
                 {/* LIVE MODE BADGE */}
                 <div className="hidden md:flex ml-2">
                    {isLiveMode ? (
                      <div className="bg-[#f23645]/10 text-[#f23645] border border-[#f23645]/20 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm shadow-[#f23645]/20 animate-pulse">
                        <AlertTriangle className="w-3 h-3" />
                        LIVE TRADING
                      </div>
                    ) : (
                      <div className="bg-[#089981]/10 text-[#089981] border border-[#089981]/20 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm">
                        <div className="w-1.5 h-1.5 bg-[#089981] rounded-full" />
                        PAPER TRADING
                      </div>
                    )}
                 </div>
              </div>
           </div>
           
           <div className="flex items-center gap-3">
             {/* DEMO / LIVE SWITCHER */}
             <button 
                onClick={() => setIsLiveMode(!isLiveMode)}
                className={cn(
                  "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-sm",
                  isLiveMode 
                    ? "bg-[#f23645]/10 border-[#f23645]/20 text-[#f23645] hover:bg-[#f23645]/20" 
                    : "bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground"
                )}
             >
                <Power className="w-3.5 h-3.5" />
                {isLiveMode ? "Disable Live API" : "Go Live"}
             </button>

             <div className="relative hidden lg:block ml-2">
               <input type="text" placeholder="Symbol search..." className="bg-secondary/30 border border-border/50 rounded-lg px-3 py-1.5 text-xs font-semibold w-56 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all" />
               <div className="absolute right-2 top-1.5 text-[9px] font-bold text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/30">⌘ K</div>
            </div>
            <div className="lg:hidden"><ThemeToggle /></div>
          </div>
        </header>

        {noPadding ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden w-full">
            {children}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto w-full p-4 lg:p-8 pb-24 lg:pb-8 relative">
            <div className="animate-in-up max-w-[1440px] mx-auto w-full h-full">
              {children}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-card/80 backdrop-blur-xl border-t border-border/60 z-50 px-2 flex justify-around items-center pb-safe">
        {[nav[0], nav[3], nav[2], nav[4], nav[6]].map((item) => {
          // Select 5 key items for mobile nav: Dashboard, Markets, Watchlists, Orders, Insights
          const active = loc === item.href || (item.href !== "/app" && loc.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} className={cn(
              "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}>
              <div className={cn("p-1.5 rounded-xl transition-all", active && "bg-primary/15")}>
                 {item.icon}
              </div>
              <span className="text-[9px] font-bold tracking-tight truncate w-full text-center px-1">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
