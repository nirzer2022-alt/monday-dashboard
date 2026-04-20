const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const MONDAY_TOKEN = process.env.MONDAY_TOKEN || '';
const PORT = process.env.PORT || 3000;

const CALENDAR_CREDS = process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : null;
const CALENDAR_ID = process.env.CALENDAR_ID || 'nirzer2022@gmail.com';
const CALENDAR_ID_STEPUP = '3fafd7868d8f30ef280cf29ecbd74ef79f75ba465c6c0b488145246726bae0e7@group.calendar.google.com';
const CALENDAR_ID_CONSULT = '96776edd0002b6adf80277d291cc40ca40f5c49b0e37f390226ca1758fc4055a@group.calendar.google.com';

const BOARDS = {
  leads:    { id: 9949694708, cols: ['lead_status', 'color_mkvd5y1g'] },
  sales:    { id: 9949694887, cols: ['lead_status'] },
  stepup:   { id: 9950584665, cols: ['lead_status'] },
  coaching: { id: 9949694755, cols: ['status', 'numeric_mky8ze04'] },
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
      path: '/v2/',
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

// ─── Google Calendar JWT Auth ─────────────────────────────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload, privateKey) {
  const crypto = require('crypto');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const sig = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${sig}`;
}

async function getGoogleToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJWT({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }, creds.private_key);

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const j = JSON.parse(data); resolve(j.access_token); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// פונקציה כללית — maxResults ניתן להגדרה
async function fetchCalendarEvents(token, calendarId, timeMin, timeMax, maxResults = '500') {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults,
  });
  const encodedId = encodeURIComponent(calendarId);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/${encodedId}/events?${params}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function classifyEvent(event) {
  const start = new Date(event.start?.dateTime || event.start?.date);
  const end = new Date(event.end?.dateTime || event.end?.date);
  const duration = (end - start) / 60000;
  const summary = event.summary || '';
  const summaryLower = summary.toLowerCase();

  if (!event.start?.dateTime) return null;
  const knownDuration = duration===20 || duration===30 || duration===60 || duration===120;
  if (!knownDuration) return null;

  let type = 'אחר';
  if (duration===120) type = 'step-up';
  else if (duration===60) type = 'ליווי';
  else if (duration===30) type = 'שירות';
  else if (duration===20) type = 'ייעוץ';

  const isZoom = summaryLower.includes('זום') || summaryLower.includes('zoom');

  const dashIdx = summary.indexOf(' - ');
  const longDashIdx = summary.indexOf(' — ');
  let namePart;
  if(dashIdx > 0) {
    namePart = summary.slice(0, dashIdx).trim();
  } else if(longDashIdx > 0) {
    namePart = summary.slice(0, longDashIdx).trim();
  } else {
    const plainDash = summary.indexOf('-');
    namePart = plainDash > 0 ? summary.slice(0, plainDash).trim() : summary.trim();
  }

  return {
    id: event.id,
    summary,
    client: namePart,
    type,
    zoom: isZoom,
    duration,
    start: start.toISOString(),
    end: end.toISOString(),
    date: start.toLocaleDateString('he-IL'),
  };
}

async function getCalendarData(timeMin, timeMax) {
  if (!CALENDAR_CREDS) throw new Error('GOOGLE_CREDENTIALS not set');
  const token = await getGoogleToken(CALENDAR_CREDS);
  const [r1, r2, r3] = await Promise.all([
    fetchCalendarEvents(token, CALENDAR_ID, timeMin, timeMax, '500'),
    fetchCalendarEvents(token, CALENDAR_ID_STEPUP, timeMin, timeMax, '500'),
    fetchCalendarEvents(token, CALENDAR_ID_CONSULT, timeMin, timeMax, '500'),
  ]);
  const events = [
    ...(r1.items || []).filter(e => e.status !== 'cancelled'),
    ...(r2.items || []).filter(e => e.status !== 'cancelled'),
    ...(r3.items || []).filter(e => e.status !== 'cancelled'),
  ];
  return events.map(classifyEvent).filter(e => e !== null);
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/data') {
    try {
      const data = await getAllData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, data, ts: new Date().toISOString() }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.url?.startsWith('/calendar')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeMin = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
      const timeMax = to ? new Date(to) : new Date();
      timeMax.setHours(23, 59, 59);

      const events = await getCalendarData(timeMin, timeMax);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, events }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.url === '/coaching') {
    try {
      // שלב 1 — שמות מהמאנדיי (קבוצת ליווי פעיל בלבד)
      const coachingQuery = `{
        boards(ids: 9949694755) {
          groups(ids: ["new_group29179"]) {
            items_page(limit: 100) {
              items {
                id name
                column_values(ids: ["numeric_mky8ze04"]) { id text }
              }
            }
          }
        }
      }`;
      const mondayRes = await fetchMonday(coachingQuery);
      const active = mondayRes.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
      const totalActive = active.length;

      // שלב 2 — אירועים מהיומן — שנה אחורה + 30 יום קדימה
      // maxResults: 2500 כדי לא לחתוך אירועים
      const now = new Date();
      const timeMin = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const token = await getGoogleToken(CALENDAR_CREDS);
      const [r1, r2, r3] = await Promise.all([
        fetchCalendarEvents(token, CALENDAR_ID, timeMin, timeMax, '2500'),
        fetchCalendarEvents(token, CALENDAR_ID_STEPUP, timeMin, timeMax, '2500'),
        fetchCalendarEvents(token, CALENDAR_ID_CONSULT, timeMin, timeMax, '2500'),
      ]);

      const VALID_DURATIONS = [30, 60, 120];

      const allEvents = [
        ...(r1.items || []),
        ...(r2.items || []),
        ...(r3.items || []),
      ].filter(e => e.status !== 'cancelled' && e.start?.dateTime);

      // שלב 3 — התאמה: שם בתחילת הכותרת + משך תקין
      const clients = active.map(item => {
        const fullName = item.name;
        const searchName = item.name.split(' ')[0];
        const purchased = parseInt(item.column_values?.find(c => c.id === 'numeric_mky8ze04')?.text || '0') || 0;

        const matched = allEvents.filter(e => {
          const title = e.summary || '';
          const start = new Date(e.start.dateTime);
          const end = new Date(e.end.dateTime);
          const duration = (end - start) / 60000;
          const nameMatch =
            title.startsWith(searchName + ' -') ||
            title.startsWith(searchName + ' —') ||
            title.startsWith(searchName + '-');
          return nameMatch && VALID_DURATIONS.includes(duration);
        });

        const done = matched.length;
        const lastEvent = matched.sort((a, b) => new Date(b.start.dateTime) - new Date(a.start.dateTime))[0];
        const last = lastEvent ? new Date(lastEvent.start.dateTime).toLocaleDateString('he-IL') : '';
        const remaining = purchased > 0 ? purchased - done : null;
        const alert = remaining !== null && remaining <= 2;

        return { name: fullName, purchased, done, remaining, alert, last };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, totalActive, clients }));

    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

  try {
    const html = fs.readFileSync(path.join('/opt/render/project/src', 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch(e) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Error reading index.html: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log(`__dirname: ${__dirname}`);
  console.log(`Calendar credentials: ${CALENDAR_CREDS ? 'loaded' : 'MISSING'}`);
});
