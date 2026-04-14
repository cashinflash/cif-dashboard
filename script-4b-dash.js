  const isPendingReview = effectiveDecision==='PENDING_REVIEW';
  const dc = ok?'ok':isDeclined?'no':isProcessing?'pending':'';
  document.getElementById('mtitle').textContent=a.formName||a.name||'Application';
  document.getElementById('mbody').innerHTML=`
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
    ${(a.status==='Error'||a.status==='Processing')&&a.plaidAccessToken?`<button class="mact-primary" onclick="rerunFromModal('${fbId}')" style="background:var(--blue);color:white">↺ Retry</button>`:''}
  </div>
  <div style="display:flex;gap:6px;margin-left:auto">
    <button class="mact-secondary" onclick="copyModal('${fbId}')">⎘ Copy</button>
    <button class="mact-secondary" onclick="delApp('${fbId}')" style="color:var(--red);border-color:var(--red-border)">🗑</button>
  </div>
</div>
<div style="display:flex;border-bottom:1px solid var(--border)">
  <button onclick="mTab('report','${fbId}',this)" id="mtab-report-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--green);border-bottom:2px solid var(--green);cursor:pointer;font-family:var(--sans)">📄 Report</button>
  <button onclick="mTab('appdata','${fbId}',this)" id="mtab-appdata-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">📋 Application</button>
  <button onclick="mTab('docs','${fbId}',this)" id="mtab-docs-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">📁 Documents</button>
  <button onclick="mTab('notes','${fbId}',this)" id="mtab-notes-${fbId}" style="padding:10px 16px;border:none;background:none;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;font-family:var(--sans)">📝 Notes</button>
</div>
</div>
${(a.fcf!=null||a.monthlyIncome!=null)?`<div class="msummary">
  <div class="msummary-item"><div class="msummary-label">Income</div><div class="msummary-value" style="color:var(--green)">$${Math.round(a.monthlyIncome||0).toLocaleString()}</div></div>
  <div class="msummary-item"><div class="msummary-label">Expenses</div><div class="msummary-value" style="color:var(--red)">$${Math.round(a.monthlyExpenses||0).toLocaleString()}</div></div>
  <div class="msummary-item"><div class="msummary-label">FCF</div><div class="msummary-value" style="color:${(a.fcf||0)>=0?'var(--green)':'var(--red)'}">$${Math.round(a.fcf||0).toLocaleString()}</div></div>
  <div class="msummary-item"><div class="msummary-label">Fintech</div><div class="msummary-value">${a.fintechCount||0}</div></div>
  <div class="msummary-item"><div class="msummary-label">NSFs</div><div class="msummary-value">${a.nsfCount||0}</div></div>
</div>`:''}
<div id="mpanel-report-${fbId}"><div class="mrhtml">${
  a.status==='Processing' || (!a.report && !a.processingComplete) ?
  `<div style="text-align:center;padding:3rem 2rem">
    <div style="width:48px;height:48px;border:4px solid var(--green-light);border-top-color:var(--green);border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 20px"></div>
    <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">Underwriting in Progress</div>
    <div style="font-size:13px;color:var(--muted)">Claude is analyzing the bank statement.<br>This typically takes 1–3 minutes. Page updates automatically.</div>
  </div>` :
  a.status==='Error' ?
  `<div style="text-align:center;padding:3rem 2rem;color:var(--red)">
    <div style="font-size:32px;margin-bottom:12px">⚠️</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">Processing Error</div>
    <div style="font-size:13px;color:var(--muted)">${a.error||'An error occurred during analysis.'}</div>
  </div>` :
  highlightTierBreakdown(stripFences(a.report||''))
}</div></div>
<div id="mpanel-appdata-${fbId}" style="display:none">${buildAppDetails(a.applicationData||{})}</div>
<div id="mpanel-docs-${fbId}" style="display:none">${buildDocsPanel(a)}</div>
<div id="mpanel-notes-${fbId}" style="display:none">
  <div style="padding:8px 0">
    <textarea style="width:100%;min-height:160px;border:1.5px solid var(--border2);border-radius:10px;padding:13px;font-size:13.5px;font-family:var(--sans);color:var(--text);background:var(--bg);resize:vertical;line-height:1.7" id="mnt${fbId}" placeholder="Add underwriter notes — observations, conditions, follow-up items...">${a.notes||''}</textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <button class="nsave" onclick="saveModalNotes('${fbId}')">Save Notes</button>
      <span style="font-size:11px;color:var(--muted)">Auto-saves as you type</span>
    </div>
  </div>
</div>

`;
  document.getElementById('ov').classList.add('open');
  setTimeout(()=>drawWheel('mwh',a.score||0,90,true),80);
}

function mTab(tab, fbId, btn) {
  const panels = ['report','appdata','docs','notes'];
  panels.forEach(p => {
    const el = document.getElementById('mpanel-'+p+'-'+fbId);
    const b = document.getElementById('mtab-'+p+'-'+fbId);
    if (el) el.style.display = p===tab ? 'block' : 'none';
    if (b) { b.style.color = p===tab ? 'var(--green)' : 'var(--muted)'; b.style.borderBottomColor = p===tab ? 'var(--green)' : 'transparent'; }
  });
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
    html += urlSection('Government ID', a.govIdUrl, '🪪');
    html += urlSection('Plaid Asset Report / Bank Statement', a.bankStatementUrl, '🏦');
    html += urlSection('Proof of Income / Pay Stubs', a.paystubUrl, '📑');
  } else if (a.govIdB64 || a.bankStatementB64 || a.paystubB64) {
    // Old base64 fallback
    html += b64Section('Government ID', a.govIdB64, 'image/jpeg', '🪪');
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

async function saveModalNotes(fbId){const ta=document.getElementById('mnt'+fbId);if(!ta)return;await updateReport(fbId,{notes:ta.value,updatedAt:Date.now()});toast('Notes saved ✓','ok');}
async function updStatus(fbId,s){await updateReport(fbId,{status:s,updatedAt:Date.now()});await loadReports();openModal(fbId);toast('Updated to '+s+' ✓','ok');}
async function updStatusWithAmt(fbId,s){
  const inp=document.getElementById('modal-approve-amt');
  const amt=inp?inp.value.trim():'';
  const final=amt?'$'+amt.replace('$',''):'N/A';
  await updateReport(fbId,{status:s,amount:final,updatedAt:Date.now()});
  await loadReports();openModal(fbId);toast('Updated to '+s+' ✓','ok');
}
function copyModal(fbId){const a=apps.find(x=>x.firebaseId===fbId);if(a){const t=document.createElement('div');t.innerHTML=a.report;navigator.clipboard.writeText(t.textContent).then(()=>toast('Copied ✓','ok'));}}

async function delApp(fbId){if(!confirm('Delete this application?'))return;await fbDelete(`reports/${fbId}.json`);closeModal();await loadReports();toast('Deleted','ok');}

function closeModal(){document.getElementById('ov').classList.remove('open');}
function closeModalOut(e){if(e.target===document.getElementById('ov'))closeModal();}

// ════════════════════════════════════════
