/* 03_app.js — part 3 of 4 of the dashboard JS bundle.
 * Extracted from app.html in v3 Phase 0.6 (claude/plan-engine-reporting-v3-9HciJ).
 *
 * Loaded in order via <script src> tags in app.html. Splitting was a
 * tooling-imposed workaround for tool-call payload size limits in the
 * MCP push_files tool — semantically this is one file. Phase C reporting
 * work can re-merge or further modularize as needed.
 */

  const btn = document.getElementById('del-selected-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.65';
    btn.style.cursor = 'wait';
    btn.innerHTML = `Deleting ${n}…`;
  }
  // Also lock individual row checkboxes so a second click doesn't race.
  document.querySelectorAll('.row-chk, #chk-all').forEach(c => c.disabled = true);

  // Parallel deletes — much faster than the old sequential loop and any
  // failure is surfaced instead of silently swallowed.
  const ids = checked.map(cb => cb.dataset.id).filter(Boolean);
  const results = await Promise.allSettled(
    ids.map(id => fbDelete(`reports/${id}.json`))
  );
  const failed = results.filter(r => r.status === 'rejected').length;

  // Reload + re-render — renderDash() now resets the button via updateSelCount().
  // Explicit reset here as a belt-and-suspenders in case loadReports throws.
  if (btn) { btn.style.display = 'none'; btn.innerHTML = originalHtml; btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; }
  const chkAll = document.getElementById('chk-all');
  if (chkAll) chkAll.checked = false;

  try {
    await loadReports();
  } catch (e) {
    console.warn('loadReports after delete failed:', e);
  }

  if (failed === 0) {
    toast(`${n} report${n>1?'s':''} deleted`, 'ok');
    logAudit('report.bulk_delete', '', `count=${n}`);
  } else if (failed === n) {
    toast(`Delete failed — none removed`, 'err');
  } else {
    toast(`${n - failed} deleted, ${failed} failed`, 'err');
    logAudit('report.bulk_delete', '', `count=${n - failed}; failed=${failed}`);
  }
}

