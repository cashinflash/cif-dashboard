/* 02_app.js — part 2 of 4 of the dashboard JS bundle.
 * Extracted from app.html in v3 Phase 0.6 (claude/plan-engine-reporting-v3-9HciJ).
 *
 * Loaded in order via <script src> tags in app.html. Splitting was a
 * tooling-imposed workaround for tool-call payload size limits in the
 * MCP push_files tool — semantically this is one file. Phase C reporting
 * work can re-merge or further modularize as needed.
 */

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

// ════════════════════════════════════════
// DATE GROUPING (collapsible)
// ════════════════════════════════════════
// Per-day open/closed state. Today is open by default; user toggles persist
// for the page session.
const dayGroupOpen = new Map();

function toggleDayGroup(key) {
  const header = document.querySelector(`tr.day-group-header[data-day-group="${key}"]`);
  if (!header) return;
  const wasOpen = header.dataset.open === '1';
  const newOpen = !wasOpen;
  dayGroupOpen.set(key, newOpen);
  header.dataset.open = newOpen ? '1' : '0';
  header.style.background = newOpen ? '#eef5ee' : '#f6f8f7';
  const chev = header.querySelector('.chev');
  if (chev) chev.textContent = newOpen ? '▼' : '▶';
  // Show/hide all data rows in this group
  document.querySelectorAll(`tr[data-day-group="${key}"]:not(.day-group-header)`).forEach(r => {
    r.style.display = newOpen ? '' : 'none';
  });
  // Redraw score wheels for newly visible rows
  if (newOpen) {
    document.querySelectorAll(`tr[data-day-group="${key}"]:not(.day-group-header)`).forEach(r => {
      const id = r.getAttribute('data-id');
      const a = apps.find(x => x.firebaseId === id);
      if (!a) return;
      const wid = 'dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
      setTimeout(() => {
        if (a.status === 'Processing') drawProcessingWheel(wid, 44);
        else drawWheel(wid, a.score || 0, 44);
      }, 30);
    });
  }
}

function groupAppsByDay(list) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7);

  // Bucket key uses LOCAL date components, not UTC. Using toISOString()
  // would split "late-evening-today" into tomorrow's bucket on any timezone
  // west of UTC — the bug that produced two "Today" groups.
  const localDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const bucketKey = (a) => {
    const ts = a.createdAt || 0;
    if (ts) return localDateKey(new Date(ts));
    if (a.date) return a.date; // Fallback; may be a human string
    return 'unknown';
  };

  const bucketLabel = (key, ts) => {
    if (key === 'unknown') return 'Undated';
    // Prefer the original timestamp so the displayed day matches the bucket.
    const d = ts ? new Date(ts) : new Date(key + 'T12:00:00');
    if (isNaN(d.getTime())) return key;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dayStart.getTime() === today.getTime()) return 'Today';
    if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday';
    if (dayStart >= weekAgo) {
      return d.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'});
    }
    return d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  };

  const buckets = {};
  const order = [];
  list.forEach(a => {
    const k = bucketKey(a);
    if (!(k in buckets)) { buckets[k] = []; order.push(k); }
    buckets[k].push(a);
  });
  return order.map(k => ({
    key: k,
    label: bucketLabel(k, buckets[k][0] ? buckets[k][0].createdAt : null),
    items: buckets[k]
  }));
}

