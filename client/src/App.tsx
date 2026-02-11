import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import HomeGate from "@/pages/HomeGate";
import AppIndex from "@/pages/AppIndex";
import Watchlists from "@/pages/Watchlists";
import WatchlistDetail from "@/pages/WatchlistDetail";
import Markets from "@/pages/Markets";
import Orders from "@/pages/Orders";
import NewOrder from "@/pages/NewOrder";
import Learn from "@/pages/Learn";
import LearnDetail from "@/pages/LearnDetail";
import AIInsights from "@/pages/AIInsights";
import MarketDetail from "@/pages/MarketDetail";
import Settings from "@/pages/Settings";
import NotFoundApp from "@/pages/NotFoundApp";

function Router() {
  return (
    <Switch>
      {/* Public root: Landing (logged out) / redirect to app (logged in) */}
      <Route path="/" component={HomeGate} />

      {/* App */}
      <Route path="/app" component={AppIndex} />
      <Route path="/app/watchlists" component={Watchlists} />
      <Route path="/app/watchlists/:id" component={WatchlistDetail} />
      <Route path="/app/markets" component={Markets} />
      <Route path="/app/markets/:id" component={MarketDetail} />
      <Route path="/app/orders" component={Orders} />
      <Route path="/app/orders/new" component={NewOrder} />
      <Route path="/app/learn" component={Learn} />
      <Route path="/app/learn/:id" component={LearnDetail} />
      <Route path="/app/insights" component={AIInsights} />
      <Route path="/app/settings" component={Settings} />

      {/* Nice 404 for app routes */}
      <Route path="/app/:rest*" component={NotFoundApp as any} />

      {/* Fallback to existing 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
