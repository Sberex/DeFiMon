import type { RequestHandler } from 'express';
// Browsers on GitHub Pages need permission to read this public, read-only API.
// This does not authenticate clients; provider secrets always stay on the server.
export const apiCors: RequestHandler = (req, res, next) => {
  const origin = req.get('Origin');
  if (!origin) { next(); return; }
  res.vary('Origin');
  const allowed = (process.env.FRONTEND_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  // Requests to the website hosted by this same server need no CORS permission.
  const ownOrigin = `${req.protocol}://${req.get('host')}`;
  if (!allowed.includes(origin) && origin !== ownOrigin) {
    res.status(403).json({ error: 'This website origin is not enabled on the server.' }); return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
};
