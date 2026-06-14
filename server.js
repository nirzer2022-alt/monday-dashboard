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
  leads:    { id: 9949694708, cols: ['lead_status', 'color_mkvd5y1g', 'date_mm00ds06'] },
  sales:    { id: 9949694887, cols: ['deal_stage', 'date_mm00jx0c', 'color_mkvdnz23'] },
  stepup:   { id: 9950584665, cols: ['lead_status', 'date4', 'dropdown_mm3w3bgt', 'lookup_mm2pqfs3'] },
  coaching: { id: 9949694755, cols: ['status', 'numeric_mky8ze04', 'lookup_mm2pjncc'] },
  sessions: { id: 9950821064, cols: ['status'] },
};

function mondayQuery(boardId, cols, cursor) {
  const colsStr = cols.map(c => `"${c}"`).join(', ');
  if (cursor) {
    return `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { name column_values(ids: [${colsStr}]) { id text } created_at } } }`;
  }
  return `{ boards(ids: ${boardId}) { items_page(limit: 500) { cursor items { name column_values(ids: [${colsStr}]) { id text } created_at } } } }`;
}

async function fetchAllItems(boardId, cols) {
  const items = [];
  let cursor = null;
  let page = 0;
  do {
    const query = mondayQuery(boardId, cols, cursor);
    const res = await fetchMonday(query);
    let pageData;
    if (cursor) {
      pageData = res.data?.next_items_page;
    } else {
      pageData = res.data?.boards?.[0]?.items_page;
    }
    if (!pageData) break;
    items.push(...(pageData.items || []));
    cursor = pageData.cursor || null;
    page++;
  } while (cursor && page < 10); // מקסימום 5000 פריטים
  return items;
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
      const items = await fetchAllItems(b.id, b.cols);
      return [key, items];
    })
  );
  return Object.fromEntries(results);
}

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

