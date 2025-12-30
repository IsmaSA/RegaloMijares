import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import sqlite3 from "sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: "256kb" }));

// --- Load photos config ---
const PHOTOS_PATH = path.join(__dirname, "data", "photos.json");
function loadPhotos() {
  const raw = fs.readFileSync(PHOTOS_PATH, "utf-8");
  const photos = JSON.parse(raw);
  const ids = new Set();
  for (const p of photos) {
    if (!p.id || !p.src) throw new Error("Cada foto necesita id y src.");
    if (ids.has(p.id)) throw new Error(`ID duplicado en photos.json: ${p.id}`);
    ids.add(p.id);
  }
  return photos;
}
let PHOTOS = loadPhotos();
const PHOTO_ID_SET = () => new Set(PHOTOS.map(p => p.id));

// --- SQLite ---
const db = new sqlite3.Database(path.join(__dirname, "votes.db"));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      voter_token TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_votes_photo_id ON votes(photo_id)`);
});

// Small helper (promise wrappers)
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

// --- Simple in-memory rate limiting (naive) ---
const rl = new Map(); // ip -> {count, resetAt}
function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 10_000;
  const limit = 30;

  const entry = rl.get(ip);
  if (!entry || entry.resetAt <= now) {
    rl.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  entry.count += 1;
  if (entry.count > limit) {
    return res.status(429).json({ error: "Demasiadas peticiones. Espera un momento." });
  }
  next();
}

app.use("/api", rateLimit);

// --- SSE (Server Sent Events) for realtime results ---
const clients = new Set(); // res objects

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function computeResults() {
  const photos = PHOTOS.map(p => ({ ...p })); // shallow copy
  const counts = await dbAll(`SELECT photo_id, COUNT(*) as c FROM votes GROUP BY photo_id`);
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM votes`);
  const total = totalRow?.total ?? 0;

  const map = new Map(counts.map(r => [r.photo_id, r.c]));
  const withVotes = photos.map(p => ({
    ...p,
    votes: map.get(p.id) ?? 0
  }));

  return { totalVotes: total, photos: withVotes, updatedAt: Date.now() };
}

async function broadcastResults() {
  const payload = await computeResults();
  for (const res of clients) {
    try {
      sseSend(res, "results", payload);
    } catch {
      // ignore
    }
  }
}

app.get("/api/photos", (_req, res) => {
  res.json({ photos: PHOTOS.map(({ id, title, src, alt }) => ({ id, title, src, alt })) });
});

app.get("/api/results", async (_req, res) => {
  try {
    res.json(await computeResults());
  } catch (e) {
    res.status(500).json({ error: "Error calculando resultados." });
  }
});

app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  clients.add(res);

  // Initial payload
  try {
    sseSend(res, "results", await computeResults());
  } catch {
    // ignore
  }

  req.on("close", () => {
    clients.delete(res);
  });
});

app.post("/api/vote", async (req, res) => {
  try {
    const { photoId, voterToken } = req.body || {};
    if (!photoId || typeof photoId !== "string") return res.status(400).json({ error: "photoId inválido." });
    if (!voterToken || typeof voterToken !== "string" || voterToken.length < 10) {
      return res.status(400).json({ error: "voterToken inválido." });
    }

    const idSet = PHOTO_ID_SET();
    if (!idSet.has(photoId)) return res.status(400).json({ error: "Esa foto no existe." });

    const now = Date.now();
    // upsert (by voter_token)
    const existing = await dbGet(`SELECT voter_token, photo_id FROM votes WHERE voter_token = ?`, [voterToken]);
    if (!existing) {
      await dbRun(
        `INSERT INTO votes (voter_token, photo_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
        , [voterToken, photoId, now, now]
      );
    } else {
      await dbRun(
        `UPDATE votes SET photo_id = ?, updated_at = ? WHERE voter_token = ?`,
        [photoId, now, voterToken]
      );
    }

    // Notify all clients
    broadcastResults().catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "No se pudo registrar el voto." });
  }
});

// Optional: reload photos without restarting (dev helper)
app.post("/api/admin/reload-photos", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado." });
  }
  try {
    PHOTOS = loadPhotos();
    await broadcastResults();
    res.json({ ok: true, photos: PHOTOS.length });
  } catch {
    res.status(400).json({ error: "No se pudieron recargar fotos." });
  }
});

// Static site
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`✅ Photo Vote listo en http://localhost:${PORT}`);
  console.log(`Tip: Si quieres admin, define ADMIN_KEY en tu entorno.`);
});