function renderDash(){
  const tot=apps.length;
  const pend=apps.filter(a=>a.status==='Pending').length;
  const appr=apps.filter(a=>a.status==='Approved').length;
  const decl=apps.filter(a=>a.status==='Declined').length;

  // ── Today's stats (primary numbers in the cards) ──
  // Use LOCAL date components, not toISOString (which is UTC and splits
  // late-evening-today into tomorrow's bucket west of UTC).
  const _now = new Date();
  const _pad = n => String(n).padStart(2,'0');
  const _localKey = d => `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  const todayKey = _localKey(_now);
  const todayApps = apps.filter(a => {
    const ts = a.createdAt || 0;
    return ts ? _localKey(new Date(ts)) === todayKey : false;
  });
  const totToday = todayApps.length;
  const pendToday = todayApps.filter(a=>a.status==='Pending').length;
  const apprToday = todayApps.filter(a=>a.status==='Approved').length;
  const declToday = todayApps.filter(a=>a.status==='Declined').length;

  document.getElementById('st').textContent=totToday;
  document.getElementById('sp2').textContent=pendToday;
  document.getElementById('sa').textContent=apprToday;
  document.getElementById('sd').textContent=declToday;
  const reviewedToday=apprToday+declToday;
  document.getElementById('st-sub').textContent=`Today · ${tot.toLocaleString()} all-time`;
  document.getElementById('sp-sub').textContent=`Today · ${pend.toLocaleString()} all-time pending`;
  document.getElementById('sa-sub').textContent=reviewedToday>0
    ? `${Math.round(apprToday/reviewedToday*100)}% today · ${appr.toLocaleString()} all-time`
    : `${appr.toLocaleString()} approved all-time`;
  document.getElementById('sd-sub').textContent=reviewedToday>0
    ? `${Math.round(declToday/reviewedToday*100)}% today · ${decl.toLocaleString()} all-time`
    : `${decl.toLocaleString()} declined all-time`;

  updateQuickFilterActive();
  const filtered=applyQuickFilter(apps.filter(a=>(!srch||a.name?.toLowerCase().includes(srch.toLowerCase()))&&(!stFilter||a.status===stFilter)));
  const c=document.getElementById('dtable');

  // First-paint skeleton — shown only before loadReports has ever succeeded.
  // Once data arrives, real rows take over; if the API is permanently failing,
  // the skeleton stays up and updateSyncStatus surfaces the offline marker.
  if (!_reportsLoaded && !apps.length) {
    _renderDashSkeleton();
    return;
  }

  if(!filtered.length){
    c.innerHTML=`<div class="empty"><div class="empty-ic"><svg class="icn icn-lg" style="width:36px;height:36px;color:var(--muted2)"><use href="#icn-inbox"/></svg></div><div class="empty-t">${apps.length?'No results':'No applications yet'}</div><div class="empty-s">${apps.length?'Try a different filter.':'Submit your first application to get started.'}</div>${!apps.length?'<button class="ecta" onclick="showView(\'single\',document.getElementById(\'nav-single\'))">+ New Analysis</button>':''}</div>`;
    updateSelCount();  // no rows → no selection possible; hide Delete Selected
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

  // Group by day for readability. Uses createdAt when present, otherwise
  // falls back to the stored `date` field. Today expanded by default;
  // other days collapsed (click header to expand).
  const groups = groupAppsByDay(filtered);

  const rows = groups.map(group => {
    // Default: Today expanded; honor user toggle via dayGroupOpen Map.
    const stateKey = group.key;
    const userPref = dayGroupOpen.get(stateKey);
    const isOpen = userPref !== undefined ? userPref : (group.label === 'Today');
    const chevron = isOpen ? '▼' : '▶';
    const headerBg = isOpen ? '#eef5ee' : '#f6f8f7';
    const header = `<tr class="day-group-header" data-day-group="${stateKey}" data-open="${isOpen?'1':'0'}" onclick="toggleDayGroup('${stateKey}')" style="cursor:pointer">
      <td colspan="7" style="background:${headerBg};padding:10px 16px;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);user-select:none">
        <span class="chev" style="display:inline-block;width:12px;color:var(--green);font-size:9px;margin-right:6px">${chevron}</span>${group.label}
        <span style="color:var(--muted2);font-weight:500;margin-left:8px">${group.items.length} application${group.items.length===1?'':'s'}</span>
      </td>
    </tr>`;
    const rowDisplay = isOpen ? '' : 'none';
    const body = group.items.map(a=>{
      const wid='dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
      const ok=a.status==='Approved';
      const v2Badge = a.v2Decision ? ` <span title="v2: ${a.v2Decision} $${a.v2TierAmount||0}" style="background:${a.v2Decision==='APPROVE'?'#eef9f1':'#fff4f0'};color:${a.v2Decision==='APPROVE'?'#1a6b3c':'#c0392b'};padding:1px 5px;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px">v2</span>` : '';
      const autoBadge = a.v2AutoDecide ? ` <span title="High confidence, no review flags — engine would 1-click approve" style="background:#e6f4ea;color:#1a6b3c;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px">auto ✓</span>` : '';
      // Green 💳 badge whenever the customer attached a debit card on
      // the application. Click → opens the app modal on the Debit
      // Card tab so staff can copy the details straight into Vergent.
      const _dcard = a.applicationData && a.applicationData.debitCard;
      let ifBadge = '';
      if (_dcard) {
        const _last4 = _dcard.last4 || (_dcard.cardNumber || '').replace(/\D/g,'').slice(-4) || '----';
        ifBadge = ` <span onclick="event.stopPropagation();openModal('${a.firebaseId}');setTimeout(()=>{const b=document.getElementById('mtab-ifcard-${a.firebaseId}');if(b)b.click();},50);" title="Debit card submitted · ${_dcard.brand||'Card'} ••••${_last4}" style="cursor:pointer;background:#e6f4ea;color:#0a5d2e;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700;margin-left:4px;border:1px solid #a0d9b5">💳 ${_ifEsc(_last4)}</span>`;
      }
      // FCF monthly (stored on v2 shadow or as part of v1 report metadata).
      const fcf = (typeof a.v2MaxAffordable === 'number' || typeof a.v2FcfMonthly === 'number') ? (a.v2FcfMonthly ?? null) : null;
      const fcfCell = fcf != null
        ? `<span style="font-family:var(--mono);font-size:12px;color:${fcf>=300?'var(--green)':fcf>=0?'var(--muted)':'var(--red)'}">$${Math.round(fcf).toLocaleString()}/mo</span>`
        : '<span style="color:var(--muted2);font-size:12px">—</span>';
      return `<tr data-id="${a.firebaseId}" data-kbd="${a.firebaseId}" data-day-group="${stateKey}" data-score="${a.score||0}" oncontextmenu="showCtxMenu(event,'${a.firebaseId}')" style="cursor:pointer;display:${rowDisplay}">
        <td onclick="event.stopPropagation()"><input type="checkbox" class="row-chk" data-id="${a.firebaseId}" onchange="updateSelCount()" style="cursor:pointer;width:15px;height:15px"></td>
        <td onclick="openModal('${a.firebaseId}')">
          <div class="nbig">${a.name||'—'}${v2Badge}${autoBadge}${ifBadge}</div>
          <div class="nsub">${a.filename||''} ${fcf!=null ? '· FCF ' + fcfCell : ''}</div>
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
    return header + body;
  }).join('');

  c.innerHTML=`<table><thead><tr>
    <th style="width:36px"><input type="checkbox" id="chk-all" onchange="toggleAllCheck(this)" style="cursor:pointer;width:15px;height:15px"></th>
    <th>Applicant</th><th>Score</th><th>Amount</th><th>Source</th><th>Date</th><th>Status</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  // Table was rebuilt — every checkbox is fresh/unchecked. Re-sync the
  // Delete Selected button + counter so stale state from pre-render doesn't
  // linger (this is the "button doesn't disappear after delete" bug).
  updateSelCount();
  filtered.forEach(a=>setTimeout(()=>{
    const wid='dw'+(a.firebaseId?.replace(/[^a-z0-9]/gi,'')||'');
    if(a.status==='Processing'||a.status==='Error'&&!a.score){
      drawProcessingWheel(wid,44);
    } else {
      drawWheel(wid,a.score||0,44);
    }
  },80));
}

// ════════════════════════════════════════
// INSTANT FUNDING — /if card submissions
// ════════════════════════════════════════
// Data lives in Firebase Realtime DB under `ifSubmissions/<key>`,
// written by the Render backend's POST /if-submit endpoint which
// receives submissions from the public cashinflash.com/if page.
// No AWS Lambda vault, no encryption dance — staff just need to
// see what the customer typed so they can enter it into Vergent.

function _ifEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function _ifRelTime(iso){
  if(!iso) return '';
  const t=new Date(iso); if(isNaN(t)) return iso;
  const d=Math.floor((Date.now()-t.getTime())/1000);
  if(d<60) return 'just now';
  if(d<3600) return Math.floor(d/60)+' min ago';
  if(d<86400) return Math.floor(d/3600)+' hr ago';
  return Math.floor(d/86400)+' days ago';
}
function _ifTtlLeft(epoch){
  if(!epoch) return '—';
  const left=epoch-Math.floor(Date.now()/1000);
  if(left<=0) return 'expired';
  if(left<3600) return Math.floor(left/60)+'m left';
  if(left<86400) return Math.floor(left/3600)+'h left';
  return Math.floor(left/86400)+'d left';
}

// Map of applicationFbId -> IF submission metadata, kept in sync
// with the IF tab's last load. Used by the Applications table to
// render a 💳 badge on rows that have an attached card submission
// and to drive the "Debit card" tab in the application detail modal.
window._ifByApp = {};

async function loadIFSubmissions(){
  const status=document.getElementById('if-status');
  const table=document.getElementById('if-table');
  if(table) table.innerHTML=`<div style="padding:40px;text-align:center;color:#888">Loading submissions…</div>`;
  if(status) status.textContent='';
  try{
    const data = await fbGet('ifSubmissions.json');
    const rows = [];
    if (data && typeof data === 'object' && !data.error) {
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object') rows.push({...val, firebaseId: key});
      }
    }
    rows.sort((a,b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    window._ifRows = rows;
    renderIFSubmissions(rows);
  }catch(e){
    if(table) table.innerHTML=`<div style="padding:40px;text-align:center;color:#b3261e">Couldn't load submissions: ${_ifEsc(e.message)}</div>`;
    if(status) status.textContent='';
  }
}

