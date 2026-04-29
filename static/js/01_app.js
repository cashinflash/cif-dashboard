/* 01_app.js — part 1 of 4 of the dashboard JS bundle.
 * Extracted from app.html in v3 Phase 0.6 (claude/plan-engine-reporting-v3-9HciJ).
 *
 * Loaded in order via <script src> tags in app.html. Splitting was a
 * tooling-imposed workaround for tool-call payload size limits in the
 * MCP push_files tool — semantically this is one file. Phase C reporting
 * work can re-merge or further modularize as needed.
 */

/* app.js — extracted from app.html in v3 Phase 0 (claude/plan-engine-reporting-v3-9HciJ).
 *
 * No semantic changes from the original inline <script> block. The HTML
 * file now references this script via <script src> placed just before
 * </body>, mirroring the original inline-block position so timing is
 * identical (no `defer` — that would change DOM-ready ordering relative
 * to the inline event handlers in app.html).
 *
 * Original size: 193,316 chars
 */

// ════════════════════════════════════════
// FIREBASE via local server proxy
// ════════════════════════════════════════
const FB = '/fb';

// ── AUTH ──
// Token lives in an HttpOnly cookie (not readable by JS, not stealable via XSS).
// All fetches use credentials:'include' so the browser sends the cookie. The
// server also accepts an X-Session header for backward compat, but the cookie
// is canonical. CSRF is blocked by SameSite=Strict on the cookie.
let _currentUser = '';
let _currentRole = 'user';
function getToken() { return ''; }            // legacy shim; cookie is used instead
function getUser() { return _currentUser || 'User'; }
function isAdmin() { return _currentRole === 'admin'; }

function authHeaders(extra) {
  return Object.assign({'Content-Type':'application/json'}, extra||{});
}

function applyRoleVisibility() {
  const show = isAdmin();
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = show ? '' : 'none';
  });
}

async function hydrateCurrentUser() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      _currentUser = d.user || '';
      _currentRole = d.role || 'user';
      applyRoleVisibility();
      const lbl = document.getElementById('who');
      if (lbl) lbl.textContent = _currentUser || 'User';
      return true;
    }
    if (r.status === 401) { window.location.replace('/'); return false; }
  } catch (e) { /* ignore; UI stays as "User" */ }
  return false;
}

// ── IDLE TIMEOUT ──
// Server enforces a 30-min idle timeout via last_active tracking, but the
// dashboard polls loadReports() every 8s which keeps the session warm
// forever. For a true "walk away and get logged out" UX we track real
// user activity in the browser and force a logout if there's been no
// mouse/keyboard input for IDLE_TIMEOUT_MS.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const IDLE_WARNING_MS = 60 * 1000;        // show warning 1 min before
let _lastActivity = Date.now();
let _idleCheckInterval = null;
let _idleWarningShown = false;

function _bumpActivity() {
  _lastActivity = Date.now();
  if (_idleWarningShown) {
    const banner = document.getElementById('idle-warning');
    if (banner) banner.remove();
    _idleWarningShown = false;
  }
}

function _showIdleWarning(secondsLeft) {
  if (_idleWarningShown) {
    const cnt = document.getElementById('idle-warning-secs');
    if (cnt) cnt.textContent = secondsLeft;
    return;
  }
  _idleWarningShown = true;
  const banner = document.createElement('div');
  banner.id = 'idle-warning';
  banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff4e0;border:1px solid #f2d46c;color:#6b4d00;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.15);display:flex;align-items:center;gap:10px';
  banner.innerHTML = `You'll be signed out for inactivity in <span id="idle-warning-secs">${secondsLeft}</span>s. <button style="background:var(--green);color:#fff;border:0;padding:6px 12px;border-radius:6px;font-weight:600;cursor:pointer;font-family:var(--sans);font-size:12px" onclick="_bumpActivity()">Stay signed in</button>`;
  document.body.appendChild(banner);
}

function _checkIdle() {
  const idle = Date.now() - _lastActivity;
  const remaining = IDLE_TIMEOUT_MS - idle;
  if (remaining <= 0) {
    // Stop polling so no stray requests fire during logout.
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (_idleCheckInterval) { clearInterval(_idleCheckInterval); _idleCheckInterval = null; }
    logout();
    return;
  }
  if (remaining <= IDLE_WARNING_MS) {
    _showIdleWarning(Math.ceil(remaining / 1000));
  }
}

function startIdleTracker() {
  // Count any real interaction as activity. Scroll alone is intentionally NOT
  // tracked (you can leave the tab scrolling long content without touching it).
  ['mousedown', 'keydown', 'touchstart', 'click'].forEach(ev =>
    document.addEventListener(ev, _bumpActivity, { passive: true })
  );
  // Check every 15s — cheap, and catches timeout within 15s of the deadline.
  _idleCheckInterval = setInterval(_checkIdle, 15000);
}

async function fbGet(path) {
  const r = await fetch(`${FB}/${path}`, {credentials:'include', headers:{'X-Session':getToken()}});
  if (r.status === 401) { window.location.href='/'; return {}; }
  return r.json();
}

async function fbPost(path, data) {
  const r = await fetch(`${FB}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  if (r.status === 401) { window.location.href='/'; return {}; }
  return r.json();
}

async function fbPatch(path, data) {
  const r = await fetch(`${FB}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({'X-Method':'PATCH'}),
    body: JSON.stringify(data)
  });
  if (r.status === 401) { window.location.href='/'; return {}; }
  return r.json();
}

