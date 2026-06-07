/* 04_app.js — part 4 of 4 of the dashboard JS bundle.
 * Extracted from app.html in v3 Phase 0.6 (claude/plan-engine-reporting-v3-9HciJ).
 *
 * Loaded in order via <script src> tags in app.html. Splitting was a
 * tooling-imposed workaround for tool-call payload size limits in the
 * MCP push_files tool — semantically this is one file. Phase C reporting
 * work can re-merge or further modularize as needed.
 */

  const detailActive = document.getElementById('view-detail')?.classList.contains('active');
  const overlayOpen = document.getElementById('ov')?.classList.contains('open');

  if (detailActive) {
    _currentModalFbId = null;
    // When invoked by the router (e.g., during popstate), the caller is
    // about to render the next view — don't double-navigate.
    if (!opts.fromRouter) {
      showView('dash', document.getElementById('nav-dash'));
    }
    return;
  }

  if (overlayOpen) {
    document.getElementById('ov').classList.remove('open');
    _currentModalFbId = null;
    return;
  }

  // Fallback — sync URL off a stale #/app/<id> hash.
  _currentModalFbId = null;
  if (location.hash && location.hash.startsWith('#/app/')) {
    history.pushState(null, '', VIEW_TO_HASH.dash);
  }
}
function closeModalOut(e){if(e.target===document.getElementById('ov'))closeModal();}

// ════════════════════════════════════════
// KEYBOARD SHORTCUTS
// A — approve open modal    D — decline open modal
// J / K — next / previous row on the dashboard (vim-style)
// Enter — open selected row's modal
// / — focus search box
// Esc — close modal (via native behavior already wired)
// ? — show shortcut cheat sheet
// ════════════════════════════════════════
let _currentModalFbId = null;
let _dashCursor = -1;  // index into the currently-rendered filtered list

function _dashVisibleApps() {
  // Mirrors the filter in renderDash() so keyboard navigation matches what's on screen.
  return applyQuickFilter(apps.filter(a =>
    (!srch || a.name?.toLowerCase().includes(srch.toLowerCase())) &&
    (!stFilter || a.status === stFilter)
  ));
}

function _highlightDashRow(fbId) {
  document.querySelectorAll('#dtable tr[data-kbd]').forEach(r => r.classList.remove('kbd-focus'));
  if (!fbId) return;
  const row = document.querySelector(`#dtable tr[data-kbd="${fbId}"]`);
  if (row) { row.classList.add('kbd-focus'); row.scrollIntoView({block:'nearest', behavior:'smooth'}); }
}

function _moveDashCursor(delta) {
  const list = _dashVisibleApps();
  if (!list.length) return;
  _dashCursor = Math.max(0, Math.min(list.length - 1, (_dashCursor < 0 ? 0 : _dashCursor + delta)));
  _highlightDashRow(list[_dashCursor]?.firebaseId);
}