// ════════════════════════════════════════
// MODAL
// ════════════════════════════════════════
function openModal(fbId){
  const a=apps.find(x=>x.firebaseId===fbId);if(!a)return;
  _currentModalFbId = fbId;
  // Keep the URL in sync so the detail view is shareable + the browser
  // back button returns to the dashboard.
  const appHash = '#/app/' + encodeURIComponent(fbId);
  if (location.hash !== appHash) history.pushState(null, '', appHash);
  // Render as a full-page view, not an overlay.
  _renderView('detail');
  // Scroll to top — feels like a real page transition rather than a popover.
  window.scrollTo({top: 0, behavior: 'instant'});
  // Determine effective decision from all available signals
  const cdec = (a.claudeDecision||'').toUpperCase();
  // Use status field as primary truth — it's set by server after processing
  const effectiveDecision = 
    (a.status==='Approved' || cdec==='APPROVED') ? 'APPROVED' :
    (a.status==='Declined' || cdec==='DECLINED') ? 'DECLINED' :
    (a.status==='Processing') ? 'PROCESSING' :
    (a.processingComplete && a.status==='Pending') ? 'PENDING_REVIEW' : 'PROCESSING';
  const ok = effectiveDecision==='APPROVED';
  const isDeclined = effectiveDecision==='DECLINED';
  const isProcessing = effectiveDecision==='PROCESSING';
  const isPendingReview = effectiveDecision==='PENDING_REVIEW';
  const dc = ok?'ok':isDeclined?'no':isProcessing?'pending':'';
  document.getElementById('detailTitle').textContent=a.formName||a.name||'Application';
  const dupeBannerHtml = _buildDupeBanner(a);
  document.getElementById('detailBody').innerHTML=`
${dupeBannerHtml}
<div class="mdh ${dc||'pending'}">
  <div class="mdh-inner" style="flex:1">
    <div style="flex:1">
      <div class="mdh-badge">${ok?'✓ Approved':isDeclined?'✕ Declined':isProcessing?'⏳ Processing...':isPendingReview?'📋 Pending Review':'⏳ '+a.status}</div>
      <div class="mdn">${a.name||'—'}</div>
      ${ok?`<div class="mda">${a.amount||''}</div>
        ${a.approvalReason?`<div class="mdr" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.25)"><span style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.9;display:block;margin-bottom:4px">✓ Approval Reason</span>${a.approvalReason}</div>`:`<div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:6px;font-style:italic">✓ Approved for disbursement</div>`}
      `:(effectiveDecision==='DECLINED'&&!a.reason)?'':''}
      ${(isDeclined||a.status==='Declined')&&a.reason?`<div class="mdr"><span style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.8;display:block;margin-bottom:4px">📋 Decline Reason</span>${a.reason}</div>`:''}
      ${(!a.reason&&isProcessing)?`<div class="mdr" style="background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)"><span style="font-size:11px;opacity:.8">⏳ Underwriting in progress...</span></div>`:''}
      ${(isPendingReview&&!a.reason)?`<div class="mdr" style="background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)"><span style="font-size:11px;opacity:.8">⏳ Underwriting in progress...</span></div>`:''}
      ${a.nameMismatch?`<div style="background:rgba(255,193,7,.25);border:1px solid rgba(255,193,7,.5);border-radius:8px;padding:8px 12px;margin-top:8px;font-size:12px;color:white"><b>⚠ Name Mismatch</b> — Form: <b>${a.formName||'—'}</b> · Document: <b>${a.documentName||'—'}</b></div>`:''}
    </div>
    <canvas id="mwh" width="90" height="90" style="flex-shrink:0;opacity:.9"></canvas>
  </div>
<div style="display:flex;background:rgba(0,0,0,.2);border-top:1px solid rgba(255,255,255,.1)">
  <div style="flex:1;text-align:center;padding:10px 8px;border-right:1px solid rgba(255,255,255,.1)"><div style="font-size:9px;opacity:.6;text-transform:uppercase;letter-spacing:.08em;color:white">Status</div><div style="font-size:14px;font-weight:700;color:white;margin-top:2px">${a.status||'Pending'}</div></div>
  <div style="flex:1;text-align:center;padding:10px 8px;border-right:1px solid rgba(255,255,255,.1)"><div style="font-size:9px;opacity:.6;text-transform:uppercase;letter-spacing:.08em;color:white">Loan</div><div style="font-size:15px;font-weight:800;color:white;margin-top:2px">${ok?(a.amount||'—'):(isDeclined?'Declined':'—')}</div></div>
  <div style="flex:1;text-align:center;padding:10px 8px"><div style="font-size:9px;opacity:.6;text-transform:uppercase;letter-spacing:.08em;color:white">Score</div><div style="font-size:15px;font-weight:800;color:white;margin-top:2px">${a.score||0}<span style="font-size:10px;opacity:.6">/100</span></div></div>
</div>
</div>
${a.extractedSSN?`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:12px">
  <div><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">SSN</span>
  <span style="font-size:14px;font-weight:700;margin-left:8px" id="modal-ssn-display-${fbId}">${a.extractedSSN.replace(/^(\d{3}-\d{2}-)(\d{4})$/,'XXX-XX-$2')}</span>
  <span style="display:none" id="modal-ssn-full-${fbId}">${a.extractedSSN}</span></div>
  <div style="display:flex;gap:6px"><button onclick="toggleSSN('${fbId}','${a.extractedSSN}')" id="ssn-eye-${fbId}" style="background:var(--surface2);border:1px solid var(--border2);border-radius:7px;padding:5px 8px;font-size:12px;cursor:pointer">👁</button><button onclick="copySSN('${a.extractedSSN}')" style="background:var(--green-light);border:1px solid var(--green-border);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;font-family:var(--sans)">Copy</button></div>
</div>`:''}
<div class="msticky">
<div class="mact-bar">
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1">
    ${a.status!=='Approved'?`<div style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,var(--green-dark),var(--green));border-radius:10px;padding:6px 8px 6px 14px"><span style="font-size:13px;font-weight:700;color:white">$</span><input id="modal-approve-amt" type="text" placeholder="255" value="${a.amount&&a.amount!=='N/A'?a.amount.replace('$',''):''}" style="width:60px;border:none;background:transparent;font-size:15px;font-weight:800;color:white;outline:none;font-family:var(--sans)" oninput="const b=document.getElementById('approve-btn-${fbId}');if(b)b.textContent='✓ Approve $'+this.value"><button class="mact-primary" onclick="updStatusWithAmt('${fbId}','Approved')" style="background:rgba(255,255,255,.25);color:white;border:1px solid rgba(255,255,255,.3)" id="approve-btn-${fbId}">✓ Approve${a.amount&&a.amount!=='N/A'?' '+a.amount:''}</button></div>`:'<span style="background:var(--green-light);color:var(--green);border:1px solid var(--green-border);border-radius:9px;padding:7px 16px;font-size:13px;font-weight:700">✓ Approved</span>'}
    ${a.status!=='Declined'?`<button class="mact-primary" onclick="updStatus('${fbId}','Declined')" style="background:var(--red);color:white">✕ Decline</button>`:'<span style="background:var(--red-light);color:var(--red);border:1px solid var(--red-border);border-radius:9px;padding:7px 16px;font-size:13px;font-weight:700">✕ Declined</span>'}
    ${(isDeclined||a.status==='Declined')?`<button class="mact-primary" onclick="openDenialModal('${fbId}')" style="background:#e8650a;color:white">📧 Denial Email</button>`:''}
<!-- Retry button disabled: /api/rerun-plaid currently creates an orphan Processing record. Will re-enable when the backend handler is finished. -->
    ${''}
  </div>
  <div style="display:flex;gap:6px;margin-left:auto">
    <button class="mact-secondary" onclick="copyModal('${fbId}')">⎘ Copy</button>
    <button class="mact-secondary" onclick="delApp('${fbId}')" style="color:var(--red);border-color:var(--red-border)">🗑</button>
  </div>
</div>
<div style="display:flex;border-bottom:1px solid var(--border)">
  <button onclick="mTab('report','${fbId}',this)" id="mtab-report-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--green);border-bottom:2px solid var(--green);cursor:pointer;font-family:var(--sans)">Report</button>
  <button onclick="mTab('appdata','${fbId}',this)" id="mtab-appdata-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">Application</button>
  <button onclick="mTab('docs','${fbId}',this)" id="mtab-docs-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">Documents</button>
  <button onclick="mTab('notes','${fbId}',this)" id="mtab-notes-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">Notes</button>
  <button onclick="mTab('ifcard','${fbId}',this)" id="mtab-ifcard-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">Debit Card${ (a.applicationData && a.applicationData.debitCard) ? ' <span style=&quot;background:#e6f4ea;color:#0a5d2e;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:2px&quot;>on file</span>' : '' }</button>
</div>
</div>
${(a.fcf!=null||a.monthlyIncome!=null||a.v2Confidence!=null)?(()=>{
  // 5-second read of the applicant. Sources:
  //   Income / Obligations / FCF — canonical fields, written by v2.
  //   Max offer + Confidence — sourced from v2's run.
  const fcf = a.fcf||0;
  // Max offer reads v2TierAmount (the FINAL decision tier after hard-declines
  // have run), NOT v2MaxAffordable (which is the pure FCF math, ignoring
  // hard-declines). For someone declined by, say, severe fintech stacking,
  // the actual offer is $0 even though the cash-flow math could afford $255.
  const offer = (typeof a.v2TierAmount==='number') ? a.v2TierAmount : null;
  const conf = (typeof a.v2Confidence==='number') ? a.v2Confidence : null;
  const fcfColor = fcf >= 0 ? 'var(--green)' : 'var(--red)';
  const offerColor = (offer && offer > 0) ? 'var(--green)' : 'var(--muted)';
  // Three-band confidence coloring — matches the auto-approve floor (0.50)
  // in engine_v2/policy/engine.py: below that, v2 flips to REVIEW_REQUIRED.
  const confColor = conf == null ? 'var(--muted)'
    : (conf >= 0.80 ? 'var(--green)'
    : (conf >= 0.60 ? '#a15c00'
    : 'var(--red)'));
  const confPct = conf == null ? '—' : Math.round(conf*100)+'%';
  return `<div class="msummary">
    <div class="msummary-item">
      <div class="msummary-label">Verified income</div>
      <div class="msummary-value" style="color:var(--green)">$${Math.round(a.monthlyIncome||0).toLocaleString()}</div>
      <div class="msummary-sub">monthly</div>
    </div>
    <div class="msummary-item">
      <div class="msummary-label">Obligations</div>
      <div class="msummary-value" style="color:var(--red)">$${Math.round(a.monthlyExpenses||0).toLocaleString()}</div>
      <div class="msummary-sub">committed monthly</div>
    </div>
    <div class="msummary-item">
      <div class="msummary-label">FCF / mo</div>
      <div class="msummary-value" style="color:${fcfColor}">$${Math.round(fcf).toLocaleString()}</div>
      <div class="msummary-sub">free cash flow</div>
    </div>
    <div class="msummary-item">
      <div class="msummary-label">Max offer</div>
      <div class="msummary-value" style="color:${offerColor}">${offer == null ? '—' : ('$' + offer)}</div>
      <div class="msummary-sub">${offer == null ? 'not yet run' : (offer > 0 ? 'v2 offers' : 'declined by v2')}</div>
    </div>
    <div class="msummary-item">
      <div class="msummary-label">Confidence</div>
      <div class="msummary-value" style="color:${confColor}">${confPct}</div>
      <div class="msummary-sub">${conf == null ? 'not yet run' : (conf >= 0.50 ? 'above approve floor' : 'below approve floor')}</div>
    </div>
  </div>`;
})():''}
<div id="mpanel-report-${fbId}">${buildReportPanel(a)}</div>
<div id="mpanel-appdata-${fbId}" style="display:none">${buildAppDetails(a.applicationData||{})}</div>
<div id="mpanel-docs-${fbId}" style="display:none">${buildDocsPanel(a)}</div>
<div id="mpanel-ifcard-${fbId}" style="display:none">${buildIFCardPanel(fbId)}</div>
<div id="mpanel-notes-${fbId}" style="display:none">
  <div style="padding:8px 0">
    <div id="notes-thread-${fbId}" style="max-height:340px;overflow-y:auto;padding:4px 2px;margin-bottom:10px">${renderNotesThread(a)}</div>
    <textarea style="width:100%;min-height:100px;border:1.5px solid var(--border2);border-radius:10px;padding:13px;font-size:13.5px;font-family:var(--sans);color:var(--text);background:var(--bg);resize:vertical;line-height:1.7" id="mnt${fbId}" placeholder="Add a note — observations, conditions, follow-up items..."></textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <button class="nsave" onclick="addThreadedNote('${fbId}')">Post note</button>
      <span style="font-size:11px;color:var(--muted)">Posted as <b>${escHtml(_currentUser || 'you')}</b> with a timestamp.</span>
    </div>
  </div>
</div>

`;
  setTimeout(()=>drawWheel('mwh',a.score||0,90,true),80);
}

function mTab(tab, fbId, btn) {
  const panels = ['report','appdata','docs','notes','ifcard'];
  panels.forEach(p => {
    const el = document.getElementById('mpanel-'+p+'-'+fbId);
    const b = document.getElementById('mtab-'+p+'-'+fbId);
    if (el) el.style.display = p===tab ? 'block' : 'none';
    if (b) { b.style.color = p===tab ? 'var(--green)' : 'var(--muted)'; b.style.borderBottomColor = p===tab ? 'var(--green)' : 'transparent'; }
  });
}

function buildIFCardPanel(fbId) {
  // Debit-card info is now written straight onto the application's
  // Firebase record under applicationData.debitCard at /submit time.
  // If it's there, show it. If it's not, the customer didn't opt in.
  // No vault, no follow-ups, no pending states.
  const app = apps.find(x => x.firebaseId === fbId);
  const dc  = app && app.applicationData && app.applicationData.debitCard;

  if (!dc) {
    return `<div style="text-align:center;padding:2rem;color:var(--muted)">
      <div style="font-size:28px;margin-bottom:8px">💳</div>
      <div style="font-weight:600">No debit card submitted</div>
      <div style="font-size:13px;margin-top:4px">This applicant did not request debit-card funding during the application.</div>
    </div>`;
  }

  const cardholder = ((dc.cardholderFirst || '') + ' ' + (dc.cardholderLast || '')).trim() || '—';
  const panFmt = (dc.cardNumber || '').replace(/\D/g,'').replace(/(.{4})/g,'$1 ').trim() || '—';
  const mm = String(dc.expMonth || '').padStart(2,'0').slice(-2);
  const yy = String(dc.expYear  || '').slice(-2);
  const exp = (mm && yy) ? mm + '/' + yy : '—';

  return `<div style="padding:12px 0">
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:12px">
      <div style="display:grid;grid-template-columns:140px 1fr;gap:8px 14px;font-size:13px;line-height:1.5">
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Cardholder</div>
        <div style="font-weight:600">${_ifEsc(cardholder)}</div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Card type</div>
        <div><strong>${_ifEsc(dc.brand || 'Card')}</strong></div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Card number</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;user-select:all">${_ifEsc(panFmt)}</div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Expiration</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;user-select:all">${_ifEsc(exp)}</div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">CVV</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;user-select:all">${_ifEsc(dc.cvv || '—')}</div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Billing ZIP</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;user-select:all">${_ifEsc(dc.billingZip || '—')}</div>
        <div style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.05em">Submitted</div>
        <div style="color:var(--muted);font-size:12px">${_ifEsc(dc.optedInAt || '—')}</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted)">Click any value above to select it — makes it easy to copy into Vergent.</div>
  </div>`;
}

// Async Debit-Card-panel refresh. Pulls a fresh copy of the
// application from Firebase AND reloads the IF submissions list,
// then if either surfaces new linkage metadata we didn't have
// locally, re-render the panel in place. Guarded by a per-fbId
// in-flight flag so repeated modal opens don't pile up network
// calls.
window._ifRefreshInFlight = window._ifRefreshInFlight || {};
async function _ifRefreshPanel(fbId) {
  if (!fbId || window._ifRefreshInFlight[fbId]) return;
  window._ifRefreshInFlight[fbId] = true;
  let changed = false;
  try {
    const fresh = await fbGet(`reports/${fbId}.json`).catch(()=>null);
    if (fresh && typeof fresh === 'object') {
      const idx = apps.findIndex(x => x.firebaseId === fbId);
      if (idx >= 0) {
        const oldAD = apps[idx].applicationData || {};
        const newAD = fresh.applicationData || {};
        if (oldAD.ifSubmissionId !== newAD.ifSubmissionId ||
            oldAD.ifSubmitError  !== newAD.ifSubmitError  ||
            oldAD.ifCardOptInAt  !== newAD.ifCardOptInAt  ||
            oldAD.ifCardLast4    !== newAD.ifCardLast4    ||
            oldAD.ifCardBrand    !== newAD.ifCardBrand) {
          apps[idx] = {...fresh, firebaseId: fbId};
          changed = true;
          console.log('[IF] refreshed applicationData from Firebase', newAD);
        }
      }
    }
  } catch(e) { console.warn('[IF] fbGet refresh failed', e); }

  // Also pull the IF list in case the vault has metadata we don't.
  try {
    if (typeof loadIFSubmissions === 'function') {
      const beforeKeys = Object.keys(window._ifByApp || {}).length;
      await loadIFSubmissions();
      const afterKeys  = Object.keys(window._ifByApp || {}).length;
      if (afterKeys !== beforeKeys) changed = true;
    }
  } catch(e) { console.warn('[IF] list refresh failed', e); }

  if (changed) {
    const panel = document.getElementById('mpanel-ifcard-' + fbId);
    if (panel) panel.innerHTML = buildIFCardPanel(fbId);
  }
  delete window._ifRefreshInFlight[fbId];
}

function buildAppDetails(d) {
  if (!d) return '<div style="text-align:center;padding:2rem;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📋</div><div style="font-weight:600">No application data</div><div style="font-size:13px;margin-top:4px">This submission was not made through the online form</div></div>';
  // Check if all meaningful fields are empty
  const hasData = d.firstName||d.lastName||d.phone||d.email||d.ssn||d.address||d.bankName||d.statementStart;
  if (!hasData) return '<div style="text-align:center;padding:2rem;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📋</div><div style="font-weight:600">Application data unavailable</div><div style="font-size:13px;margin-top:4px">This submission may have been processed before form data capture was enabled. Ask the customer to reapply.</div></div>';
  const uid = Math.random().toString(36).slice(2,8);
  function row(label, value, id) {
    if (!value) return '';
    const eid = 'adv-'+id+'-'+uid;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);gap:12px">
      <span style="font-size:13px;color:var(--muted);font-weight:500;min-width:150px;flex-shrink:0">${label}</span>
      <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;text-align:right" id="${eid}">${value}</span>
      <button onclick="copyField('${eid}')" style="flex-shrink:0;background:var(--green-light);border:1px solid var(--green-border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--green);cursor:pointer;font-family:var(--sans);white-space:nowrap">Copy</button>
    </div>`;
  }
  function sec(title) { return `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:16px 0 4px;padding-top:8px;border-top:2px solid var(--border)">${title}</div>`; }
  return `<div style="padding:4px 0 16px">
    ${sec('Personal Information')}
    ${row('First Name', d.firstName, 'fname')}
    ${row('Middle Name', d.middleName, 'mname')}
    ${row('Last Name', d.lastName, 'lname')}
    ${row('Date of Birth', d.dob, 'dob')}
    ${row('SSN', d.ssn ? String(d.ssn).replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3') : '', 'ssn')}
    ${row('Address', d.address, 'addr')}
    ${row('Address Line 2', d.address2, 'addr2')}
    ${row('City', d.city, 'city')}
    ${row('State', d.state, 'state')}
    ${row('ZIP', d.zip, 'zip')}
    ${row('Phone', d.phone, 'phone')}
    ${row('Email', d.email, 'email')}
    ${sec('Loan Request')}
    ${row('Loan Amount', d.loanAmount ? '$'+d.loanAmount : '', 'loanamt')}
    ${sec('Source of Income & Employment')}
    ${row('Source of Income', d.sourceOfIncome, 'src')}
    ${row('Employer Name', d.employer, 'employer')}
    ${row('Pay Frequency', d.payFrequency, 'payfreq')}
    ${row('Pay Day', d.payDay, 'payday')}
    ${row('Last Pay Date', d.lastPayDate, 'lastpay')}
    ${row('Payment Method', d.paymentMethod, 'paymethod')}
    ${row('Gross Pay Per Check', d.grossPay ? '$'+d.grossPay : '', 'grosspay')}
    ${sec('Banking Information')}
    ${row('Account Type', d.accountType, 'accttype')}
    ${row('Routing Number', d.routingNumber, 'routing')}
    ${row('Account Number', d.accountNumber, 'acctnum')}
    ${row('Bank Name', d.bankName, 'bankname')}
    ${row('Statement Start', d.statementStart, 'ststart')}
    ${row('Statement End', d.statementEnd, 'stend')}
    ${row('Beginning Balance', d.beginningBalance!=null&&d.beginningBalance!=='' ? '$'+Number(d.beginningBalance).toLocaleString(undefined,{minimumFractionDigits:2}) : '', 'begbal')}
    ${row('Ending Balance', d.endingBalance!=null&&d.endingBalance!=='' ? '$'+Number(d.endingBalance).toLocaleString(undefined,{minimumFractionDigits:2}) : '', 'endbal')}
    ${row('Avg Daily Balance', d.avgDailyBalance!=null&&d.avgDailyBalance!=='' ? '$'+Number(d.avgDailyBalance).toLocaleString(undefined,{minimumFractionDigits:2}) : '', 'avgbal')}
    ${sec('Financial Information')}
    ${row('Housing Status', d.housingStatus, 'housing')}
    ${row('Bankruptcy', d.bankruptcy, 'bk')}
    ${row('Military Status', d.military, 'mil')}
    ${sec('Bank Verification')}
    ${row('Method', d.bankMethod, 'bankmethod')}
    ${row('Submitted', d.submittedAt ? new Date(d.submittedAt).toLocaleString() : '', 'submitted')}
    ${row('Language', d.language === 'es' ? 'Spanish' : 'English', 'lang')}
  </div>`;
}