function renderIFSubmissions(rows){
  const status=document.getElementById('if-status');
  const table=document.getElementById('if-table');
  const stats=document.getElementById('if-stats');
  const badge=document.getElementById('ifcount');
  const badgeMob=document.getElementById('ifcount-mob');
  const pending  = rows.filter(r => (r.status||'pending').toLowerCase() !== 'processed');
  const processed= rows.filter(r => (r.status||'').toLowerCase() === 'processed');
  if(badge){ badge.textContent=pending.length; badge.style.display=pending.length?'inline-block':'none'; }
  if(badgeMob){ badgeMob.textContent=pending.length; badgeMob.style.display=pending.length?'inline-block':'none'; }

  // Stat cards
  if (stats) {
    const card = (label, val, tint) => `<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px 16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">${label}</div>
      <div style="font-size:24px;font-weight:800;color:${tint||'var(--text)'};letter-spacing:-.02em">${val}</div>
    </div>`;
    stats.innerHTML =
      card('Total submissions', rows.length)
    + card('Action needed',     pending.length,   pending.length ? '#b38700' : 'var(--muted)')
    + card('Processed',         processed.length, 'var(--green,#0E8741)');
  }

  if(!rows.length){
    table.innerHTML=`<div class="empty" style="background:#fff;border:1px dashed var(--border);border-radius:12px"><div class="empty-ic"><svg class="icn icn-lg" style="width:44px;height:44px;color:var(--muted2)"><use href="#icn-file"/></svg></div><div class="empty-t">No submissions yet</div><div class="empty-s">When a customer submits their debit card at <strong>cashinflash.com/if</strong> it will appear here.</div></div>`;
    status.textContent='';
    return;
  }
  status.textContent=`${rows.length}${rows.length===1?' submission':' submissions'} · ${pending.length} pending`;

  const statusBadge=st=>{
    const s=(st||'pending').toLowerCase();
    const color={pending:['#fff3cd','#664d03','#ffe49c'],processed:['#d1f2dd','#0a5d2e','#a0d9b5']}[s]||['#eef0ee','#444','#dde1de'];
    return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:${color[0]};color:${color[1]};border:1px solid ${color[2]}">${_ifEsc(s)}</span>`;
  };
  const brandChip=b=>{
    const key=(b||'').toLowerCase();
    const c={visa:['#1a1f71','#fff'],mastercard:['#eb001b','#fff'],amex:['#2e77bb','#fff'],discover:['#ff6000','#fff']}[key]||['#e9ecee','#333'];
    return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:.04em;background:${c[0]};color:${c[1]};white-space:nowrap">${_ifEsc(b||'Card')}</span>`;
  };
  const body=rows.map(s=>{
    const borrowerName   = ((s.borrowerFirst||'')  +' '+(s.borrowerLast||'')  ).trim() || '—';
    const cardholderName = ((s.cardholderFirst||'')+' '+(s.cardholderLast||'')).trim() || '—';
    const mm = String(s.expMonth||'').padStart(2,'0').slice(-2);
    const yy = String(s.expYear ||'').slice(-2);
    const exp = (mm && yy) ? mm+'/'+yy : '—';
    const rowKey = _ifEsc(s.firebaseId || '');
    const nameAttr = _ifEsc(borrowerName.replace(/'/g,'').slice(0,40));
    const sameName = borrowerName === cardholderName;
    return `<tr style="cursor:pointer;transition:background .12s" onclick="revealIFCard('${rowKey}')" onmouseover="this.style.background='#f8faf9'" onmouseout="this.style.background=''">
      <td style="padding:14px 16px">
        <div style="font-weight:700;color:var(--text);font-size:14px">${_ifEsc(borrowerName)}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:2px">${sameName ? 'Same cardholder' : 'Cardholder: '+_ifEsc(cardholderName)}</div>
      </td>
      <td style="padding:14px 16px;white-space:nowrap">
        ${brandChip(s.brand)}
        <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:var(--text2);margin-left:8px">•••• ${_ifEsc(s.last4||'----')}</span>
      </td>
      <td style="padding:14px 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:var(--text2);white-space:nowrap">${_ifEsc(exp)}</td>
      <td style="padding:14px 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:var(--text2);white-space:nowrap">${_ifEsc(s.billingZip||'—')}</td>
      <td style="padding:14px 16px;white-space:nowrap">${statusBadge(s.status)}</td>
      <td style="padding:14px 16px;color:var(--muted);font-size:12px;white-space:nowrap" title="${_ifEsc(s.submittedAt||'')}">${_ifEsc(_ifRelTime(s.submittedAt))}</td>
      <td style="padding:14px 16px;text-align:right;white-space:nowrap">
        <button class="actbtn btn-ok" onclick="event.stopPropagation();revealIFCard('${rowKey}')" style="font-size:12px">View card</button>
        <button class="actbtn btn-gh" title="Delete submission" onclick="event.stopPropagation();deleteIFSubmission('${rowKey}','${nameAttr}')" style="color:var(--red,#b3261e);border-color:var(--red-border,#f5b1b1);padding:4px 8px;font-size:12px;margin-left:4px">🗑</button>
      </td>
    </tr>`;
  }).join('');
  table.innerHTML=`<div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden">
    <table class="tbl" style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;background:#f8faf9;border-bottom:1px solid var(--border)">
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Borrower</th>
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Card</th>
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Exp</th>
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">ZIP</th>
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Status</th>
        <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Submitted</th>
        <th></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
  // Row separators (every row except the last)
  const trs = table.querySelectorAll('tbody tr');
  trs.forEach((tr,i)=>{ if (i < trs.length-1) tr.style.borderBottom='1px solid #eff2f0'; });
}

// Filter the currently-loaded IF submissions by a free-text query
// across borrower name, cardholder name, brand, last-4, and ZIP.
function filterIFSubmissions(q) {
  const rows = window._ifRows || [];
  const term = (q || '').trim().toLowerCase();
  if (!term) { renderIFSubmissions(rows); return; }
  const filtered = rows.filter(r => {
    const b = ((r.borrowerFirst||'')  +' '+(r.borrowerLast||'')  ).trim().toLowerCase();
    const c = ((r.cardholderFirst||'')+' '+(r.cardholderLast||'')).trim().toLowerCase();
    return b.includes(term)
        || c.includes(term)
        || (r.brand||'').toLowerCase().includes(term)
        || (r.last4||'').includes(term)
        || (r.billingZip||'').toLowerCase().includes(term);
  });
  renderIFSubmissions(filtered);
}

function revealIFCard(rowKey){
  const ov=document.getElementById('ov');
  const mt=document.getElementById('mtitle');
  const mb=document.getElementById('mbody');
  mt.textContent='Card details';
  const data = (window._ifRows||[]).find(r => r.firebaseId === rowKey);
  if(!data){
    mb.innerHTML=`<div style="padding:28px;text-align:center"><div style="color:#b3261e;font-weight:600;margin-bottom:6px">Submission not found</div><div style="color:#555">It may have just been deleted. Try refreshing the Instant Funding tab.</div></div>`;
    ov.classList.add('open');
    return;
  }
  const borrowerName   = ((data.borrowerFirst||'')  +' '+(data.borrowerLast||'')  ).trim() || '—';
  const cardholderName = ((data.cardholderFirst||'')+' '+(data.cardholderLast||'')).trim() || '—';
  const mm = String(data.expMonth||'').padStart(2,'0').slice(-2);
  const yy = String(data.expYear ||'').slice(-2);
  const exp = (mm && yy) ? mm+'/'+yy : '—';
  const panFmt = (data.cardNumber||'').replace(/\D/g,'').replace(/(.{4})/g,'$1 ').trim() || '—';
  const row=(k,v,copy)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eff2f0;gap:14px">
    <span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em">${_ifEsc(k)}</span>
    <span style="font-weight:600;text-align:right">
      <span id="if-field-${_ifEsc(copy||k)}" style="${copy?'font-family:ui-monospace,Menlo,Consolas,monospace;user-select:all':''}">${_ifEsc(v||'—')}</span>
      ${copy?`<button class="actbtn btn-gh" style="margin-left:8px;padding:2px 8px;font-size:11px" onclick="_ifCopy('if-field-${_ifEsc(copy)}',this)">Copy</button>`:''}
    </span>
  </div>`;
  mb.innerHTML=`
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:14px">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Borrower &amp; cardholder</div>
      ${row('Borrower',borrowerName)}
      ${row('Cardholder',cardholderName)}
      ${row('Submitted',data.submittedAt||'—')}
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:14px">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Card details — click any value to select it</div>
      ${row('Card number',panFmt,'cardNumber')}
      ${row('Card type',data.brand||'Card')}
      ${row('Expiration',exp,'expiration')}
      ${row('CVV',data.cvv,'cvv')}
      ${row('Billing ZIP',data.billingZip,'billingZip')}
    </div>
    <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;justify-content:flex-end">
      <a href="https://cashinflash.my.vergentlms.com/login" target="_blank" rel="noopener" class="actbtn btn-gh" style="text-decoration:none">Open Vergent ↗</a>
      <button class="actbtn btn-gh" onclick="_ifCopyAll()">Copy all fields</button>
      <button class="actbtn btn-gh" onclick="markIFProcessed('${_ifEsc(rowKey)}')">Mark processed</button>
      <button class="actbtn btn-gh" onclick="deleteIFSubmission('${_ifEsc(rowKey)}','${_ifEsc(borrowerName.replace(/'/g,'').slice(0,40))}')" style="color:var(--red,#b3261e);border-color:var(--red-border,#f5b1b1)">Delete permanently</button>
      <button class="actbtn btn-gh" onclick="closeModal()">Done</button>
    </div>`;
  // Cache values for the "Copy all" helper
  window._ifPending={
    Borrower:borrowerName, Cardholder:cardholderName,
    CardNumber:panFmt, CardType:data.brand||'Card',
    Expiration:exp, CVV:data.cvv, BillingZIP:data.billingZip,
  };
  ov.classList.add('open');
}

async function deleteIFSubmission(rowKey, label){
  const who = label ? ` for ${label}` : '';
  if (!confirm(`Permanently delete this submission${who}?`)) return;
  try{
    await fbDelete(`ifSubmissions/${rowKey}.json`);
    if (typeof toast === 'function') toast('Submission deleted', 'ok');
    const ov = document.getElementById('ov');
    if (ov && ov.classList.contains('open')) closeModal();
    loadIFSubmissions();
  } catch(e){
    if (typeof toast === 'function') toast('Delete failed: ' + e.message, 'err');
    else alert('Delete failed: ' + e.message);
  }
}

async function markIFProcessed(rowKey){
  if(!confirm('Mark this submission processed? Use this when you\'ve already entered the card into Vergent yourself. The record stays on file — use Delete permanently to remove it.')) return;
  try{
    await fbPatch(`ifSubmissions/${rowKey}.json`, {status: 'processed'});
    if(typeof toast==='function') toast('Submission marked processed','ok');
    closeModal();
    loadIFSubmissions();
  }catch(e){
    if(typeof toast==='function') toast('Mark processed failed: '+e.message,'err');
    else alert('Mark processed failed: '+e.message);
  }
}

function _ifCopy(elId,btn){
  const el=document.getElementById(elId); if(!el) return;
  const v=el.textContent.trim();
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(v); }
  const p=btn.textContent; btn.textContent='Copied'; btn.style.background='var(--green,#0E8741)'; btn.style.color='#fff';
  setTimeout(()=>{ btn.textContent=p; btn.style.background=''; btn.style.color=''; },1100);
}

function _ifCopyAll(){
  const p=window._ifPending||{};
  const lines=['Borrower: '+(p.Borrower||''),'Cardholder: '+(p.Cardholder||''),
    'Card Number: '+(p.CardNumber||''),'Card Type: '+(p.CardType||''),
    'Expiration: '+(p.Expiration||''),'CVV: '+(p.CVV||''),'Billing ZIP: '+(p.BillingZIP||'')].join('\n');
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(lines); }
  if(typeof toast==='function') toast('Copied all fields','ok');
}