function showShortcutHelp() {
  const existing = document.getElementById('kbd-help');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.id = 'kbd-help';
  panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9000;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.2);padding:16px 18px;font-size:12px;line-height:1.7;max-width:260px';
  panel.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">Keyboard shortcuts <button onclick="document.getElementById('kbd-help').remove()" style="border:0;background:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1">&times;</button></div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
      <kbd>J</kbd><span>Next row</span>
      <kbd>K</kbd><span>Previous row</span>
      <kbd>Enter</kbd><span>Open selected row</span>
      <kbd>A</kbd><span>Approve (in modal)</span>
      <kbd>D</kbd><span>Decline (in modal)</span>
      <kbd>/</kbd><span>Focus search</span>
      <kbd>Esc</kbd><span>Close modal</span>
      <kbd>?</kbd><span>Toggle this help</span>
    </div>`;
  document.body.appendChild(panel);
}

document.addEventListener('keydown', (e) => {
  // Don't hijack keys when the user is typing in an input/textarea/contenteditable.
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing && e.key !== 'Escape') return;

  const overlayOpen = document.getElementById('ov')?.classList.contains('open');
  const detailActive = document.getElementById('view-detail')?.classList.contains('active');
  const onAppDetail = detailActive && _currentModalFbId;

  // Esc — close the detail page or overlay modal.
  if (e.key === 'Escape' && (overlayOpen || detailActive)) { closeModal(); e.preventDefault(); return; }

  // On the application detail page: approve / decline directly.
  if (onAppDetail) {
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      updStatus(_currentModalFbId, 'Approved');
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      updStatus(_currentModalFbId, 'Declined');
      return;
    }
  }

  // On dashboard only (not when the overlay or detail page is active).
  if (!overlayOpen && !detailActive) {
    const dashActive = document.getElementById('view-dash')?.classList.contains('active');
    if (!dashActive) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); _moveDashCursor(1); return; }
    if (e.key === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); _moveDashCursor(-1); return; }
    if (e.key === 'Enter') {
      const list = _dashVisibleApps();
      if (_dashCursor >= 0 && list[_dashCursor]) openModal(list[_dashCursor].firebaseId);
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      const input = document.querySelector('#view-dash input[placeholder*="earch" i], #view-dash input[type="text"]');
      if (input) input.focus();
      return;
    }
    if (e.key === '?') { e.preventDefault(); showShortcutHelp(); return; }
  }
});

// ════════════════════════════════════════
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

// ═════════════════════════════════════════
// PLAID CUSTOMERS
// ═════════════════════════════════════════
// Customer-keyed view: one row per (phone+email) customer, expandable to
// show every application that customer has ever submitted with their Plaid
// status and a working "Re-run Report" button per application. Drops the
// previous "latest only" dedup so re-applicants don't disappear.
let allPlaidCustomers = [];

function plaidCustomerKey(phone, email) {
  const p = (phone || '').replace(/\D/g, '');
  const e = (email || '').trim().toLowerCase();
  return (p + '|' + e) || null;
}

async function loadPlaidCustomers() {
  const list = document.getElementById('plaid-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>';
  try {
    const data = await fbGet('reports.json');
    if (!data) { allPlaidCustomers = []; renderPlaidCustomers([]); return; }
    // Group every Plaid-bearing record by (phone+email) customer key.
    const groups = {};
    Object.entries(data).forEach(([id, r]) => {
      if (!r) return;
      const bankMethod = (r.applicationData?.bankMethod || r.bankMethod || r.filename || '').toLowerCase();
      const hasPlaidToken = !!(r.plaidAssetToken || r.plaidAccessToken);
      const isPlaid = bankMethod.includes('plaid') || hasPlaidToken;
      if (!isPlaid) return;
      const phone = r.applicationData?.phone || '';
      const email = r.applicationData?.email || '';
      const fallbackName = r.name || `${r.applicationData?.firstName||''} ${r.applicationData?.lastName||''}`.trim();
      const key = plaidCustomerKey(phone, email) || fallbackName || id;
      const app = {
        firebaseId: id,
        date: r.date || '',
        time: r.time || '',
        createdAt: r.createdAt || 0,
        accessToken: r.plaidAccessToken || r.applicationData?.plaidAccessToken || '',
        assetToken: r.plaidAssetToken || '',
        status: r.status || '',
        amount: r.amount || '',
        decision: r.claudeDecision || '',
      };
      if (!groups[key]) {
        groups[key] = {
          key,
          name: fallbackName,
          phone,
          email,
          applications: [],
        };
      }
      groups[key].applications.push(app);
      // Customer-level fields take the latest non-empty value.
      if (!groups[key].name && fallbackName) groups[key].name = fallbackName;
    });
    // Sort applications within each customer newest-first; sort customers
    // by their latest application date.
    allPlaidCustomers = Object.values(groups)
      .map(g => {
        g.applications.sort((a, b) => (b.createdAt||0) - (a.createdAt||0));
        const latest = g.applications[0] || {};
        g.latestStatus = latest.status || '';
        g.latestDate = latest.date || '';
        g.latestCreatedAt = latest.createdAt || 0;
        g.totalApps = g.applications.length;
        return g;
      })
      .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
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

function _renderPlaidAppRow(app, isMobile) {
  const pill = `<span class="pill pill-${(app.status||'p').toLowerCase()}">${app.status||'—'}</span>`;
  const stamp = `${app.date||'—'}${app.time?(' • '+app.time):''}`;
  const tokenBadge = app.accessToken
    ? '<span style="font-size:10px;color:#5a7a3a;background:#e8f3d8;padding:2px 6px;border-radius:3px">access_token ✓</span>'
    : (app.assetToken
        ? '<span style="font-size:10px;color:#7a6a3a;background:#f5ecd0;padding:2px 6px;border-radius:3px">asset_token only</span>'
        : '<span style="font-size:10px;color:#a44;background:#fbe6e6;padding:2px 6px;border-radius:3px">no token</span>');
  const refreshBtn = app.accessToken
    ? `<button onclick="event.stopPropagation();refreshFromPlaid('${app.firebaseId}')" id="plaidref-${app.firebaseId}" class="actbtn btn-gh" style="font-size:11px;padding:5px 10px">Refresh from Plaid &amp; Re-run</button>`
    : `<button disabled title="No access_token stored on this record — applicant must reconnect via the application form." class="actbtn btn-gh" style="font-size:11px;padding:5px 10px;opacity:.5;cursor:not-allowed">Refresh (no token)</button>`;
  if (isMobile) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-top:1px solid var(--border);font-size:12px;gap:8px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
        <div style="display:flex;gap:6px;align-items:center">${pill}<span style="color:var(--muted)">${stamp}</span></div>
        <div>${tokenBadge}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="event.stopPropagation();openModal('${app.firebaseId}')" class="actbtn btn-gh" style="font-size:11px;padding:5px 10px">View</button>
        ${refreshBtn}
      </div>
    </div>`;
  }
  return `<tr style="background:var(--bg);font-size:12px">
    <td style="padding-left:32px;color:var(--muted)">${stamp}</td>
    <td>${pill}</td>
    <td>${tokenBadge}</td>
    <td style="text-align:right">
      <button onclick="event.stopPropagation();openModal('${app.firebaseId}')" class="actbtn btn-gh" style="font-size:11px;padding:5px 10px;margin-right:4px">View</button>
      ${refreshBtn}
    </td>
  </tr>`;
}