function buildDocsPanel(a) {
  let html = '<div style="display:flex;flex-direction:column;gap:16px;padding:4px 0">';

  function urlSection(title, url, icon) {
    if (!url) return '';
    const isPdf = url.includes('.pdf') || url.includes('asset_report') || url.includes('bank_statement') || url.includes('paystub');
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="padding:12px 16px;background:var(--green-light);border-bottom:1px solid var(--green-border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:700;color:var(--green-dark)">${icon} ${title}</div>
        <div style="display:flex;gap:6px">
          <a href="${url}" target="_blank" rel="noopener" style="background:var(--green);color:white;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--sans);text-decoration:none">👁 View</a>
          <button onclick="downloadDoc('${url}','${title.replace(/'/g,'\'')}')" style="background:white;color:var(--green);border:1.5px solid var(--green-border);border-radius:7px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--sans)">⬇ Download</button>
        </div>
      </div>
      <div style="padding:14px 16px;text-align:center">
        ${isPdf
          ? '<iframe src="'+url+'" style="width:100%;height:350px;border:none;border-radius:8px;background:var(--bg)" loading="lazy"></iframe>'
          : '<img src="'+url+'" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;background:var(--bg)" loading="lazy" onerror="this.outerHTML=\'<div style=padding:20px;color:var(--muted)>Preview unavailable — click View</div>\'" />'}
      </div>
    </div>`;
  }

  function b64Section(title, b64, type, icon) {
    if (!b64) return '';
    const isImage = type && type.match(/image/);
    const mimeType = isImage ? 'image/jpeg' : 'application/pdf';
    const dataUrl = 'data:'+mimeType+';base64,'+b64;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="padding:12px 16px;background:var(--green-light);border-bottom:1px solid var(--green-border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:700;color:var(--green-dark)">${icon} ${title}</div>
        <button onclick="viewDoc('${b64}','${mimeType}')" style="background:var(--green);color:white;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--sans)">👁 View</button>
      </div>
      <div style="padding:14px;text-align:center">
        ${isImage
          ? '<img src="'+dataUrl+'" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;background:var(--bg)" loading="lazy" />'
          : '<iframe src="'+dataUrl+'" style="width:100%;height:350px;border:none;border-radius:8px;background:var(--bg)" loading="lazy"></iframe>'}
      </div>
    </div>`;
  }

  // New system — Firebase Storage URLs
  if (a.govIdUrl || a.bankStatementUrl || a.paystubUrl) {
    html += urlSection('Government ID', a.govIdUrl, '🩪');
    html += urlSection('Plaid Asset Report / Bank Statement', a.bankStatementUrl, '🏦');
    html += urlSection('Proof of Income / Pay Stubs', a.paystubUrl, '📑');
  } else if (a.govIdB64 || a.bankStatementB64 || a.paystubB64) {
    // Old base64 fallback
    html += b64Section('Government ID', a.govIdB64, 'image/jpeg', '🩪');
    html += b64Section('Bank Statement', a.bankStatementB64, 'application/pdf', '🏦');
    html += b64Section('Pay Stubs', a.paystubB64, 'image/jpeg', '📑');
  } else {
    html += `<div style="background:var(--pale);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;color:var(--muted)">
      <div style="font-size:28px;margin-bottom:8px">⏳</div>
      <div style="font-weight:700;margin-bottom:6px;color:var(--text2)">Documents processing...</div>
      <div style="font-size:13px">Files are being uploaded. Refresh in a moment if just submitted.</div>
    </div>`;
  }

  html += '</div>';
  return html;
}