// When the modal closes (close/cancel/backdrop), wipe card fields
// out of the DOM so PAN/CVV don't linger. We do NOT auto-refresh the
// table on close anymore — the record only disappears when staff push
// to Vergent or click Mark processed (both of which call
// loadIFSubmissions themselves). Closing the modal without action
// leaves the row in 'viewed' status so they can come back.
(function(){
  const ov=document.getElementById('ov');
  if(!ov) return;
  const mo=new MutationObserver(()=>{
    if(!ov.classList.contains('open')){
      window._ifPending=null;
      const mb=document.getElementById('mbody');
      const title=(document.getElementById('mtitle')||{}).textContent||'';
      if(mb && title.indexOf('Card details')===0){
        mb.innerHTML='';
        // Refresh once in case status changed elsewhere — cheap.
        loadIFSubmissions();
      }
    }
  });
  mo.observe(ov,{attributes:true,attributeFilter:['class']});
})();

// ════════════════════════════════════════
// REVIEW QUEUE — unclassified merchants
// ════════════════════════════════════════
async function loadReviewQueue() {
  const container = document.getElementById('rq-table');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:#888">Scanning reports for unclassified merchants…</div>`;
  try {
    const resp = await fetch('/api/v2-unclassified', {
      credentials: 'include',
      headers: {'X-Session': getToken()}
    });
    const data = await resp.json();
    if (!resp.ok) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#c0392b">${data.error || 'Failed to load'}</div>`;
      return;
    }
    renderReviewQueue(data);
  } catch (e) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#c0392b">Error: ${e.message}</div>`;
  }
}