function renderPlaidCustomers(list) {
  const el = document.getElementById('plaid-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-ic"><svg class="icn icn-lg" style="width:36px;height:36px;color:var(--muted2)"><use href="#icn-bank"/></svg></div><div class="empty-t">No Plaid customers found</div><div class="empty-s">Customers who connect their bank via Plaid will appear here</div></div>';
    return;
  }
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    el.innerHTML = list.map(c => `
      <details style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden">
        <summary style="padding:16px;cursor:pointer;list-style:none">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="min-width:0;flex:1">
              <div class="nbig">${c.name||'—'}</div>
              <div class="nsub" style="font-size:12px">${c.phone||''}</div>
              <div class="nsub" style="font-size:11px">${c.email||''}</div>
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
              <span class="pill pill-${(c.latestStatus||'p').toLowerCase()}">${c.latestStatus||'—'}</span>
              <span style="font-size:11px;color:var(--muted)">${c.totalApps} app${c.totalApps>1?'s':''}</span>
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px">Latest: ${c.latestDate||'—'} • click to expand</div>
        </summary>
        ${c.applications.map(a => _renderPlaidAppRow(a, true)).join('')}
      </details>`).join('');
  } else {
    el.innerHTML = `<table>
    <thead><tr>
      <th style="width:30px"></th>
      <th>Customer</th>
      <th>Phone</th>
      <th>Latest Report</th>
      <th>Apps</th>
      <th>Latest Status</th>
    </tr></thead>
    <tbody>${list.map((c, i) => `
      <tr style="cursor:pointer" onclick="togglePlaidGroup('${i}')">
        <td><span id="plaid-chev-${i}" style="display:inline-block;transition:transform .15s">▶</span></td>
        <td><div class="nbig">${c.name||'—'}</div><div class="nsub">${c.email||''}</div></td>
        <td style="font-size:13px">${c.phone||'—'}</td>
        <td style="font-size:12px;color:var(--muted)">${c.latestDate||'—'}</td>
        <td><span class="pill" style="background:var(--bg);border:1px solid var(--border)">${c.totalApps}</span></td>
        <td><span class="pill pill-${(c.latestStatus||'p').toLowerCase()}">${c.latestStatus||'—'}</span></td>
      </tr>
      <tr id="plaid-apps-${i}" style="display:none">
        <td colspan="6" style="padding:0">
          <table style="width:100%;border-top:1px solid var(--border)">
            <thead><tr style="background:var(--bg);font-size:11px;color:var(--muted)">
              <th style="text-align:left;padding-left:32px;font-weight:500">When</th>
              <th style="text-align:left;font-weight:500">Status</th>
              <th style="text-align:left;font-weight:500">Plaid token</th>
              <th style="text-align:right;font-weight:500;padding-right:8px">Action</th>
            </tr></thead>
            <tbody>${c.applications.map(a => _renderPlaidAppRow(a, false)).join('')}</tbody>
          </table>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  }
}

