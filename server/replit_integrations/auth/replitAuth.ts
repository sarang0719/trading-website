import type { Express, RequestHandler } from "express";

export async function setupAuth(app: Express) {
  // bypass authentication for local development without replit
  app.get("/api/login", (req, res) => {
    res.redirect("/api/callback");
  });

  app.get("/api/callback", (req, res) => {
    res.redirect("/");
  });

  app.get("/api/logout", (req, res) => {
    res.redirect("/");
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // bypass authentication for local development without replit
  // mock user for local development
  req.user = {
    claims: {
      sub: "local-dev-user-id",
      email: "test@example.com",
      first_name: "Local",
      last_name: "Developer",
      profile_image_url: ""
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600
  };

  // Also pass the mocked user into a pretend req.isAuthenticated() method since the app might be relying on that
  req.isAuthenticated = () => true;

  next();
};

export function getSession() {
  return (req: any, res: any, next: any) => next();
}