// Credit categories — label + short human description shown as the dropdown option text.
const RQ_CREDIT_OPTIONS = [
  ['payroll',              'Payroll — wages from an employer'],
  ['gig_income',           'Gig income — Uber/Lyft/DoorDash/Instacart payouts'],
  ['govt_benefits',        'Govt benefits — SSA, SSI, EDD, IRS refund, unemployment'],
  ['pension',              'Pension / retirement'],
  ['child_support',        'Child support received'],
  ['p2p_received',         'P2P received — Zelle/Venmo/Cash App from someone'],
  ['fintech_advance',      'Fintech advance — Earnin/Dave/Brigit/MoneyLion paid IN'],
  ['loan_proceeds',        'Loan proceeds — 3rd-party lender disbursement (Upstart, subprime)'],
  ['internal_transfer',    'Internal transfer — moving money between own accounts'],
  ['cash_deposit',         'Cash deposit — ATM/branch cash in'],
  ['mobile_deposit',       'Mobile deposit — check scanned via phone'],
  ['account_verification', 'Account verification — micro-deposit (e.g. $0.01 pings)'],
  ['bnpl_refund',          'BNPL refund — Klarna/Afterpay/Affirm refund'],
  ['other_credit',         'Other credit — catch-all (avoid if possible)'],
];

