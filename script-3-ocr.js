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

// ── Recalculate decision with transaction overrides ──
window.recalculateDecision = async function(firebaseId) {
  const overrides = window.__txnOverrides || {};
  const changes = Object.keys(overrides);
  if (!changes.length) { toast('No changes to recalculate','warn'); return; }

  // Find the firebase ID — either passed directly or from the currently open modal/report
  const fbId = firebaseId || sPendingId || (window._currentModalFbId || '');
  if (!fbId) { toast('No application ID found — save application first','warn'); return; }

  const btn = document.getElementById('recalc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Recalculating...'; }

  try {
    // Build transaction_overrides array from the changes map
    const txnOverrides = changes.map(idx => ({
      index: parseInt(idx),
      category: overrides[idx].category || undefined,
      counted: overrides[idx].counted !== undefined ? overrides[idx].counted : undefined,
    }));

    const resp = await fetch('/api/rerun-engine', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json', 'X-Session': getToken()},
      body: JSON.stringify({ firebase_id: fbId, overrides: { transaction_overrides: txnOverrides } })
    });
    if (!resp.ok) throw new Error('Rerun failed: ' + resp.status);
    const data = await resp.json();

    // Update the report display
    const newHtml = data.report_html || '';
    const reportEl = document.getElementById('srhtml');
    if (reportEl && newHtml) reportEl.innerHTML = highlightTierBreakdown(newHtml);
    // Also update modal report if open
    const modalEl = document.getElementById('mpanel-report-' + fbId);
    if (modalEl && newHtml) modalEl.innerHTML = '<div class="mrhtml">' + highlightTierBreakdown(newHtml) + '</div>';

    // Update hero/badge
    const ok = data.decision === 'APPROVED';
    const dhero = document.getElementById('dhero');
    if (dhero) dhero.className = 'dhero ' + (ok ? 'approved' : 'declined');
    const badge = document.getElementById('dbadge');
    if (badge) { badge.className = 'dbadge ' + (ok ? 'approved' : 'declined'); badge.textContent = ok ? '✓ Approved' : '✕ Declined'; }
    const amtIn = document.getElementById('amtin');
    if (amtIn && ok) amtIn.value = data.amount;

    // Clear overrides
    window.__txnOverrides = {};
    toast('Decision recalculated — ' + data.decision + (ok ? ' $' + data.amount : ''), ok ? 'ok' : 'warn');

    // Refresh the app list to pick up updated Firebase data
    setTimeout(() => loadReports(), 1000);
  } catch (e) {
    console.error('Recalculate error:', e);
    toast('Recalculation failed: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Recalculate Decision'; }
  }
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