function togglePlaidGroup(i) {
  const row = document.getElementById('plaid-apps-' + i);
  const chev = document.getElementById('plaid-chev-' + i);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
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
  // Income-related decline reasons
  { keywords: ['no verified', 'no payroll', 'income source stale', 'no income deposit'], reasons: [1] },
  { keywords: ['stated income anomaly', 'stated income materially', 'income unverifiable'], reasons: [0, 1] },
  { keywords: ['insufficient', 'below the minimum tier', 'free cash flow', 'fcf', 'outflows exceed', 'monthly outflows', 'repayment', 'hardship', 'afford', 'cash flow'], reasons: [11] },
  // Stability decline reasons
  { keywords: ['nsf', 'returned', 'insufficient fund', 'bounced'], reasons: [3] },
  { keywords: ['negative balance', 'negative days', 'overdraft pattern', 'ending negative', 'ended negative'], reasons: [4] },
  { keywords: ['low ending', 'avg daily balance', 'low average daily', 'low balance'], reasons: [5] },
  // Stacking / fintech / payday
  { keywords: ['fintech stacking', 'cash-advance apps', 'severe fintech', 'extreme fintech', 'payday-loan stacking', 'acute payday'], reasons: [2] },
  { keywords: ['bnpl', 'installment payments', 'buy now pay later'], reasons: [2] },
  // Fraud / identity
  { keywords: ['fraud', 'suspicious', 'unusual'], reasons: [7] },
  { keywords: ['identity', 'mismatch', 'wrong account', 'self-transfer'], reasons: [8] },
  // Speculative / gambling
  { keywords: ['speculative', 'gambling', 'crypto', 'skill-gaming', 'lottery'], reasons: [10] },
  // Statement quality
  { keywords: ['reconciliation', 'extraction unreliable', 'too few transactions', 'insufficient data', 'incomplete', 'unreadable'], reasons: [12] },
  { keywords: ['statement', 'window', '30 day', '60 day', 'outside'], reasons: [9] },
  // Active competing loan
  { keywords: ['competing loan', 'fresh loan', 'rollover'], reasons: [2] },
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

  // Pass 1: text-based keyword matching against the engine's decline
  // reason string. Catches the named decline drivers ("severe fintech
  // stacking", "acute payday-loan stacking", "reconciliation failed",
  // etc.) that the engine surfaces in plain English.
  DENIAL_KEYWORD_MAP.forEach(({keywords, reasons}) => {
    if (keywords.some(k => declineReason.includes(k))) {
      reasons.forEach(r => autoSelected.add(r));
    }
  });

  // Pass 2: data-driven signals. The text may not always include every
  // applicable reason (the engine only surfaces the top 1-2 drivers
  // verbatim) but the numeric metrics on the report tell the whole
  // story. Mirror the engine's traffic-light logic so the operator
  // gets every FCRA-applicable reason pre-checked.
  const fcf = Number(a.fcf || 0);
  const monthlyIncome = Number(a.monthlyIncome || a.monthly_income || 0);
  const monthlyExpenses = Number(a.monthlyExpenses || a.monthly_expenses || 0);
  const nsfCount = Number(a.nsfCount || a.nsf_count || 0);
  const fintechCount = Number(a.fintechCount || a.fintech_count || 0);

  // Capacity: negative FCF → can't demonstrate repayment without hardship.
  if (fcf < 0) {
    autoSelected.add(11);
  }
  // Capacity follow-on: when income is genuinely tiny ($0-500/mo) the
  // primary issue is "insufficient income", not just FCF math.
  if (monthlyIncome > 0 && monthlyIncome < 500) {
    autoSelected.add(0);
  }
  if (monthlyIncome <= 0) {
    autoSelected.add(1);
  }
  // Stability: bounced/NSF count signals.
  if (nsfCount >= 3) {
    autoSelected.add(3);
  }
  // Stacking: heavy fintech count.
  if (fintechCount >= 5) {
    autoSelected.add(2);
  }
  // Severe over-spend: obligations > 1.5x income is a structural mismatch.
  if (monthlyIncome > 0 && monthlyExpenses > monthlyIncome * 1.5) {
    autoSelected.add(11);
  }

  // Sensible fallback when neither pass produced anything: the FCRA-
  // compliant catch-all is "Inability to demonstrate repayment without
  // hardship" (reason 11). It's more accurate than the old "Insufficient
  // income" default (reason 0) because most engine declines actually
  // come from the cashflow side, not income side.
  if (autoSelected.size === 0) autoSelected.add(11);

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
    await fetch('/api/logout', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}});
  } catch(e){}
  // Clear any lingering legacy client-side state.
  try { sessionStorage.removeItem('cif_token'); sessionStorage.removeItem('cif_user'); } catch(e){}
  window.location.replace('/');
}