function viewDoc(b64, mimeType) {
  const byteChars = atob(b64);
  const byteArr = new Uint8Array(byteChars.length);
  for (let i=0; i<byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArr], {type: mimeType});
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let ssnTimer = null;
function toggleSSN(fbId, fullSSN) {
  const display = document.getElementById('modal-ssn-display-'+fbId);
  const btn = document.getElementById('ssn-eye-'+fbId);
  if (!display) return;
  const isHidden = display.textContent.includes('X');
  if (isHidden) {
    display.textContent = fullSSN;
    btn.textContent = '🙈';
    clearTimeout(ssnTimer);
    ssnTimer = setTimeout(() => {
      display.textContent = fullSSN.replace(/^(\d{3}-\d{2}-)(\d{4})$/, 'XXX-XX-$2');
      btn.textContent = '👁';
    }, 10000);
  } else {
    display.textContent = fullSSN.replace(/^(\d{3}-\d{2}-)(\d{4})$/, 'XXX-XX-$2');
    btn.textContent = '👁';
    clearTimeout(ssnTimer);
  }
}

function copySSN(ssn) {
  navigator.clipboard.writeText(ssn).then(() => toast('SSN copied ✓', 'ok'));
}

function copyField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim()).then(() => toast('Copied ✓','ok'));
}

