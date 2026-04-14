async function runBatch(){
  if(!bFiles.length){toast('Upload PDFs first','err');return;}
  if(bRunning)return;
  bRunning=true;
  const btn=document.getElementById('babtn');btn.disabled=true;btn.textContent='Running batch...';
  document.getElementById('bresults').innerHTML='';
  document.getElementById('bprogwrap').style.display='block';
  const total=bFiles.length;let done=0;
  for(let i=0;i<bFiles.length;i++){
    const f=bFiles[i];
    const qi=document.getElementById('bqi'+i),qs=document.getElementById('bqs'+i);
    if(qi)qi.className='bqi processing';if(qs)qs.innerHTML='<div class="bqsp"></div>';
    document.getElementById('bctr').textContent=`Analyzing ${i+1} of ${total}...`;
    document.getElementById('bpbar').style.width=((done/total)*100)+'%';
    const uid='b'+Date.now()+'_'+i;
    try{
      const b64=await toB64(f);const text=await callClaude(b64);const d=parseBlock(text);
      const ok=d.decision==='APPROVED';
      if(qi)qi.className='bqi '+(ok?'done-ok':'done-no');if(qs)qs.textContent=ok?'✓ Approved':'✕ Declined';
      // Auto-save to Firebase
      const now=new Date();
      const rec={id:Date.now(),date:now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),time:now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),createdAt:Date.now(),source:'desktop',status:'Pending',name:d.name,amount:d.amount?'$'+d.amount:'N/A',claudeDecision:d.decision,reason:d.reason,score:d.score,filename:f.name,report:d.report,notes:'',profile:activeProfile};
      const fbId=await saveReport(rec);
      const card=document.createElement('div');card.className='brc';card.id='brc'+uid;card._fbId=fbId;card._reason=d.reason;card._rep=d.report;
      card.innerHTML=`<div class="brh ${ok?'ok':'no'}" onclick="toggleBRC('${uid}')"><canvas id="bwh${uid}" width="50" height="50"></canvas><div style="flex:1"><div class="brn">${d.name}</div><div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap"><span class="pill ${ok?'pill-a':'pill-d'}">${ok?'✓ Approved':'✕ Declined'}</span>${ok&&d.amount?`<span style="font-size:17px;font-weight:700;color:var(--green)">$${d.amount}</span>`:''}</div>${!ok&&d.reason?`<div style="font-size:12px;color:var(--red);margin-top:3px">${d.reason}</div>`:''}</div><span style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${f.name}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7c72" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div><div class="brb open" id="brb${uid}"><div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><span style="font-size:13px;font-weight:600;color:var(--muted)">Override amount:</span><span style="font-size:18px;font-weight:700;color:var(--green)">$</span><input class="bamt-in" id="ba${uid}" type="text" value="${d.amount}" placeholder="0"></div><div class="rhtml">${d.report}</div><div class="bract" id="bract${uid}"><button class="actbtn btn-ok" onclick="saveBatch('${uid}','Approved','${d.name.replace(/'/g,"\\'")}',${d.score},'${f.name.replace(/'/g,"\\'")}')">✓ Approve &amp; Save</button><button class="actbtn btn-no" onclick="saveBatch('${uid}','Declined','${d.name.replace(/'/g,"\\'")}',${d.score},'${f.name.replace(/'/g,"\\'")}')">✕ Decline &amp; Save</button></div></div>`;
      document.getElementById('bresults').appendChild(card);
      setTimeout(()=>drawWheel('bwh'+uid,d.score,50),80);
      card.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){
      if(qi)qi.className='bqi err';if(qs)qs.textContent='Error';
      const card=document.createElement('div');card.className='brc';card.innerHTML=`<div class="brh no"><div style="flex:1"><div class="brn">${f.name}</div><div style="font-size:12px;color:var(--red)">Error: ${e.message}</div></div></div>`;
      document.getElementById('bresults').appendChild(card);
    }
    done++;document.getElementById('bctr').textContent=`${done} of ${total} complete`;document.getElementById('bpbar').style.width=((done/total)*100)+'%';
  }
  bRunning=false;btn.disabled=false;btn.textContent='Run Batch Analysis →';
  toast(`Batch complete — ${done} of ${total} analyzed`,'ok');
}

function toggleBRC(uid){const b=document.getElementById('brb'+uid);if(b)b.classList.toggle('open');}

