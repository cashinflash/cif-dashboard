// ════════════════════════════════════════
// FIREBASE via local server proxy
// ════════════════════════════════════════
const FB = '/fb';

// ── AUTH ──
function getToken() { return sessionStorage.getItem('cif_token') || ''; }
function getUser() { return sessionStorage.getItem('cif_user') || 'User'; }

function authHeaders(extra) {
  return Object.assign({'Content-Type':'application/json','X-Session': getToken()}, extra||{});
}

// Auth is handled server-side via cookie
// No client-side redirect needed

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
  await loadKey();
  renderProfiles();
  loadRulesUI(editingProfile);
  updateProfileBadge();
  startDots();
  setupDragDrop();
  // Always land on Dashboard
  showView('dash', document.getElementById('nav-dash'));
  loadReports();
  pollTimer = setInterval(loadReports, 8000);
};



async function loadKey() {
  // API key is stored server-side — just update user label
  const lbl = document.getElementById('user-label');
  if (lbl) lbl.textContent = sessionStorage.getItem('cif_user') || 'User';
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
    renderDash();
    updateSyncStatus(true);
  } catch(e) {
    updateSyncStatus(false);
    console.warn('Load reports failed:', e);
  }
}