// Debit categories — label + short human description.
const RQ_DEBIT_OPTIONS = [
  ['rent',                 'Rent — landlord or property management'],
  ['utilities',            'Utilities — electric/gas/water'],
  ['phone',                'Phone bill — T-Mobile/Verizon/AT&T/etc'],
  ['internet',             'Internet — Spectrum/Xfinity/etc'],
  ['insurance',            'Insurance — auto/health/life'],
  ['groceries',            'Groceries — supermarkets'],
  ['gas_fuel',             'Gas/fuel — gas stations'],
  ['restaurants',          'Restaurants / food delivery'],
  ['subscriptions',        'Subscriptions — Netflix/Spotify/Prime/etc'],
  ['loan_payment',         'Loan payment — auto/student/credit-card/personal loan'],
  ['fintech_repayment',    'Fintech repayment — Earnin/Dave/MoneyLion pulling back OUT'],
  ['bnpl_payment',         'BNPL payment — Klarna/Afterpay/Affirm installment'],
  ['atm',                  'ATM withdrawal — cash out at ATM'],
  ['money_order',          'Money order purchase'],
  ['p2p_sent',             'P2P sent — Zelle/Venmo/Cash App out to someone'],
  ['medical',              'Medical — doctor/hospital/pharmacy'],
  ['transportation',       'Transportation — Uber/Lyft/parking/transit'],
  ['childcare',            'Childcare — daycare/preschool'],
  ['speculative',          'Speculative — casino/crypto/sports betting/lottery'],
  ['account_verification', 'Account verification — micro-debit pings'],
  ['internal_transfer',    'Internal transfer — to own savings/checking'],
  ['fee',                  'Fee — overdraft/NSF/service fee'],
  ['other_expense',        'Other expense — catch-all (avoid if possible)'],
];

