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

async function updateReport(id, data) {
  try { await fbPatch(`reports/${id}.json`, data); }
  catch(e) { toast('Update failed','err'); }
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
function showView(name, btn) {
  if (name==='plaid') loadPlaidCustomers();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name==='dash') loadReports();
}

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

function toggleProfileDD() {
  const dd = document.getElementById('profile-dd');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) renderProfileDD();
}

function renderProfileDD() {
  const list = document.getElementById('profile-dd-list');
  if (!list) return;
  list.innerHTML = Object.keys(profiles).map(n => `
    <div class="profile-dd-item ${n===activeProfile?'active':''}" onclick="switchActive('${n}')">
      ${n}
      ${n===activeProfile?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':''}
    </div>`).join('');
}

function switchActive(n) {
  activeProfile = n;
  localStorage.setItem('cif_active_profile',n);
  updateProfileBadge();
  document.getElementById('profile-dd').classList.remove('open');
  // Push new active profile to Firebase
  pushSettingsToFirebase(n, profiles[n] || DR);
  toast(`Switched to "${n}" ✓`, 'ok');
}

function updateProfileBadge() {
  document.getElementById('active-profile-label').textContent = activeProfile;
  document.getElementById('single-profile-name').textContent = activeProfile;
  const b = document.getElementById('batch-profile-name');
  if (b) b.textContent = activeProfile;
}

document.addEventListener('click', e => {
  const btn = document.getElementById('profile-btn');
  const dd = document.getElementById('profile-dd');
  if (btn && dd && !btn.contains(e.target) && !dd.contains(e.target)) dd.classList.remove('open');
});

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