async function fbDelete(path) {
  await fetch(`${FB}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({'X-Method':'DELETE'}),
    body: '{}'
  });
}

// ════════════════════════════════════════
// DEFAULT RULES
// ════════════════════════════════════════
const DR = {loanMin:100,loanMax:255,t1Fcf:150,t2Fcf:300,t3Fcf:425,t4Fcf:550,
  nsfDrop:2,nsfCap:4,nsfDecline:5,ftDrop:5,ftCap:7,ftDecline:9,ftAbs:11,
  t1Amount:100,t2Amount:150,t3Amount:200,
  negCap:7,negDecline:10,specDrop:35,specCap:50,atmThreshold:200,atmPct:30,atmCountAll:true,
  p2pReceivedMode:'exclude',p2pReceivedPct:50,p2pSentMode:'recurring',
  subCapPerMerchant:2,bouncedDetection:true,expSpeculative:true,staleDays:30,
  expenseFloorOn:true,expenseFloor:500,
  fintechFeePct:15,moneyOrderThreshold:200,dtiDrop:45,dtiDrop2:60,
  incPayroll:true,incGovt:true,incPension:true,incGig:true,incSupport:false,
  expRent:true,expUtilities:true,expPhone:true,expInsurance:true,expLoans:true,expGrocery:true,expGas:true,expSubscriptions:true,expChildcare:true,expRestaurants:true,expTransportation:true,expMedical:true,expOtherThreshold:50,atmCountAll:true,
  velocityOn:true,velocityDrop:90,velocityCap:98,
  endBalOn:true,endBalFlag:25,endBalDrop:5,
  require2Checks:false,incomeVariance:25,
  ftDep:30,ftDepCap:60,
  adSingleCheck:'flag',adLowBalance:'flag',
  adNoIncome:'decline',adClosed:'decline',adFraud:'decline',adFcf:'decline',
  adAvgBal:'decline',adJobLoss:'decline',adBankruptcy:'decline',adStale:'decline'};

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
let apps = [];
let profiles = JSON.parse(localStorage.getItem('cif_profiles') || 'null') || {
  Standard:{...DR}, Lenient:{...DR,nsfDrop:3,nsfCap:6,nsfDecline:8,ftDrop:7,ftCap:9,ftDecline:11,ftAbs:13,negCap:9,negDecline:14,specDrop:45,specCap:65},
  Strict:{...DR,nsfDrop:1,nsfCap:2,nsfDecline:3,ftDrop:3,ftCap:5,ftDecline:7,ftAbs:9,negCap:5,negDecline:8,specDrop:20,specCap:35}
};
let activeProfile = localStorage.getItem('cif_active_profile') || 'Standard';
let editingProfile = activeProfile;
let sFile=null,sReport='',sName='',sDecision='',sAmount='',sReason='',sScore=0,sPendingId=null;
let bFiles=[],bRunning=false,bSaved=0;
let srch='',stFilter='';
let pollTimer=null;

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
window.onload = async () => {
  // Fetch current user (and validate session) from the server. If 401, we
  // redirect to /login. This replaces the old sessionStorage-based display.
  await hydrateCurrentUser();
  await loadKey();
  renderProfiles();
  loadRulesUI(editingProfile);
  updateProfileBadge();
  startDots();
  setupDragDrop();
  startIdleTracker();
  // Deep-link: email notifications link to /app?if=<UUID>. Land on
  // the Instant Funding tab and auto-open the reveal modal for that
  // submission. Strip the query param after so a refresh doesn't
  // re-open the (already-purged) record.
  const _ifQ = new URLSearchParams(location.search).get('if');
  if (_ifQ) {
    history.replaceState(null, '', '/app' + VIEW_TO_HASH.if);
    _renderView('if', document.getElementById('nav-if'));
    // Wait for loadIFSubmissions to populate _ifRows, then resolve
    // either the submissionId (old email deep-links) or the Firebase
    // key (new internal links) to a row and open the reveal modal.
    setTimeout(() => {
      const match = (window._ifRows || []).find(r =>
        r.firebaseId === _ifQ || r.submissionId === _ifQ);
      if (match) revealIFCard(match.firebaseId);
    }, 400);
  } else {
    // Hydrate from the URL hash — drops the user back on whatever view
    // they were viewing before refresh / bookmark-load. Defaults to
    // Dashboard when no hash is present (parseRoute() returns 'dash').
    const { view, fbId } = parseRoute();
    if (view === 'app' && fbId) {
      // Reloaded directly on a detail URL. Render dashboard skeleton first
      // (so the page doesn't look empty), then try to open the detail as
      // soon as loadReports has populated apps[]. Retry a few times in
      // case Firebase is slow.
      _renderView('dash', document.getElementById('nav-dash'));
      const tryOpen = (retries) => {
        if (apps.find(x => x.firebaseId === fbId)) { openModal(fbId); return; }
        if (retries > 0) setTimeout(() => tryOpen(retries - 1), 200);
      };
      tryOpen(25);  // ~5s of retries total
    } else {
      _renderView(view, document.getElementById('nav-' + view));
    }
  }
  loadReports();
  pollTimer = setInterval(loadReports, 8000);
  // Silent bg fetch to prime the IF badge count
  if (typeof loadIFSubmissions === 'function') loadIFSubmissions();
};



async function loadKey() {
  // API key is stored server-side — just update user label
  const lbl = document.getElementById('user-label');
  if (lbl) lbl.textContent = _currentUser || 'User';
}

async function saveKey() {}
function getKey() { return 'server-side'; }
function toggleSettings() {}

function startDots() {
  const dots=['d1','d2','d3','d4','d5']; let i=0;
  setInterval(()=>{if(document.getElementById('proc').classList.contains('show')){dots.forEach((d,idx)=>{const el=document.getElementById(d);if(!el)return;el.className=idx<i?'dot done':idx===i?'dot active':'dot'});i=(i+1)%dots.length;}},2200);
}

function setupDragDrop() {
  const sdz=document.getElementById('sdz');
  sdz.addEventListener('dragover',e=>{e.preventDefault();sdz.classList.add('over')});
  sdz.addEventListener('dragleave',()=>sdz.classList.remove('over'));
  sdz.addEventListener('drop',e=>{e.preventDefault();sdz.classList.remove('over');const f=e.dataTransfer.files[0];if(f&&f.type==='application/pdf')setSingle(f);else toast('PDF only','err')});
  const bdz=document.getElementById('bdz');
  bdz.addEventListener('dragover',e=>{e.preventDefault();bdz.classList.add('over')});
  bdz.addEventListener('dragleave',()=>bdz.classList.remove('over'));
  bdz.addEventListener('drop',e=>{e.preventDefault();bdz.classList.remove('over');const files=Array.from(e.dataTransfer.files).filter(f=>f.type==='application/pdf').slice(0,10);if(files.length){bFiles=files;renderQueue();}else toast('PDF files only','err')});
}

// ════════════════════════════════════════
// FIREBASE LOAD
// ════════════════════════════════════════
// Tracks whether loadReports has finished at least once. Used by renderDash
// to show a skeleton on first paint instead of the empty state (which would
// otherwise say "No applications yet" for the ~500ms before data arrives).
let _reportsLoaded = false;

async function loadReports() {
  try {
    const data = await fbGet('reports.json');
    if (data && typeof data === 'object' && !data.error) {
      apps = Object.entries(data)
        .map(([key,val]) => ({...val, firebaseId:key}))
        .sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    } else {
      apps = [];
    }
    _reportsLoaded = true;
    renderDash();
    updateSyncStatus(true);
  } catch(e) {
    // Don't flip _reportsLoaded on failure — keep the skeleton so the user
    // knows we're still trying (poll retries every 8s).
    updateSyncStatus(false);
    console.warn('Load reports failed:', e);
  }
}

// Dashboard table skeleton — 8 rows shaped roughly like real rows so the
// layout doesn't jump when data arrives.
function _renderDashSkeleton() {
  const c = document.getElementById('dtable');
  if (!c) return;
  const rows = Array.from({length: 8}, () => `
    <tr>
      <td style="padding:14px 10px"><span class="skel" style="height:10px;width:60%"></span><br><span class="skel" style="height:8px;width:40%;margin-top:6px"></span></td>
      <td style="padding:14px 10px;text-align:center"><span class="skel" style="height:24px;width:36px;border-radius:12px"></span></td>
      <td style="padding:14px 10px"><span class="skel" style="height:10px;width:55px"></span></td>
      <td style="padding:14px 10px"><span class="skel" style="height:10px;width:70px"></span></td>
      <td style="padding:14px 10px"><span class="skel" style="height:10px;width:65px"></span></td>
      <td style="padding:14px 10px"><span class="skel" style="height:20px;width:70px;border-radius:10px"></span></td>
    </tr>
  `).join('');
  c.innerHTML = `<table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>`;
}

async function saveReport(data) {
  try {
    const result = await fbPost('reports.json', data);
    return result.name; // Firebase returns {name: "-KEY"}
  } catch(e) {
    toast('Save failed: '+e.message,'err');
    return null;
  }
}

// Conflict-safe report update.
// Reads the remote updatedAt just before write and compares to the local copy.
// If they differ, a second underwriter has edited this record since we loaded
// it — surface the conflict instead of silently overwriting their work.
async function updateReport(id, data) {
  try {
    const local = apps.find(a => a.firebaseId === id);
    const localUpdatedAt = local && local.updatedAt ? Number(local.updatedAt) : 0;
    if (localUpdatedAt) {
      try {
        const remote = await fbGet(`reports/${id}/updatedAt.json`);
        const remoteUpdatedAt = remote ? Number(remote) : 0;
        if (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt) {
          const proceed = confirm(
            'This application was just updated by another user.\n\n' +
            'Saving now will overwrite their changes. Click Cancel to ' +
            'reload first and see what changed, or OK to save anyway.'
          );
          if (!proceed) { await loadReports(); throw new Error('Conflict — reloaded'); }
        }
      } catch (readErr) {
        if (readErr.message?.startsWith('Conflict')) throw readErr;
        // If the read fails for network reasons, fall through and attempt the write.
      }
    }
    // Always stamp updatedAt on every write so future conflict checks work.
    const payload = { ...data, updatedAt: Date.now() };
    await fbPatch(`reports/${id}.json`, payload);
    if (local) Object.assign(local, payload);
  } catch (e) {
    if (e.message?.startsWith('Conflict')) return;  // handled above
    toast('Update failed', 'err');
  }
}

function updateSyncStatus(ok) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (ok && apps.length > 0) {
    el.innerHTML = `<div class="sync-bar"><div class="sync-dot"></div>Firebase connected — ${apps.length} report${apps.length!==1?'s':''}</div>`;
  } else if (ok) {
    el.innerHTML = '';
  } else {
    el.innerHTML = '<div style="background:var(--red-light);border:1px solid var(--red-border);border-radius:10px;padding:10px 16px;margin-bottom:1rem;font-size:13px;color:var(--red)">⚠ Firebase connection issue — check your internet connection</div>';
  }
}

// ════════════════════════════════════════
// VIEWS
// ════════════════════════════════════════
// ════════════════════════════════════════
// ROUTER — hash-based URL routing so views + applications are
// deep-linkable, the browser back/forward buttons work, and refreshing
// a detail page doesn't drop you back on the dashboard.
//   #/dashboard        → dash     (default)
//   #/analysis         → single
//   #/batch            → batch
//   #/plaid            → plaid
//   #/instant-funding  → if
//   #/users            → users    (admin only)
//   #/audit            → audit    (admin only)
//   #/app/<firebaseId> → application detail (currently renders as modal;
//                        phase 2 will convert to a full-page view)
// ════════════════════════════════════════
const VIEW_TO_HASH = {
  dash: '#/dashboard',
  single: '#/analysis',
  batch: '#/batch',
  plaid: '#/plaid',
  if: '#/instant-funding',
  users: '#/users',
  audit: '#/audit',
};
const HASH_TO_VIEW = Object.fromEntries(Object.entries(VIEW_TO_HASH).map(([k, v]) => [v, k]));

function parseRoute() {
  const hash = location.hash || '#/dashboard';
  const mApp = hash.match(/^#\/app\/([^/?#]+)/);
  if (mApp) return { view: 'app', fbId: decodeURIComponent(mApp[1]) };
  return { view: HASH_TO_VIEW[hash] || 'dash' };
}

// Render a view without touching history. Called by the router on
// hashchange / initial load. Callers that want to change the URL should
// go through showView() instead.
function _renderView(name, btn) {
  if (name==='plaid') loadPlaidCustomers();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  const el = document.getElementById('view-'+name);
  if (el) el.classList.add('active');
  const navBtn = btn || document.getElementById('nav-' + name);
  if (navBtn) navBtn.classList.add('active');
  if (name==='dash') loadReports();
  if (name==='reviewqueue') loadReviewQueue();
  if (name==='if') loadIFSubmissions();
  if (name==='users') loadUsers();
  if (name==='audit') loadAuditLog();
}

function router() {
  const { view, fbId } = parseRoute();
  if (view === 'app' && fbId) {
    // During phase 1 we still render the detail as a modal — phase 2
    // converts it to a full-page view inside #view-detail.
    if (_currentModalFbId !== fbId) openModal(fbId);
    return;
  }
  // Close any open modal/detail state before rendering the next list view.
  if (_currentModalFbId) closeModal({fromRouter: true});
  _renderView(view, document.getElementById('nav-' + view));
}

// Public: called by nav buttons. Updates URL + renders.
function showView(name, btn) {
  const hash = VIEW_TO_HASH[name] || ('#/' + name);
  if (location.hash !== hash) {
    // pushState instead of assigning location.hash so we don't double-render
    // (hashchange listener below also triggers on location.hash = ...).
    history.pushState(null, '', hash);
  }
  _renderView(name, btn);
}

// Back/forward browser buttons.
window.addEventListener('popstate', router);
// Direct hash edits / location.hash assignments from other code paths.
window.addEventListener('hashchange', router);

// ════════════════════════════════════════
// PROFILES
// ════════════════════════════════════════
function renderProfiles() {
  const bar = document.getElementById('profiles-bar');
  bar.innerHTML = Object.keys(profiles).map(n => `
    <div class="profile-chip ${n===editingProfile?'active':''}" onclick="selectEditProfile('${n}')">
      ${n}
      ${!['Standard','Lenient','Strict'].includes(n)?`<span onclick="event.stopPropagation();deleteProfile('${n}')" style="opacity:.7;cursor:pointer">✕</span>`:''}
    </div>`).join('');
  document.getElementById('editing-profile-name').textContent = editingProfile;
}

function selectEditProfile(n) { editingProfile=n; renderProfiles(); loadRulesUI(n); }

function addProfile() {
  const inp = document.getElementById('new-profile-name');
  const n = inp.value.trim();
  if (!n) { toast('Enter a name','err'); return; }
  if (profiles[n]) { toast('Already exists','err'); return; }
  profiles[n] = {...(profiles[activeProfile]||DR)};
  saveProfilesStore(); inp.value=''; editingProfile=n;
  renderProfiles(); loadRulesUI(n); renderProfileDD();
  toast(`Profile "${n}" created ✓`,'ok');
}

function deleteProfile(n) {
  if (!confirm(`Delete "${n}"?`)) return;
  delete profiles[n];
  if (activeProfile===n) { activeProfile='Standard'; localStorage.setItem('cif_active_profile','Standard'); updateProfileBadge(); }
  if (editingProfile===n) { editingProfile='Standard'; loadRulesUI('Standard'); }
  saveProfilesStore(); renderProfiles(); renderProfileDD();
  toast(`Deleted "${n}"`,'ok');
}

function saveProfilesStore() { localStorage.setItem('cif_profiles',JSON.stringify(profiles)); }

function switchActive(n) {
  activeProfile = n;
  localStorage.setItem('cif_active_profile',n);
  updateProfileBadge();
  pushSettingsToFirebase(n, profiles[n] || DR);
  toast(`Switched to "${n}"`, 'ok');
}

function updateProfileBadge() {
  // Header picker was removed; these elements may be absent. Be defensive.
  const lbl = document.getElementById('active-profile-label');
  if (lbl) lbl.textContent = activeProfile;
  const sp = document.getElementById('single-profile-name');
  if (sp) sp.textContent = activeProfile;
  const b = document.getElementById('batch-profile-name');
  if (b) b.textContent = activeProfile;
}


// ════════════════════════════════════════
// RULES UI
// ════════════════════════════════════════
function loadRulesUI(n) {
  const r = profiles[n]||DR;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
  const setChk = (id,v) => { const el=document.getElementById(id); if(el) el.checked=!!v; };
  const setSel = (id,v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  set('r-loan-min',r.loanMin); set('r-loan-max',r.loanMax);
  set('r-t1-fcf',r.t1Fcf); set('r-t2-fcf',r.t2Fcf); set('r-t3-fcf',r.t3Fcf); set('r-t4-fcf',r.t4Fcf);
  set('r-t1-amount',r.t1Amount??100); set('r-t2-amount',r.t2Amount??150); set('r-t3-amount',r.t3Amount??200);
  set('r-nsf-drop',r.nsfDrop); set('r-nsf-cap',r.nsfCap); set('r-nsf-decline',r.nsfDecline);
  set('r-ft-drop',r.ftDrop); set('r-ft-cap',r.ftCap); set('r-ft-decline',r.ftDecline); set('r-ft-abs',r.ftAbs);
  set('r-neg-cap',r.negCap); set('r-neg-cap-r',r.negCap);
  set('r-neg-dec',r.negDecline); set('r-neg-dec-r',r.negDecline);
  set('r-spec-drop',r.specDrop); set('r-spec-drop-r',r.specDrop);
  set('r-spec-cap',r.specCap); set('r-spec-cap-r',r.specCap);
  set('r-atm-threshold',r.atmThreshold??200); set('r-atm-pct',r.atmPct??30); set('r-atm-pct-r',r.atmPct??30);
  setChk('r-atm-count-all',r.atmCountAll??true);
  // P2P, subscription, bounced, speculative
  const p2pRSel = document.getElementById('r-p2p-received-mode'); if(p2pRSel) p2pRSel.value = r.p2pReceivedMode||'exclude';
  set('r-p2p-received-pct',r.p2pReceivedPct??50);
  const p2pSSel = document.getElementById('r-p2p-sent-mode'); if(p2pSSel) p2pSSel.value = r.p2pSentMode||'recurring';
  set('r-sub-cap',r.subCapPerMerchant??2);
  setChk('r-bounced-detection',r.bouncedDetection??true);
  setChk('r-exp-speculative',r.expSpeculative??true);
  // Expense floor
  setChk('r-expense-floor-on',r.expenseFloorOn??true); set('r-expense-floor',r.expenseFloor??500);
  // v2 expense settings
  if(document.getElementById('r-fintech-fee-pct')) document.getElementById('r-fintech-fee-pct').value = r.fintechFeePct ?? 15;
  if(document.getElementById('r-money-order-threshold')) document.getElementById('r-money-order-threshold').value = r.moneyOrderThreshold ?? 200;
  if(document.getElementById('r-dti-drop')) document.getElementById('r-dti-drop').value = r.dtiDrop ?? 45;
  if(document.getElementById('r-dti-drop2')) document.getElementById('r-dti-drop2').value = r.dtiDrop2 ?? 60;
  // Income toggles
  setChk('r-inc-payroll',r.incPayroll??true); setChk('r-inc-govt',r.incGovt??true);
  setChk('r-inc-pension',r.incPension??true); setChk('r-inc-gig',r.incGig??true);
  setChk('r-inc-support',r.incSupport??false);
  // Expense toggles
  setChk('r-exp-rent',r.expRent??true); setChk('r-exp-utilities',r.expUtilities??true);
  setChk('r-exp-phone',r.expPhone??true); setChk('r-exp-insurance',r.expInsurance??true);
  setChk('r-exp-loans',r.expLoans??true); setChk('r-exp-grocery',r.expGrocery??true);
  setChk('r-exp-gas',r.expGas??true); setChk('r-exp-subscriptions',r.expSubscriptions??true);
  setChk('r-exp-childcare',r.expChildcare??false);
  setChk('r-exp-restaurants',r.expRestaurants??true); setChk('r-exp-transportation',r.expTransportation??true);
  setChk('r-exp-medical',r.expMedical??true);
  set('r-exp-other-threshold',r.expOtherThreshold??50);
  // Behavioral
  setChk('r-velocity-on',r.velocityOn??true); set('r-velocity-drop',r.velocityDrop??90); set('r-velocity-drop-r',r.velocityDrop??90);
  set('r-velocity-cap',r.velocityCap??98); set('r-velocity-cap-r',r.velocityCap??98);
  setChk('r-endbal-on',r.endBalOn??true); set('r-endbal-flag',r.endBalFlag??25); set('r-endbal-drop',r.endBalDrop??5);
  setChk('r-require-2-checks',r.require2Checks??false); set('r-income-variance',r.incomeVariance??25); set('r-income-variance-r',r.incomeVariance??25);
  set('r-ft-dep',r.ftDep??30); set('r-ft-dep-r',r.ftDep??30); set('r-ft-dep-cap',r.ftDepCap??60); set('r-ft-dep-cap-r',r.ftDepCap??60);
  // New auto-decline
  setSel('ad-single-check',r.adSingleCheck||'flag'); setSel('ad-low-balance',r.adLowBalance||'flag');
  // Set ad-sel dropdowns — handle legacy boolean values
  function setAd(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (val === true || val === 'true') el.value = 'decline';
    else if (val === false || val === 'false') el.value = 'off';
    else el.value = val || 'decline';
  }
  setAd('ad-no-income',r.adNoIncome); setAd('ad-closed',r.adClosed); setAd('ad-fraud',r.adFraud);
  setAd('ad-fcf',r.adFcf); setAd('ad-avg-bal',r.adAvgBal); setAd('ad-job-loss',r.adJobLoss);
  setAd('ad-bankruptcy',r.adBankruptcy); setAd('ad-stale',r.adStale);
}

function syncR(t,s,rev=false) { const se=document.getElementById(s),te=document.getElementById(t); if(se&&te)te.value=se.value; }

function getRulesFromUI() {
  const n = id => { const el=document.getElementById(id); return el ? +el.value||0 : 0; };
  const c = id => { const el=document.getElementById(id); return el ? el.checked : false; };
  const chk = c;
  const sel = id => { const el=document.getElementById(id); return el ? el.value : ''; };
  return {loanMin:n('r-loan-min'),loanMax:n('r-loan-max'),t1Fcf:n('r-t1-fcf'),t2Fcf:n('r-t2-fcf'),t3Fcf:n('r-t3-fcf'),t4Fcf:n('r-t4-fcf'),t1Amount:n('r-t1-amount'),t2Amount:n('r-t2-amount'),t3Amount:n('r-t3-amount'),
    nsfDrop:n('r-nsf-drop'),nsfCap:n('r-nsf-cap'),nsfDecline:n('r-nsf-decline'),ftDrop:n('r-ft-drop'),ftCap:n('r-ft-cap'),ftDecline:n('r-ft-decline'),ftAbs:n('r-ft-abs'),
    negCap:n('r-neg-cap'),negDecline:n('r-neg-dec'),specDrop:n('r-spec-drop'),specCap:n('r-spec-cap'),atmThreshold:n('r-atm-threshold'),atmPct:n('r-atm-pct'),atmCountAll:chk('r-atm-count-all'),
    expenseFloorOn:chk('r-expense-floor-on'),expenseFloor:n('r-expense-floor'),
    fintechFeePct:parseInt(document.getElementById('r-fintech-fee-pct')?.value||'15'),moneyOrderThreshold:parseInt(document.getElementById('r-money-order-threshold')?.value||'200'),
    dtiDrop:parseInt(document.getElementById('r-dti-drop')?.value||'45'),dtiDrop2:parseInt(document.getElementById('r-dti-drop2')?.value||'60'),
    incPayroll:chk('r-inc-payroll'),incGovt:chk('r-inc-govt'),incPension:chk('r-inc-pension'),incGig:chk('r-inc-gig'),incSupport:chk('r-inc-support'),
    expRent:chk('r-exp-rent'),expUtilities:chk('r-exp-utilities'),expPhone:chk('r-exp-phone'),expInsurance:chk('r-exp-insurance'),
    expLoans:chk('r-exp-loans'),expGrocery:chk('r-exp-grocery'),expGas:chk('r-exp-gas'),expSubscriptions:chk('r-exp-subscriptions'),expChildcare:chk('r-exp-childcare'),expRestaurants:chk('r-exp-restaurants'),expTransportation:chk('r-exp-transportation'),expMedical:chk('r-exp-medical'),expSpeculative:chk('r-exp-speculative'),expOtherThreshold:n('r-exp-other-threshold'),
    subCapPerMerchant:n('r-sub-cap'),bouncedDetection:chk('r-bounced-detection'),
    p2pReceivedMode:sel('r-p2p-received-mode'),p2pReceivedPct:n('r-p2p-received-pct'),p2pSentMode:sel('r-p2p-sent-mode'),
    velocityOn:chk('r-velocity-on'),velocityDrop:n('r-velocity-drop'),velocityCap:n('r-velocity-cap'),
    endBalOn:chk('r-endbal-on'),endBalFlag:n('r-endbal-flag'),endBalDrop:n('r-endbal-drop'),
    require2Checks:chk('r-require-2-checks'),incomeVariance:n('r-income-variance'),
    ftDep:n('r-ft-dep'),ftDepCap:n('r-ft-dep-cap'),
    adSingleCheck:sel('ad-single-check'),adLowBalance:sel('ad-low-balance'),
    adNoIncome:sel('ad-no-income')||'decline',
    adClosed:sel('ad-closed')||'decline',
    adFraud:sel('ad-fraud')||'decline',
    adFcf:sel('ad-fcf')||'decline',
    adAvgBal:sel('ad-avg-bal')||'decline',
    adJobLoss:sel('ad-job-loss')||'decline',
    adBankruptcy:sel('ad-bankruptcy')||'decline',
    adStale:sel('ad-stale')||'decline'};
}

async function savePdfSetting(allowed) {
  try {
    await fbPatch('settings.json', {allowPdfUpload: allowed});
    toast((allowed ? 'PDF uploads enabled' : 'PDF uploads disabled') + ' on apply form ✓', 'ok');
  } catch(e) { toast('Failed to save setting','err'); }
}

async function loadPdfSetting() {
  try {
    const d = await fbGet('settings.json');
    if (d && typeof d.allowPdfUpload !== 'undefined') {
      document.getElementById('allow-pdf-toggle').checked = d.allowPdfUpload;
    }
  } catch(e) {}
}

function saveRules() {
  profiles[editingProfile] = getRulesFromUI();
  saveProfilesStore();
  // If editing the active profile, push to Firebase so cif-apply picks it up
  if (editingProfile === activeProfile) {
    pushSettingsToFirebase(editingProfile, profiles[editingProfile]);
  }
  toast(`Rules saved for "${editingProfile}" ✓`, 'ok');
}

async function pushSettingsToFirebase(profileName, rules) {
  try {
    await fbPatch('settings/underwriting.json', {
      activeProfile: profileName,
      rules: rules,
      updatedAt: Date.now()
    });
    toast('Settings synced to underwriting engine ✓', 'ok');
  } catch(e) {
    console.warn('Settings sync failed:', e);
  }
}
function resetProfileToDefaults() { if(!confirm(`Reset "${editingProfile}"?`))return; profiles[editingProfile]={...DR}; saveProfilesStore(); loadRulesUI(editingProfile); toast('Reset to defaults ✓','ok'); }

// ════════════════════════════════════════
// BUILD INSTRUCTIONS
// ════════════════════════════════════════
function buildInstructions() {
  const r = profiles[activeProfile]||DR;
  const ads = [];
  if(r.adNoIncome) ads.push('No verified income');
  if(r.adClosed) ads.push('Account closed or restricted');
  if(r.adFraud) ads.push('Fraud indicators detected');
  if(r.adFcf) ads.push(`FCF below $${r.t1Fcf}`);
  if(r.adAvgBal) ads.push('Average daily balance below $0');
  if(r.adJobLoss) ads.push('Recent job loss');
  if(r.adBankruptcy) ads.push('Bankruptcy in progress');
  if(r.adStale) ads.push('Statement older than 30 days');
  ads.push(`${r.nsfDecline}+ NSFs`);
  ads.push(`${r.ftDecline}+ fintech apps (${r.ftAbs}+ absolute)`);
  ads.push(`${r.negDecline}+ negative balance days`);

  return `You are a California DFPI-compliant payday loan underwriting analyst for Cash in Flash.

OUTPUT THIS BLOCK FIRST — no text before it:
DECISION_BLOCK_START
APPLICANT_NAME: [Full name from document]
DECISION: [APPROVED or DECLINED]
APPROVED_AMOUNT: [dollar amount or N/A]
DECLINE_REASON: [1-2 plain English sentences if declined, or N/A]
SCORE: [0-100 overall creditworthiness]
DECISION_BLOCK_END

Then output the COMPLETE HTML report — ALL sections, never truncate.
OUTPUT RULES: Only valid HTML, no html/head/body tags, no Markdown.
Use h1 once, h2 per section, p per line item, ul/li for lists, hr between sections, b for bold, table for fintech apps.

REPORT STRUCTURE:
<h1>CASH IN FLASH — UNDERWRITING ANALYSIS</h1>
<h2>Applicant Summary</h2><hr/>
<h2>1️⃣ Statement Verification</h2><hr/>
<h2>2️⃣ Income Analysis (Verified Deposits Only)</h2><hr/>
<h2>3️⃣ Expense & Cash-Flow Analysis</h2><hr/>
<h2>4️⃣ Debt-to-Income (DTI) & Affordability</h2><hr/>
<h2>5️⃣ Risk Flags & Compliance Checks</h2><hr/>
<h2>6️⃣ Final Decision</h2>

ACTIVE PROFILE: ${activeProfile}
LOAN LIMITS: Min $${r.loanMin} | Max $${r.loanMax}
VERIFIED INCOME: payroll, govt benefits, pension, consistent gig only.
NOT income: P2P, internal transfers, refunds, loan proceeds, crypto, ATM, gambling.

FCF TIERS:
T1: $100 → FCF ≥ $${r.t1Fcf}
T2: $150 → FCF ≥ $${r.t2Fcf}
T3: $200 → FCF ≥ $${r.t3Fcf}
T4: $255 → FCF ≥ $${r.t4Fcf}

RISK ADJUSTMENTS:
NSF: 0-${r.nsfDrop-1}→none | ${r.nsfDrop}-${r.nsfCap-1}→drop 1 tier | ${r.nsfCap}-${r.nsfDecline-1}→cap $${r.loanMin} | ${r.nsfDecline}+→decline
Fintech: 0-${r.ftDrop-1}→none | ${r.ftDrop}-${r.ftCap-1}→drop 1 | ${r.ftCap}-${r.ftDecline-1}→cap $${r.loanMin} | ${r.ftDecline}-${r.ftAbs-1}→decline | ${r.ftAbs}+→absolute
Neg days: ${r.negCap}-${r.negDecline-1}→cap $${r.loanMin} | ${r.negDecline}+→decline | avg<$0→decline
Speculative: ${r.specDrop}-${r.specCap-1}%→drop 1 | ${r.specCap}%+→cap $${r.loanMin}

AUTO-DECLINE: ${ads.join(' | ')}

Section 6 MUST include step-by-step tier breakdown:
<p><b>Free Cash Flow:</b> $[amount]</p>
<p><b>Base Tier Qualified:</b> Tier [X] — $[amount] (FCF $[X] meets threshold $[Y])</p>
<p><b>NSF Adjustment:</b> [X] NSFs → [result]</p>
<p><b>Fintech Adjustment:</b> [X] apps → [result]</p>
<p><b>Negative Days Adjustment:</b> [X] days → [result]</p>
<p><b>Speculative Adjustment:</b> [X]% → [result]</p>
<p><b>Final Tier:</b> Tier [X] — $[amount] / Declined</p>
<p><b>Final Decision:</b> [Approved $X / Declined]</p>
<p><b>Compliance:</b> CDDTL compliant.</p>`;
}

// ════════════════════════════════════════
// ANALYSIS
// ════════════════════════════════════════
function handleSingle(input) { const f=input.files[0]; if(f) setSingle(f); }
function setSingle(f) { sFile=f; const fs=document.getElementById('sfs'); fs.style.display='flex'; document.getElementById('sfn').textContent=f.name; document.getElementById('sfz').textContent=fmtSz(f.size); document.getElementById('sdz').style.display='none'; }
function clearSingle() { sFile=null; document.getElementById('sfi').value=''; document.getElementById('sfs').style.display='none'; document.getElementById('sdz').style.display='block'; }

function setStep(n) {
  for(let i=1;i<=5;i++){const d=document.getElementById('d'+i);if(d){d.className='dot'+(i<n?' done':'')+(i===n?' active':'');}}
}

async function runSingle() {
  if (!sFile) { toast('Upload a PDF first','err'); return; }
  const btn=document.getElementById('sabtn');
  btn.disabled=true; btn.classList.add('loading');
  setStep(1);
  document.getElementById('proc').classList.add('show');
  document.getElementById('sresult').style.display='none';
  try {
    const b64 = await toB64(sFile);
    const res = await callClaude(b64);
    await parseSingle(res, b64);
  } catch(e) { toast('Error: '+e.message,'err'); }
  finally { btn.disabled=false; btn.classList.remove('loading'); document.getElementById('proc').classList.remove('show'); setStep(0); }
}

async function callClaude(b64) {
  // Use the deterministic 3-step engine via cif-apply
  const rules = profiles[activeProfile] || DR;
  setStep(1);
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 300000); // 5 min timeout
  // Animate steps on a timer (estimate: extract ~30s, engine ~2s, narrative ~30s)
  const stepTimers = [
    setTimeout(()=>setStep(2), 8000),
    setTimeout(()=>setStep(3), 25000),
    setTimeout(()=>setStep(4), 35000),
    setTimeout(()=>setStep(5), 55000)
  ];
  try {
    const resp = await fetch('/api/analyze-engine', {
      method:'POST',
      credentials:'include',
      signal: controller.signal,
      headers:{'Content-Type':'application/json','X-Session':getToken()},
      body: JSON.stringify({ pdf_b64: b64, settings: rules })
    });
    clearTimeout(timeout);
    stepTimers.forEach(t=>clearTimeout(t));
    setStep(5);
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({}));
      throw new Error(err.error?.message || err.error || `Server error ${resp.status}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || data.error);
    // Reconstruct text format that parseBlock expects
    const block = `\nDECISION_BLOCK_START\nAPPLICANT_NAME: ${data.name||'Unknown'}\nDECISION: ${data.decision}\nAPPROVED_AMOUNT: ${data.decision==='APPROVED'?'$'+data.amount:'N/A'}\nDECLINE_REASON: ${data.reason||'N/A'}\nAPPROVAL_REASON: ${data.approvalReason||'N/A'}\nSCORE: ${data.score||50}\nDECISION_BLOCK_END\n`;
    // Attach extracted info for Application tab
    callClaude._lastExtracted = data.extracted_info || null;
    callClaude._lastMetrics = {
      fcf: data.fcf, monthlyIncome: data.monthly_income,
      monthlyExpenses: data.monthly_expenses, fintechCount: data.fintech_count,
      nsfCount: data.nsf_count
    };
    return (data.report_html || '') + block;
  } catch(e) {
    clearTimeout(timeout);
    stepTimers.forEach(t=>clearTimeout(t));
    if (e.name === 'AbortError') throw new Error('Analysis timed out after 5 minutes. Please try again.');
    throw e;
  }
}