async function downloadDoc(url, filename) {
  try {
    toast('Downloading...', '');
    const resp = await fetch(url);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast('Downloaded ✓', 'ok');
  } catch(e) {
    // Fallback — open in new tab if fetch fails (CORS)
    window.open(url, '_blank');
  }
}

// ── Threaded notes ──
// Legacy shape: a.notes is a single string. New shape: a.notesThread is an
// array of {author, at, text}. renderNotesThread handles both: any legacy
// string gets shown as a single read-only "imported" entry at the top.
function renderNotesThread(a) {
  const thread = Array.isArray(a.notesThread) ? a.notesThread.slice() : [];
  const legacy = typeof a.notes === 'string' ? a.notes.trim() : '';
  const entries = [];
  if (legacy) {
    entries.push({ author: '(imported)', at: a.updatedAt || a.createdAt || 0, text: legacy, legacy: true });
  }
  entries.push(...thread);
  entries.sort((x, y) => (y.at || 0) - (x.at || 0));
  if (!entries.length) {
    return '<div style="font-size:12px;color:var(--muted);padding:10px;text-align:center">No notes yet. Add the first one below.</div>';
  }
  return entries.map(e => {
    const when = e.at ? new Date(e.at).toLocaleString() : '(no date)';
    return `<div style="border-left:3px solid ${e.legacy ? '#ccd6ce' : 'var(--green)'};padding:8px 12px;margin-bottom:8px;background:${e.legacy?'#f7faf7':'#fff'};border-radius:0 8px 8px 0">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px"><b style="color:var(--text)">${escHtml(e.author || 'unknown')}</b> · ${escHtml(when)}${e.legacy ? ' · <span style="color:#a15c00">imported</span>' : ''}</div>
      <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap">${escHtml(e.text || '')}</div>
    </div>`;
  }).join('');
}

async function addThreadedNote(fbId) {
  const ta = document.getElementById('mnt' + fbId);
  if (!ta) return;
  const text = (ta.value || '').trim();
  if (!text) { toast('Write something first', 'err'); return; }
  const a = apps.find(x => x.firebaseId === fbId);
  if (!a) return;
  const thread = Array.isArray(a.notesThread) ? a.notesThread.slice() : [];
  thread.push({
    author: _currentUser || 'unknown',
    at: Date.now(),
    text,
  });
  await updateReport(fbId, { notesThread: thread });
  a.notesThread = thread;
  ta.value = '';
  const container = document.getElementById('notes-thread-' + fbId);
  if (container) container.innerHTML = renderNotesThread(a);
  logAudit('note.added', a.name || fbId, text.slice(0, 80));
  toast('Note posted', 'ok');
}

