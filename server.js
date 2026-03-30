const http = require('http');
const https = require('https');

const MONDAY_TOKEN = process.env.MONDAY_TOKEN || '';
const PORT = process.env.PORT || 3000;

const BOARDS = {
  leads:    { id: 9949694708, cols: ['lead_status', 'color_mkvd5y1g'] },
  sales:    { id: 9949694887, cols: ['deal_stage', 'color_mkvdnz23', 'date_mm00jx0c'] },
  stepup:   { id: 9950584665, cols: ['status', 'date4'] },
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

async function getUpdates(itemId) {
  const query = `{ items(ids: ${itemId}) { updates(limit: 50) { body created_at } } }`;
  const res = await fetchMonday(query);
  return res.data?.items?.[0]?.updates || [];
}

const HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>לוח בקרה — ניר</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{--bg:#f4f5f7;--bg2:#fff;--bg3:#eef0f3;--border:#e2e5ea;--text:#1a1d23;--text2:#6b7280;--text3:#9ca3af;--green:#16a34a;--green-bg:#dcfce7;--green-b:#bbf7d0;--blue:#2563eb;--blue-bg:#dbeafe;--blue-b:#bfdbfe;--amber:#d97706;--amber-bg:#fef3c7;--purple:#7c3aed;--purple-bg:#ede9fe;--red:#dc2626;--red-bg:#fee2e2;--red-b:#fecaca;}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:20px 24px;}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;}
.header-title{font-size:22px;font-weight:700;}
.header-sub{font-size:13px;color:var(--text2);margin-top:2px;}
.header-right{display:flex;align-items:center;gap:10px;}
.live-badge{display:flex;align-items:center;gap:5px;background:var(--green-bg);border:1px solid var(--green-b);border-radius:20px;padding:4px 10px;font-size:12px;color:var(--green);}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}
.updated{font-size:12px;color:var(--text3);}
.btn{background:var(--bg2);border:1px solid var(--border);color:var(--text2);padding:6px 14px;border-radius:8px;font-size:13px;cursor:pointer;font-family:'Heebo',sans-serif;}
.tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
.tab{padding:7px 16px;border-radius:8px;font-size:13px;cursor:pointer;border:1px solid var(--border);color:var(--text2);background:var(--bg2);font-family:'Heebo',sans-serif;font-weight:500;}
.tab.active{background:var(--blue);color:#fff;border-color:var(--blue);}
.date-range{display:inline-flex;align-items:center;gap:6px;background:var(--blue-bg);border:1px solid var(--blue-b);border-radius:8px;padding:5px 12px;font-size:12px;color:var(--blue);margin-bottom:16px;}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px;}
.mc{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;}
.mc-label{font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:500;}
.mc-value{font-size:28px;font-weight:700;line-height:1;}
.mc-sub{font-size:11px;margin-top:5px;font-weight:500;}
.c-green{color:var(--green);}.c-blue{color:var(--blue);}.c-amber{color:var(--amber);}.c-purple{color:var(--purple);}.c-text2{color:var(--text2);}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px 18px;}
.card-title{font-size:11px;color:var(--text2);margin-bottom:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;}
.funnel{display:flex;flex-direction:column;gap:5px;}
.funnel-step{border-radius:8px;padding:9px 13px;display:flex;justify-content:space-between;align-items:center;}
.funnel-label{font-size:13px;font-weight:600;}
.funnel-right{display:flex;align-items:center;gap:8px;}
.funnel-num{font-size:16px;font-weight:700;}
.funnel-pct{font-size:11px;opacity:.8;}
.funnel-arr{font-size:9px;color:var(--text3);text-align:center;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:right;color:var(--text3);font-weight:500;padding:6px 4px;border-bottom:1px solid var(--border);font-size:11px;}
td{padding:7px 4px;color:var(--text);border-bottom:1px solid var(--bg3);}
tr:last-child td{border-bottom:none;}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600;}
.src-bar-wrap{height:3px;background:var(--border);border-radius:2px;margin-top:4px;}
.src-bar{height:100%;border-radius:2px;}
.months-grid{display:grid;gap:10px;margin-bottom:12px;}
.month-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;}
.month-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.month-name{font-size:14px;font-weight:700;}
.month-dates{font-size:11px;color:var(--text3);}
.month-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;}
.month-metric-val{font-size:18px;font-weight:700;}
.month-metric-lbl{font-size:10px;color:var(--text2);margin-top:1px;}
.err{background:var(--red-bg);border:1px solid var(--red-b);border-radius:10px;padding:12px 16px;font-size:13px;color:var(--red);margin-bottom:14px;}
.comm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;}
.comm-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;text-align:center;}
.comm-val{font-size:24px;font-weight:700;}
.comm-lbl{font-size:11px;color:var(--text2);margin-top:4px;}
</style>
</head>
<body>
<div id="app">
  <div class="header">
    <div>
      <div class="header-title">לוח בקרה — ניר</div>
      <div class="header-sub" id="sub">טוען...</div>
    </div>
    <div class="header-right">
      <div class="live-badge"><div class="live-dot"></div>זמן אמת</div>
      <span class="updated" id="upd"></span>
      <button class="btn" onclick="load()">⟳ רענן</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" onclick="go('today',this)">היום</button>
    <button class="tab" onclick="go('week',this)">שבוע</button>
    <button class="tab" onclick="go('month',this)">חודש זה</button>
    <button class="tab" onclick="go('compare',this)">השוואת חודשים</button>
    <button class="tab" onclick="go('comm',this)">📞 תקשורת</button>
  </div>
  <div class="date-range" id="dr">📅 טוען...</div>
  <div id="err" class="err" style="display:none"></div>
  <div id="content"></div>