function parseBlock(text) {
  const m = text.match(/DECISION_BLOCK_START([\s\S]*?)DECISION_BLOCK_END/);
  let name='',decision='',amount='',reason='',score=50;
  if (m) {
    const b=m[1];
    name=(b.match(/APPLICANT_NAME:\s*(.+)/)||[])[1]?.trim()||'Unknown';
    decision=(b.match(/DECISION:\s*(.+)/)||[])[1]?.trim().toUpperCase()||'';
    amount=(b.match(/APPROVED_AMOUNT:\s*(.+)/)||[])[1]?.trim()||'';
    reason=(b.match(/DECLINE_REASON:\s*(.+)/)||[])[1]?.trim()||'';
    const sr=(b.match(/SCORE:\s*(\d+)/)||[])[1];
    if(sr) score=Math.min(100,Math.max(0,parseInt(sr)));
  }
  return {name,decision,amount:amount==='N/A'?'':amount.replace('$','').trim(),reason:reason==='N/A'?'':reason,score,report:text.replace(/DECISION_BLOCK_START[\s\S]*?DECISION_BLOCK_END\n?/,'').trim()};
}

async function parseSingle(text, b64) {
  const d = parseBlock(text);
  sReport=d.report; sName=d.name; sDecision=d.decision; sAmount=d.amount; sReason=d.reason; sScore=d.score;
  const ok = d.decision==='APPROVED';
  document.getElementById('dhero').className='dhero '+(ok?'approved':'declined');
  document.getElementById('dname').textContent=d.name;
  const badge=document.getElementById('dbadge'); badge.className='dbadge '+(ok?'approved':'declined'); badge.textContent=ok?'✓ Approved':'✕ Declined';
  const ai=document.getElementById('amtin'),ap=document.getElementById('amtpfx'),al=document.getElementById('amtlbl'),rb=document.getElementById('rbox');
  ai.value=d.amount;
  if(ok){ap.style.color='var(--green)';ai.className='amt-in';al.textContent='Approved amount — edit if needed';rb.style.display='none';}
  else{ap.style.color='var(--muted)';ai.className='amt-in dim';al.textContent='Override to approve manually';if(d.reason){rb.style.display='block';rb.textContent=d.reason;}else rb.style.display='none';}
  document.getElementById('srhtml').innerHTML=highlightTierBreakdown(d.report);
  document.getElementById('snotes').value='';
  stab('report',document.querySelector('.rtab'));
  setTimeout(()=>drawWheel('swh',d.score,108),50);
  document.getElementById('sresult').style.display='block';
  document.getElementById('sresult').scrollIntoView({behavior:'smooth',block:'start'});

  // Auto-save to Firebase as Pending immediately
  const now=new Date();
  const ext = callClaude._lastExtracted || {};
  const appData = ext.account_holder_name ? {
    firstName: (ext.account_holder_name||'').split(' ')[0]||'',
    lastName: (ext.account_holder_name||'').split(' ').slice(1).join(' ')||'',
    bankName: ext.bank_name||'',
    statementStart: ext.statement_start||'',
    statementEnd: ext.statement_end||'',
    beginningBalance: ext.beginning_balance||'',
    endingBalance: ext.ending_balance||'',
    avgDailyBalance: ext.avg_daily_balance||'',
    source: 'desktop'
  } : undefined;
  const record={id:Date.now(),date:now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),createdAt:Date.now(),source:'desktop',status:'Pending',name:d.name,amount:d.amount?'$'+d.amount:'N/A',claudeDecision:d.decision,reason:d.reason,score:d.score,filename:sFile?sFile.name:'',report:d.report,notes:'',profile:activeProfile};
  if(appData) record.applicationData = appData;
  if(b64) record.bankStatementB64 = b64;
  const metrics = callClaude._lastMetrics || {};
  if(metrics.fcf!=null) { record.fcf=metrics.fcf; record.monthlyIncome=metrics.monthlyIncome; record.monthlyExpenses=metrics.monthlyExpenses; record.fintechCount=metrics.fintechCount; record.nsfCount=metrics.nsfCount; }
  sPendingId = await saveReport(record);
}

