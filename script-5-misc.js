// SCORE WHEEL
// ════════════════════════════════════════
function drawProcessingWheel(id, size) {
  const cv = document.getElementById(id);
  if (!cv) return;
  cv.classList.add('wheel-processing');
  const ctx = cv.getContext('2d'), cx = size/2, cy = size/2, r = size/2-6, lw = size>80?9:size>60?7:5;
  // Draw static track
  ctx.clearRect(0,0,size,size);
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(200,210,205,.4)'; ctx.lineWidth = lw; ctx.stroke();
  // Draw spinning arc (about 1/3 of circle)
  ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2, Math.PI/6);
  ctx.strokeStyle = '#1a6b3c'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
  // Draw dots in center
  const fs = size>80?11:8;
  ctx.fillStyle = '#6b9e7e';
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('...', cx, cy);
}

function drawWheel(id,score,size,darkBg){
  const cv=document.getElementById(id);if(!cv)return;
  const ctx=cv.getContext('2d'),cx=size/2,cy=size/2,r=size/2-6,lw=size>80?9:size>60?7:5;
  ctx.clearRect(0,0,size,size);
  const trackCol = darkBg ? 'rgba(255,255,255,.2)' : '#e2e8e4';
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle=trackCol;ctx.lineWidth=lw;ctx.stroke();
  const col=score>=70?'#4ade80':score>=50?'#fbbf24':score>=30?'#fb923c':'#f87171';
  const textCol = darkBg ? 'white' : (score>=70?'#1a6b3c':score>=50?'#c9a84c':score>=30?'#d97706':'#c0392b');
  ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(Math.PI*2*score/100));ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();
  if(size>60){
    const bigFs=size>80?26:16;
    ctx.fillStyle=textCol;ctx.font=`800 ${bigFs}px Poppins,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(score,cx,cy);
    ctx.fillStyle=darkBg?'rgba(255,255,255,.5)':'#8fa197';
    ctx.font=`600 ${Math.round(bigFs*.42)}px Poppins,sans-serif`;
    ctx.fillText('/100',cx,cy+bigFs*.98);
  } else {
    ctx.fillStyle=textCol;ctx.font=`bold 11px Poppins,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(score,cx,cy);
  }
}

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
function stripFences(html) {
  if (!html) return '';
  // Remove code fences
  html = html.replace(/^```[a-z]*\n?/gim, '').replace(/```\s*$/gim, '').trim();
  // Convert markdown headings to HTML (safety net if Claude outputs markdown)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Convert markdown bold to HTML
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Convert markdown horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');
  // Convert markdown bullet points
  html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
  return html;
}

function highlightTierBreakdown(html) {
  // Wrap the tier breakdown block (Free Cash Flow through Final Decision) in a styled div
  return html.replace(
    /(<p[^>]*><b>Free Cash Flow:<\/b>[\s\S]*?<b>Compliance:<\/b>[^<]*<\/p>)/i,
    '<div class="tier-breakdown">$1</div>'
  );
}

// ══════════════════════════════════════════
// PLAID CUSTOMERS
// ══════════════════════════════════════════
let allPlaidCustomers = [];