// ════════════════════════════════════════
// USER MANAGEMENT (admin-only) + SELF PASSWORD CHANGE
// ════════════════════════════════════════
async function loadUsers() {
  const box = document.getElementById('users-table');
  if (!box) return;
  box.innerHTML = `<div style="padding:40px;text-align:center;color:#888">Loading users…</div>`;
  try {
    const r = await fetch('/api/users', { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) { box.innerHTML = `<div style="padding:30px;text-align:center;color:#c0392b">${d.error || 'Failed to load'}</div>`; return; }
    renderUsers(d.users || []);
  } catch (e) {
    box.innerHTML = `<div style="padding:30px;text-align:center;color:#c0392b">Error: ${e.message}</div>`;
  }
}

function renderUsers(users) {
  const box = document.getElementById('users-table');
  if (!users.length) {
    box.innerHTML = `<div class="empty" style="padding:3rem;text-align:center"><div class="empty-ic"><svg class="icn icn-lg" style="width:36px;height:36px;color:var(--muted2)"><use href="#icn-users"/></svg></div><div class="empty-t">No users yet</div><div class="empty-s">Click "Add User" to create the first one.</div></div>`;
    return;
  }
  const rows = users.map(u => {
    const when = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() + ' ' + new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
    const rolePill = u.role === 'admin'
      ? '<span class="pill pill-info">admin</span>'
      : '<span class="pill pill-muted">user</span>';
    const sourcePill = u.source === 'firebase'
      ? '<span class="pill pill-ok">editable</span>'
      : '<span class="pill pill-warn">env-var</span>';
    const isSelf = u.username === _currentUser;
    const isEnv = u.source !== 'firebase';
    // Usernames are validated server-side to /^[a-z0-9_.-]{2,32}$/ so inline
    // interpolation in onclick attributes is safe. JSON.stringify breaks the
    // attribute because of embedded double quotes.
    const u_name = u.username;
    const actions = isEnv
      ? `<button class="actbtn" style="padding:4px 12px;font-size:12px;background:#fff8e5;color:#6b4d00;border:1px solid #f2d46c;font-weight:600" onclick="migrateEnvUser('${u_name}')" title="Copy this env-var user to Firebase so you can reset or delete them here. Their current password keeps working.">Migrate to Firebase</button>`
      : `
        <button class="actbtn btn-gh" style="padding:4px 10px;font-size:12px" onclick="openResetUserModal('${u_name}')">Reset password</button>
        ${isSelf ? '' : `<button class="actbtn btn-gh" style="padding:4px 10px;font-size:12px;margin-left:4px" onclick="changeUserRole('${u_name}','${u.role || 'user'}')">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>`}
        ${isSelf ? '' : `<button class="actbtn" style="padding:4px 10px;font-size:12px;background:#fff5f5;color:var(--red);border:1px solid var(--red-border);margin-left:4px" onclick="deleteUser('${u_name}')">Delete</button>`}
      `;
    return `<tr>
      <td style="padding:10px 12px"><b>${escHtml(u.username)}</b>${isSelf ? ' <span style="font-size:10px;color:var(--muted);font-weight:400">(you)</span>' : ''}</td>
      <td style="padding:10px 12px">${rolePill}</td>
      <td style="padding:10px 12px">${sourcePill}</td>
      <td style="padding:10px 12px;font-size:12px;color:#555">${when(u.last_login)}</td>
      <td style="padding:10px 12px;font-size:12px;color:#555">${escHtml(u.created_by || '')}</td>
      <td style="padding:10px 12px;text-align:right;white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');
  box.innerHTML = `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:var(--surface2)">
      <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Username</th>
      <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Role</th>
      <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Source</th>
      <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Last login</th>
      <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Created by</th>
      <th style="padding:10px 12px"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function openUserModal(title, bodyHtml, onSubmit, submitLabel) {
  closeUserModal();
  const overlay = document.createElement('div');
  overlay.id = 'user-modal-ov';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:5000;display:grid;place-items:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;width:100%;max-width:420px;box-shadow:0 24px 64px rgba(0,0,0,.25)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:17px;font-weight:700">${escHtml(title)}</div>
        <button onclick="closeUserModal()" style="background:none;border:0;font-size:20px;cursor:pointer;color:var(--muted);line-height:1">&times;</button>
      </div>
      ${bodyHtml}
      <div id="user-modal-err" style="display:none;margin-top:10px;padding:8px 12px;background:#fdecea;color:#b3261e;border:1px solid #f1baba;border-radius:8px;font-size:13px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="actbtn btn-gh" onclick="closeUserModal()">Cancel</button>
        <button class="actbtn btn-ok" id="user-modal-submit">${escHtml(submitLabel)}</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeUserModal(); });
  document.body.appendChild(overlay);
  document.getElementById('user-modal-submit').onclick = async () => {
    const btn = document.getElementById('user-modal-submit');
    btn.disabled = true;
    try { await onSubmit(); } catch (e) {
      const errEl = document.getElementById('user-modal-err');
      if (errEl) { errEl.textContent = e.message || 'Failed'; errEl.style.display = 'block'; }
    }
    btn.disabled = false;
  };
  setTimeout(() => overlay.querySelector('input')?.focus(), 50);
}

function closeUserModal() {
  const ov = document.getElementById('user-modal-ov');
  if (ov) ov.remove();
}

function modalInput(id, label, type, attrs = '', extraStyle = '') {
  const baseStyle = 'width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:var(--sans)';
  return `
    <div style="margin-bottom:12px">
      <label for="${id}" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text2)">${escHtml(label)}</label>
      <input id="${id}" type="${type}" ${attrs} style="${baseStyle};${extraStyle}">
    </div>`;
}

async function migrateEnvUser(username) {
  if (!confirm(`Migrate "${username}" from env-var to Firebase?\n\nTheir current password keeps working. After this, you'll be able to reset or delete them from this page. The matching USER_N env var on Render becomes dormant and can be removed on your next convenient deploy.`)) return;
  try {
    const r = await fetch('/api/users/migrate-from-env', {
      method: 'POST', credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Failed to migrate', 'err'); return; }
    toast(`"${username}" migrated — Reset/Delete now available`, 'ok');
    loadUsers();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function openAddUserModal() {
  openUserModal(
    'Add user',
    modalInput('nu-user', 'Username', 'text', 'autocomplete="off" autocapitalize="none" spellcheck="false"') +
    modalInput('nu-pass', 'Password (min 8 chars)', 'password', 'autocomplete="new-password"') +
    `<div style="margin-bottom:12px">
       <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text2)">Role</label>
       <select id="nu-role" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:var(--sans)">
         <option value="user">user</option>
         <option value="admin">admin</option>
       </select>
     </div>`,
    async () => {
      const username = document.getElementById('nu-user').value.trim().toLowerCase();
      const password = document.getElementById('nu-pass').value;
      const role = document.getElementById('nu-role').value;
      const r = await fetch('/api/users/add', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password, role }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to add user');
      toast(`User "${username}" added`, 'ok');
      closeUserModal();
      loadUsers();
    },
    'Add user'
  );
}

function openResetUserModal(username) {
  openUserModal(
    `Reset password for "${username}"`,
    `<div style="font-size:13px;color:var(--muted);margin-bottom:10px">The user will need the new password on their next login.</div>` +
    modalInput('rp-pass', 'New password (min 8 chars)', 'password', 'autocomplete="new-password"'),
    async () => {
      const password = document.getElementById('rp-pass').value;
      const r = await fetch('/api/users/reset', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to reset password');
      toast(`Password reset for "${username}"`, 'ok');
      closeUserModal();
      loadUsers();
    },
    'Reset password'
  );
}

async function changeUserRole(username, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  const verb = newRole === 'admin' ? 'promote' : 'demote';
  const msg = newRole === 'admin'
    ? `Promote "${username}" to admin?\n\nAdmins can add/reset/delete other users and access the Users page.`
    : `Demote "${username}" to user?\n\nThey'll lose access to the Users page and can't manage other accounts.`;
  if (!confirm(msg)) return;
  try {
    const r = await fetch('/api/users/role', {
      method: 'POST', credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, role: newRole }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || `Failed to ${verb}`, 'err'); return; }
    toast(`"${username}" is now ${newRole}`, 'ok');
    loadUsers();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function deleteUser(username) {
  if (!confirm(`Delete user "${username}"? They'll be logged out immediately and won't be able to sign in.`)) return;
  try {
    const r = await fetch('/api/users/delete', {
      method: 'POST', credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Failed to delete', 'err'); return; }
    toast(`User "${username}" deleted`, 'ok');
    loadUsers();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function openChangePasswordModal() {
  openUserModal(
    'Change my password',
    modalInput('cp-cur', 'Current password', 'password', 'autocomplete="current-password"') +
    modalInput('cp-new', 'New password (min 8 chars)', 'password', 'autocomplete="new-password"') +
    modalInput('cp-new2', 'Confirm new password', 'password', 'autocomplete="new-password"'),
    async () => {
      const cur = document.getElementById('cp-cur').value;
      const n1 = document.getElementById('cp-new').value;
      const n2 = document.getElementById('cp-new2').value;
      if (n1 !== n2) throw new Error('New passwords do not match');
      const r = await fetch('/api/password', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ current_password: cur, new_password: n1 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to change password');
      toast('Password changed. Please log in again with your new password.', 'ok');
      closeUserModal();
      setTimeout(logout, 900);
    },
    'Change password'
  );
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