function stab(tab,btn){document.querySelectorAll('.rtab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tpanel').forEach(p=>p.classList.remove('active'));if(btn)btn.classList.add('active');document.getElementById('tp-'+tab).classList.add('active');}

async function saveSingle(status) {
  const amt=document.getElementById('amtin').value.trim();
  const final=amt?'$'+amt.replace('$',''):(status==='Approved'?'$'+sAmount:'N/A');
  const btn1=document.querySelector('.btn-ok[onclick*="saveSingle"]');
  const btn2=document.querySelector('.btn-no[onclick*="saveSingle"]');
  if(btn1)btn1.disabled=true; if(btn2)btn2.disabled=true;
  try {
    if (sPendingId) {
      await updateReport(sPendingId, {status, amount:final, updatedAt:Date.now()});
      sPendingId=null;
      await loadReports();
      toast('Saved as '+status+' ✓','ok');
      setTimeout(()=>resetSingle(),1200);
    } else {
      // No pending ID — create a new record
      const now=new Date();
      const record={id:Date.now(),date:now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),createdAt:Date.now(),source:'desktop',status,name:sName,amount:final,claudeDecision:sDecision,reason:sReason,score:sScore,filename:sFile?sFile.name:'',report:sReport,notes:'',profile:activeProfile};
      await saveReport(record);
      await loadReports();
      toast('Saved as '+status+' ✓','ok');
      setTimeout(()=>resetSingle(),1200);
    }
  } catch(e) {
    toast('Save failed: '+e.message,'err');
    if(btn1)btn1.disabled=false; if(btn2)btn2.disabled=false;
  }
}