</div>
<script>
const SRC=[
  {key:'אתר',label:'אתר',color:'#2563eb',bg:'#dbeafe'},
  {key:'דף נחיתה פיסגה',label:'פסגה',color:'#7c3aed',bg:'#ede9fe'},
  {key:'voicenter',label:'Voicenter',color:'#d97706',bg:'#fef3c7'},
  {key:'WhatsApp',label:'WhatsApp',color:'#16a34a',bg:'#dcfce7'},
  {key:'Google',label:'Google',color:'#dc2626',bg:'#fee2e2'},
  {key:'Calendly',label:'Calendly',color:'#0891b2',bg:'#cffafe'},
];
const ADV=['נקבעה שיחה','רלוונטי-העבר למכירות','פולאו-אפ','פגישת StepUp','נמכר ליווי'];
const MO=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
let range='today',data={};
const fd=d=>d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear();
const gv=(item,col)=>item.column_values?.find(c=>c.id===col)?.text||'';
function getDate(item,col){if(col){const v=gv(item,col);if(v&&v.trim())return new Date(v);}return item.created_at?new Date(item.created_at):null;}
function filter(items,r,col){
  const now=new Date();let s;
  if(r==='today'){s=new Date(now);s.setHours(0,0,0,0);}
  else if(r==='week'){s=new Date(now);s.setDate(now.getDate()-now.getDay());s.setHours(0,0,0,0);}
  else if(r==='month'){s=new Date(now.getFullYear(),now.getMonth(),1);}
  else return items;
  return items.filter(i=>{const d=getDate(i,col);return d&&d>=s;});
}
function label(r){
  const n=new Date();
  if(r==='today')return'היום · '+fd(n);
  if(r==='week'){const s=new Date(n);s.setDate(n.getDate()-n.getDay());return fd(s)+' — '+fd(n);}
  if(r==='month'){const s=new Date(n.getFullYear(),n.getMonth(),1);return MO[n.getMonth()]+' '+n.getFullYear()+' · '+fd(s)+' — '+fd(n);}
  if(r==='compare')return'השוואה בין חודשים · '+n.getFullYear();
  if(r==='comm')return'פעילות תקשורת Voicenter';
}
async function load(){
  document.getElementById('sub').textContent='טוען...';
  try{
    const res=await fetch('/data');const j=await res.json();
    if(!j.ok)throw new Error(j.error);
    data=j.data;document.getElementById('err').style.display='none';
    render();
    document.getElementById('upd').textContent='עודכן '+new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
  }catch(e){document.getElementById('err').style.display='block';document.getElementById('err').textContent='שגיאה: '+e.message;}
}
function go(r,el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');range=r;render();}
function render(){
  document.getElementById('dr').textContent='📅 '+label(range);
  document.getElementById('sub').textContent=label(range);
  if(range==='compare'){cmp();return;}
  if(range==='comm'){commTab();return;}
  const L=filter(data.leads||[],range,null),S=filter(data.sales||[],range,'date_mm00jx0c'),T=filter(data.stepup||[],range,'date4'),C=data.coaching||[],M=filter(data.sessions||[],range,null);
  const contact=L.length;
  const adv=L.filter(i=>ADV.includes(gv(i,'lead_status'))).length+S.filter(i=>['פגישת StepUp','נמכר ליווי','פולאו-אפ'].includes(gv(i,'deal_stage'))).length;
  const su=T.length;
  const sold=T.filter(i=>gv(i,'status')==='נמכר ליווי').length+S.filter(i=>gv(i,'deal_stage')==='נמכר ליווי').length;
  const sess=M.filter(i=>gv(i,'status')==='התקיימה').length;
  const c1=contact>0?Math.round(adv/contact*100):0,c2=adv>0?Math.round(su/adv*100):0,c3=su>0?Math.round(sold/su*100):0;
  const sm={};SRC.forEach(s=>sm[s.key]={c:0,a:0,su:0,sold:0});
  L.forEach(i=>{const s=gv(i,'color_mkvd5y1g');if(!sm[s])sm[s]={c:0,a:0,su:0,sold:0};sm[s].c++;if(ADV.includes(gv(i,'lead_status')))sm[s].a++;});
  document.getElementById('content').innerHTML=`
<div class="metrics">
  <div class="mc"><div class="mc-label">יצרו קשר</div><div class="mc-value c-blue">${contact}</div><div class="mc-sub c-text2">כניסות</div></div>
  <div class="mc"><div class="mc-label">שיחת ייעוץ</div><div class="mc-value c-green">${adv}</div><div class="mc-sub c-green">${c1}% המרה</div></div>
  <div class="mc"><div class="mc-label">פגישת STEP-UP</div><div class="mc-value c-amber">${su}</div><div class="mc-sub c-amber">${c2}% מהשיחות</div></div>
  <div class="mc"><div class="mc-label">רכישת ליווי</div><div class="mc-value c-purple">${sold}</div><div class="mc-sub c-purple">${c3}% מ-STEP-UP</div></div>
  <div class="mc"><div class="mc-label">פגישות ליווי</div><div class="mc-value c-text2">${sess}</div><div class="mc-sub c-text2">התקיימו</div></div>
</div>
<div class="row2">
  <div class="card"><div class="card-title">משפך המרה</div>${funnel(contact,adv,su,sold)}</div>
  <div class="card"><div class="card-title">פירוט מקורות</div>${srcTable(sm,contact)}</div>
</div>
<div class="card" style="margin-bottom:12px"><div class="card-title">ליוויים פעילים</div>${coach(C)}</div>`;
}
function funnel(contact,adv,su,sold){
  const steps=[
    {n:'יצרו קשר',v:contact,bg:'#dbeafe',t:'#1d4ed8',w:100},
    {n:'שיחת ייעוץ',v:adv,bg:'#dcfce7',t:'#15803d',w:82},
    {n:'פגישת STEP-UP',v:su,bg:'#fef3c7',t:'#b45309',w:66},
    {n:'רכישת ליווי',v:sold,bg:'#ede9fe',t:'#6d28d9',w:46},
  ];
  return '<div class="funnel">'+steps.map((s,i)=>{
    const p=contact>0?Math.round(s.v/contact*100):0;
    const cv=i>0&&steps[i-1].v>0?' · '+Math.round(s.v/steps[i-1].v*100)+'% מהשלב הקודם':'';
    return (i>0?'<div class="funnel-arr">▼</div>':'')+
      `<div class="funnel-step" style="background:${s.bg};width:${s.w}%"><span class="funnel-label" style="color:${s.t}">${s.n}</span><span class="funnel-right"><span class="funnel-num" style="color:${s.t}">${s.v}</span><span class="funnel-pct" style="color:${s.t}">${p}%${cv}</span></span></div>`;
  }).join('')+'</div>';
}
function srcTable(sm,total){
  const rows=SRC.map(s=>{
    const d=sm[s.key]||{c:0,a:0,su:0,sold:0};
    const pt=total>0?Math.round(d.c/total*100):0;
    const pa=d.c>0?Math.round(d.a/d.c*100):0;
    const ps=d.a>0?Math.round(d.su/d.a*100):0;
    const pl=d.su>0?Math.round(d.sold/d.su*100):0;
    const cv=d.c>0?Math.round(d.sold/d.c*100):0;
    const cc=cv>=30?'color:#16a34a;background:#dcfce7':cv>=15?'color:#d97706;background:#fef3c7':'color:#dc2626;background:#fee2e2';
    return `<tr>
      <td><span class="badge" style="background:${s.bg};color:${s.color}">${s.label}</span><div class="src-bar-wrap" style="width:80px;margin-top:3px"><div class="src-bar" style="width:${pt}%;background:${s.color}"></div></div></td>
      <td style="text-align:center;font-weight:600">${d.c}<div style="font-size:10px;color:#9ca3af">${pt}%</div></td>
      <td style="text-align:center">${d.a}<div style="font-size:10px;color:#9ca3af">${pa}%</div></td>
      <td style="text-align:center">${d.su}<div style="font-size:10px;color:#9ca3af">${ps}%</div></td>
      <td style="text-align:center;font-weight:700">${d.sold}<div style="font-size:10px;color:#9ca3af">${pl}%</div></td>
      <td style="text-align:center"><span class="badge" style="${cc}">${cv}%</span></td>
    </tr>`;
  }).join('');
  return `<table><tr><th>מקור</th><th style="text-align:center">קשר<br><span style="font-weight:400">% מסך</span></th><th style="text-align:center">ייעוץ<br><span style="font-weight:400">% המרה</span></th><th style="text-align:center">STEP-UP<br><span style="font-weight:400">% המרה</span></th><th style="text-align:center">ליווי<br><span style="font-weight:400">% המרה</span></th><th style="text-align:center">המרה<br><span style="font-weight:400">כוללת</span></th></tr>${rows}</table>`;
}
function coach(items){
  const active=items.filter(i=>gv(i,'status')==='פעיל');
  if(!active.length)return '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:16px 0">אין ליוויים פעילים</div>';
  return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">'+
    active.map(i=>`<div style="background:var(--bg3);border-radius:8px;padding:10px 12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">${i.name}</div><div style="font-size:11px;color:var(--green)">פעיל</div></div>`).join('')+'</div>';
}
function cmp(){
  const now=new Date();const md=[];
  for(let m=0;m<=now.getMonth();m++){
    const s=new Date(now.getFullYear(),m,1),e=new Date(now.getFullYear(),m+1,0,23,59,59);
    const inM=(arr,col)=>arr.filter(i=>{const d=col?new Date(gv(i,col)||''):new Date(i.created_at||'');if(isNaN(d))return false;return d>=s&&d<=e;});
    const L=inM(data.leads||[],null),S=inM(data.sales||[],'date_mm00jx0c'),T=inM(data.stepup||[],'date4');
    const c=L.length,a=L.filter(i=>ADV.includes(gv(i,'lead_status'))).length,su=T.length;
    const sold=T.filter(i=>gv(i,'status')==='נמכר ליווי').length+S.filter(i=>gv(i,'deal_stage')==='נמכר ליווי').length;
    if(c>0||m===now.getMonth())md.push({m,name:MO[m],s,e,c,a,su,sold});
  }
  const mx=Math.max(...md.map(d=>d.c),1),cols=Math.min(md.length,3);
  document.getElementById('content').innerHTML=`<div class="months-grid" style="grid-template-columns:repeat(${cols},1fr)">${md.map(d=>{
    const cv=d.c>0?Math.round(d.sold/d.c*100):0,bw=Math.round(d.c/mx*100),ed=d.m===now.getMonth()?fd(now):fd(d.e);
    return `<div class="month-card"><div class="month-header"><span class="month-name">${d.name}</span><span class="month-dates">${fd(d.s)} — ${ed}</span></div><div class="month-metrics"><div><div class="month-metric-val c-blue">${d.c}</div><div class="month-metric-lbl">קשר</div></div><div><div class="month-metric-val c-green">${d.a}</div><div class="month-metric-lbl">ייעוץ</div></div><div><div class="month-metric-val c-amber">${d.su}</div><div class="month-metric-lbl">STEP-UP</div></div><div><div class="month-metric-val c-purple">${d.sold} <span style="font-size:11px">${cv}%</span></div><div class="month-metric-lbl">ליווי</div></div></div><div class="src-bar-wrap" style="margin-top:8px"><div class="src-bar" style="width:${bw}%;background:#2563eb"></div></div></div>`;
  }).join('')}</div>`;
}
async function commTab(){
  document.getElementById('content').innerHTML='<div style="text-align:center;padding:30px;color:#6b7280">טוען נתוני תקשורת... זה עלול לקחת כ-30 שניות</div>';
  try{
    const res=await fetch('/comm');const j=await res.json();
    if(!j.ok)throw new Error(j.error);
    const {answered,missed,total,avgDuration}=j.stats;
    document.getElementById('content').innerHTML=`
      <div class="comm-stats">
        <div class="comm-card"><div class="comm-val c-blue">${total}</div><div class="comm-lbl">סה"כ שיחות</div></div>
        <div class="comm-card"><div class="comm-val c-green">${answered}</div><div class="comm-lbl">שיחות שנענו</div></div>
        <div class="comm-card"><div class="comm-val" style="color:var(--red)">${missed}</div><div class="comm-lbl">לא נענו</div></div>
        <div class="comm-card"><div class="comm-val c-amber">${avgDuration}</div><div class="comm-lbl">משך ממוצע</div></div>
      </div>
      <div class="card"><div class="card-title">פירוט לפי ליד</div>${j.table}</div>`;
  }catch(e){
    document.getElementById('content').innerHTML=`<div class="err">שגיאה: ${e.message}</div>`;
  }
}
load();
setInterval(load,5*60*1000);
</script>
</body>
</html>`;

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
  if (req.url === '/comm') {
    try {
      const leadsData = await getAllData();
      const leads = leadsData.leads || [];
      let answered=0,missed=0,total=0,totalSecs=0;
      const rows=[];
      for(const lead of leads.slice(0,100)){
        const updates = await getUpdates(lead.id||'');
        const vu=updates.filter(u=>u.body&&(u.body.includes('שיחה נענתה')||u.body.includes('ניסיון שיחה')));
        if(!vu.length)continue;
        vu.forEach(u=>{
          total++;
          if(u.body.includes('שיחה נענתה')){answered++;const m=u.body.match(/(\d+):(\d+)/);if(m)totalSecs+=parseInt(m[1])*60+parseInt(m[2]);}
          else missed++;
        });
        rows.push({name:lead.name,calls:vu.length});
      }
      const avg=answered>0?Math.round(totalSecs/answered):0;
      const avgDuration=Math.floor(avg/60)+':'+(avg%60).toString().padStart(2,'0');
      const table='<table><tr><th>ליד</th><th style="text-align:center">שיחות</th></tr>'+rows.map(r=>`<tr><td>${r.name}</td><td style="text-align:center">${r.calls}</td></tr>`).join('')+'</table>';
      res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
      res.end(JSON.stringify({ok:true,stats:{answered,missed,total,avgDuration},table}));
    } catch(e) {
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:e.message}));
    }
    return;
  }
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