// Legacy single-blob save path kept for any lingering callers.
async function saveModalNotes(fbId){const ta=document.getElementById('mnt'+fbId);if(!ta)return;await updateReport(fbId,{notes:ta.value});toast('Notes saved','ok');}
async function updStatus(fbId,s){
  const a = apps.find(x => x.firebaseId === fbId);
  await updateReport(fbId,{status:s});
  logAudit(`decision.${s.toLowerCase()}`, a?.name || fbId, `amount=${a?.amount || '-'}`);
  await loadReports();openModal(fbId);toast('Updated to '+s,'ok');
}
async function updStatusWithAmt(fbId,s){
  const inp=document.getElementById('modal-approve-amt');
  const amt=inp?inp.value.trim():'';
  const final=amt?'$'+amt.replace('$',''):'N/A';
  const a = apps.find(x => x.firebaseId === fbId);
  await updateReport(fbId,{status:s,amount:final});
  logAudit(`decision.${s.toLowerCase()}`, a?.name || fbId, `amount=${final}`);
  await loadReports();openModal(fbId);toast('Updated to '+s,'ok');
}
function copyModal(fbId){const a=apps.find(x=>x.firebaseId===fbId);if(a){const t=document.createElement('div');t.innerHTML=a.report;navigator.clipboard.writeText(t.textContent).then(()=>toast('Copied ✓','ok'));}}

// ════════════════════════════════════════
// REPORT PANEL — single tab combining re-run controls + v2 report
// + (during transition) v1 shadow one-liner for audit comparison.
// ════════════════════════════════════════
function buildReportPanel(a) {
  const fbId = a.firebaseId;
  const hasRun = a.v2Decision && a.v2Report;
  const runAt = a.v2RunAt ? new Date(a.v2RunAt).toLocaleString() : '';
  const canRefresh = !!a.plaidAssetToken;
  const acctCount = a.connectedAccountCount;
  const refreshedAt = a.plaidRefreshedAt ? new Date(a.plaidRefreshedAt).toLocaleString() : '';

  // Re-run controls — always available so staff can force a re-evaluation
  // with stored data or fresh-pulled Plaid data.
  const rerunHeader = `
    <div style="padding:10px 12px;background:#f8f8f8;border-radius:8px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button onclick="runV2('${fbId}')" id="v2run-${fbId}"
                style="background:#1a6b3c;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          ${hasRun ? 'Re-run with stored data' : 'Run engine'}
        </button>
        ${canRefresh ? `
          <button onclick="refreshFromPlaid('${fbId}')" id="plaidref-${fbId}"
                  title="Pulls fresh data from Plaid across ALL connected accounts, then re-runs. Use this when you suspect the stored extraction missed an account."
                  style="background:#fff8e5;color:#6b4d00;border:1px solid #f2d46c;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
            Refresh from Plaid &amp; Re-run
          </button>
        ` : ''}
        ${a.bankStatementUrl ? `
          <button onclick="pushPlaidToVergent('${fbId}')" id="vergentpush-${fbId}"
                  title="Upload the Plaid asset report PDF to this applicant's Vergent customer record (resolved by SSN + DOB + name). Operator workflow shortcut."
                  style="background:#e8f3f8;color:#1a4d6b;border:1px solid #6cb1e2;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
            ${a.vergentPushedAt ? '↻ Re-push to Vergent' : '↗ Push to Vergent'}
          </button>
        ` : ''}
      </div>
      <div style="font-size:11px;color:#888;text-align:right">
        ${hasRun ? `Last run: ${runAt}` : 'Not yet run'}
        ${refreshedAt ? `<br>Plaid refreshed: ${refreshedAt}` : ''}
        ${acctCount ? `<br><b>${acctCount} Plaid account${acctCount > 1 ? 's' : ''}</b>` : ''}
        ${a.vergentPushedAt ? `<br><span style="color:#1a4d6b">✓ Vergent pushed ${new Date(a.vergentPushedAt).toLocaleString()}</span>` : ''}
      </div>
    </div>
  `;

  // Main report body — Processing/Error/Done states.
  const body = `<div class="mrhtml">${
    a.status==='Processing' || (!a.report && !a.processingComplete) ?
    `<div style="text-align:center;padding:3rem 2rem">
      <div style="width:48px;height:48px;border:4px solid var(--green-light);border-top-color:var(--green);border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 20px"></div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">Underwriting in Progress</div>
      <div style="font-size:13px;color:var(--muted)">The engine is analyzing the bank statement.<br>This typically takes 1–3 minutes. Page updates automatically.</div>
    </div>` :
    a.status==='Error' ?
    `<div style="text-align:center;padding:3rem 2rem;color:var(--red)">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:8px">Processing Error</div>
      <div style="font-size:13px;color:var(--muted)">${a.error||'An error occurred during analysis.'}</div>
    </div>` :
    highlightTierBreakdown(stripFences(a.report||''))
  }</div>`;

  return rerunHeader + body;
}



async function runV2(fbId) {
  const btn = document.getElementById('v2run-'+fbId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:6px;vertical-align:-2px"></span> Running...'; }
  try {
    const resp = await fetch('/api/rerun-v2', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json','X-Session':getToken()},
      body: JSON.stringify({firebase_id: fbId})
    });
    const data = await resp.json();
    if (!resp.ok) {
      toast(data.error || 'v2 run failed', 'err');
      if (btn) { btn.disabled = false; btn.innerHTML = '🔬 Run with v2'; }
      return;
    }
    toast('v2 decision: '+String(data.decision||'').toUpperCase()+' $'+(data.tier_amount||0), 'ok');
    // Refresh the report in the local cache & rerender
    const a = apps.find(x=>x.firebaseId===fbId);
    if (a) {
      a.v2Decision = (data.decision||'').toUpperCase();
      a.v2TierAmount = data.tier_amount;
      a.v2MaxAffordable = data.max_affordable_loan;
      a.v2Confidence = data.confidence;
      a.v2Report = data.report_html;
      a.v2ReasonsJson = JSON.stringify(data.reasons || []);
      a.v2ReconciliationOk = data.reconciliation_ok;
      a.v2ReconciliationError = data.reconciliation_error;
      a.v2AutoDecide = !!data.auto_decide_candidate;
      a.v2RunAt = Date.now();
    }
    // Rerender the Report panel (now holds both re-run controls + the v2 report
    // body; v2 Engine tab was folded into Report).
    const panel = document.getElementById('mpanel-report-'+fbId);
    if (panel && a) panel.innerHTML = buildReportPanel(a);
  } catch (e) {
    toast('v2 run error: '+e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = '🔬 Run with v2'; }
  }
}