function copyRpt(){const t=document.createElement('div');t.innerHTML=sReport;navigator.clipboard.writeText(t.textContent).then(()=>toast('Copied ✓','ok'));}

// Per-transaction overrides relied on the v1 engine. v2 reclassifies via
// the Review Queue (pattern-level overrides in entities_overrides.json),
// which propagates across applicants instead of one-shot mutations.
window.recalculateDecision = function() {
  toast('Per-txn overrides removed. Use the Review Queue to map a merchant pattern, then re-run.', 'warn');
};
function resetSingle(){clearSingle();document.getElementById('sresult').style.display='none';sReport='';sName='';sDecision='';sAmount='';sReason='';sScore=0;sPendingId=null;window.scrollTo({top:0,behavior:'smooth'});}

// ════════════════════════════════════════
// BATCH
// ════════════════════════════════════════
function handleBatch(input){bFiles=Array.from(input.files).slice(0,10);renderQueue();}
function renderQueue(){
  const q=document.getElementById('bqueue'),btn=document.getElementById('babtn'),clr=document.getElementById('bclrbtn');
  if(!bFiles.length){q.innerHTML='';btn.style.display='none';clr.style.display='none';return;}
  q.innerHTML=bFiles.map((f,i)=>`<div class="bqi" id="bqi${i}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1a6b3c" stroke-width="2" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="bqn">${f.name}</span><span class="bqs" id="bqs${i}">${fmtSz(f.size)}</span></div>`).join('');
  btn.style.display='block';clr.style.display='block';
  document.getElementById('bresults').innerHTML='';
  document.getElementById('bprogwrap').style.display='none';
  document.getElementById('bclrallwrap').style.display='none';
  bSaved=0;
}
function clearBatch(){bFiles=[];bSaved=0;bRunning=false;document.getElementById('bfi').value='';document.getElementById('bqueue').innerHTML='';document.getElementById('bresults').innerHTML='';document.getElementById('babtn').style.display='none';document.getElementById('bclrbtn').style.display='none';document.getElementById('bprogwrap').style.display='none';document.getElementById('bclrallwrap').style.display='none';window.scrollTo({top:0,behavior:'smooth'});toast('Batch cleared','ok');}

async function runBatch(){
  if(!bFiles.length){toast('Upload PDFs first','err');return;}
  if(bRunning)return;
  bRunning=true;
  const btn=document.getElementById('babtn');btn.disabled=true;btn.textContent='Running batch...';
  document.getElementById('bresults').innerHTML='';
  document.getElementById('bprogwrap').style.display='block';
