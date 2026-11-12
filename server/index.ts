import 'dotenv/config';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const app = createApp();
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) { res.status(404).json({ error: 'Endpoint not found' }); return; }
  res.sendFile(`${dist}/index.html`);
});
const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => console.log(`DeFiMon server listening on port ${port}`));