async function saveBatch(uid,status,name,score,filename){
  const ai=document.getElementById('ba'+uid);const amt=ai?ai.value.trim():'';const final=amt?'$'+amt.replace('$',''):'N/A';
  const card=document.getElementById('brc'+uid);
  if(card&&card._fbId) await updateReport(card._fbId,{status,amount:final,updatedAt:Date.now()});
  const h=card?.querySelector('.brh');if(h){const b=document.createElement('span');b.className='saved-badge';b.textContent='Saved ✓';h.appendChild(b);}
  const bract=document.getElementById('bract'+uid);if(bract)bract.style.display='none';
  bSaved++;if(bSaved>=bFiles.length){document.getElementById('bclrallwrap').style.display='block';document.getElementById('bclrallwrap').scrollIntoView({behavior:'smooth',block:'nearest'});}
  toast(name+' saved as '+status+' ✓','ok');
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
function srcBadge(src) {
  const map = {
    'loan-app':   ['#dbeafe','#1d4ed8','Loan App'],
    'web-apply':  ['#f0fdf4','#15803d','Web Apply'],
    'doc-upload': ['#fdf4ff','#7e22ce','Doc Upload'],
    'mobile':     ['var(--gold-light)','var(--gold-dark)','Mobile'],
    'plaid-rerun':['#eff6ff','#2563eb','Re-run'],
    'lead':       ['#fef3c7','#92400e','⭐ Lead'],
  };
  const [bg,col,lbl] = map[src] || ['var(--green-light)','var(--green-dark)','Desktop'];
  return `<span style="font-size:11px;background:${bg};color:${col};padding:3px 10px;border-radius:20px;font-weight:700;letter-spacing:.02em">${lbl}</span>`;
}

function scoreBg(score) {
  if (score >= 70) return 'rgba(26,107,60,.08)';
  if (score >= 50) return 'rgba(201,168,76,.1)';
  if (score >= 30) return 'rgba(217,119,6,.08)';
  return 'rgba(192,57,43,.07)';
}


// ════════════════════════════════════════
// STAT CARD DONUTS
// ════════════════════════════════════════
function drawStatDonut(id,pct,color,track){
  const cv=document.getElementById(id);if(!cv)return;
  const ctx=cv.getContext('2d'),s=56,cx=28,cy=28,r=21,lw=6;
  ctx.clearRect(0,0,s,s);
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle=track||'rgba(0,0,0,.09)';ctx.lineWidth=lw;ctx.stroke();
  if(pct>0){ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(Math.PI*2*Math.min(pct,1)));ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();}
  ctx.fillStyle=color;ctx.font='700 11px Poppins,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(Math.round(pct*100)+'%',cx,cy);
}
function drawStatDonuts(tot,pend,appr,decl){
  const rev=appr+decl;
  drawStatDonut('sc-tot-c',rev/Math.max(tot,1),'#4b7c5e','rgba(0,0,0,.07)');
  drawStatDonut('sc-pen-c',tot>0?pend/tot:0,'#d97706','rgba(217,119,6,.15)');
  drawStatDonut('sc-app-c',rev>0?appr/rev:0,'#1a6b3c','rgba(26,107,60,.12)');
  drawStatDonut('sc-dec-c',rev>0?decl/rev:0,'#c0392b','rgba(192,57,43,.1)');
}

