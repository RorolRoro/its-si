// $SI poll API — Vercel serverless function.
// Storage: Upstash Redis (Vercel Marketplace "Upstash for Redis" / legacy Vercel KV) over REST, no SDK.
// GET  /api/vote            -> { superior, extreme, supreme, total, voted?: "superior"|... }
// POST /api/vote {choice}   -> same shape (one vote per visitor: cookie + hashed IP)
// Without Redis env vars the API answers 503 and the page falls back to browser-only mode.

import { createHash, randomUUID } from "node:crypto";

const CHOICES = ["superior", "extreme", "supreme"];
// First-run seed = the tweet's 134,987 votes. Set SEED_VOTES="0,0,0" in Vercel env to start from zero.
const DEFAULT_SEED = "61204,22451,51332";
const KEY_COUNTS = "si:votes";
const KEY_VOTERS = "si:voters";
const COOKIE = "si_voter";

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function counts() {
  const flat = await redis("HGETALL", KEY_COUNTS);
  const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]);
  if (CHOICES.some((c) => !(c in out))) {
    // first run: seed once (HSETNX so a concurrent cold start can't double-seed)
    const seed = (process.env.SEED_VOTES || DEFAULT_SEED).split(",").map((n) => Number(n) || 0);
    await Promise.all(CHOICES.map((c, i) => redis("HSETNX", KEY_COUNTS, c, seed[i] ?? 0)));
    return counts();
  }
  const res = Object.fromEntries(CHOICES.map((c) => [c, out[c]]));
  res.total = CHOICES.reduce((a, c) => a + res[c], 0);
  return res;
}

function parseCookies(h = "") {
  return Object.fromEntries(h.split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf("="); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
}
function voterId(req) {
  const salt = process.env.VOTE_SALT || "si-very-elegant";
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
  const ua = req.headers["user-agent"] || "";
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!URL_ || !TOKEN) return res.status(503).json({ error: "vote storage not configured" });

  try {
    const cookies = parseCookies(req.headers.cookie);
    const cookieVote = CHOICES.includes(cookies[COOKIE]) ? cookies[COOKIE] : null;

    if (req.method === "GET") {
      const c = await counts();
      const ipVote = await redis("HGET", KEY_VOTERS, voterId(req));
      const voted = cookieVote || (CHOICES.includes(ipVote) ? ipVote : undefined);
      return res.status(200).json(voted ? { ...c, voted } : c);
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const choice = body && body.choice;
      if (!CHOICES.includes(choice)) return res.status(400).json({ error: "choice must be superior | extreme | supreme" });

      const id = voterId(req);
      const already = cookieVote || (await redis("HGET", KEY_VOTERS, id));
      if (CHOICES.includes(already)) {
        const c = await counts();
        return res.status(200).json({ ...c, voted: already, duplicate: true });
      }
      const fresh = await redis("HSETNX", KEY_VOTERS, id, choice);
      if (fresh === 1) await redis("HINCRBY", KEY_COUNTS, choice, 1);
      const c = await counts();
      res.setHeader("Set-Cookie", `${COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
      return res.status(200).json({ ...c, voted: choice });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "vote storage unavailable" });
  }
}
