import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Wallet, Sparkles } from "lucide-react";
import Seo from "@/components/Seo";
import ThemeToggle from "@/components/ThemeToggle";

import { useToast } from "@/hooks/use-toast";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { login, register, isLoading } = useAuth();
  const { toast } = useToast();

  // Form states
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        const res = await login({ email, password });
        if (res.ok) setLocation("/app");
      } else {
        const res = await register({ email, password, firstName, lastName });
        if (res.ok) {
          toast({
            title: "Welcome!",
            description: "Account created successfully.",
          });
          setLocation("/app");
        }
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Authentication failed. Please check your credentials.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-mesh grain flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <Seo title={isLogin ? "Login - HTC Trade" : "Register - HTC Trade"} />
      
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center z-10 hidden sm:block">
         <div className="flex justify-center mb-6">
            <div className="grid place-items-center h-16 w-16 rounded-3xl bg-gradient-to-br from-primary/18 via-primary/10 to-accent/10 border border-border/60 shadow-lg shadow-primary/20">
              <Wallet className="h-8 w-8 text-primary" />
            </div>
         </div>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight">
          {isLogin ? "Sign in to your account" : "Create an account"}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground mb-6">
          {isLogin ? "Welcome back to the trading platform" : "Join our trading platform today"}
        </p>
      </div>

      <div className="mt-4 sm:mt-8 sm:mx-auto sm:w-full sm:max-w-md z-10 relative">
        <div className="glass sm:shadow-luxe sm:rounded-3xl sm:px-10 px-6 py-8 sm:border border-border/60 backdrop-blur-2xl">
          <form className="space-y-5" onSubmit={handleSubmit}>
            
            {!isLogin && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground/80 mb-1.5 uppercase tracking-wide">First Name</label>
                  <input
                    type="text"
                    required={!isLogin}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full bg-input/40 border border-border/60 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/50"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground/80 mb-1.5 uppercase tracking-wide">Last Name</label>
                  <input
                    type="text"
                    required={!isLogin}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full bg-input/40 border border-border/60 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/50"
                    placeholder="Doe"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-foreground/80 mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-input/40 border border-border/60 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground/80 mb-1.5 uppercase tracking-wide">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-input/40 border border-border/60 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/50"
                placeholder="••••••••"
              />
            </div>

            <div className="pt-2">
              <Button 
                type="submit" 
                className="w-full rounded-xl py-6 text-sm font-semibold bg-gradient-to-r from-primary to-primary/85 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98]"
                disabled={isLoading}
              >
                {isLoading ? "Please wait..." : (isLogin ? "Sign In" : "Create Account")}
              </Button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setEmail("");
                setPassword("");
                setFirstName("");
                setLastName("");
              }}
              type="button"
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>

          <div className="mt-8 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80 font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Secure Local Auth
              </span>
              <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