function renderDash(){
  const tot=apps.length;
  const pend=apps.filter(a=>a.status==='Pending').length;
  const appr=apps.filter(a=>a.status==='Approved').length;
  const decl=apps.filter(a=>a.status==='Declined').length;
  document.getElementById('st').textContent=tot;
  document.getElementById('sp2').textContent=pend;
  document.getElementById('sa').textContent=appr;
  document.getElementById('sd').textContent=decl;
  const reviewed=appr+decl;
  document.getElementById('st-sub').textContent=tot===1?'1 application':tot+' applications';
  document.getElementById('sp-sub').textContent=pend===0?'All reviewed':pend+' need review';
  document.getElementById('sa-sub').textContent=reviewed>0?Math.round(appr/reviewed*100)+'% approval rate':'No decisions yet';
  document.getElementById('sd-sub').textContent=reviewed>0?Math.round(decl/reviewed*100)+'% decline rate':'No decisions yet';

  const filtered=apps.filter(a=>(!srch||a.name?.toLowerCase().includes(srch.toLowerCase()))&&(!stFilter||a.status===stFilter));
  const c=document.getElementById('dtable');

  if(!filtered.length){
    c.innerHTML=`<div class="empty"><div class="empty-ic">📋</div><div class="empty-t">${apps.length?'No results':'No applications yet'}</div><div class="empty-s">${apps.length?'Try a different filter.':'Submit your first application to get started.'}</div>${!apps.length?'<button class="ecta" onclick="showView(\'single\',document.getElementById(\'nav-single\'))">+ New Analysis</button>':''}</div>`;
    return;
  }

  // Only full re-render when rows added/removed/reordered — not on status/score changes
  const structureKey = filtered.map(a=>a.firebaseId).join('~');
  const dataKey = filtered.map(a=>a.firebaseId+'|'+a.status+'|'+(a.score||0)+'|'+(a.amount||'')).join('~');

  if(c.dataset.structureKey === structureKey && c.querySelector('table')) {
    // Rows unchanged — just update individual cells in place (no flicker)
    if(c.dataset.renderKey !== dataKey) {
      c.dataset.renderKey = dataKey;
      filtered.forEach(a => {
        const wid = 'dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
        const tr = document.querySelector(`tr[data-id="${a.firebaseId}"]`);
        if (!tr) return;
        // Update status pill
        const statusCell = tr.querySelector('.pill');
        if (statusCell) { statusCell.className=`pill pill-${a.status?.toLowerCase()||'p'}`; statusCell.textContent=a.status||'Pending'; }
        // Update amount
        const amtCell = tr.querySelector('.amt-cell');
        if (amtCell) { const ok=a.status==='Approved'; amtCell.style.color=ok?'var(--green)':'var(--muted)'; amtCell.style.fontSize=ok?'15px':'13px'; amtCell.textContent=ok?(a.amount||'—'):'—'; }
        // Redraw wheel if score changed OR if status changed away from Processing
        const wasProcessing = tr.dataset.status === 'Processing';
        const nowProcessing = a.status === 'Processing';
        tr.dataset.status = a.status || '';
        if (tr.dataset.score !== String(a.score||0) || (wasProcessing && !nowProcessing)) {
          tr.dataset.score = String(a.score||0);
          if(a.status==='Processing') drawProcessingWheel(wid,44);
          else { const cv=document.getElementById(wid); if(cv) cv.classList.remove('wheel-processing'); drawWheel(wid,a.score||0,44); }
        }
      });
    }
    return;
  }
  c.dataset.structureKey = structureKey;
  c.dataset.renderKey = dataKey;

  const rows=filtered.map(a=>{
    const wid='dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
    const ok=a.status==='Approved';
    return `<tr data-id="${a.firebaseId}" data-score="${a.score||0}" oncontextmenu="showCtxMenu(event,'${a.firebaseId}')" style="cursor:pointer">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-chk" data-id="${a.firebaseId}" onchange="updateSelCount()" style="cursor:pointer;width:15px;height:15px"></td>
      <td onclick="openModal('${a.firebaseId}')">
        <div class="nbig">${a.name||'—'}</div>
        <div class="nsub">${a.filename||''}</div>
      </td>
      <td onclick="openModal('${a.firebaseId}')" style="background:${scoreBg(a.score||0)};text-align:center;padding:8px">
        <canvas id="${wid}" width="44" height="44"></canvas>
      </td>
      <td onclick="openModal('${a.firebaseId}')" class="amt-cell abig" style="font-size:${ok?'15px':'13px'};color:${ok?'var(--green)':'var(--muted)'}">${ok?(a.amount||'—'):'—'}</td>
      <td onclick="openModal('${a.firebaseId}')">${srcBadge(a.source)}</td>
      <td onclick="openModal('${a.firebaseId}')" style="color:var(--muted);font-size:12px">${a.date||''}<br><span style="font-size:11px;color:var(--muted2)">${a.time||''}</span></td>
      <td onclick="openModal('${a.firebaseId}')"><span class="pill pill-${a.status?.toLowerCase()||'p'}">${a.status||'Pending'}</span></td>
    </tr>`;
  }).join('');

  c.innerHTML=`<table><thead><tr>
    <th style="width:36px"><input type="checkbox" id="chk-all" onchange="toggleAllCheck(this)" style="cursor:pointer;width:15px;height:15px"></th>
    <th>Applicant</th><th>Score</th><th>Amount</th><th>Source</th><th>Date</th><th>Status</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  filtered.forEach(a=>setTimeout(()=>{
    const wid='dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
    if(a.status==='Processing'||a.status==='Error'&&!a.score){
      drawProcessingWheel(wid,44);
    } else {
      drawWheel(wid,a.score||0,44);
    }
  },80));
}

function filterDash(v){srch=v;renderDash();}

function filterStatus(v){stFilter=v;renderDash();}

function toggleAllCheck(cb) {
  document.querySelectorAll('.row-chk').forEach(c => c.checked = cb.checked);
  updateSelCount();
}

function updateSelCount() {
  const checked = document.querySelectorAll('.row-chk:checked');
  const btn = document.getElementById('del-selected-btn');
  const cnt = document.getElementById('sel-count');
  if (checked.length > 0) { btn.style.display='inline-flex'; cnt.textContent=checked.length; }
  else { btn.style.display='none'; }
}

async function deleteSelected() {
  const checked = Array.from(document.querySelectorAll('.row-chk:checked'));
  if (!checked.length) return;
  if (!confirm(`Delete ${checked.length} selected report${checked.length>1?'s':''}?`)) return;
  for (const cb of checked) {
    const fbId = cb.dataset.id;
    if (fbId) await fbDelete(`reports/${fbId}.json`);
  }
  await loadReports();
  toast(`${checked.length} report${checked.length>1?'s':''} deleted`,'ok');
}

// ════════════════════════════════════════
// MODAL
// ════════════════════════════════════════
function openModal(fbId){
  const a=apps.find(x=>x.firebaseId===fbId);if(!a)return;
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
