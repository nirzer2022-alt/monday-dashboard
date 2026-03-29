const http = require('http');
const https = require('https');

const MONDAY_TOKEN = process.env.MONDAY_TOKEN || '';
const PORT = process.env.PORT || 3000;

const BOARDS = {
  leads:    { id: 9949694708, cols: ['lead_status', 'color_mkvd5y1g'] },
  sales:    { id: 9949694887, cols: ['lead_status'] },
  stepup:   { id: 9950584665, cols: ['lead_status'] },
  coaching: { id: 9949694755, cols: ['status'] },
  sessions: { id: 9950821064, cols: ['status'] },
};

function mondayQuery(boardId, cols) {
  const colsStr = cols.map(c => `"${c}"`).join(', ');
  return `{ boards(ids: ${boardId}) { items_page(limit: 500) { items { name column_values(ids: [${colsStr}]) { id text } created_at } } } }`;
}

function fetchMonday(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getAllData() {
  const results = await Promise.all(
    Object.entries(BOARDS).map(async ([key, b]) => {
      const res = await fetchMonday(mondayQuery(b.id, b.cols));
      return [key, res.data?.boards?.[0]?.items_page?.items || []];
    })
  );
  return Object.fromEntries(results);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.url === '/data') {
    try {
      const data = await getAllData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data, ts: new Date().toISOString() }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