async function fetchCalendarEvents(token, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
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

async function fetchAllCalendarEvents(token, calendarId, timeMin, timeMax) {
  const allItems = [];
  let current = new Date(timeMin);
  while (current < timeMax) {
    const chunkEnd = new Date(Math.min(
      current.getTime() + 90 * 24 * 60 * 60 * 1000,
      timeMax.getTime()
    ));
    const result = await fetchCalendarEvents(token, calendarId, current, chunkEnd);
    allItems.push(...(result.items || []));
    current = new Date(chunkEnd);
  }
  return { items: allItems };
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

  if (duration !== 120 && duration !== 20) {
    const hasDash = summary.includes(' - ') || summary.includes(' — ') || (summary.includes('-') && !summary.startsWith('-'));
    if (!hasDash) return null;
  }

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
    if(plainDash > 0) {
      namePart = summary.slice(0, plainDash).trim();
    } else {
      const andIdx = summary.indexOf(' and ');
      namePart = andIdx > 0 ? summary.slice(0, andIdx).trim() : summary.trim();
    }
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
    fetchAllCalendarEvents(token, CALENDAR_ID, timeMin, timeMax),
    fetchAllCalendarEvents(token, CALENDAR_ID_STEPUP, timeMin, timeMax),
    fetchAllCalendarEvents(token, CALENDAR_ID_CONSULT, timeMin, timeMax),
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

  // ─── /data ────────────────────────────────────────────────────────────────
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

  // ─── /calendar ────────────────────────────────────────────────────────────
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

  // ─── /coaching ────────────────────────────────────────────────────────────
  // FIX: disambiguation של שמות — fullName תמיד מנצח firstName
  // אירוע שנתפס על ידי fullName של לקוח A — לא נספר עבור firstName של לקוח B
  if (req.url?.startsWith('/coaching')) {
    try {
      // יתרה = נרכשו - סך כל הפגישות שבוצעו אי פעם (ללא קשר לטווח הנבחר בדשבורד)
      // תמיד טוענים שנתיים אחורה עד היום
      const timeMin = new Date(new Date().getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
      const timeMax = new Date();
      timeMax.setHours(23, 59, 59);

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

      const token = await getGoogleToken(CALENDAR_CREDS);
      const [r1, r2, r3] = await Promise.all([
        fetchAllCalendarEvents(token, CALENDAR_ID, timeMin, timeMax),
        fetchAllCalendarEvents(token, CALENDAR_ID_STEPUP, timeMin, timeMax),
        fetchAllCalendarEvents(token, CALENDAR_ID_CONSULT, timeMin, timeMax),
      ]);

      const VALID_DURATIONS = [60];

      const allEvents = [
        ...(r1.items || []),
        ...(r2.items || []),
        ...(r3.items || []),
      ].filter(e => e.status !== 'cancelled' && e.start?.dateTime);

      // ── STEP 1: בנה מפת fullName → אירועים תואמים (שם מלא בלבד) ──────────
      function eventMatchesFull(e, fullName) {
        const title = e.summary || '';
        const start = new Date(e.start.dateTime);
        const end   = new Date(e.end.dateTime);
        const duration = (end - start) / 60000;
        if (!VALID_DURATIONS.includes(duration)) return false;
        const hasDash = title.includes(' - ') || title.includes(' —') || /\w-\w/.test(title);
        if (!hasDash) return false;
        return (
          title.startsWith(fullName + ' -') ||
          title.startsWith(fullName + ' —') ||
          title.startsWith(fullName + '-')
        );
      }

      function eventMatchesFirst(e, firstName) {
        const title = e.summary || '';
        const start = new Date(e.start.dateTime);
        const end   = new Date(e.end.dateTime);
        const duration = (end - start) / 60000;
        if (!VALID_DURATIONS.includes(duration)) return false;
        const hasDash = title.includes(' - ') || title.includes(' —') || /\w-\w/.test(title);
        if (!hasDash) return false;
        return (
          title.startsWith(firstName + ' -') ||
          title.startsWith(firstName + ' —') ||
          title.startsWith(firstName + '-')
        );
      }

      // מפה: fullName → רשימת אירועים שתואמים שם מלא
      const fullNameMatchMap = {};
      active.forEach(item => {
        fullNameMatchMap[item.name] = allEvents.filter(e => eventMatchesFull(e, item.name));
      });

      // set של event IDs שכבר "שויכו" לשם מלא — לא זמינים לשם פרטי
      const claimedByFullName = new Set(
        Object.values(fullNameMatchMap).flat().map(e => e.id)
      );

      // ── STEP 2: חשב כל לקוח ──────────────────────────────────────────────
      const clients = active.map(item => {
        const fullName   = item.name;
        const firstName  = item.name.split(' ')[0];
        const purchased  = parseInt(item.column_values?.find(c => c.id === 'numeric_mky8ze04')?.text || '0') || 0;

        const fullMatched = fullNameMatchMap[fullName] || [];

        // firstName match — רק אם אין fullMatch לאותו לקוח,
        // ורק אירועים שלא תפוסים על ידי fullName של לקוח אחר
        const firstMatched = fullMatched.length === 0
          ? allEvents.filter(e => {
              if (claimedByFullName.has(e.id)) return false; // תפוס → דלג
              return eventMatchesFirst(e, firstName);
            })
          : [];

        const matched = [...fullMatched, ...firstMatched];

        const done = matched.length;
        const lastEvent = matched.sort((a, b) => new Date(b.start.dateTime) - new Date(a.start.dateTime))[0];
        const last = lastEvent ? new Date(lastEvent.start.dateTime).toLocaleDateString('he-IL') : '';
        const remaining = purchased > 0 ? purchased - done : null;
        const alert = remaining !== null && remaining <= 2;

        return { name: fullName, purchased, done, remaining, alert, last };
      });

      const doneTotal = clients.reduce((s, c) => s + c.done, 0);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, totalActive, doneTotal, clients }));

    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ─── /stats ───────────────────────────────────────────────────────────────
  // שכבת ספירה אחידה — מקור יחיד לכל המספרים בדשבורד
  // מחזיר: leads, advCount, stepupCount, sold + doneTotal מאותם אירועי יומן
  if (req.url?.startsWith('/stats')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const from = url.searchParams.get('from');
      const to   = url.searchParams.get('to');
      const timeMin = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
      const timeMax = to   ? new Date(to)   : new Date();
      timeMax.setHours(23, 59, 59);

      // מאנדיי + יומן במקביל
      const [mondayData, calEvents] = await Promise.all([
        getAllData(),
        getCalendarData(timeMin, timeMax),
      ]);

      // סינון לפי טווח — תמיד לפי אותה פונקציה
      function inRange(dateStr, col) {
        if (!dateStr) return false;
        const d = new Date(dateStr.replace(' ', 'T'));
        return !isNaN(d) && d >= timeMin && d <= timeMax;
      }

      const gv = (item, col) => item.column_values?.find(c => c.id === col)?.text || '';

      // לידים — לפי date_mm00ds06
      // לידים מבורד לידים לפי date_mm00ds06
      const leadsFromBoard = (mondayData.leads || []).filter(i => {
        const v = gv(i, 'date_mm00ds06');
        return v && inRange(v);
      });

      // לידים מ-STEP-UP לפי created_at (אין date_mm00ds06)
      const leadsFromStepup = (mondayData.stepup || []).filter(i => {
        return inRange(i.created_at);
      });

      // לידים ממכירות לפי date_mm00jx0c
      const leadsFromSales = (mondayData.sales || []).filter(i => {
        const v = gv(i, 'date_mm00jx0c');
        return v && inRange(v);
      });

      // לידים מליוויים לפי created_at
      const leadsFromCoaching = (mondayData.coaching || []).filter(i => {
        return inRange(i.created_at);
      });

      // איחוד — מניעת כפילויות לפי שם
      const seenNames = new Set(leadsFromBoard.map(i => i.name.trim().toLowerCase()));
      leadsFromStepup.forEach(i => {
        const n = i.name.trim().toLowerCase();
        if (!seenNames.has(n)) { seenNames.add(n); leadsFromBoard.push(i); }
      });
      leadsFromSales.forEach(i => {
        const n = i.name.trim().toLowerCase();
        if (!seenNames.has(n)) { seenNames.add(n); leadsFromBoard.push(i); }
      });
      leadsFromCoaching.forEach(i => {
        const n = i.name.trim().toLowerCase();
        if (!seenNames.has(n)) { seenNames.add(n); leadsFromBoard.push(i); }
      });

      const leads = leadsFromBoard;

      // STEP-UP מאנדיי — לפי date4 (להשוואת חודשים)
      const stepupMonday = (mondayData.stepup || []).filter(i => {
        const v = gv(i, 'date4');
        return v && inRange(v);
      });

      // מכירות — לפי date_mm00jx0c
      const sales = (mondayData.sales || []).filter(i => {
        const v = gv(i, 'date_mm00jx0c');
        return v && inRange(v);
      });
      const sold = sales.filter(i => gv(i, 'deal_stage') === 'נמכר ליווי').length;

      // נמכר ליווי לפי מקור — מעמודת color_mkvdnz23 בבורד מכירות
      const soldBySource = {};
      sales.filter(i => gv(i, 'deal_stage') === 'נמכר ליווי').forEach(i => {
        let src = gv(i, 'color_mkvdnz23') || 'שונות';
        if (src === 'Google' || src === 'Facebook') src = 'דף נחיתה פיסגה';
        if (!soldBySource[src]) soldBySource[src] = 0;
        soldBySource[src]++;
      });

      // יומן — כבר מסונן לפי timeMin/timeMax מהשרת
      const advCount    = calEvents.filter(e => e.type === 'ייעוץ').length;
      const stepupCount = calEvents.filter(e => e.type === 'step-up').length;
      const serviceCount = calEvents.filter(e => e.type === 'שירות').length;
      const coachingCount = calEvents.filter(e => e.type === 'ליווי').length;

      // STEP-UP לפי מקור — מעמודת dropdown_mm3w3bgt ישירות
      const stepupBySource = {};
      stepupMonday.forEach(i => {
        let src = gv(i, 'dropdown_mm3w3bgt') || 'שונות';
        if (src === 'Google' || src === 'Facebook') src = 'דף נחיתה פיסגה';
        if (!stepupBySource[src]) stepupBySource[src] = 0;
        stepupBySource[src]++;
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        range: { from: timeMin.toISOString(), to: timeMax.toISOString() },
        leads: leads.length,
        advCount,
        stepupCount,
        stepupMonday: stepupMonday.length,
        stepupBySource,  // STEP-UP לפי מקור
        soldBySource,    // נמכר ליווי לפי מקור
        sold,
        serviceCount,
        coachingCount,
      }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ─── /comm ────────────────────────────────────────────────────────────────
  if (req.url?.startsWith('/comm')) {
    try {
      const leadsQuery = `{
        boards(ids: 9949694708) {
          groups(ids: ["topics", "group_mky8hb65"]) {
            items_page(limit: 500) {
              items {
                id
                name
                created_at
                column_values(ids: ["lead_status", "date_mm00ds06", "color_mkvd5y1g", "lead_phone"]) { id text }
                updates(limit: 20) {
                  id
                  body
                  created_at
                }
              }
            }
          }
        }
      }`;

      const mondayRes = await fetchMonday(leadsQuery);
      const urlComm = new URL(req.url, 'http://localhost');
      const days = parseInt(urlComm.searchParams.get('days') || '60');
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const groups = mondayRes.data?.boards?.[0]?.groups || [];
      const items = groups.flatMap(g => g.items_page?.items || []);

      const leadsRaw = items.map(item => {
        const gv = (col) => item.column_values?.find(c => c.id === col)?.text || '';
        const dateStr = gv('date_mm00ds06');
        const leadDate = dateStr ? new Date(dateStr) : new Date(item.created_at);
        if (leadDate < sinceDate) return null;
        const status = gv('lead_status');
        const source = gv('color_mkvd5y1g');
        const phone = gv('lead_phone');

        const callUpdates = (item.updates || []).filter(u =>
          u.body && (
            u.body.includes('שיחה נענתה') ||
            u.body.includes('שיחה לא נענתה') ||
            u.body.includes('ניסיון שיחה') ||
            u.body.includes('משך זמן')
          )
        );

        let callStatus = 'לא טופל';
        let lastCallDate = null;
        let callCount = callUpdates.length;

        if (callUpdates.length > 0) {
          callUpdates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const last = callUpdates[0];
          lastCallDate = new Date(last.created_at).toLocaleDateString('he-IL');
          const body = last.body || '';

          const isAnswer = body.includes('שיחה נענתה') && !body.includes('שיחה לא נענתה');
          const isIncoming = body.includes('Caller is the Client');

          let durationMin = 0;
          const durMatch = body.match(/משך זמן[^\d]*(\d+):(\d+)/);
          if (durMatch) {
            durationMin = parseInt(durMatch[1]) + parseInt(durMatch[2]) / 60;
          }

          if (!isIncoming && isAnswer && durationMin >= 3) callStatus = 'טופל';
          else if (!isIncoming && isAnswer && durationMin < 3) callStatus = 'שיחה קצרה';
          else if (!isIncoming && !isAnswer) callStatus = 'לא ענה';
          else if (isIncoming && isAnswer && durationMin >= 3) callStatus = 'טופל';
          else if (isIncoming && isAnswer && durationMin < 3) callStatus = 'שיחה קצרה';
          else if (isIncoming && !isAnswer) callStatus = 'פספסנו';
        }

        const BOOKED_STATUSES = ['נקבעה שיחה', 'פגישת StepUp', 'נמכר ליווי', 'רלוונטי-העבר למכירות'];
        const hasBooked = BOOKED_STATUSES.includes(status);
        if (callStatus === 'לא טופל' && hasBooked) callStatus = 'נקבעה שיחה';

        return {
          id: item.id,
          name: item.name,
          status,
          source,
          leadDate: leadDate.toLocaleDateString('he-IL'),
          leadDateRaw: leadDate.getTime(), // FIX: שמור timestamp לצורך מיון אמין
          phone,
          callCount,
          callStatus,
          lastCallDate,
          hasBooked,
        };
      });

      const leads = leadsRaw.filter(l => l !== null);
      // FIX: מיון לפי timestamp — לא לפי string מפורמט (שגרם לבעיות)
      leads.sort((a, b) => b.leadDateRaw - a.leadDateRaw);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, leads }));

    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }


  // ─── /journey ─────────────────────────────────────────────────────────────
  // מסע הליד: פנייה → שיחות → ייעוץ → STEP-UP → רכישה
  if (req.url?.startsWith('/journey')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const from = url.searchParams.get('from') || new Date(new Date().getFullYear(), 4, 1).toISOString().slice(0,10); // מאי 2026
      const to   = url.searchParams.get('to')   || new Date().toISOString().slice(0,10);
      const timeMin = new Date(from);
      const timeMax = new Date(to); timeMax.setHours(23,59,59);

      // שלוף לידים + updates במקביל עם STEP-UP + מכירות
      const leadsQuery = `{
        boards(ids: 9949694708) {
          items_page(limit: 500) {
            items {
              id name created_at
              column_values(ids: ["lead_status","date_mm00ds06","color_mkvd5y1g","lead_phone"]) { id text }
              updates(limit: 30) { id body created_at }
            }
          }
        }
      }`;
      const stepupQuery = `{
        boards(ids: 9950584665) {
          items_page(limit: 500) {
            items {
              id name created_at
              column_values(ids: ["date4","lead_status","dropdown_mm3w3bgt","lead_phone","status"]) { id text }
              updates(limit: 30) { id body created_at }
            }
          }
        }
      }`;
      // שלוף גם קבוצת "נמכר ליווי" מבורד STEP-UP
      const stepupSoldQuery = `{
        boards(ids: 9950584665) {
          groups(ids: ["group_mkvdgsnn"]) {
            items_page(limit: 500) {
              items {
                id name created_at
                column_values(ids: ["date4","lead_status","dropdown_mm3w3bgt","lead_phone","status","date_mm00jx0c"]) { id text }
              }
            }
          }
        }
      }`;
      const salesQuery = `{
        boards(ids: 9949694887) {
          groups(ids: ["group_mm00znzx", "new_group29179"]) {
            items_page(limit: 500) {
              items { name column_values(ids: ["deal_stage","date_mm00jx0c"]) { id text } }
            }
          }
        }
      }`;

      const [leadsRes, stepupRes, salesRes, stepupSoldRes, calEventsRaw] = await Promise.all([
        fetchMonday(leadsQuery),
        fetchMonday(stepupQuery),
        fetchMonday(salesQuery),
        fetchMonday(stepupSoldQuery),
        getCalendarData(timeMin, timeMax),
      ]);

      const gv = (item, col) => item.column_values?.find(c => c.id === col)?.text || '';

      // סנן לידים מבורד לידים לפי טווח
      const allLeads = leadsRes.data?.boards?.[0]?.items_page?.items || [];
      const leadsFiltered = allLeads.filter(item => {
        const v = gv(item, 'date_mm00ds06');
        const d = v ? new Date(v) : new Date(item.created_at);
        return d >= timeMin && d <= timeMax;
      });

      // הוסף פריטים מ-STEP-UP שלא קיימים בלידים (לפי שם)
      const stepupItemsAll = stepupRes.data?.boards?.[0]?.items_page?.items || [];
      const existingNames = new Set(leadsFiltered.map(i => i.name.trim().toLowerCase()));
      const stepupOnlyItems = stepupItemsAll.filter(item => {
        const nameL = item.name.trim().toLowerCase();
        if (existingNames.has(nameL)) return false; // כבר קיים בלידים
        // סנן לפי תאריך פגישה (date4) בטווח
        const v = gv(item, 'date4');
        const d = v ? new Date(v.replace(' ','T')) : new Date(item.created_at);
        return d >= timeMin && d <= timeMax;
      }).map(item => ({
        // המר לפורמט של ליד
        ...item,
        _fromStepup: true,
        column_values: [
          ...item.column_values,
          { id: 'date_mm00ds06', text: gv(item, 'date4') }, // תאריך פגישה כתאריך פנייה
          { id: 'color_mkvd5y1g', text: gv(item, 'dropdown_mm3w3bgt') }, // מקור
        ]
      }));

      const leads = [...leadsFiltered, ...stepupOnlyItems];

      // בנה מפות שם → נתונים
      const stepupMap = {}; // שם מלא בלבד — מניעת התאמה שגויה לפי שם פרטי
      stepupItemsAll.forEach(item => {
        const d = gv(item, 'date4');
        const date = d ? new Date(d.replace(' ','T')) : null;
        stepupMap[item.name.trim().toLowerCase()] = { date, name: item.name };
      });

      // מכירות מבורד מכירות
      const salesGroups = salesRes.data?.boards?.[0]?.groups || [];
      const salesItems = salesGroups.flatMap(g => g.items_page?.items || []);
      const salesMap = {}; // שם מלא בלבד — מניעת התאמה שגויה לפי שם פרטי
      salesItems.forEach(item => {
        const d = gv(item, 'date_mm00jx0c');
        const stage = gv(item, 'deal_stage');
        salesMap[item.name.trim().toLowerCase()] = { date: d ? new Date(d) : null, stage, name: item.name };
      });
      // מכירות מבורד STEP-UP (קבוצת נמכר ליווי) — רק אם לא קיים כבר מבורד מכירות
      const stepupSoldItems = stepupSoldRes.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
      stepupSoldItems.forEach(item => {
        const nameL = item.name.trim().toLowerCase();
        if (salesMap[nameL]) return; // כבר קיים מבורד מכירות — דלג
        // תאריך רכישה = created_at של הפריט (מתי נוצר/הועבר לקבוצה)
        // activity_logs לא נתמך ישירות ב-items, נשתמש ב-created_at כקירוב
        let saleDate = new Date(item.created_at);
        salesMap[nameL] = { date: saleDate, stage: 'נמכר ליווי', name: item.name };
      });

      // אירועי ייעוץ מיומן — מפה לפי שם
      const consultEvents = calEventsRaw.filter(e => e.type === 'ייעוץ');
      const consultMap = {};
      consultEvents.forEach(e => {
        const key = e.client.trim().toLowerCase();
        if (!consultMap[key]) consultMap[key] = [];
        consultMap[key].push(e.start);
      });

      // בנה מסע לכל ליד
      const journey = leads.map(item => {
        const name = item.name;
        const nameL = name.trim().toLowerCase();
        const firstL = name.trim().split(' ')[0].toLowerCase();
        const status = gv(item, 'lead_status');
        const source = gv(item, 'color_mkvd5y1g');
        const phone  = gv(item, 'lead_phone');
        const dateStr = gv(item, 'date_mm00ds06');
        const leadDate = dateStr ? new Date(dateStr) : new Date(item.created_at);

        // שיחות מ-updates
        const callUpdates = (item.updates || []).filter(u =>
          u.body && (u.body.includes('שיחה נענתה') || u.body.includes('שיחה לא נענתה') || u.body.includes('ניסיון שיחה'))
        );
        callUpdates.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        const calls = callUpdates.map(u => {
          const body = u.body || '';
          const answered = body.includes('שיחה נענתה') && !body.includes('שיחה לא נענתה');
          const incoming = body.includes('Caller is the Client');
          let dur = 0;
          const m = body.match(/משך זמן[^\d]*(\d+):(\d+)/);
          if (m) dur = parseInt(m[1]) + parseInt(m[2])/60;
          return { date: new Date(u.created_at).toLocaleDateString('he-IL'), answered, incoming, dur: Math.round(dur) };
        });

        // ייעוץ מיומן
        const consultDates = (consultMap[nameL] || [])
          .map(d => new Date(d).toLocaleDateString('he-IL'));

        // STEP-UP — מהיומן בלבד (אמין יותר מהבורד — פגישות מבוטלות לא מופיעות)
        const calStepup = calEventsRaw.filter(e =>
          e.type === 'step-up' &&
          (e.client.trim().toLowerCase() === nameL ||
           e.client.trim().toLowerCase() === name.trim().split(' ')[0].toLowerCase())
        );
        const su = calStepup.length > 0
          ? { date: new Date(calStepup[0].start), name }
          : null;

        // רכישה — שם מלא בלבד
        const sale = salesMap[nameL] || null;
        const sold = sale?.stage === 'נמכר ליווי';

        return {
          id: item.id,
          name,
          phone,
          source: source === 'Google' || source === 'Facebook' ? 'דף נחיתה פיסגה' : source,
          leadDate: leadDate.toLocaleDateString('he-IL'),
          leadDateRaw: leadDate.getTime(),
          status,
          calls,        // מערך שיחות
          callCount: calls.length,
          consult: consultDates,       // תאריכי ייעוץ
          stepup: su ? su.date?.toLocaleDateString('he-IL') : null,
          sold,
          saleDate: sale?.date?.toLocaleDateString('he-IL') || null,
        };
      });

      journey.sort((a,b) => b.leadDateRaw - a.leadDateRaw);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, journey }));

    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ─── /health ──────────────────────────────────────────────────────────────
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

  // ─── /test-activity ───────────────────────────────────────────────────────
  if (req.url === '/test-activity') {
    try {
      const q = `{
        boards(ids: 9949694708) {
          items_page(limit: 3) {
            items {
              id name
              activity_logs(limit: 10) {
                id event data created_at
              }
            }
          }
        }
      }`;
      const r = await fetchMonday(q);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, data: r.data }, null, 2));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ─── index.html ───────────────────────────────────────────────────────────
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