// Re-fetches the Plaid asset report using the stored access token, runs it
// through the new multi-account extractor, overwrites extractedData in
// Firebase, then re-runs v2. Use this when you suspect the original
// extraction missed an account (Jairo Canas pattern — payroll was in a
// second Plaid-connected account that the old extractor discarded).
async function refreshFromPlaid(fbId) {
  if (!confirm(
    'Refresh this applicant\'s data from Plaid?\n\n' +
    'This pulls a fresh asset report across ALL connected accounts and re-runs v2. ' +
    'Takes up to ~2 minutes. v1 decision is not changed automatically.'
  )) return;

  const btn = document.getElementById('plaidref-'+fbId);
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #6b4d00;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:6px;vertical-align:-2px"></span> Fetching from Plaid...';
  }
  try {
    const resp = await fetch('/api/refresh-from-plaid', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ firebase_id: fbId }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      toast(data.error || 'Refresh failed', 'err');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = 'Refresh from Plaid &amp; Re-run'; }
      return;
    }
    const n = data.connected_account_count || 1;
    const income = (data.v2_verified_income_monthly || 0).toFixed(0);
    toast(
      `Plaid refreshed: ${n} account${n>1?'s':''}, ${data.transaction_count} txns. ` +
      `v2 says ${String(data.v2_decision || '').toUpperCase()} — verified income $${income}/mo.`,
      'ok'
    );
    logAudit('plaid.refreshed', fbId, `${n} accounts, v2 ${data.v2_decision}`);
    await loadReports();
    openModal(fbId);
  } catch (e) {
    toast('Refresh error: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = 'Refresh from Plaid &amp; Re-run'; }
  }
}

// Push the Plaid asset report PDF to the applicant's Vergent customer
// record. Resolves the Vergent customerId via SSN+name+DOB search; if 0
// matches we suggest creating the customer in Vergent first; if 2+ we
// surface the candidate list so the operator can pick one to override.
async function pushPlaidToVergent(fbId, overrideCustomerId) {
  if (!overrideCustomerId && !confirm(
    'Push the Plaid asset report PDF to this applicant\'s Vergent customer record?\n\n' +
    'We\'ll search Vergent by SSN + DOB + name and upload the PDF as a customer document.'
  )) return;
  const btn = document.getElementById('vergentpush-' + fbId);
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #1a4d6b;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:6px;vertical-align:-2px"></span> Pushing to Vergent...';
  }
  try {
    const body = { firebase_id: fbId };
    if (overrideCustomerId) body.vergent_customer_id = String(overrideCustomerId);
    const resp = await fetch('/api/push-plaid-to-vergent', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (resp.status === 409 && data.error === 'customer_ambiguous' && Array.isArray(data.candidates)) {
      // Multiple Vergent customers matched. Let the operator pick.
      const choice = prompt(
        'Multiple Vergent customers matched this applicant. Paste the customerId to use:\n\n' +
        data.candidates.slice(0, 6).map((c, i) =>
          `  ${i+1}. customerId=${c.customerId||c.CustomerId||'?'}  ${c.firstName||''} ${c.lastName||''}`
        ).join('\n'),
        ''
      );
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '↗ Push to Vergent'; }
      if (choice && choice.trim()) return pushPlaidToVergent(fbId, choice.trim());
      return;
    }
    if (resp.status === 404 && data.error === 'customer_not_found_in_vergent') {
      toast('No Vergent customer matched. Create the customer in Vergent first, then retry.', 'err');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '↗ Push to Vergent'; }
      return;
    }
    if (data.error === 'vergent_upload_all_paths_failed' && Array.isArray(data.attempts)) {
      // Every (host, path) candidate IIS-404'd — Vergent hasn't exposed
      // the upload endpoint at any URL we know to try. Surface the full
      // attempt log so the operator can paste it into a Vergent ticket.
      const lines = data.attempts.map((a, i) =>
        `  ${i+1}. ${a.url} → HTTP ${a.status}${a.is_iis_404 ? ' (IIS 404)' : ''}`
      ).join('\n');
      const summary = 'Vergent has not exposed the document upload endpoint at any URL we know.\n\n' +
                      'Tried:\n' + lines + '\n\n' +
                      'Action: open a Vergent support ticket with the URL list above and ' +
                      'ask for the canonical document-upload endpoint for service-account ' +
                      'uploads to a customer record (company 386).';
      console.error('[VERGENT UPLOAD all paths 404]', data.attempts);
      alert(summary);
      toast('Vergent upload endpoint not found — see alert for support-ticket details.', 'err');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '↗ Push to Vergent'; }
      return;
    }
    if (!resp.ok || !data.ok) {
      toast(data.detail || data.error || 'Vergent push failed', 'err');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '↗ Push to Vergent'; }
      return;
    }
    toast(
      `Pushed to Vergent (customer ${data.vergentCustomerId}, ${(data.pdf_bytes/1024).toFixed(0)} KB).`,
      'ok'
    );
    logAudit('vergent.pushed', fbId, `customer=${data.vergentCustomerId} doc=${data.vergentDocumentId}`);
    await loadReports();
    openModal(fbId);
  } catch (e) {
    toast('Vergent push error: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '↗ Push to Vergent'; }
  }
}

async function delApp(fbId){if(!confirm('Delete this application?'))return;await fbDelete(`reports/${fbId}.json`);closeModal();await loadReports();toast('Deleted','ok');}