function _rqSelectHTML(id, options, selected, noneLabel) {
  const opts = options.map(([v, label]) =>
    `<option value="${v}"${v===selected ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<select id="${id}" style="font-size:12px;padding:5px 6px;border:1px solid #ddd;border-radius:6px;background:#fff;width:100%">
    <option value="">— ${noneLabel} —</option>${opts}
  </select>`;
}

function renderReviewQueue(data) {
  const merchants = data.merchants || [];
  document.getElementById('rq-merchants').textContent = merchants.length;
  document.getElementById('rq-txns').textContent = merchants.reduce((s,m)=>s+m.count, 0);
  document.getElementById('rq-reg').textContent = data.registry_size ?? '—';

  // Nav badge
  const badge = document.getElementById('rqcount');
  const badgeMob = document.getElementById('rqcount-mob');
  [badge, badgeMob].forEach(b => {
    if (!b) return;
    if (merchants.length > 0) { b.style.display = 'inline-block'; b.textContent = merchants.length; }
    else { b.style.display = 'none'; }
  });

  const container = document.getElementById('rq-table');
  if (!merchants.length) {
    container.innerHTML = `<div class="empty" style="padding:3rem;text-align:center"><div class="empty-ic"><svg class="icn icn-lg" style="width:36px;height:36px;color:var(--muted2)"><use href="#icn-tag"/></svg></div><div class="empty-t">No unclassified merchants</div><div class="empty-s">v2 knows every merchant in your historical data.</div></div>`;
    return;
  }

  const rows = merchants.map((m, i) => {
    const samples = (m.samples || []).slice(0,3).map(s => {
      const desc = (s.description || '').replace(/</g,'&lt;');
      return `<div style="font-size:11px;color:#555;padding:2px 0;border-top:1px dashed #eee">
        <span style="display:inline-block;min-width:54px;color:${s.is_credit?'#1a6b3c':'#c0392b'};font-weight:600">${s.is_credit ? '▲ IN' : '▼ OUT'} $${(s.amount||0).toFixed(2)}</span>
        <span style="color:#333">${desc}</span>
        <span style="color:#999">&nbsp;·&nbsp;${s.date || ''}</span>
      </div>`;
    }).join('');
    const sugg = m.suggestion_source && m.suggestion_source !== 'none';
    const suggHint = sugg ? `<div style="font-size:10px;color:#1a6b3c;margin-top:4px">💡 Suggested from ${m.suggestion_source}</div>` : '';
    const directionHint = `<div style="font-size:10px;color:#888;margin-top:3px">${m.credit_count||0} incoming · ${m.debit_count||0} outgoing</div>`;
    return `<tr>
      <td style="vertical-align:top;padding:10px 12px">
        <div style="font-weight:700;font-size:13px">${m.pattern}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">${m.count} txn${m.count===1?'':'s'} · ${m.reports} report${m.reports===1?'':'s'}</div>
        ${directionHint}
        ${suggHint}
        <div style="margin-top:6px">${samples}</div>
      </td>
      <td style="vertical-align:top;padding:10px 12px;min-width:240px">
        <div style="font-size:10px;color:#666;margin-bottom:2px;text-transform:uppercase">If incoming (credit)</div>
        ${_rqSelectHTML('rq-credit-'+i, RQ_CREDIT_OPTIONS, m.suggested_credit || '', "don't match credit")}
      </td>
      <td style="vertical-align:top;padding:10px 12px;min-width:240px">
        <div style="font-size:10px;color:#666;margin-bottom:2px;text-transform:uppercase">If outgoing (debit)</div>
        ${_rqSelectHTML('rq-debit-'+i, RQ_DEBIT_OPTIONS, m.suggested_debit || '', "don't match debit")}
      </td>
      <td style="vertical-align:top;padding:10px 12px;text-align:right;white-space:nowrap">
        <button class="actbtn btn-ok" style="padding:6px 14px;font-size:12px;margin:0 0 6px 0" onclick="saveEntity(${i})" data-pattern="${encodeURIComponent(m.pattern)}">${sugg ? 'Confirm ✓' : 'Add'}</button>
        <br>
        <button class="actbtn btn-gh" style="padding:4px 10px;font-size:11px;margin:0" onclick="skipMerchant(${i})" data-pattern="${encodeURIComponent(m.pattern)}" title="Dismiss as noise / not a real merchant">Skip</button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `<table style="width:100%">
    <thead><tr>
      <th style="text-align:left;padding:10px 12px">Merchant pattern</th>
      <th style="text-align:left;padding:10px 12px">If INCOMING</th>
      <th style="text-align:left;padding:10px 12px">If OUTGOING</th>
      <th style="text-align:right;padding:10px 12px">Action</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function skipMerchant(idx) {
  const btn = document.querySelector(`button[onclick="skipMerchant(${idx})"]`);
  const pattern = btn ? decodeURIComponent(btn.getAttribute('data-pattern') || '') : '';
  if (!pattern) { toast('Pattern missing', 'err'); return; }
  if (!confirm(`Dismiss "${pattern}" from the Review Queue?\n\nIt won't appear again unless you explicitly remove it from the skip list. Transactions matching it will stay categorized as unclassified.`)) return;
  try {
    const resp = await fetch('/api/v2-unclassified-skip', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json','X-Session':getToken()},
      body: JSON.stringify({pattern})
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || 'Failed to skip', 'err'); return; }
    toast(`Dismissed "${pattern}" ✓`, 'ok');
    loadReviewQueue();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function saveEntity(idx) {
  const btn = document.querySelector(`button[onclick="saveEntity(${idx})"]`);
  const pattern = btn ? decodeURIComponent(btn.getAttribute('data-pattern') || '') : '';
  if (!pattern) { toast('Pattern missing', 'err'); return; }
  const creditCat = document.getElementById(`rq-credit-${idx}`).value || null;
  const debitCat = document.getElementById(`rq-debit-${idx}`).value || null;
  if (!creditCat && !debitCat) {
    toast('Pick at least one direction', 'err');
    return;
  }
  try {
    const resp = await fetch('/api/v2-entities-add', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json','X-Session':getToken()},
      body: JSON.stringify({pattern, credit: creditCat, debit: debitCat})
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || 'Failed to save', 'err'); return; }
    toast(`Added "${pattern}" to registry ✓`, 'ok');
    loadReviewQueue(); // refresh — the merchant should disappear
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function filterDash(v){srch=v;renderDash();}

function filterStatus(v){stFilter=v;renderDash();}

// Persisted one-click filter presets. localStorage keeps the choice across
// refresh so the underwriter always lands where they left off.
let quickFilter = localStorage.getItem('cif_quick_filter') || 'all';
function setQuickFilter(name) {
  quickFilter = name;
  localStorage.setItem('cif_quick_filter', name);
  // Status dropdown is disjoint from the quick filters — reset it when a
  // preset is picked so it doesn't compound unexpectedly.
  if (name !== 'all') stFilter = '';
  renderDash();
}
function applyQuickFilter(list) {
  const now = Date.now();
  switch (quickFilter) {
    case 'today': {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      return list.filter(a => (a.createdAt || 0) >= startOfDay.getTime());
    }
    case 'pending':
      return list.filter(a => a.status === 'Pending');
    case 'pending24':
      return list.filter(a => a.status === 'Pending' && (a.createdAt || 0) < now - 24*60*60*1000);
    case 'declined':
      return list.filter(a => a.status === 'Declined');
    case 'approved':
      return list.filter(a => a.status === 'Approved');
    case 'autodecide':
      return list.filter(a => !!a.v2AutoDecide);
    // v2-era audit filters
    case 'reconfail':
      return list.filter(a => a.v2ReconciliationOk === false);
    case 'lowconf':
      // Everything below the auto-approve confidence floor we set in
      // engine_v2/policy/engine.py. Worth a manual eyeball.
      return list.filter(a => typeof a.v2Confidence === 'number' && a.v2Confidence < 0.5);
    case 'review':
      return list.filter(a => String(a.v2Decision || '').toUpperCase() === 'REVIEW_REQUIRED');
    case 'all':
    default:
      return list;
  }
}
function updateQuickFilterActive() {
  document.querySelectorAll('#quick-filters .qfp').forEach(b => {
    b.classList.toggle('active', b.dataset.qf === quickFilter);
  });
}

// CSV export of the currently-visible (filtered) rows. Safer than "all apps"
// — the filter you chose is what you get. Quotes are escaped per RFC 4180.
function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCSV() {
  const list = _dashVisibleApps();
  if (!list.length) { toast('Nothing to export for this filter', 'err'); return; }
  const rows = [['Name','Status','Amount','Score','FCF Monthly','v2 Decision','Auto-decide','Date','Time']];
  for (const a of list) {
    rows.push([
      a.name || '',
      a.status || '',
      a.amount || '',
      a.score ?? '',
      (typeof a.v2FcfMonthly === 'number' ? a.v2FcfMonthly : ''),
      a.v2Decision || '',
      a.v2AutoDecide ? 'yes' : '',
      a.date || '',
      a.time || '',
    ]);
  }
  const csv = rows.map(r => r.map(_csvEscape).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0,10);
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `cif-reports-${stamp}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} row${list.length>1?'s':''}`, 'ok');
}

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
  const n = checked.length;
  if (!confirm(`Delete ${n} selected report${n>1?'s':''}? This cannot be undone.`)) return;