async function loadPlaidCustomers() {
  const list = document.getElementById('plaid-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>';
  try {
    const data = await fbGet('reports.json');
    if (!data) { allPlaidCustomers = []; renderPlaidCustomers([]); return; }
    // Find all unique customers who used Plaid
    const seen = {};
    allPlaidCustomers = [];
    Object.entries(data).forEach(([id, r]) => {
      if (!r) return;
      const bankMethod = (r.applicationData?.bankMethod || r.bankMethod || r.filename || '').toLowerCase();
      const hasPlaidToken = !!(r.plaidAssetToken || r.plaidAccessToken);
      const isPlaid = bankMethod.includes('plaid') || hasPlaidToken;
      if (!isPlaid) return;
      const phone = r.applicationData?.phone || '';
      const email = r.applicationData?.email || '';
      const key = phone + email || r.name || id;
      if (!seen[key] || r.createdAt > seen[key].createdAt) {
        seen[key] = {
          firebaseId: id,
          name: r.name || `${r.applicationData.firstName||''} ${r.applicationData.lastName||''}`.trim(),
          phone: r.applicationData.phone || '',
          email: r.applicationData.email || '',
          date: r.date || '',
          lastReport: r.date || '',
          accessToken: r.plaidAccessToken || r.applicationData?.plaidAccessToken || '',
          assetToken: r.plaidAssetToken || '',
          createdAt: r.createdAt || 0,
          status: r.status || '',
          amount: r.amount || '',
        };
      }
    });
    allPlaidCustomers = Object.values(seen).sort((a,b) => b.createdAt - a.createdAt);
    renderPlaidCustomers(allPlaidCustomers);
  } catch(e) {
    list.innerHTML = `<div class="empty"><div class="empty-t">Error loading</div><div class="empty-s">${e.message}</div></div>`;
  }
}

function filterPlaidCustomers(q) {
  if (!q) { renderPlaidCustomers(allPlaidCustomers); return; }
  const lq = q.toLowerCase();
  renderPlaidCustomers(allPlaidCustomers.filter(c =>
    (c.name||'').toLowerCase().includes(lq) ||
    (c.phone||'').includes(lq) ||
    (c.email||'').toLowerCase().includes(lq)
  ));
}

function renderPlaidCustomers(list) {
  const el = document.getElementById('plaid-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-ic">🏦</div><div class="empty-t">No Plaid customers found</div><div class="empty-s">Customers who connect their bank via Plaid will appear here</div></div>';
    return;
  }
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    el.innerHTML = list.map(c => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div class="nbig">${c.name||'—'}</div>
            <div class="nsub" style="font-size:12px">${c.phone||''}</div>
            <div class="nsub" style="font-size:11px">${c.email||''}</div>
          </div>
          <span class="pill pill-${c.status?.toLowerCase()||'p'}">${c.status||'—'}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Last report: ${c.lastReport||'—'}</div>
        <div style="display:flex;gap:8px">
          <button onclick="openModal('${c.firebaseId}')" class="actbtn btn-gh" style="flex:1;font-size:12px;text-align:center">View</button>
          <button onclick="rerunPlaidReport('${c.firebaseId}','${c.accessToken}','${c.name}')" class="actbtn ${c.accessToken?'btn-ok':'btn-gh'}" style="flex:1;font-size:12px;text-align:center${c.accessToken?'':';opacity:.6'}">↺ Re-run</button>
        </div>
      </div>`).join('');
  } else {
    el.innerHTML = `<table>
    <thead><tr>
      <th>Customer</th>
      <th>Phone</th>
      <th>Last Report</th>
      <th>Status</th>
      <th>Action</th>
    </tr></thead>
    <tbody>${list.map(c => `<tr>
      <td><div class="nbig">${c.name||'—'}</div><div class="nsub">${c.email||''}</div></td>
      <td style="font-size:13px">${c.phone||'—'}</td>
      <td style="font-size:12px;color:var(--muted)">${c.lastReport||'—'}</td>
      <td><span class="pill pill-${c.status?.toLowerCase()||'p'}">${c.status||'—'}</span></td>
      <td>
        <button onclick="openModal('${c.firebaseId}')" class="actbtn btn-gh" style="font-size:11px;padding:5px 10px;margin-right:4px">View</button>
        ${c.accessToken ? `<button onclick="rerunPlaidReport('${c.firebaseId}','${c.accessToken}','${c.name}')" class="actbtn btn-ok" style="font-size:11px;padding:5px 10px">↺ Re-run Report</button>` : `<button onclick="alert('This customer needs to reconnect via the application form to generate a new report.')" class="actbtn btn-gh" style="font-size:11px;padding:5px 10px;opacity:.6">↺ Re-run Report</button>`}
      </td>
    </tr>`).join('')}
    </tbody>
  </table>`;
  }
}

async function rerunFromModal(fbId) {
  const a = apps.find(x => x.firebaseId === fbId);
  if (!a) return;
  closeModal();
  await rerunPlaidReport(fbId, a.plaidAccessToken || '', a.name || 'Customer');
}

async function rerunPlaidReport(fbId, accessToken, name) {
  if (!confirm(`Pull a fresh Plaid asset report for ${name}?\n\nThis will create a new underwriting report using their current bank data.`)) return;
  toast('Pulling fresh Plaid asset report...', '');
  try {
    const orig = await fbGet(`reports/${fbId}.json`);
    const now = new Date();
    const newRecord = {
      id: Date.now(),
      date: now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
      time: now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),
      createdAt: Date.now(),
      source: 'plaid-rerun',
      status: 'Processing',
      name: name,
      amount: orig?.amount || 'N/A',
      claudeDecision: '',
      reason: '',
      score: 0,
      filename: `Plaid Re-run — ${now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`,
      report: '',
      notes: '',
      profile: activeProfile,
      processingComplete: false,
      applicationData: orig?.applicationData || {},
      plaidAccessToken: accessToken,
      plaidAssetToken: '',
    };
    const newId = await saveReport(newRecord);
    toast('Fresh asset report requested — underwriting in progress...', 'ok');
    try {
      await fetch('/api/rerun-plaid', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({accessToken, firebaseId: newId, formData: orig?.applicationData || {}})
      });
    } catch(e) {}
    showView('dash', document.getElementById('nav-dash'));
    setTimeout(loadReports, 2000);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}



// ══ RIGHT-CLICK CONTEXT MENU ══
let ctxFbId = null;

function showCtxMenu(e, fbId) {
  e.preventDefault();
  ctxFbId = fbId;
  const a = apps.find(x => x.firebaseId === fbId);
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-name').textContent = a?.name || 'Application';
  menu.style.display = 'block';
  // Position near cursor
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 220);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

async function ctxAction(action) {
  const menu = document.getElementById('ctx-menu');
  menu.style.display = 'none';
  if (!ctxFbId) return;
  if (action === 'open') { openModal(ctxFbId); }
  else if (action === 'approve') { await updStatus(ctxFbId, 'Approved'); }
  else if (action === 'decline') { await updStatus(ctxFbId, 'Declined'); }
  else if (action === 'denial') { openDenialModal(ctxFbId); }
  else if (action === 'delete') { await delApp(ctxFbId); }
  ctxFbId = null;
}

document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });
document.addEventListener('scroll', () => { document.getElementById('ctx-menu').style.display = 'none'; });

// ══ DENIAL EMAIL ══
const DENIAL_REASONS = [
  "Insufficient income to support a cash advance loan",
  "No verified income in statement period",
  "Excessive payday/advance activity",
  "Excessive NSF/returned items",
  "Chronic negative balance",
  "Low average daily balance",
  "Account closed",
  "Fraud indication",
  "Identity mismatch",
  "Bank statement outside acceptable window",
  "Excessive speculative activity",
  "Inability to demonstrate repayment without hardship",
  "Incomplete or unreadable bank statement"
];

const DENIAL_KEYWORD_MAP = [
  { keywords: ['income','pay','gross','salary','employment','wages'], reasons: [0,1] },
  { keywords: ['nsf','returned','insufficient fund','bounced'], reasons: [3] },
  { keywords: ['negative','below zero','overdraft'], reasons: [4] },
  { keywords: ['balance','low','average daily'], reasons: [5] },
  { keywords: ['closed','account close'], reasons: [6] },
  { keywords: ['fraud','suspicious','unusual'], reasons: [7] },
  { keywords: ['identity','mismatch','name','id'], reasons: [8] },
  { keywords: ['fintech','advance','dave','brigit','earnin','payday','cash advance'], reasons: [2] },
  { keywords: ['speculative','gambling','crypto','betting'], reasons: [10] },
  { keywords: ['repayment','hardship','afford','cash flow','fcf'], reasons: [11] },
  { keywords: ['statement','window','30 day','period','outside'], reasons: [9,12] },
];

let denialFbId = null;
let denialEmail = '';
let denialName = '';

function openDenialModal(fbId) {
  const a = apps.find(x => x.firebaseId === fbId);
  if (!a) return;
  denialFbId = fbId;
  denialEmail = a.applicationData?.email || '';
  denialName = a.name || '';

  document.getElementById('denial-to-label').textContent = 'To: ' + (denialEmail || 'No email on file');
  document.getElementById('denial-email-display').textContent = denialEmail || 'No email address found';

  // Auto-select reasons based on Claude decline reason
  const declineReason = (a.reason || '').toLowerCase();
  const autoSelected = new Set();
  DENIAL_KEYWORD_MAP.forEach(({keywords, reasons}) => {
    if (keywords.some(k => declineReason.includes(k))) {
      reasons.forEach(r => autoSelected.add(r));
    }
  });
  // If nothing matched, default to reason 0 (insufficient income) as fallback
  if (autoSelected.size === 0) autoSelected.add(0);

  // Render checkboxes
  const container = document.getElementById('denial-reasons');
  container.innerHTML = DENIAL_REASONS.map((r, i) => `
    <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;padding:10px 12px;border:1px solid ${autoSelected.has(i)?'var(--green-border)':'var(--border)'};border-radius:9px;background:${autoSelected.has(i)?'var(--green-light)':'white'};transition:all .15s" id="denial-row-${i}">
      <input type="checkbox" id="denial-chk-${i}" ${autoSelected.has(i)?'checked':''} onchange="updateDenialRow(${i})"
        style="width:16px;height:16px;margin-top:2px;accent-color:var(--green);cursor:pointer;flex-shrink:0">
      <span style="font-size:13px;color:var(--text2);line-height:1.5">${r}</span>
    </label>`).join('');

  document.getElementById('denial-ov').style.display = 'flex';
}

function updateDenialRow(i) {
  const chk = document.getElementById('denial-chk-'+i);
  const row = document.getElementById('denial-row-'+i);
  if (chk.checked) {
    row.style.borderColor = 'var(--green-border)';
    row.style.background = 'var(--green-light)';
  } else {
    row.style.borderColor = 'var(--border)';
    row.style.background = 'white';
  }
}

function closeDenialModal() {
  document.getElementById('denial-ov').style.display = 'none';
  denialFbId = null;
}

async function sendDenialEmail() {
  if (!denialEmail) { toast('No email address on file for this customer', 'err'); return; }
  const selectedReasons = DENIAL_REASONS.filter((_, i) => document.getElementById('denial-chk-'+i)?.checked);
  if (selectedReasons.length === 0) { toast('Please select at least one denial reason', 'err'); return; }

  const btn = document.getElementById('denial-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const resp = await fetch('/api/send-denial', {
      method: 'POST',
      credentials: 'include',
      headers: {...authHeaders(), 'Content-Type':'application/json'},
      body: JSON.stringify({email: denialEmail, name: denialName, reasons: selectedReasons})
    });
    const data = await resp.json();
    if (data.ok) {
      toast('Denial email sent to ' + denialEmail + ' ✓', 'ok');
      closeDenialModal();
    } else {
      toast('Error: ' + (data.error||'Unknown error'), 'err');
    }
  } catch(e) {
    toast('Failed to send: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Denial Email';
  }
}

async function logout() {
  try {
    await fetch('/api/logout', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json','X-Session':getToken()}});
  } catch(e){}
  sessionStorage.removeItem('cif_token');
  sessionStorage.removeItem('cif_user');
  document.cookie = 'cif_token=; Path=/; Max-Age=0';
  window.location.replace('/');
}



function toB64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});}
function fmtSz(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}
function showReTab(tab) {
  document.querySelectorAll('.re-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.re-tab-content').forEach(c => c.style.display='none');
  document.getElementById('retab-'+tab).classList.add('active');
  document.getElementById('retab-content-'+tab).style.display='';
  // Update tier preview cards
  if(tab==='fcf'){
    ['t1','t2','t3','t4'].forEach(t=>{
      const el=document.getElementById('prev-'+t);
      const inp=document.getElementById('r-'+t+'-fcf');
      if(el&&inp) el.textContent=inp.value;
    });
  }
}

function toggleAnalysisDD(){
  const dd = document.getElementById('analysis-dd');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('analysis-dd-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('analysis-dd').style.display = 'none';
});

function toggleMobMenu(){
  const menu=document.getElementById('mob-menu');
  if(menu)menu.style.display=menu.style.display==='none'?'block':'none';
}

function toast(msg,type=''){const t=document.getElementById('toastel');t.textContent=msg;t.className='toast '+(type||'')+' show';clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3200);}