// ════════════════════════════════════════
// AUDIT LOG
// Writes to Firebase /audit/<id> on every decision/note/delete/user action.
// Admin page reads the last 200 entries, newest first. [AUDIT] log lines
// still appear in Render for server-side actions; this captures the
// client-driven ones too.
// ════════════════════════════════════════
async function logAudit(action, targetName, details) {
  try {
    const rec = {
      action,
      user: _currentUser || 'unknown',
      target: targetName || '',
      at: Date.now(),
      details: details || '',
    };
    // Firebase RTDB doesn't have server-gen IDs without POST, but we use PATCH
    // via our proxy which defaults to "update under this key". Use a
    // client-generated ordered key (timestamp + rand) for easy newest-first sort.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fbPatch(`audit/${id}.json`, rec);
  } catch (e) { /* audit failure shouldn't block the action */ }
}

async function loadAuditLog() {
  const box = document.getElementById('audit-table');
  if (!box) return;
  box.innerHTML = `<div style="padding:40px;text-align:center;color:#888">Loading audit log…</div>`;
  try {
    const data = await fbGet('audit.json');
    const rows = Object.entries(data || {})
      .map(([id, r]) => ({ id, ...(r || {}) }))
      .filter(r => r.at)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 200);
    if (!rows.length) {
      box.innerHTML = `<div class="empty" style="padding:3rem;text-align:center"><div class="empty-ic"><svg class="icn icn-lg" style="width:36px;height:36px;color:var(--muted2)"><use href="#icn-file"/></svg></div><div class="empty-t">No audit events yet</div><div class="empty-s">Decisions, notes, deletions, and user-management actions will show up here.</div></div>`;
      return;
    }
    const tbody = rows.map(r => {
      const when = new Date(r.at).toLocaleString();
      const actionColor = r.action?.startsWith('decision.approve') ? '#1a6b3c' : r.action?.startsWith('decision.decline') || r.action?.startsWith('report.delete') ? '#c0392b' : r.action?.startsWith('user.') ? '#1d4ed8' : '#475';
      return `<tr>
        <td style="padding:8px 12px;font-size:12px;color:#555;white-space:nowrap">${escHtml(when)}</td>
        <td style="padding:8px 12px;font-weight:600">${escHtml(r.user || '?')}</td>
        <td style="padding:8px 12px"><span style="color:${actionColor};font-family:var(--mono);font-size:12px;font-weight:600">${escHtml(r.action || '')}</span></td>
        <td style="padding:8px 12px">${escHtml(r.target || '')}</td>
        <td style="padding:8px 12px;font-size:12px;color:#555">${escHtml(r.details || '')}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--surface2)">
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">When</th>
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">User</th>
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Action</th>
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Target</th>
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Details</th>
      </tr></thead>
      <tbody>${tbody}</tbody></table>`;
  } catch (e) {
    box.innerHTML = `<div style="padding:30px;text-align:center;color:#c0392b">Failed to load audit log: ${escHtml(e.message)}</div>`;
  }
}

async function exportAuditCSV() {
  try {
    const data = await fbGet('audit.json');
    const rows = Object.values(data || {}).filter(r => r && r.at).sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!rows.length) { toast('Nothing to export', 'err'); return; }
    const header = ['When', 'User', 'Action', 'Target', 'Details'];
    const csv = [header, ...rows.map(r => [new Date(r.at).toISOString(), r.user || '', r.action || '', r.target || '', r.details || ''])]
      .map(r => r.map(_csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cif-audit-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} rows`, 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'err'); }
}

// ════════════════════════════════════════
// DUPE DETECTION
// Scans the already-loaded apps array for prior applications from the same
// person (phone, SSN last-4, or normalized name). Banner appears above the
// modal header. Zero backend work — everything we need is already in memory.
// ════════════════════════════════════════
function _normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}
function _digits(s) { return String(s || '').replace(/\D/g, ''); }

function _findDupes(target) {
  const tPhone = _digits(target.applicationData?.phone);
  const tSsn = _digits(target.applicationData?.ssn).slice(-4);
  const tName = _normName(target.formName || target.name);
  const hits = [];
  for (const a of apps) {
    if (!a || a.firebaseId === target.firebaseId) continue;
    const aPhone = _digits(a.applicationData?.phone);
    const aSsn = _digits(a.applicationData?.ssn).slice(-4);
    const aName = _normName(a.formName || a.name);
    let matchedOn = null;
    if (tPhone && aPhone && tPhone === aPhone) matchedOn = 'phone';
    else if (tSsn && aSsn && tSsn.length === 4 && tSsn === aSsn) matchedOn = 'SSN last-4';
    else if (tName && aName && tName === aName) matchedOn = 'name';
    if (matchedOn) hits.push({ app: a, on: matchedOn });
  }
  // Most recent first — helps underwriter spot the last decision fast.
  return hits.sort((x, y) => (y.app.createdAt || 0) - (x.app.createdAt || 0));
}

function _buildDupeBanner(a) {
  const hits = _findDupes(a);
  if (!hits.length) return '';
  const rows = hits.slice(0, 5).map(h => {
    const when = h.app.createdAt ? new Date(h.app.createdAt).toLocaleDateString() : '(no date)';
    const statusColor = h.app.status === 'Approved' ? '#1a6b3c' : h.app.status === 'Declined' ? '#c0392b' : '#6b7c72';
    return `<li style="margin:3px 0">
      <a href="#" onclick="event.preventDefault();openModal('${h.app.firebaseId}')" style="color:#b3261e;text-decoration:underline;font-weight:600">${h.app.name || '(no name)'}</a>
      — matched on ${h.on} ·
      <span style="color:${statusColor};font-weight:700">${h.app.status || 'Pending'}</span>
      ${h.app.amount ? ' · ' + h.app.amount : ''}
      <span style="color:#6b7c72">· ${when}</span>
    </li>`;
  }).join('');
  const extra = hits.length > 5 ? `<div style="font-size:11px;color:#6b7c72;margin-top:4px">+${hits.length - 5} more</div>` : '';
  return `
    <div style="background:#fdecea;border:1px solid #f1baba;border-left:4px solid #b3261e;color:#6b1410;padding:12px 16px;margin:0 0 12px 0;border-radius:8px">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">⚠ ${hits.length} prior application${hits.length>1?'s':''} from this applicant</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.6">${rows}</ul>
      ${extra}
    </div>`;
}

function closeModal(opts){
  opts = opts || {};
  // Two close paths because we now host two independent detail UIs:
  //   1. Application detail — full-page view (#view-detail). Back =
  //      navigate to dashboard via the hash router.
  //   2. Overlay modal — #ov, still used by revealIFCard for the IF
  //      card quick-reveal flow. Back = just close the overlay.
