// Cross-origin headers for routes the website (whatyouate.app) calls on the app's server.

const ORIGINS = new Set(["https://whatyouate.app", "https://www.whatyouate.app"]);

export function siteCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://whatyouate.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}
