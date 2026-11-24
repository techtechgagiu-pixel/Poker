import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const clients = new Set();
const emit = (type, payload) => {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) c.write(msg);
};
const game = new Game(emit);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(game.snapshot())}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/start' && req.method === 'POST') {
    if (game.phase !== 'running') game.start();
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  if (url.pathname === '/api/reset' && req.method === 'POST') {
    game.reset(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
  }
  let f = path.join(PUB, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`AI Poker Night: http://localhost:${PORT}  (AI: ${process.env.OPENROUTER_API_KEY ? 'OpenRouter' : 'boți euristici - lipsește OPENROUTER_API_KEY'})`));
