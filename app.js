(() => {
'use strict';
const nowD = new Date();
const curCycle = () => nowD.getMonth() >= 5 ? nowD.getFullYear() : nowD.getFullYear() - 1;
const DEF = { cycle: curCycle(), plafond: 218, cp: 30, rtt: 11, preavis: 60, arretCompte: true };
const CODES = [
  { k:'JT',  label:'Jour travaillé' },
  { k:'OFF', label:'Jour OFF' },
  { k:'RTT', label:'RTT' },
  { k:'CP',  label:'Congé payé' },
  { k:'JF',  label:'Jour férié' },
  { k:'AM',  label:'Arrêt maladie' },
  { k:'AT',  label:'Accident du travail' },
  { k:'ABS', label:'Absence', view:true }   // affiché uniquement aux profils de consultation (AM/AT masqués)
];
const ARR = new Set(['AM','AT','ABS']);   // absences médicales : comptées dans le plafond selon le réglage
const ROLES = { employe:'Salarié', admin:'Administrateur (DRH)', superviseur:'Consultation + forfait jours (voit son niveau et ceux en dessous)', lecteur:'Consultation seule, sans forfait jours (voit son niveau et ceux en dessous)' };
const NIVEAUX = { 1:'Niveau 1', 2:'Niveau 2 (Bureau)', 3:'Niveau 3', 4:'Niveau 4 (directeurs de restaurant)' };
const CODE = Object.fromEntries(CODES.map(c => [c.k, c]));
const REAL_CODES = CODES.filter(x => !x.view);
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const MSHORT = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
const DOW = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];



const CFG = window.FRANCHISE_CONFIG || {};
const S = {
  role:'employe', consult:false, hasOwn:true, consultIds:new Set(), session:null, meRow:null, me:null, uid:null, isAdmin:false, canWrite:true,
  settings:{...DEF}, cycle:DEF.cycle, myHr:null, hr:{}, allDocs:{}, history:{},
  myCycle:{prev:{},reel:{},months:{}}, signing:null, dataAt:0, verCtx:null,
  tab:'me', mi:0, brush:'JT', layer:'prev',
  viewUid:null, draft:{}, loading:true, fatal:null, auth:{ mode:'login', step:1, email:'' },
  adding:false, showArchived:false, confirmDel:null, fRest:'', fStatus:'', fQ:'', heat:'JT'
};


// ---------- helpers
const $app = document.getElementById('app');
const pad = n => String(n).padStart(2,'0');
const isoOf = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;
const toIso = d => isoOf(d.getFullYear(), d.getMonth(), d.getDate());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = n => (Math.round(n*10)/10).toLocaleString('fr-FR',{maximumFractionDigits:1});
const fmtDate = s => s ? parse(s).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : '';
const todayIso = () => toIso(new Date());
const dayDiff = (a,b) => Math.round((parse(b)-parse(a))/864e5);
const addMonths = (s,n) => { const d = parse(s); d.setMonth(d.getMonth()+n); return toIso(d); };
const cyc = () => S.cycle;
const FIRST_CYCLE = 2024;
const LAST_AHEAD = 10;   // cycles proposés jusqu'à 10 ans après le cycle en cours
const cycLabel = c => `${c}-${c+1}`;

function holidaysOf(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const n=h+l-7*m+114, easter=new Date(y,Math.floor(n/31)-1,n%31+1);
  const plus=k=>{const x=new Date(easter);x.setDate(x.getDate()+k);return toIso(x)};
  return {
    [isoOf(y,0,1)]:"Jour de l'An",[plus(1)]:'Lundi de Pâques',[isoOf(y,4,1)]:'Fête du Travail',[isoOf(y,4,8)]:'Victoire 1945',
    [plus(39)]:'Ascension',[plus(50)]:'Lundi de Pentecôte',[isoOf(y,6,14)]:'Fête nationale',[isoOf(y,7,15)]:'Assomption',
    [isoOf(y,10,1)]:'Toussaint',[isoOf(y,10,11)]:'Armistice',[isoOf(y,11,25)]:'Noël'
  };
}
const holCache = {};
const holidays = c => holCache[c] || (holCache[c] = { ...holidaysOf(c), ...holidaysOf(c+1) });
function cycleMonths(c){
  return Array.from({length:12}, (_,i) => { const m=(5+i)%12, y=c+(5+i>=12?1:0); return { y, m, ym:`${y}-${pad(m+1)}` }; });
}
function* cycleDays(c){ for(let d=new Date(c,5,1); d<=new Date(c+1,4,31); d.setDate(d.getDate()+1)) yield new Date(d); }
function isoWeek(d){
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const day=t.getUTCDay()||7;
  t.setUTCDate(t.getUTCDate()+4-day); const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil(((t-y0)/864e5+1)/7);
}
function defaultMonthIndex(c){
  const ym = `${nowD.getFullYear()}-${pad(nowD.getMonth()+1)}`, ms = cycleMonths(c), i = ms.findIndex(x => x.ym===ym);
  return i>=0 ? i : (ym < ms[0].ym ? 0 : 11);
}
const emptyCycle = () => ({ prev:{}, reel:{}, months:{} });
const normCycle = d => ({ prev:(d&&d.prev)||{}, reel:(d&&d.reel)||{}, months:(d&&d.months)||{} });

// ---------- calculations
function summarize(doc, c){
  const prev = doc.prev||{}, reel = doc.reel||{}, months = doc.months||{}, from = doc.from||'';
  const ms = cycleMonths(c), idx = {}; ms.forEach((mo,i) => idx[mo.ym]=i);
  const per = { JT:Array(12).fill(0), CP:Array(12).fill(0), RTT:Array(12).fill(0), OFF:Array(12).fill(0) };
  const n = { JT:0, CP:0, RTT:0, OFF:0, JF:0, AM:0, AT:0, ABS:0 };
  let blank=0, coded=0, real=0, proj=0, streak=0, max=0, last=null, jfw=0, rttRun=0, maxRtt=0;
  const hol = holidays(c);
  for(const d of cycleDays(c)){
    const iso = toIso(d), r = reel[iso]||'', e = r || prev[iso] || '';
    if(from && iso < from){ last=null; streak=0; rttRun=0; continue; }
    if(!e){ blank++; last=null; streak=0; rttRun=0; continue; }
    n[e]++; coded++;
    if(e==='RTT'){ rttRun++; maxRtt = Math.max(maxRtt, rttRun); } else if(e!=='OFF' && e!=='JF'){ rttRun = 0; }
    const i = idx[iso.slice(0,7)];
    if(per[e] && e!=='JT') per[e][i]++;
    const worked = e==='JT', ferie = !!hol[iso];
    if(worked && ferie) jfw++;
    // Un férié travaillé est payé et ne compte pas dans le plafond : il se déduit comme s'il n'avait pas été travaillé.
    const counts = (worked && !ferie) || (S.settings.arretCompte && ARR.has(r));
    if(counts){ proj++; per.JT[i]++; }
    if((r==='JT' && !ferie) || (S.settings.arretCompte && ARR.has(r))) real++;
    if(e==='JT'){ streak = (last && dayDiff(last,iso)===1) ? streak+1 : 1; last = iso; max = Math.max(max,streak); }
    else { last=null; streak=0; }
  }
  const validated=[], issues=[];
  for(const ym of Object.keys(months)){
    const m = months[ym]; if(!m || !m.valide) continue;
    validated.push(ym);
    if(m.r11===false || m.r35===false || m.equilibre===false || (m.charge && m.charge!=='ok')) issues.push(ym);
  }
  const minCoded = from ? Math.max(7, Math.round(30*(dayDiff(from, cycleRange(c).to)+1)/365)) : MIN_CODED;
  return { min:minCoded, proj, real, jt:n.JT, jfw, cp:n.CP, rtt:n.RTT, off:n.OFF, jf:n.JF, am:n.AM, at:n.AT, blank, coded, maxStreak:max, maxRtt, per, validated:validated.sort(), issues:issues.sort() };
}
// Part du cycle effectivement présente (arrivée en cours de cycle) : sert à proratiser les quotas par défaut.
function presence(hr, c){
  const e = startOf(hr, c), { from, to } = cycleRange(c);
  if(!e) return 1; if(e > to) return 0;
  return (dayDiff(e, to)+1) / (dayDiff(from, to)+1);
}
function alloc(hr){
  const c = cyc(), a = (hr && hr.cycles && hr.cycles[c]) || {}, f = presence(hr, c);
  return { plafond:a.plafond || (hr&&hr.plafond) || Math.round(S.settings.plafond*f), cp:a.cp ?? Math.round(S.settings.cp*f), cpa:a.cpa||0, rtt:a.rtt ?? Math.round(S.settings.rtt*f), prorata:f<1 };
}
// Projection du cycle complet : jours planifiés (réel, sinon prévu) + jours non planifiés estimés (lundi-vendredi travaillés, week-ends OFF, fériés JF).
// Rythme normal : tous les CP et RTT du quota sont pris avant la fin du cycle (RTT : environ 1 par mois, 2 consécutifs au maximum ;
// CP : 2 semaines en été, le reste d'octobre à fin mai). 1 CP en jours ouvrables = 5/6 de jour travaillé en moins.
function projectCycle(doc, c, al, sum){
  const prev = doc.prev||{}, reel = doc.reel||{}, hol = holidays(c), ms = cycleMonths(c), idx = {}; ms.forEach((mo,i) => idx[mo.ym]=i);
  const from = doc.from||'', nowYm = `${nowD.getFullYear()}-${pad(nowD.getMonth()+1)}`;
  const cur = c < curCycle() ? 11 : c > curCycle() ? -1 : (idx[nowYm] ?? 0);        // mois en cours dans le cycle
  const endIso = cur >= 0 ? ms[cur].ym + '-31' : '0000-00-00';
  let planned = 0, est = 0, rttUsed = 0, cpSummer = 0; const rttPer = Array(12).fill(0); const perP = Array(12).fill(0), perE = Array(12).fill(0);
  for(const d of cycleDays(c)){
    const iso = toIso(d), r = reel[iso]||'', e = r || prev[iso] || '', i = idx[iso.slice(0,7)];
    if(from && iso < from) continue;
    if(e){
      if((e==='JT' && !hol[iso]) || (S.settings.arretCompte && ARR.has(r))){ planned++; perP[i]++; }
      if(e==='RTT'){ rttPer[i]++; if(iso <= endIso) rttUsed++; }
      if(e==='CP' && i <= 3) cpSummer++;
    } else if(defaultFor(d, hol)==='JT'){ est++; perE[i]++; }
  }
  const cpLeft = Math.max(0, al.cp - sum.cp), rttLeft = Math.max(0, al.rtt - sum.rtt), cpDays = Math.round(cpLeft*5/6);
  const base = planned + est, noRtt = Math.max(0, base - cpDays), withRtt = Math.max(0, noRtt - rttLeft);
  const startIdx = from ? (idx[from.slice(0,7)] ?? 0) : 0;
  const rttDue = cur >= startIdx ? Math.round(al.rtt*(cur-startIdx+1)/(12-startIdx)) : 0, rttRetard = Math.max(0, rttDue - rttUsed);
  const monthsLeft = cur >= 0 ? Math.max(1, 12 - Math.max(cur, startIdx)) : 12 - startIdx;
  // Répartition équilibrée : les RTT restants vont, un par un, dans le mois restant qui en compte le moins (le quota peut valoir 11 une année et 7 une autre).
  const rttRec = Array(12).fill(0), first = Math.max(cur, startIdx, 0);
  if(cur < 11) for(let k = 0; k < rttLeft; k++){ let b = first; for(let i = first; i < 12; i++) if(rttPer[i] + rttRec[i] < rttPer[b] + rttRec[b]) b = i; rttRec[b]++; }
  return { rttPer, rttRec, rttFirst:first, planned, est, base, cpLeft, cpDays, rttLeft, noRtt, withRtt, sessions:Math.ceil(rttLeft/2), perP, perE,
    rttDue, rttUsed, rttRetard, monthsLeft, rttPerMonth:rttLeft/monthsLeft, cpSummer, summerOver:cur >= 4 && startIdx <= 3 };
}
const MIN_CODED = 30;   // en dessous, le planning est trop partiel pour projeter un dépassement
function metrics(sum, al, pj){
  const p = pj ? pj.withRtt : sum.proj;
  if(sum.coded < sum.min && sum.real <= al.plafond) return { status:'none', reste:al.plafond-p, toRest:0 };
  let status='ok';
  if(sum.real>al.plafond) status='dep';
  else if(p>al.plafond) status='risk';
  else if(pj && pj.noRtt>al.plafond && pj.rttRetard>0) status='rtt';
  else if(sum.blank>0 || sum.cp!==al.cp || sum.rtt!==al.rtt) status='watch';
  return { status, reste:al.plafond-p, toRest:Math.max(0,p-al.plafond) };
}
const STATUS = { ok:'Conforme', watch:'Planning à ajuster', risk:'Projection au-dessus du plafond', dep:'Plafond dépassé', none:'Planning à démarrer', rtt:'RTT en retard' };
function lateMonths(validated, c, from){
  const cur = `${nowD.getFullYear()}-${pad(nowD.getMonth()+1)}`, f = from ? from.slice(0,7) : '';
  return cycleMonths(c).map(m => m.ym).filter(ym => ym < cur && ym >= f && !validated.includes(ym));
}
function interviewStatus(hr){
  const t = todayIso();
  if(!hr || !hr.entretien) return { label:'À planifier', cls:'dep', next:'' };
  const next = addMonths(hr.entretien, 12);
  if(next < t) return { label:'En retard', cls:'dep', next };
  if(dayDiff(t,next) <= S.settings.preavis) return { label:'À prévoir', cls:'watch', next };
  return { label:'À jour', cls:'ok', next };
}
const registered = hr => !!hr && hr.actif !== false;

// ---------- signature électronique simple
let padStrokes = [], padDown = false;
async function sha256(str){
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join(''); }
  catch(e){ return ''; }
}
function canonical(doc, uid, ym, rec){
  const pick = o => Object.keys(o||{}).filter(k => k.startsWith(ym) && o[k]).sort().map(k => k+'='+o[k]).join(',');
  return JSON.stringify([uid, ym, pick(doc.prev), pick(doc.reel), rec.r11!==false, rec.r35!==false, rec.charge||'ok', rec.comment||''].concat(rec.equilibre===false ? ['equilibre=non'] : []));
}
function sigSvg(sig){
  if(!sig || !sig.strokes) return '';
  const lines = sig.strokes.map(st => { const pts=[]; for(let i=0;i+1<st.length;i+=2) pts.push(st[i]+','+st[i+1]); return pts.length===1 ? `<circle cx="${st[0]}" cy="${st[1]}" r="1.2" fill="currentColor"/>` : `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; }).join('');
  return `<svg viewBox="0 0 240 80" role="img" aria-label="Signature de ${esc(sig.name)}">${lines}</svg>`;
}
function sigBox(sig, role){
  if(!sig) return '';
  return `<div class="sigbox">${sigSvg(sig)}<small>${esc(role)} · ${esc(sig.name||'')}<br>${sig.at ? fmtDate(sig.at.slice(0,10)) : ''}</small></div>`;
}
function signPanel(kind){
  const txt = kind==='visa'
    ? "Je vise ce mois en tant que DRH / N+1 après examen du planning et des déclarations du salarié."
    : "Je certifie l'exactitude de mon planning réel et de mes déclarations pour ce mois.";
  return `<div class="signpad"><b>Signature électronique</b>
    <canvas id="pad" width="480" height="160" aria-label="Zone de signature"></canvas>
    <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" id="sign-ok" style="width:auto;margin-top:4px"><span>${txt}</span></label>
    <div class="row"><button class="btn small" data-act="sign-clear">Effacer</button><button class="btn small" data-act="sign-cancel">Annuler</button>
    <button class="btn primary" data-act="sign-submit">Signer${kind==='visa'?' et viser':' et valider'}</button></div>
    <small class="muted">Signature électronique simple : votre identité de compte, la date et une empreinte du contenu sont enregistrées avec le dessin.</small></div>`;
}
function initPad(){
  const cv = document.getElementById('pad'); if(!cv) return;
  const ctx = cv.getContext('2d'), ink = getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#000';
  const draw = () => { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height); ctx.scale(2,2); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for(const st of padStrokes){ ctx.beginPath(); ctx.moveTo(st[0],st[1]); if(st.length===2){ ctx.arc(st[0],st[1],1.2,0,6.3); ctx.fill(); } for(let i=2;i+1<st.length;i+=2) ctx.lineTo(st[i],st[i+1]); ctx.stroke(); } };
  draw();
  const pos = e => { const r = cv.getBoundingClientRect(); return [Math.max(0,Math.min(240,Math.round((e.clientX-r.left)/r.width*240))), Math.max(0,Math.min(80,Math.round((e.clientY-r.top)/r.height*80)))]; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); padDown = true; padStrokes.push(pos(e)); draw(); });
  cv.addEventListener('pointermove', e => { if(!padDown) return; const st = padStrokes[padStrokes.length-1], [x,y] = pos(e);
    if(Math.abs(x-st[st.length-2])+Math.abs(y-st[st.length-1]) >= 2){ st.push(x,y); draw(); } });
  const up = () => { padDown = false; if(pendingRender) setTimeout(() => { pendingRender=false; render(); }, 50); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
async function verifyIntegrity(){
  const el = document.getElementById('integ'); if(!el || !S.verCtx) return;
  const { uid, doc } = S.verCtx, ym = el.dataset.ym, rec = doc.months[ym];
  if(!rec || !rec.hash){ el.textContent = ''; return; }
  const h = await sha256(canonical(doc, uid, ym, rec));
  const e2 = document.getElementById('integ'); if(!e2 || e2.dataset.ym!==ym) return;
  e2.innerHTML = h && h===rec.hash ? '<span class="pill ok">Contenu inchangé depuis la signature</span>' : '<span class="pill dep">Planning modifié depuis la signature</span>';
}


// ---------- accès aux données (Supabase ; chaque requête est filtrée par la RLS côté serveur)
const fromLink = /(^|[#&])access_token=/.test(location.hash);   // arrivée par le lien reçu par e-mail
let pendingPwd = fromLink;
const ready = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = ready ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }) : null;
const msg = e => {
  const m = (e && e.message) || '';
  if(/Invalid login credentials/i.test(m)) return 'Adresse e-mail ou mot de passe incorrect.';
  if(/Token has expired|invalid/i.test(m) && /token|otp/i.test(m)) return 'Code invalide ou expiré. Demandez un nouveau code.';
  if(/duplicate key|already/i.test(m)) return 'Cette adresse e-mail est déjà utilisée par une autre fiche.';
  if(/rate limit|too many/i.test(m)) return 'Trop de tentatives. Patientez quelques minutes.';
  if(/Mois (déjà )?validé/i.test(m)) return m;
  if(/row-level security|permission|42501/i.test(m)) return "Action refusée : droits insuffisants.";
  return m || 'Une erreur est survenue. Réessayez.';
};
const cycleRange = c => ({ from:`${c}-06-01`, to:`${c+1}-05-31` });
const startOf = (hr, c) => { const e = hr && hr.entree; return e && e > `${c}-06-01` ? e : ''; };   // arrivée en cours de cycle
async function fetchPages(make){
  const out = [];
  for(let from=0; ; from+=1000){
    const { data, error } = await make().range(from, from+999);
    if(error) throw error;
    out.push(...data); if(data.length<1000) break;
  }
  return out;
}
function buildDocs(jours, vals){
  const docs = {}, get = id => docs[id] || (docs[id] = emptyCycle());
  for(const r of jours){ const d = get(r.collaborateur_id); if(r.prevu) d.prev[r.jour]=r.prevu; if(r.reel) d.reel[r.jour]=r.reel; }
  for(const v of vals) get(v.collaborateur_id).months[v.mois] = { valide:v.valide, r11:v.r11, r35:v.r35, equilibre:v.equilibre, charge:v.charge, comment:v.commentaire||'', reopened:v.reouvert_le, at:v.signe_le, hash:v.empreinte, sig:v.signature, visa:v.visa };
  return docs;
}
function buildHr(rows, quotas){
  const out = {};
  for(const r of rows) out[r.id] = { id:r.id, email:r.email||'', nom:r.nom, role:r.role, niveau:r.niveau||4, actif:r.actif, fonction:r.fonction||'', categorie:r.categorie||'', restaurant:r.restaurant||'', entree:r.date_entree||'', n1:r.n1||'', entretien:r.entretien||'', cycles:{} };
  for(const q of quotas) if(out[q.collaborateur_id]) out[q.collaborateur_id].cycles[q.cycle] = { plafond:q.plafond, cp:q.cp, rtt:q.rtt, cpa:q.cp_anticipe };
  return out;
}
async function loadSettings(){
  const { data } = await sb.from('parametres').select('*').eq('id',1).maybeSingle();
  if(data) S.settings = { ...DEF, cycle:data.cycle, plafond:data.plafond, cp:data.cp, rtt:data.rtt, preavis:data.preavis, arretCompte:data.arret_compte };
}
async function loadData(){
  const c = cyc(), { from, to } = cycleRange(c), ms = cycleMonths(c), m0 = ms[0].ym, m1 = ms[11].ym;
  if(S.isAdmin){
    const [cols, qs, jours, vals] = await Promise.all([
      sb.from('collaborateurs').select('*').order('nom'),
      sb.from('quotas').select('*'),
      fetchPages(() => sb.from('jours').select('collaborateur_id,jour,prevu,reel').gte('jour',from).lte('jour',to).order('collaborateur_id').order('jour')),
      sb.from('validations').select('*').gte('mois',m0).lte('mois',m1)
    ]);
    for(const x of [cols, qs, vals]) if(x.error) throw x.error;
    S.hr = buildHr(cols.data, qs.data); S.allDocs = buildDocs(jours, vals.data);
  } else {
    let hr = {}, docs = {};
    if(S.hasOwn){
      const [qs, jours, vals] = await Promise.all([
        sb.from('quotas').select('*').eq('collaborateur_id', S.uid),
        fetchPages(() => sb.from('jours').select('collaborateur_id,jour,prevu,reel').eq('collaborateur_id',S.uid).gte('jour',from).lte('jour',to).order('jour')),
        sb.from('validations').select('*').eq('collaborateur_id', S.uid).gte('mois',m0).lte('mois',m1)
      ]);
      for(const x of [qs, vals]) if(x.error) throw x.error;
      hr = buildHr([S.meRow], qs.data); docs = buildDocs(jours, vals.data);
    }
    if(S.consult){
      const [cols, qs2] = await Promise.all([ sb.rpc('consultation_collaborateurs'), sb.rpc('consultation_quotas') ]);
      const jours2 = await fetchPages(() => sb.rpc('consultation_jours', { d1:from, d2:to }).order('collaborateur_id').order('jour'));
      for(const x of [cols, qs2]) if(x.error) throw x.error;
      const rows = cols.data.map(r => ({ ...r, email:null, role:'employe', actif:true, entretien:null }));
      const hr2 = buildHr(rows, qs2.data), docs2 = buildDocs(jours2, []);
      S.consultIds = new Set(rows.map(r => r.id));
      for(const id of Object.keys(hr2)) if(!hr[id]) hr[id] = hr2[id];
      for(const id of Object.keys(docs2)) if(!docs[id]) docs[id] = docs2[id];
    }
    S.hr = hr; S.allDocs = docs;
  }
  for(const id of Object.keys(S.hr)){ const d = S.allDocs[id] || emptyCycle(); d.from = startOf(S.hr[id], c); S.allDocs[id] = d; }
  S.myHr = S.hr[S.uid] || null; S.myCycle = S.allDocs[S.uid] || emptyCycle(); S.dataAt = Date.now();
}
async function loadHistory(id){
  const rows = await fetchPages(() => sb.from('jours').select('jour,prevu,reel').eq('collaborateur_id',id).order('jour'));
  const byC = {};
  for(const r of rows){ const d = parse(r.jour), c = d.getMonth()>=5 ? d.getFullYear() : d.getFullYear()-1; const doc = byC[c] || (byC[c]=emptyCycle()); if(r.prevu) doc.prev[r.jour]=r.prevu; if(r.reel) doc.reel[r.jour]=r.reel; }
  const out = {};
  for(const c of Object.keys(byC)){ const s = summarize(byC[c], Number(c)); out[c] = { real:s.real, proj:s.proj, cp:s.cp, rtt:s.rtt }; }
  S.history[id] = out;
}

// ---------- écritures
let queue = Promise.resolve();
function enqueue(fn){
  queue = queue.then(fn).catch(e => { console.error(e); toast(msg(e)); if(S.session) loadData().then(safeRender).catch(() => {}); });
  return queue;
}
async function upsertChunks(table, rows, onConflict){
  for(let i=0; i<rows.length; i+=500){ const { error } = await sb.from(table).upsert(rows.slice(i,i+500), { onConflict }); if(error) throw error; }
}
function tgt(){ return (S.isAdmin && S.tab==='team' && S.viewUid) ? { uid:S.viewUid, admin:true } : { uid:S.uid, admin:false }; }
function setCodes(layer, map){
  const T = tgt(), clean = {}; for(const [d,c] of Object.entries(map)) clean[d] = c || '';
  const cur = S.allDocs[T.uid] || emptyCycle();
  const touched = new Set(Object.keys(clean).map(d => d.slice(0,7)));
  const wasValidated = T.admin && [...touched].some(ym => cur.months[ym] && cur.months[ym].valide);
  const next = { ...cur, [layer]:{ ...cur[layer], ...clean } };
  S.allDocs[T.uid] = next; if(T.uid===S.uid) S.myCycle = next;
  render();
  const col = layer==='prev' ? 'prevu' : 'reel';
  enqueue(async () => {
    await upsertChunks('jours', Object.entries(clean).map(([jour,c]) => ({ collaborateur_id:T.uid, jour, [col]: c || null })), 'collaborateur_id,jour');
    if(T.admin){ await loadData(); render(); if(wasValidated) toast('Validation du mois annulée : le collaborateur devra revalider.'); }
  });
}
async function dbDo(q){ const { error } = await q; if(error) throw error; }

// ---------- authentification
const authMsg = (t, ok) => { const el = document.getElementById('auth-msg'); if(el){ el.textContent = t; el.className = 'note' + (ok ? ' info' : ''); el.hidden = !t; } };
async function startSession(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ S.session = null; S.loading = false; render(); return; }
  if(pendingPwd){ history.replaceState(null, '', location.pathname + location.search); S.auth = { mode:'code', step:3, email:(session.user && session.user.email) || '' }; S.loading = false; render(); return; }
  await sb.rpc('lier_compte');
  const { data:me, error } = await sb.from('collaborateurs').select('*').eq('user_id', session.user.id).maybeSingle();
  if(error){ S.fatal = 'error'; S.loading = false; render(); return; }
  if(!me || !me.actif){ S.session = session; S.fatal = 'unregistered'; S.loading = false; render(); return; }
  S.session = session; S.meRow = me; S.uid = me.id; S.role = me.role; S.isAdmin = me.role === 'admin'; S.consult = me.role === 'superviseur' || me.role === 'lecteur'; S.hasOwn = me.role !== 'lecteur'; S.me = { name:me.nom, email:me.email };
  await loadSettings(); S.cycle = S.settings.cycle; S.mi = defaultMonthIndex(S.cycle);
  await loadData();
  S.tab = (S.isAdmin || !S.hasOwn) ? 'team' : 'me'; S.loading = false; render();
  if(S.hasOwn) loadHistory(S.uid).then(safeRender).catch(() => {});
  bumpIdle();
}
async function logout(){ try { await sb.auth.signOut(); } finally { location.reload(); } }
let idleT;
function bumpIdle(){ clearTimeout(idleT); if(S.session) idleT = setTimeout(logout, 30*60*1000); }   // déconnexion après 30 min d'inactivité
['click','keydown','pointerdown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive:true }));
document.addEventListener('visibilitychange', () => {
  if(!document.hidden && S.session && S.uid && !S.signing && Date.now()-S.dataAt > 60000) loadData().then(safeRender).catch(() => {});
});

// ---------- rendering
let pendingRender = false;
function safeRender(){
  if(padDown){ pendingRender = true; return; }
  const a = document.activeElement;
  if(a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){ pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => { if(pendingRender) setTimeout(() => { if(pendingRender){ pendingRender=false; render(); } }, 80); });



function initials(n){ return String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase(); }
function avatarUri(n){
  let h = 0; for(const ch of String(n||'')) h = (h*31 + ch.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(${h} 45% 38%)"/><text x="20" y="25.5" font-family="sans-serif" font-size="15" font-weight="600" text-anchor="middle" fill="#fff">${esc(initials(n))}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function nameOf(id){ return (S.hr[id] && S.hr[id].nom) || 'Collaborateur'; }
function avatarOf(id){ return avatarUri(nameOf(id)); }


function cycleOptions(){
  let o=''; for(let c=curCycle()+LAST_AHEAD; c>=FIRST_CYCLE; c--) o += `<option value="${c}" ${c===cyc()?'selected':''}>Cycle ${cycLabel(c)}${c===curCycle()?' (en cours)':''}</option>`;
  return o;
}

function header(){
  const c = cyc();
  const tabs = [];
  if(S.hasOwn) tabs.push(['me','Mon suivi']);
  if(S.isAdmin || S.consult) tabs.push(['team', 'Équipe']);
  if(S.isAdmin) tabs.push(['settings','Réglages']);
  return `<header class="top">
    <div class="top-row">
      <div class="brand"><h1>McDonald's</h1><p>Forfait ${S.settings.plafond} jours · cycle juin ${c} → mai ${c+1}</p></div>
      <div class="who"><select class="cyc" id="cycle-sel" data-cycle aria-label="Cycle affiché">${cycleOptions()}</select><img src="${esc(avatarUri(S.me.name))}" alt=""><span>${esc(S.me.name)}</span><button class="btn small" data-act="logout">Se déconnecter</button></div>
    </div>
    ${tabs.length>1 ? `<nav class="tabs" aria-label="Sections">${tabs.map(([k,l]) => `<button data-act="tab" data-v="${k}" ${S.tab===k?'aria-current="page"':''}>${l}</button>`).join('')}</nav>` : '<div style="height:12px"></div>'}
  </header>`;
}



function summaryCard(sum, al, m, pj){
  const partial = sum.coded < sum.min, proj = pj.withRtt, scale = Math.max(al.plafond, partial ? 0 : proj, sum.real) * 1.04 || 1;
  const w = Math.min(100, sum.real/scale*100), p = partial ? 0 : Math.min(100, proj/scale*100), cap = al.plafond/scale*100;
  return `<section class="card raised" aria-labelledby="sum-h">
    <div class="row between"><h3 id="sum-h">Jours travaillés · cycle ${cycLabel(cyc())}</h3><span class="pill ${m.status}">${STATUS[m.status]}</span></div>
    ${partial ? `<div class="big num" style="margin-top:10px">—<small>pas assez de jours saisis pour projeter (${sum.coded} sur ${sum.min} minimum)</small></div>` : `<div class="big num" style="margin-top:10px">${nf(proj)}<small>projetés sur ${al.plafond} jours, au rythme normal</small></div>`}
    <div class="meter" role="img" aria-label="${nf(sum.real)} jours réalisés, ${nf(proj)} projetés sur le cycle complet, plafond ${al.plafond}">
      <div class="p" style="width:${p}%"></div><div class="w" style="width:${w}%"></div>
      <div class="cap" style="left:${cap}%"><b>${al.plafond}</b></div>
    </div>
    <div class="meter-legend"><span><i style="background:var(--accent)"></i>Réalisés</span><span><i style="background:var(--accent-soft);outline:1px solid var(--accent)"></i>Projection du cycle complet (CP et RTT pris au rythme normal)</span></div>
    <dl class="facts">
      <div><dt>Réalisés à ce jour</dt><dd>${nf(sum.real)} j</dd></div>
      <div><dt>Marge sur le plafond</dt><dd>${partial ? '—' : (m.reste>=0?nf(m.reste):'−'+nf(-m.reste))+' j'}</dd></div>
      <div><dt>CP planifiés</dt><dd>${sum.cp} / ${al.cp}</dd></div>
      ${al.cpa >= 1 ? `<div><dt>CP par anticipation</dt><dd>${al.cpa} j</dd></div>` : ''}
      <div><dt>RTT planifiés</dt><dd>${sum.rtt} / ${al.rtt}</dd></div>
      <div><dt>Jours OFF</dt><dd>${sum.off}</dd></div>
      <div><dt>Fériés chômés (JF)</dt><dd>${sum.jf}</dd></div>
      <div><dt>Fériés travaillés (déduits)</dt><dd>${sum.jfw}</dd></div>
      <div><dt>Arrêts · accidents du travail</dt><dd>${S.consult ? sum.am+sum.at : sum.am} · ${S.consult ? '—' : sum.at}</dd></div>
    </dl>
    <div class="val-list" style="margin-top:14px">
      ${sum.jfw>0 ? `<p class="note info">${sum.jfw} férié(s) travaillé(s) : payés, sans récupération, et retirés du décompte des ${al.plafond} jours.</p>` : ''}
      ${sum.blank>0 ? `<p class="note info">${sum.blank} jour(s) du cycle ne sont pas encore planifiés (estimés dans la projection).</p>` : ''}
      ${(sum.cp!==al.cp || sum.rtt!==al.rtt) ? `<p class="note info">Quota défini par la DRH : ${al.cp} CP et ${al.rtt} RTT. Planifiés : ${sum.cp} et ${sum.rtt}.</p>` : ''}
      ${sum.maxRtt>2 ? `<p class="note">${sum.maxRtt} RTT consécutifs sont planifiés : le maximum est de 2 consécutifs.</p>` : ''}
      ${sum.maxStreak>=7 ? `<p class="note">${sum.maxStreak} jours travaillés d'affilée sont planifiés. Un repos hebdomadaire de 35 heures consécutives est obligatoire.</p>` : ''}
    </div>
  </section>`;
}

function projectionCard(sum, al, m, pj){
  const partial = sum.coded < sum.min, v = x => partial ? '—' : x, over = pj.withRtt - al.plafond;
  const notes = [];
  if(partial){
    notes.push(`<p class="note info">Planning trop partiel pour projeter (${sum.coded} jour(s) saisi(s), ${sum.min} minimum). Utilisez « Pré-remplir tout le cycle » dans la couche Prévu, puis placez les CP et les RTT : la projection s'affichera ensuite.</p>`);
  } else {
    notes.push(over > 0
      ? `<p class="note">Même avec tous les CP et les RTT pris au rythme normal, il resterait ${over} jour(s) au-dessus du plafond : ajoutez des jours OFF ou des CP.</p>`
      : `<p class="note info">Dans le plafond au rythme normal, avec ${-over} jour(s) de marge.</p>`);
    if(pj.rttRetard > 0) notes.push(`<p class="note">RTT en retard : ${pj.rttRetard} de moins que le rythme attendu (${pj.rttDue} à ce jour sur ${al.rtt}, soit environ 1 par mois). Sans les ${pj.rttLeft} RTT restants, la projection serait de ${pj.noRtt} jours${pj.noRtt>al.plafond ? ` (${pj.noRtt-al.plafond} au-dessus du plafond)` : ''}.</p>`);
    if(pj.summerOver && pj.cpSummer < 12) notes.push(`<p class="note info">Congé d'été : ${pj.cpSummer} CP posés de juin à septembre, pour un minimum de 12 jours ouvrables (2 semaines).</p>`);
  }
  return `<section class="card" aria-labelledby="pj-h"><h3 id="pj-h">Projection du cycle complet</h3>
    <dl class="facts">
      <div><dt>Jours planifiés (réel, sinon prévu)</dt><dd>${pj.planned} j</dd></div>
      <div><dt>Jours non planifiés, estimés</dt><dd>${v(pj.est+' j')}</dd></div>
      <div><dt>CP restants (${pj.cpLeft}, jours ouvrables)</dt><dd>${v('− '+pj.cpDays+' j')}</dd></div>
      <div><dt>RTT restants (${pj.rttLeft})</dt><dd>${v('− '+pj.rttLeft+' j')}</dd></div>
      <div><dt>Projection au rythme normal</dt><dd>${v(pj.withRtt+' j')}</dd></div>
      <div><dt>Si les RTT restants ne sont pas pris</dt><dd>${v(pj.noRtt+' j')}</dd></div>
    </dl>
    <div class="val-list" style="margin-top:14px">${notes.join('')}</div>
    ${partial ? '' : `<dl class="facts" style="margin-top:14px">
      <div><dt>RTT attendus à ce jour · pris ou planifiés</dt><dd>${pj.rttDue} · ${pj.rttUsed}</dd></div>
      <div><dt>RTT restants par mois (jusqu'à fin mai)</dt><dd>${pj.rttLeft ? nf(pj.rttPerMonth) : '0'}</dd></div>
      <div><dt>CP posés en été (juin à sept.) · minimum</dt><dd>${pj.cpSummer} · 12</dd></div>
      <div><dt>CP restants à placer d'octobre à mai</dt><dd>${pj.cpLeft}</dd></div>
    </dl>`}</section>`;
}

function monthsChart(pj, partial){
  if(partial) return '';
  const ms = cycleMonths(cyc()), tot = ms.map((_,i) => pj.perP[i] + pj.perE[i]), mx = Math.max(23, ...tot);
  const cur = `${nowD.getFullYear()}-${pad(nowD.getMonth()+1)}`;
  return `<section class="card" aria-labelledby="bars-h"><h3 id="bars-h">Jours travaillés par mois (projection)</h3>
    <div class="bars">${ms.map((mo,i) => `<div class="${mo.ym===cur?'cur':''}"><em>${tot[i]||''}</em><i class="stk"><span class="est" style="height:${pj.perE[i]/mx*62}px"></span><span style="height:${Math.max(pj.perP[i]?2:0,pj.perP[i]/mx*62)}px"></span></i>${MSHORT[mo.m]}</div>`).join('')}</div>
    <div class="meter-legend" style="margin-top:8px"><span><i style="background:var(--accent)"></i>Planifiés</span><span><i style="background:var(--accent-soft);outline:1px solid var(--accent)"></i>Estimés</span></div></section>`;
}

function interviewCard(hr){
  const st = interviewStatus(hr);
  return `<section class="card" aria-labelledby="int-h"><div class="row between"><h3 id="int-h">Entretien annuel</h3><span class="pill ${st.cls}">${st.label}</span></div>
    <p style="margin:10px 0 0">${hr && hr.entretien ? `Dernier entretien : <b>${fmtDate(hr.entretien)}</b><br>Prochain avant le : <b>${fmtDate(st.next)}</b>` : `Aucun entretien enregistré. La DRH le renseigne après l'échange.`}</p></section>`;
}

function calendarCard(ctx){
  const c = cyc(), mo = cycleMonths(c)[S.mi], hol = holidays(c), t = todayIso();
  const { prev, reel } = ctx.doc, rec = ctx.doc.months[mo.ym] || {};
  const edit = !!ctx.edit, view = ctx.readonly && !edit;
  const locked = !!rec.valide, ro = view || (locked && !edit) || !S.canWrite;
  const layer = view ? 'reel' : S.layer;
  const first = new Date(mo.y,mo.m,1), lead = (first.getDay()+6)%7, dim = new Date(mo.y,mo.m+1,0).getDate();
  const weeks = Math.ceil((lead+dim)/7);
  let cells = `<div></div>` + DOW.map(d => `<div class="hd">${d}</div>`).join('');
  for(let w=0; w<weeks; w++){
    const monday = new Date(mo.y,mo.m,1-lead+w*7);
    cells += `<button class="wk" data-act="week" data-v="${toIso(monday)}" ${ro?'disabled':''} title="Appliquer le code choisi à la semaine ${isoWeek(monday)} (jours vides)">S${isoWeek(monday)}</button>`;
    for(let d=0; d<7; d++){
      const dt = new Date(mo.y,mo.m,1-lead+w*7+d);
      if(dt.getMonth()!==mo.m){ cells += `<div class="day blank"></div>`; continue; }
      const iso = toIso(dt), h = hol[iso], p = prev[iso]||'', r = reel[iso]||'';
      const code = layer==='prev' ? p : (r || p);
      const pre = !!(ctx.doc.from && iso < ctx.doc.from);
      const cls = ['day', pre?'pre':'', d>=5?'we':'', h?'hol':'', iso===t?'today':'', layer==='reel' && !r && p ? 'pend' : '', layer==='reel' && r && p && r!==p ? 'diff' : ''].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-act="day" data-v="${iso}" ${code?`data-code="${code}"`:''} ${(ro||pre)?'disabled':''} title="${esc(h || fmtDate(iso))}${code?' · '+CODE[code].label:''}" aria-label="${fmtDate(iso)}${h?' férié':''}${code?', '+CODE[code].label:', non planifié'}"><span class="n">${dt.getDate()}</span><span class="c">${code}</span></button>`;
    }
  }
  const tally = {};
  for(let d=1; d<=dim; d++){ const iso = isoOf(mo.y,mo.m,d), e = reel[iso]||prev[iso]; if(e) tally[e]=(tally[e]||0)+1; }
  return `<section class="card" aria-labelledby="cal-h">
    <div class="monthbar">
      <button class="icon-btn" data-act="month" data-v="-1" aria-label="Mois précédent" ${S.mi===0?'disabled':''}>‹</button>
      <h2 id="cal-h">${MONTHS[mo.m]} ${mo.y}</h2>
      <button class="icon-btn" data-act="month" data-v="1" aria-label="Mois suivant" ${S.mi===11?'disabled':''}>›</button>
    </div>
    ${view ? `<p class="muted" style="margin:10px 0 0;text-align:center">Vue du planning (réel, sinon prévu). Les points rouges signalent un écart avec le prévu.</p>` : `
    <div class="row" style="justify-content:center;margin-top:12px"><div class="seg" role="group" aria-label="Couche de saisie">
      <button data-act="layer" data-v="prev" aria-pressed="${S.layer==='prev'}">Prévu</button>
      <button data-act="layer" data-v="reel" aria-pressed="${S.layer==='reel'}">Réel</button></div></div>`}
    ${ro ? '' : `<div class="brushes" role="group" aria-label="Code à appliquer">
      ${CODES.filter(x => !x.view).map(x => `<button class="brush" style="background:var(--c-${x.k}-bg);color:var(--c-${x.k}-fg)" data-act="brush" data-v="${x.k}" aria-pressed="${S.brush===x.k}">${x.k} · ${x.label}</button>`).join('')}
      <button class="brush erase" data-act="brush" data-v="" aria-pressed="${S.brush===''}">Effacer</button></div>`}
    ${locked && !ctx.readonly ? `<p class="note info" style="margin:14px 0">Mois validé : la saisie est verrouillée. Contactez la DRH pour une correction.</p>` : ''}
    ${locked && edit ? `<p class="note" style="margin:14px 0">Ce mois est validé. Toute modification annule la validation : le collaborateur devra revalider.</p>` : ''}
    ${edit && !locked ? `<p class="note info" style="margin:14px 0">Vous modifiez le planning de ${esc(nameOf(ctx.uid))}.</p>` : ''}
    ${!locked && !view && !edit && !S.canWrite ? `<p class="note" style="margin:14px 0">Lecture seule : votre accès ne permet pas la saisie.</p>` : ''}
    ${ctx.doc.from ? `<p class="note info" style="margin:12px 0">Arrivée le ${fmtDate(ctx.doc.from)} : les jours précédents ne comptent pas et les quotas sont proratisés.</p>` : ''}
    <div class="cal" style="margin-top:${ro?14:0}px">${cells}</div>
    <div class="tally">${CODES.map(x => tally[x.k] ? `<span>${x.k} : <b>${tally[x.k]}</b></span>` : '').join('')}</div>
    ${ro ? '' : `<div class="row" style="margin-top:14px">
      ${S.layer==='prev'
        ? `<button class="btn small" data-act="fillmonth">Pré-remplir ce mois</button><button class="btn small" data-act="fillcycle">Pré-remplir tout le cycle</button>`
        : `<button class="btn small" data-act="confirm">Confirmer le prévu comme réalisé jusqu'à aujourd'hui</button>`}</div>
      ${S.layer==='prev' ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Pré-remplir : fériés en JF, samedis et dimanches en OFF, autres jours en JT. Les jours déjà saisis ne changent pas.</p>` : ''}`}
  </section>`;
}

function validationCard(ctx){
  const c = cyc(), mo = cycleMonths(c)[S.mi], ym = mo.ym, rec = ctx.doc.months[ym] || {};
  const label = `${MONTHS[mo.m].toLowerCase()} ${mo.y}`;
  if(rec.valide){
    const bad = rec.r11===false || rec.r35===false || rec.equilibre===false || (rec.charge && rec.charge!=='ok');
    return `<section class="card" aria-labelledby="val-h"><div class="row between"><h3 id="val-h">Validation de ${label}</h3>
      <span class="row"><span class="pill ${bad?'watch':'ok'}">${bad?'Validé avec réserve':'Validé'}</span>${rec.visa ? `<span class="pill info">Visé DRH/N+1</span>`:''}</span></div>
      <div class="val-list">
        <div>Charge de travail ce mois-ci : <b>${rec.charge==='haute'?'élevée':rec.charge==='excessive'?'excessive':'raisonnable'}</b></div>
        <div>Temps de travail quotidien et hebdomadaire respecté : <b>${rec.r11===false?'Non':'Oui'}</b></div>
        <div>Temps de repos quotidiens, hebdomadaires et congés payés respectés : <b>${rec.r35===false?'Non':'Oui'}</b></div>
        <div>Bon équilibre vie professionnelle / vie personnelle : <b>${rec.equilibre===false?'Non':'Oui'}</b></div>
        ${rec.comment ? `<div class="muted">« ${esc(rec.comment)} »</div>` : ''}
        <div class="sigs">${sigBox(rec.sig,'Salarié')}${sigBox(rec.visa,'Visa DRH / N+1')}</div>
        ${rec.at && rec.at.slice(0,10) < isoOf(mo.y,mo.m,new Date(mo.y,mo.m+1,0).getDate()) ? `<p class="muted" style="margin:0;font-size:12px">Validation anticipée : les jours postérieurs au ${fmtDate(rec.at.slice(0,10))} sont validés tels que planifiés.</p>` : ''}
        <div id="integ" data-ym="${ym}"></div>
        ${rec.hash ? `<small class="muted num" style="word-break:break-all">Empreinte SHA-256 : ${esc(rec.hash)}</small>` : ''}
      </div>
      ${ctx.readonly && ctx.isAdmin ? (S.signing==='visa' ? `<div style="margin-top:12px">${signPanel('visa')}</div>` : `<div class="row" style="margin-top:12px">${rec.visa ? '' : `<button class="btn small primary" data-act="sign-open" data-v="visa">Viser ce mois</button>`}<button class="btn small" data-act="reopen" data-v="${ym}">Rouvrir ce mois</button></div>`) : ''}</section>`;
  }
  if(ctx.readonly) return `<section class="card"><h3>Validation de ${label}</h3><p class="muted" style="margin:10px 0 0">Le salarié n'a pas encore validé ce mois.</p></section>`;
  const future = new Date(mo.y,mo.m,1) > nowD, t = todayIso(), dim = new Date(mo.y,mo.m+1,0).getDate();
  let missing = 0;
  for(let d=1; d<=dim; d++){ const iso = isoOf(mo.y,mo.m,d); if(ctx.doc.from && iso < ctx.doc.from) continue; if(iso<t){ if(!ctx.doc.reel[iso]) missing++; } else if(!ctx.doc.prev[iso] && !ctx.doc.reel[iso]) missing++; }
  const ongoing = !future && isoOf(mo.y,mo.m,dim) > t;
  const dr = S.draft[ym] || (S.draft[ym] = { r11:true, r35:true, equilibre:true, charge:'ok', comment:'' });
  const seg = (k, v, a, b) => `<div class="seg" role="group"><button data-act="draft" data-k="${k}" data-v="true" aria-pressed="${v!==false}">${a}</button><button class="bad" data-act="draft" data-k="${k}" data-v="false" aria-pressed="${v===false}">${b}</button></div>`;
  return `<section class="card" aria-labelledby="val-h"><h3 id="val-h">Validation de ${label}</h3>
    <p class="muted" style="margin:6px 0 0">Chaque fin de mois, confirmez votre réel et vos conditions de repos, puis signez électroniquement.</p>
    <div class="val-list">
      <div class="field"><label for="charge">1. Ma charge de travail ce mois-ci</label>
        <select id="charge" data-k="charge"><option value="ok" ${dr.charge==='ok'?'selected':''}>Raisonnable</option><option value="haute" ${dr.charge==='haute'?'selected':''}>Élevée</option><option value="excessive" ${dr.charge==='excessive'?'selected':''}>Excessive</option></select></div>
      <fieldset class="q"><legend>2. Mon organisation m'a permis de respecter le temps de travail quotidien et hebdomadaire</legend>${seg('r11',dr.r11,'Oui','Non')}</fieldset>
      <fieldset class="q"><legend>3. Mon organisation m'a permis de respecter les temps de repos quotidiens, hebdomadaires et mes congés payés</legend>${seg('r35',dr.r35,'Oui','Non')}</fieldset>
      <fieldset class="q"><legend>4. Je suis parvenu(e) à maintenir un bon équilibre vie professionnelle / vie personnelle</legend>${seg('equilibre',dr.equilibre,'Oui','Non')}</fieldset>
      <div class="field"><label for="comment">5. Commentaires (facultatif)</label><textarea id="comment" data-k="comment" maxlength="500">${esc(dr.comment)}</textarea></div>
      ${rec.reopened ? `<p class="note">La DRH a modifié ce mois le ${fmtDate(rec.reopened.slice(0,10))} : vérifiez le planning et revalidez.</p>` : ''}
      ${missing ? `<p class="note">${missing} jour(s) à compléter : réel pour les jours passés, prévu pour les jours à venir.</p>` : ''}
      ${future ? `<p class="note info">Ce mois n'a pas commencé : la validation sera possible en cours de mois.</p>` : ''}
      ${S.signing==='validate' ? signPanel('validate') : `<div><button class="btn primary" data-act="sign-open" data-v="validate" ${missing||future||!S.canWrite?'disabled':''}>Signer et valider ${label}</button></div>`}
    </div></section>`;
}


function historyCard(h){
  const cs = h || {}, list = Object.keys(cs).map(Number).sort((a,b) => b-a);
  if(!list.length) return '';
  return `<section class="card" aria-labelledby="hist-h"><h3 id="hist-h">Historique des cycles</h3>
    <div class="tablewrap"><table class="hist" style="margin-top:8px"><thead><tr><th>Cycle</th><th class="r">Réalisés</th><th class="r">Projection</th><th class="r">CP</th><th class="r">RTT</th><th></th></tr></thead><tbody>
    ${list.map(c => { const e = cs[c]; return `<tr><td>${cycLabel(c)}</td><td class="r num">${nf(e.real||0)}</td><td class="r num">${nf(e.proj||0)}</td><td class="r num">${e.cp||0}</td><td class="r num">${e.rtt||0}</td><td class="r">${c===cyc()?'<span class="pill info">Affiché</span>':`<button class="btn small" data-act="goto-cycle" data-v="${c}">Ouvrir</button>`}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
}
function employeeView(ctx){
  const c = cyc(), al = alloc(ctx.hr), sum = summarize(ctx.doc, c), pj = projectCycle(ctx.doc, c, al, sum), m = metrics(sum, al, pj), consult = !!ctx.consult;
  S.verCtx = { uid:ctx.uid, doc:ctx.doc };
  return `<div class="grid2">
    <div class="stack">${summaryCard(sum, al, m, pj)}${projectionCard(sum, al, m, pj)}${consult ? '' : interviewCard(ctx.hr)}${monthsChart(pj, sum.coded < sum.min)}${historyCard(S.history[ctx.uid])}</div>
    <div class="stack">${calendarCard(ctx)}${consult ? '' : validationCard(ctx)}${consult ? '' : downloadCard()}</div></div>`;
}


// ----- équipe (administrateurs)

function teamRows(){
  const c = cyc();
  const base = S.isAdmin ? Object.keys(S.hr).filter(u => S.hr[u].role !== 'lecteur') : [...S.consultIds].filter(u => S.hr[u] && S.hr[u].role !== 'lecteur');
  const ids = base.filter(u => S.hr[u] && (S.isAdmin ? (S.showArchived ? S.hr[u].actif===false : S.hr[u].actif!==false) : true));
  const rows = ids.map(uid => {
    const hr = S.hr[uid], al = alloc(hr), doc = S.allDocs[uid] || emptyCycle();
    const started = Object.keys(doc.prev).length + Object.keys(doc.reel).length > 0;
    const sum = started ? summarize(doc, c) : null, pj = started ? projectCycle(doc, c, al, sum) : null;
    const m = started ? metrics(sum, al, pj) : { status:'none', reste:al.plafond, toRest:0 };
    const late = started && S.isAdmin ? lateMonths(sum.validated, c, doc.from) : [];
    return { uid, hr, al, sum, pj, m, late, started, iv:S.isAdmin ? interviewStatus(hr) : { cls:'ok', label:'' } };
  });
  const q = S.fQ.trim().toLowerCase();
  const out = rows.filter(r => (!S.fRest || r.hr.restaurant===S.fRest) && (!S.fStatus || r.m.status===S.fStatus) && (!q || nameOf(r.uid).toLowerCase().includes(q) || (r.hr.restaurant||'').toLowerCase().includes(q)));
  const order = { dep:0, risk:1, rtt:2, watch:3, none:4, ok:5 };
  out.sort((a,b) => order[a.m.status]-order[b.m.status] || nameOf(a.uid).localeCompare(nameOf(b.uid),'fr'));
  return { all:rows, rows:out };
}
function alertChips(r){
  const c = [];
  if(!r.started) return `<span class="muted">${r.hr.email ? 'Aucune saisie' : 'Adresse e-mail à renseigner'}</span>`;
  if(r.sum.maxStreak>=7) c.push(`<span class="pill dep">${r.sum.maxStreak} j d'affilée</span>`);
  if(r.sum.issues.length) c.push(`<span class="pill watch">Charge / repos signalés</span>`);
  if(r.late.length) c.push(`<span class="pill watch">${r.late.length} mois non validé${r.late.length>1?'s':''}</span>`);
  if(r.sum.coded < r.sum.min) c.push(`<span class="pill info">Planning partiel (${r.sum.coded} j)</span>`);
  else if(r.pj && r.pj.withRtt>r.al.plafond) c.push(`<span class="pill dep">Dépasse même avec les RTT</span>`);
  else if(r.pj && r.pj.rttRetard>0) c.push(`<span class="pill watch">RTT en retard (${r.pj.rttRetard})</span>`);
  if(r.sum.maxRtt>2) c.push(`<span class="pill dep">${r.sum.maxRtt} RTT d'affilée</span>`);
  if(r.sum.blank>0 && r.sum.coded >= r.sum.min) c.push(`<span class="pill info">${r.sum.blank} j non planifiés</span>`);
  if(r.iv.cls!=='ok') c.push(`<span class="pill ${r.iv.cls==='dep'?'dep':'info'}">Entretien ${r.iv.label.toLowerCase()}</span>`);
  return c.length ? c.join('') : '<span class="muted">Aucune</span>';
}
function addPanel(){
  const s = S.settings;
  const f = (id,l,v,t='text',extra='') => `<div class="field"><label for="${id}">${l}</label><input type="${t}" id="${id}" value="${esc(v)}" ${extra}></div>`;
  return `<section class="card raised"><div class="row between"><h2>Ajouter un collaborateur</h2><button class="btn small" data-act="add-close">Fermer</button></div>
    <div class="form-grid" style="margin-top:12px">
      ${f('add-nom','Nom et prénom','','text','maxlength="80" autocomplete="off"')}
      ${f('add-email','Adresse e-mail (identifiant de connexion)','','email','maxlength="120" autocomplete="off" placeholder="peut être renseignée plus tard"')}
      ${f('add-fonction','Fonction','','text','maxlength="80"')}
      <div class="field"><label for="add-categorie">Catégorie</label><select id="add-categorie"><option>Directeur</option><option>Cadre</option></select></div>
      ${f('add-restaurant','Restaurant','','text','maxlength="80"')}${f('add-n1','N+1 (responsable)','','text','maxlength="80"')}
      <div class="field"><label for="add-niveau">Niveau hiérarchique (consulte son niveau et ceux en dessous)</label><select id="add-niveau">${Object.entries(NIVEAUX).map(([k,l]) => `<option value="${k}" ${k==4?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="add-role">Droits</label><select id="add-role">${Object.entries(ROLES).map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      ${f('add-entree',"Date d'entrée (si arrivée en cours de cycle)",'','date')}
      ${f('add-plafond',`Jours à travailler · cycle ${cycLabel(cyc())}`,s.plafond,'number','min="1" max="366"')}
      ${f('add-cp',`CP à prendre · cycle ${cycLabel(cyc())}`,s.cp,'number','min="0" max="60"')}
      ${f('add-rtt',`RTT à prendre · cycle ${cycLabel(cyc())}`,s.rtt,'number','min="0" max="30"')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-act="add-save">Ajouter au suivi</button></div></section>`;
}

function heatTable(rows){
  const ms = cycleMonths(cyc()), key = S.heat, mx = key==='JT' ? 31 : key==='OFF' ? 12 : 12;
  const body = rows.filter(r => r.started).map(r => `<tr><td class="name">${esc(nameOf(r.uid))}</td>${ms.map((_,i) => {
    const v = (r.sum.per[key]||[])[i]||0, a = Math.round(Math.min(1,v/mx)*70);
    return `<td style="background:color-mix(in srgb, var(--accent) ${a}%, transparent)">${v||'·'}</td>`; }).join('')}</tr>`).join('');
  if(!body) return '';
  return `<section class="card"><div class="row between"><h2>Vue mois par mois</h2>
    <div class="field" style="min-width:200px"><label for="heat">Indicateur</label><select id="heat" data-heat><option value="JT" ${key==='JT'?'selected':''}>Jours travaillés</option><option value="CP" ${key==='CP'?'selected':''}>Congés payés</option><option value="RTT" ${key==='RTT'?'selected':''}>RTT</option><option value="OFF" ${key==='OFF'?'selected':''}>Jours OFF</option></select></div></div>
    <div class="tablewrap" style="margin-top:12px"><table class="heat" style="min-width:760px"><thead><tr><th>Collaborateur</th>${ms.map(m => `<th style="text-align:center">${MSHORT[m.m]}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function quotasCard(){
  const c = cyc(), list = Object.entries(S.hr).filter(([,h]) => h.actif!==false && h.role!=='lecteur').sort((a,b) => nameOf(a[0]).localeCompare(nameOf(b[0]),'fr'));
  if(!list.length) return '';
  const inp = (id,v,ph,max) => `<input type="number" id="${id}" value="${v ?? ''}" placeholder="${ph}" min="0" max="${max}" style="width:90px">`;
  return `<section class="card"><h2>Quotas individuels · cycle ${cycLabel(c)}</h2>
    <p class="muted" style="margin:6px 0 0">Jours à travailler, CP et RTT propres à chaque collaborateur pour ce cycle. Une case vide applique la valeur par défaut (${S.settings.plafond} jours, ${S.settings.cp} CP, ${S.settings.rtt} RTT).</p>
    <div class="tablewrap" style="margin-top:10px"><table style="min-width:620px"><thead><tr><th>Collaborateur</th><th>Jours à travailler</th><th>CP</th><th>RTT</th></tr></thead><tbody>
    ${list.map(([uid,h]) => { const a = (h.cycles && h.cycles[c]) || {};
      return `<tr><td><b>${esc(nameOf(uid))}</b><br><small class="muted">${esc(h.fonction||'')}</small></td><td>${inp('q-p-'+uid, a.plafond ?? '', S.settings.plafond, 366)}</td><td>${inp('q-c-'+uid, a.cp ?? '', S.settings.cp, 60)}</td><td>${inp('q-r-'+uid, a.rtt ?? '', S.settings.rtt, 30)}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="save-quotas">Enregistrer les quotas</button></div></section>`;
}

function consultCard(){
  const list = Object.entries(S.hr).filter(([,h]) => h.role==='lecteur' && (S.showArchived ? h.actif===false : h.actif!==false)).sort((a,b) => nameOf(a[0]).localeCompare(nameOf(b[0]),'fr'));
  if(!S.isAdmin || !list.length) return '';
  return `<section class="card"><h2>Accès de consultation (${list.length})</h2>
    <p class="muted" style="margin:6px 0 0">Profils en consultation seule : ils voient les plannings de leur niveau et des niveaux inférieurs, sans saisir de forfait jours.</p>
    <div class="tablewrap" style="margin-top:10px"><table style="min-width:0"><tbody>
    ${list.map(([uid,h]) => `<tr data-act="open" data-v="${esc(uid)}" tabindex="0"><td><div class="person"><img src="${esc(avatarOf(uid))}" alt=""><div><b>${esc(h.nom)}</b><small>${esc([h.fonction, h.restaurant].filter(Boolean).join(' · ') || 'Lecteur')}</small></div></div></td><td>${esc(h.email || 'Adresse e-mail à renseigner')}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}
function teamView(){
  const { all, rows } = teamRows();
  const act = S.isAdmin ? Object.values(S.hr).filter(h => h.actif!==false && h.role!=='lecteur').length : all.length;
  const k = { act, ok:all.filter(r=>r.m.status==='ok').length, adj:all.filter(r=>r.m.status==='watch'||r.m.status==='rtt').length,
    over:all.filter(r=>r.m.status==='risk'||r.m.status==='dep').length, al:all.filter(r=>r.started&&(r.sum.maxStreak>=7||r.sum.issues.length||r.late.length)).length };
  const rests = [...new Set(all.map(r => r.hr.restaurant).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  return `<div class="kpis">
    <div class="kpi"><b>${S.showArchived?all.length:act}</b><span>${S.showArchived?'Collaborateurs retirés':'Collaborateurs suivis'}</span></div>
    <div class="kpi"><b>${k.ok}</b><span>Conformes</span></div>
    <div class="kpi"><b>${k.adj}</b><span>Planning à ajuster</span></div>
    <div class="kpi"><b>${k.over}</b><span>Au-dessus du plafond</span></div>
    <div class="kpi"><b>${k.al}</b><span>Avec alertes de suivi</span></div></div>
  ${S.adding ? addPanel() : ''}
  <section class="card"><div class="row between"><h2>${'Équipe'} · cycle ${cycLabel(cyc())}</h2>
    ${S.isAdmin ? `<span class="row"><button class="btn small" data-act="export" ${rows.length?'':'disabled'}>Exporter en Excel</button><button class="btn small primary" data-act="add-open">Ajouter un collaborateur</button></span>` : `<span class="pill info">Consultation</span>`}</div>
  <div class="filters">
    <div class="field"><label for="f-q">Recherche</label><input type="search" id="f-q" data-filter="fQ" value="${esc(S.fQ)}" placeholder="Nom ou restaurant"></div>
    <div class="field"><label for="f-rest">Restaurant</label><select id="f-rest" data-filter="fRest"><option value="">Tous</option>${rests.map(r => `<option ${S.fRest===r?'selected':''}>${esc(r)}</option>`).join('')}</select></div>
    <div class="field"><label for="f-st">Statut</label><select id="f-st" data-filter="fStatus"><option value="">Tous</option>${Object.entries(STATUS).map(([k2,l]) => `<option value="${k2}" ${S.fStatus===k2?'selected':''}>${l}</option>`).join('')}</select></div>
    ${S.isAdmin ? `<div class="field"><label for="f-arch">Affichage</label><select id="f-arch" data-filter="showArchived"><option value="">Collaborateurs actifs</option><option value="1" ${S.showArchived?'selected':''}>Collaborateurs retirés</option></select></div>` : ''}
  </div>
  ${rows.length ? `<div class="tablewrap" style="margin-top:12px"><table class="team"><thead><tr><th>Collaborateur</th><th>Restaurant · N+1</th><th class="r">Réalisés</th><th class="r" title="Projection du cycle complet au rythme normal (CP et RTT pris)">Projection</th><th class="r">CP</th><th class="r">RTT</th><th>Statut</th><th>Alertes</th></tr></thead><tbody>
    ${rows.map(r => `<tr data-act="open" data-v="${esc(r.uid)}" tabindex="0">
      <td data-label="Collaborateur"><div class="person"><img src="${esc(avatarOf(r.uid))}" alt=""><div><b>${esc(nameOf(r.uid))}</b><small>${esc([r.hr.fonction,r.hr.categorie].filter(Boolean).join(' · ') || 'Fonction non renseignée')}</small></div></div></td>
      <td data-label="Restaurant · N+1"><div>${esc(r.hr.restaurant || '—')}<br><small class="muted">${esc(r.hr.n1 || '')}</small></div></td>
      <td data-label="Réalisés" class="r num">${r.started?nf(r.sum.real):'—'}</td>
      <td data-label="Projection" class="r num">${r.started && r.sum.coded>=r.sum.min?`<span class="pv">${nf(r.pj.withRtt)} / ${r.al.plafond}</span><span class="mini"><i style="width:${Math.min(100,r.pj.withRtt/r.al.plafond*100)}%"></i></span><small class="muted">sans RTT restants : ${nf(r.pj.noRtt)}</small>`:`— / ${r.al.plafond}`}</td>
      <td data-label="CP" class="r num">${r.started?r.sum.cp:'—'} / ${r.al.cp}</td><td data-label="RTT" class="r num">${r.started?r.sum.rtt:'—'} / ${r.al.rtt}</td>
      <td data-label="Statut"><span class="pill ${r.m.status}">${STATUS[r.m.status]}</span></td>
      <td data-label="Alertes"><div class="chips">${alertChips(r)}</div></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty"><b>${all.length ? 'Aucun résultat' : (S.showArchived ? 'Aucun collaborateur retiré' : 'Aucun collaborateur pour l\'instant')}</b>${all.length ? 'Modifiez les filtres.' : (S.showArchived ? '' : 'Ajoutez les directeurs et cadres au forfait jours avec le bouton ci-dessus.')}</div>`}
  </section>${heatTable(rows)}${consultCard()}`;
}

function consultDetailView(){
  const uid = S.viewUid, hr = S.hr[uid] || {}, doc = S.allDocs[uid] || emptyCycle();
  return `<div class="row between"><button class="btn small" data-act="back">‹ Retour</button></div>
    <section class="card"><div class="row between"><h2>${esc(hr.nom||'')}</h2><span class="pill info">Consultation</span></div>
    <p class="muted" style="margin:6px 0 0">${esc([hr.fonction, hr.categorie, hr.restaurant, hr.n1 ? 'N+1 : '+hr.n1 : ''].filter(Boolean).join(' · '))}</p></section>` +
    employeeView({ uid, doc, hr, readonly:true, consult:true });
}
function detailView(){
  const uid = S.viewUid, hr = S.hr[uid] || {}, c = cyc(), a = (hr.cycles && hr.cycles[c]) || {};
  const f = (id,l,v,t='text',extra='') => `<div class="field"><label for="${id}">${l}</label><input type="${t}" id="${id}" value="${esc(v)}" ${extra}></div>`;
  const archived = hr.actif === false;
  const head = `<div class="row between"><button class="btn small" data-act="back">‹ Retour à l'équipe</button></div>`;
  const form = `<section class="card"><div class="row between"><h2>${esc(nameOf(uid))}</h2><span class="row">${hr.role && hr.role!=='employe' ? `<span class="pill info">${esc(ROLES[hr.role]||hr.role)}</span>` : ''}${archived ? '<span class="pill none">Retiré du suivi</span>' : ''}${hr.email ? '' : '<span class="pill watch">Adresse e-mail manquante</span>'}</span></div>
    <div class="form-grid" style="margin-top:12px">
      ${f('hr-nom','Nom et prénom',hr.nom||'','text','maxlength="80"')}
      ${f('hr-email','Adresse e-mail (identifiant de connexion)',hr.email||'','email','maxlength="120" autocomplete="off"')}
      ${f('hr-fonction','Fonction',hr.fonction||'','text','maxlength="80"')}
      <div class="field"><label for="hr-categorie">Catégorie</label><select id="hr-categorie"><option value="">—</option>${['Directeur','Cadre'].map(x=>`<option ${hr.categorie===x?'selected':''}>${x}</option>`).join('')}</select></div>
      ${f('hr-restaurant','Restaurant',hr.restaurant||'','text','maxlength="80"')}${f('hr-n1','N+1 (responsable)',hr.n1||'','text','maxlength="80"')}
      <div class="field"><label for="hr-niveau">Niveau hiérarchique (consulte son niveau et ceux en dessous)</label><select id="hr-niveau">${Object.entries(NIVEAUX).map(([k,l]) => `<option value="${k}" ${(hr.niveau||4)==k?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="hr-role">Droits</label><select id="hr-role">${Object.entries(ROLES).map(([k,l]) => `<option value="${k}" ${(hr.role||'employe')===k?'selected':''}>${l}</option>`).join('')}</select></div>
      ${hr.role==='lecteur' ? '' : f('hr-plafond',`Jours à travailler · cycle ${cycLabel(c)}`,a.plafond ?? '','number',`min="1" max="366" placeholder="${S.settings.plafond}"`)}
      ${hr.role==='lecteur' ? '' : f('hr-cp',`CP à prendre · cycle ${cycLabel(c)}`,a.cp ?? '','number',`min="0" max="60" placeholder="${S.settings.cp}"`)}
      ${hr.role==='lecteur' ? '' : f('hr-cpa',`CP par anticipation · cycle ${cycLabel(c)} (affiché seulement si 1 ou plus)`,a.cpa ?? '','number','min="0" max="30"')}
      ${hr.role==='lecteur' ? '' : f('hr-rtt',`RTT à prendre · cycle ${cycLabel(c)}`,a.rtt ?? '','number',`min="0" max="30" placeholder="${S.settings.rtt}"`)}
      ${f('hr-entree',"Date d'entrée (si arrivée en cours de cycle)",hr.entree||'','date')}
      ${f('hr-entretien','Dernier entretien annuel',hr.entretien||'','date')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-act="save-hr">Enregistrer la fiche</button>
      ${archived ? `<button class="btn" data-act="restore">Réintégrer</button>` : `<button class="btn" data-act="archive">Retirer du suivi</button>`}
      ${archived ? (S.confirmDel===uid
        ? `<span class="note" style="display:inline-block">Supprime la fiche et tout l'historique. Action irréversible.</span><button class="btn danger solid" data-act="delete-final">Oui, supprimer définitivement</button><button class="btn" data-act="delete-cancel">Annuler</button>`
        : `<button class="btn danger" data-act="delete-ask">Supprimer définitivement</button>`) : ''}
    </div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Une case vide applique la valeur par défaut des Réglages, proratisée si une date d'entrée tombe dans le cycle. Les quotas sont propres au cycle affiché. « Retirer du suivi » conserve l'historique et bloque l'accès de la personne.</p></section>`;
  const doc = S.allDocs[uid] || emptyCycle();
  if(hr.role==='lecteur') return head + form + `<p class="note info">Accès de consultation : cette personne voit en lecture seule les plannings de son niveau et des niveaux inférieurs et n'a pas de forfait jours à saisir.</p>`;
  return head + form + `<p class="muted" style="margin:0">Vous pouvez modifier le planning ci-dessous. Modifier un mois validé annule sa validation : le collaborateur devra revalider.</p>` + employeeView({ uid, doc, hr, readonly:true, edit:true, isAdmin:true });
}


function settingsView(){
  const s = S.settings, cy = curCycle();
  const f = (id,l,v,min,max) => `<div class="field"><label for="${id}">${l}</label><input type="number" id="${id}" value="${v}" min="${min}" max="${max}"></div>`;
  return `<section class="card"><h2>Réglages du suivi</h2>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label for="set-cycle">Cycle ouvert par défaut (juin → mai)</label><select id="set-cycle">${Array.from({length:LAST_AHEAD+3}, (_,i) => cy-2+i).map(c => `<option value="${c}" ${s.cycle===c?'selected':''}>${cycLabel(c)}</option>`).join('')}</select></div>
      ${f('set-plafond','Plafond annuel (jours)',s.plafond,1,366)}
      ${f('set-cp','CP par défaut sur le cycle',s.cp,0,60)}${f('set-rtt','RTT par défaut sur le cycle',s.rtt,0,30)}
      ${f('set-preavis',"Préavis d'alerte entretien (jours)",s.preavis,0,365)}
      <div class="field"><label for="set-arret">Arrêts maladie et accidents du travail dans le plafond</label><select id="set-arret"><option value="1" ${s.arretCompte?'selected':''}>Comptés comme jours du forfait (comme votre tableur)</option><option value="0" ${s.arretCompte?'':'selected'}>Non comptés</option></select></div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-act="save-settings">Enregistrer</button></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Les CP et RTT par défaut s'appliquent aux collaborateurs sans quota personnel.</p></section>
  ${quotasCard()}
  <section class="card"><h2>Sécurité et accès</h2>
    <ul style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px">
      <li>Chaque personne se connecte avec son adresse e-mail et son mot de passe. Le premier accès passe par un code reçu par e-mail.</li>
      <li>Un salarié ne voit et ne modifie que son planning. Les administrateurs voient toute l'équipe. Ces règles sont appliquées par la base de données, pas seulement par la page.</li>
      <li>Un salarié sans fiche (ou retiré du suivi) n'accède à rien. Ajoutez son adresse e-mail dans sa fiche pour l'autoriser.</li>
      <li>Un mois validé est signé électroniquement et verrouillé côté serveur. Seule la DRH peut le rouvrir ou le viser.</li>
      <li>Déconnexion automatique après 30 minutes d'inactivité.</li>
      <li>La signature est une signature électronique simple (dessin, identité vérifiée par e-mail, horodatage serveur, empreinte). Pour une signature qualifiée, utilisez un prestataire dédié.</li>
    </ul></section>`;
}


function loginView(){
  const a = S.auth;
  const wrap = inner => `<div class="card" style="max-width:420px;margin-inline:auto">${inner}<p id="auth-msg" class="note" style="margin-top:12px" hidden></p></div>`;
  const field = (id,l,t,ex='') => `<div class="field"><label for="${id}">${l}</label><input type="${t}" id="${id}" ${ex}></div>`;
  if(a.mode==='login') return wrap(`<h2>Connexion</h2><p class="muted" style="margin:6px 0 14px">Utilisez l'adresse e-mail enregistrée par la DRH.</p>
    <form data-form="login" class="val-list" style="margin:0">${field('au-email','Adresse e-mail','email','autocomplete="username" required')}${field('au-pwd','Mot de passe','password','autocomplete="current-password" required')}
    <div class="row"><button class="btn primary" type="submit">Se connecter</button><button class="btn small" type="button" data-act="auth-to-code">Première connexion ou mot de passe oublié</button></div></form>`);
  if(a.step===1) return wrap(`<h2>Première connexion</h2><p class="muted" style="margin:6px 0 14px">Saisissez votre adresse e-mail. Vous recevrez un message avec un lien de connexion : il vous permettra de créer votre mot de passe.</p>
    <form data-form="send" class="val-list" style="margin:0">${field('au-email','Adresse e-mail','email',`autocomplete="username" required value="${esc(a.email)}"`)}
    <div class="row"><button class="btn primary" type="submit">Recevoir le lien</button><button class="btn small" type="button" data-act="auth-to-login">Retour</button></div></form>`);
  if(a.step===2) return wrap(`<h2>Consultez votre messagerie</h2><p class="muted" style="margin:6px 0 14px">Message envoyé à ${esc(a.email)}. Cliquez sur le lien qu'il contient (vérifiez les courriers indésirables). Si le message contient un code à 6 chiffres, saisissez-le ci-dessous.</p>
    <form data-form="verify" class="val-list" style="margin:0">${field('au-code','Code à 6 chiffres','text','inputmode="numeric" autocomplete="one-time-code" maxlength="8" required')}
    <div class="row"><button class="btn primary" type="submit">Valider le code</button><button class="btn small" type="button" data-act="auth-to-code">Renvoyer le message</button></div></form>`);
  return wrap(`<h2>Choisissez votre mot de passe</h2><p class="muted" style="margin:6px 0 14px">12 caractères minimum. Utilisez une phrase que vous seul connaissez.</p>
    <form data-form="setpwd" class="val-list" style="margin:0">${field('au-new','Nouveau mot de passe','password','autocomplete="new-password" minlength="12" required')}${field('au-new2','Confirmation','password','autocomplete="new-password" minlength="12" required')}
    <div class="row"><button class="btn primary" type="submit">Enregistrer et continuer</button></div></form>`);
}
function render(){
  pendingRender = false;
  let body = '', showHeader = false;
  if(!ready){
    body = `<div class="card empty"><b>Configuration manquante</b>Renseignez l'adresse et la clé publique Supabase dans le fichier config.js.</div>`;
  } else if(S.fatal==='unregistered'){
    body = `<div class="card empty"><b>Adresse non enregistrée</b>Votre adresse n'est associée à aucune fiche active. Contactez la DRH.<div style="margin-top:14px"><button class="btn" data-act="logout">Se déconnecter</button></div></div>`;
  } else if(S.fatal){
    body = `<div class="card empty"><b>Accès impossible</b>Une erreur est survenue. Rechargez la page ou reconnectez-vous.<div style="margin-top:14px"><button class="btn" data-act="logout">Se déconnecter</button></div></div>`;
  } else if(S.loading){
    body = `<div class="card empty"><b>Chargement…</b>Récupération de votre suivi.</div>`;
  } else if(!S.session){
    body = loginView();
  } else {
    showHeader = true;
    if(S.tab==='team' && S.isAdmin) body = S.viewUid ? detailView() : teamView();
    else if(S.tab==='team' && S.consult) body = S.viewUid ? consultDetailView() : teamView();
    else if(S.tab==='settings' && S.isAdmin) body = settingsView();
    else if(!S.hasOwn) body = teamView();
    else body = employeeView({ uid:S.uid, doc:S.myCycle, hr:S.myHr, readonly:false, isAdmin:S.isAdmin });
  }
  const top = showHeader ? header() : `<header class="top"><div class="top-row"><div class="brand"><h1>McDonald's</h1><p>Suivi du forfait 218 jours</p></div></div><div style="height:12px"></div></header>`;
  $app.innerHTML = top + `<main>${body}</main>`;
  initPad(); verifyIntegrity();
}


// ---------- fichier Excel (.xlsx) généré dans le navigateur, sans bibliothèque externe
const CRC = (() => { const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c = n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; t[n] = c>>>0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for(let i=0;i<u8.length;i++) c = CRC[(c ^ u8[i]) & 255] ^ (c>>>8); return (c ^ 0xFFFFFFFF)>>>0; };
function zipStore(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n&255, (n>>8)&255], u32 = n => [n&255, (n>>8)&255, (n>>16)&255, (n>>>24)&255];
  for(const f of files){
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const head = new Uint8Array([0x50,0x4b,3,4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, data);
    central.push(new Uint8Array([0x50,0x4b,1,2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((a,b) => a + b.length, 0);
  const end = new Uint8Array([0x50,0x4b,5,6, 0,0,0,0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0,0]);
  return new Blob([...parts, ...central, end], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xe = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const colName = i => { let n = '', k = i+1; while(k>0){ const m = (k-1)%26; n = String.fromCharCode(65+m) + n; k = Math.floor((k-1)/26); } return n; };
function sheetXml(rows, widths){
  const body = rows.map((r,ri) => `<row r="${ri+1}">` + r.map((v,ci) => {
    const ref = colName(ci) + (ri+1), st = ri===0 ? ' s="1"' : '';
    if(typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if(v === null || v === undefined || v === '') return '';
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const cols = widths ? `<cols>${widths.map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}
function makeXlsx(sheets){
  const files = [
    { name:'[Content_Types].xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name:'_rels/.rels', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name:'xl/workbook.xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh,i) => `<sheet name="${xe(sh.name).slice(0,31)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>` },
    { name:'xl/_rels/workbook.xml.rels', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name:'xl/styles.xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((sh,i) => ({ name:`xl/worksheets/sheet${i+1}.xml`, data:sheetXml(sh.rows, sh.widths) }))
  ];
  return zipStore(files);
}
function saveBlob(name, blob){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- relevés (PDF via impression, Excel)
const DOWL = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
function downloadCard(){
  const mo = cycleMonths(cyc())[S.mi];
  return `<section class="card" aria-labelledby="dl-h"><h3 id="dl-h">Télécharger</h3>
    <p class="muted" style="margin:6px 0 10px">Relevé des jours saisis. Le PDF s'obtient avec « Enregistrer au format PDF » dans la fenêtre d'impression.</p>
    <div class="row">
      <button class="btn small" data-act="dl" data-v="month-pdf">${MONTHS[mo.m]} · PDF</button>
      <button class="btn small" data-act="dl" data-v="month-xlsx">${MONTHS[mo.m]} · Excel</button>
      <button class="btn small" data-act="dl" data-v="cycle-pdf">Cycle ${cycLabel(cyc())} · PDF</button>
      <button class="btn small" data-act="dl" data-v="cycle-xlsx">Cycle ${cycLabel(cyc())} · Excel</button>
    </div></section>`;
}
const monthDays = mo => Array.from({length:new Date(mo.y,mo.m+1,0).getDate()}, (_,i) => new Date(mo.y,mo.m,i+1));
const slug = t => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
function dayRowsX(hr, doc, days){
  const hol = holidays(cyc()), rows = [['Collaborateur','Date','Jour','Prévu','Réel','Retenu','Jour férié']];
  for(const d of days){
    const iso = toIso(d), p = doc.prev[iso]||'', r = doc.reel[iso]||'';
    rows.push([hr.nom, fmtDate(iso), DOWL[d.getDay()], p, r, r||p, hol[iso]||'']);
  }
  return rows;
}
function recapRowsX(hr, doc){
  const c = cyc(), al = alloc(hr), sum = summarize(doc, c), pj = projectCycle(doc, c, al, sum), m = metrics(sum, al, pj), hol = holidays(c);
  const rows = [['Mois', ...REAL_CODES.map(x => x.k), 'Fériés travaillés', 'Non planifiés', 'Validation']];
  for(const mo of cycleMonths(c)){
    const t = {}; let blank = 0, jfw = 0;
    for(const d of monthDays(mo)){ const iso = toIso(d), e = doc.reel[iso]||doc.prev[iso]; if(!e){ if(!(doc.from && iso < doc.from)) blank++; continue; } t[e] = (t[e]||0)+1; if(e==='JT' && hol[iso]) jfw++; }
    const rec = doc.months[mo.ym] || {};
    rows.push([`${MONTHS[mo.m]} ${mo.y}`, ...REAL_CODES.map(x => t[x.k]||0), jfw, blank, rec.valide ? 'Validé'+(rec.visa?' · visé':'') : '']);
  }
  rows.push([]);
  rows.push(['Collaborateur', hr.nom]); rows.push(['Cycle', cycLabel(c)]);
  rows.push(['Jours réalisés (plafond)', sum.real]); rows.push(['Jours planifiés (réel, sinon prévu)', pj.planned]); rows.push(['Jours non planifiés estimés', pj.est]);
  rows.push(['CP restants (jours travaillés en moins)', pj.cpDays]); rows.push(['Projection si les RTT restants ne sont pas pris', pj.noRtt]);
  rows.push(['RTT restants à prendre', pj.rttLeft]); rows.push(['Projection au rythme normal (CP et RTT pris)', pj.withRtt]); rows.push(['RTT en retard', pj.rttRetard]); rows.push(['Plafond', al.plafond]);
  rows.push(['Marge (−) / excédent', -m.reste]);
  rows.push(['CP planifiés', sum.cp]); rows.push(['CP à prendre', al.cp]); if(al.cpa >= 1) rows.push(['CP par anticipation', al.cpa]); rows.push(['RTT planifiés', sum.rtt]); rows.push(['RTT à prendre', al.rtt]);
  rows.push(['Fériés travaillés déduits', sum.jfw]);
  return rows;
}
function reportHead(hr, title, sub){
  return `<div class="rpt">${hr.restaurant ? `<p class="rest"><b>${esc(hr.restaurant)}</b></p>` : ''}<h1>${esc(title)}</h1>
    <p><b>${esc(hr.nom)}</b>${hr.fonction ? ' · '+esc(hr.fonction) : ''}${hr.n1 ? ' · N+1 : '+esc(hr.n1) : ''}<br>${esc(sub)}<br><small>Édité le ${fmtDate(todayIso())}</small></p>`;
}
function reportMonth(uid, doc, hr){
  const c = cyc(), mo = cycleMonths(c)[S.mi], hol = holidays(c), rec = doc.months[mo.ym] || {};
  const rows = monthDays(mo).map(d => { const iso = toIso(d), p = doc.prev[iso]||'', r = doc.reel[iso]||'';
    return `<tr><td>${fmtDate(iso)}</td><td>${DOWL[d.getDay()]}</td><td>${p||'—'}</td><td>${r||'—'}</td><td>${esc(hol[iso]||'')}</td></tr>`; }).join('');
  const tally = {}; for(const d of monthDays(mo)){ const iso = toIso(d), e = doc.reel[iso]||doc.prev[iso]; if(e) tally[e] = (tally[e]||0)+1; }
  const sig = rec.valide
    ? `<p>Déclarations du salarié : charge de travail ${rec.charge==='haute'?'élevée':rec.charge==='excessive'?'excessive':'raisonnable'} · temps de travail quotidien et hebdomadaire respecté : ${rec.r11===false?'non':'oui'} · temps de repos et congés payés respectés : ${rec.r35===false?'non':'oui'} · équilibre vie professionnelle / personnelle : ${rec.equilibre===false?'non':'oui'}${rec.comment ? ' · « '+esc(rec.comment)+' »' : ''}.</p><p>Mois validé et signé électroniquement par <b>${esc(rec.sig && rec.sig.name || hr.nom)}</b>${rec.at ? ' le '+fmtDate(rec.at.slice(0,10)) : ''}. ${rec.visa ? 'Visé par '+esc(rec.visa.name||'la DRH')+(rec.visa.at ? ' le '+fmtDate(rec.visa.at.slice(0,10)) : '')+'.' : 'Non visé.'}</p>
       <div class="sigs">${sigBox(rec.sig,'Salarié')}${sigBox(rec.visa,'Visa DRH / N+1')}</div>${rec.hash ? `<p><small>Empreinte SHA-256 : ${esc(rec.hash)}</small></p>` : ''}`
    : `<p>Mois non validé.</p>`;
  return reportHead(hr, `Relevé de ${MONTHS[mo.m].toLowerCase()} ${mo.y}`, `Forfait annuel en jours · cycle ${cycLabel(c)}`) +
    `<table><thead><tr><th>Date</th><th>Jour</th><th>Prévu</th><th>Réel</th><th>Observation</th></tr></thead><tbody>${rows}</tbody></table>
    <p><b>Total retenu (réel, sinon prévu) :</b> ${CODES.map(x => tally[x.k] ? `${x.k} ${tally[x.k]}` : '').filter(Boolean).join(' · ') || 'aucun jour saisi'}</p>${sig}
    <p><small>JT jour travaillé · OFF repos · RTT · CP congé payé · JF férié · AM arrêt maladie · AT accident du travail. Un férié travaillé est payé et ne compte pas dans le plafond.</small></p></div>`;
}
function reportCycle(uid, doc, hr){
  const c = cyc(), al = alloc(hr), sum = summarize(doc, c), pj = projectCycle(doc, c, al, sum), m = metrics(sum, al, pj), ms = cycleMonths(c), hol = holidays(c);
  const rows = ms.map(mo => { const t = {}; let blank = 0, jfw = 0;
    for(const d of monthDays(mo)){ const iso = toIso(d), e = doc.reel[iso]||doc.prev[iso]; if(!e){ if(!(doc.from && iso < doc.from)) blank++; continue; } t[e] = (t[e]||0)+1; if(e==='JT' && hol[iso]) jfw++; }
    const rec = doc.months[mo.ym] || {};
    return `<tr><td>${MONTHS[mo.m]} ${mo.y}</td>${REAL_CODES.map(x => `<td>${t[x.k]||0}</td>`).join('')}<td>${jfw}</td><td>${blank}</td><td>${rec.valide ? 'Validé'+(rec.visa?' · visé':'') : '—'}</td></tr>`; }).join('');
  return reportHead(hr, `Relevé du cycle ${cycLabel(c)}`, `Forfait annuel en jours · juin ${c} → mai ${c+1}`) +
    `<table><thead><tr><th>Mois</th>${REAL_CODES.map(x => `<th>${x.k}</th>`).join('')}<th>Fériés trav.</th><th>Non planifiés</th><th>Validation</th></tr></thead><tbody>${rows}</tbody></table>
    <p><b>Jours retenus pour le plafond :</b> réalisés ${nf(sum.real)} · planifiés ${pj.planned} · non planifiés estimés ${pj.est}.<br>
    <b>Projection du cycle complet, au rythme normal (CP et RTT pris) :</b> ${pj.withRtt} jours (${m.reste>=0?'marge '+nf(m.reste):'excédent '+nf(-m.reste)} par rapport à ${al.plafond}) · ${pj.noRtt} jours si les ${pj.rttLeft} RTT restants ne sont pas pris.<br>
    <b>Quotas :</b> CP ${sum.cp} / ${al.cp}${al.cpa >= 1 ? ` (dont ${al.cpa} par anticipation)` : ''} · RTT ${sum.rtt} / ${al.rtt}. Fériés travaillés déduits : ${sum.jfw}.</p>
    <p><small>JT jour travaillé · OFF repos · RTT · CP congé payé · JF férié · AM arrêt maladie · AT accident du travail. Décompte sur le réel, à défaut le prévu.</small></p></div>`;
}
function printReport(html){
  const root = document.getElementById('print-root'); root.innerHTML = html; document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); window.print();
}
function runDownload(kind){
  const t = (S.tab==='team' && S.viewUid) ? { uid:S.viewUid, doc:S.allDocs[S.viewUid] || emptyCycle(), hr:S.hr[S.viewUid] } : { uid:S.uid, doc:S.myCycle, hr:S.myHr };
  if(!t.hr) return;
  const c = cyc(), mo = cycleMonths(c)[S.mi], base = `forfait-jours-${slug(t.hr.nom)}`;
  if(kind==='month-pdf') printReport(reportMonth(t.uid, t.doc, t.hr));
  else if(kind==='cycle-pdf') printReport(reportCycle(t.uid, t.doc, t.hr));
  else if(kind==='month-xlsx') saveBlob(`${base}-${mo.ym}.xlsx`, makeXlsx([{ name:'Jours', rows:dayRowsX(t.hr, t.doc, monthDays(mo)), widths:[26,22,14,8,8,9,24] }]));
  else if(kind==='cycle-xlsx') saveBlob(`${base}-${cycLabel(c)}.xlsx`, makeXlsx([{ name:'Récapitulatif', rows:recapRowsX(t.hr, t.doc), widths:[28,12,8,8,8,8,8,8,18,14,16] }, { name:'Jours', rows:dayRowsX(t.hr, t.doc, [...cycleDays(c)]), widths:[26,22,14,8,8,9,24] }]));
}

// ---------- actions
let toastTimer;
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('on'),4200); }
const csvCell = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
function exportCsv(){
  const rows = [['Collaborateur','E-mail','Fonction','Catégorie','Restaurant','N+1','Plafond','Jours réalisés','Projection si RTT non pris','Projection au rythme normal','CP planifiés','CP à prendre','RTT planifiés','RTT à prendre','Jours OFF','Jours non planifiés','Statut','Mois validés','Mois non validés','Jours consécutifs max','Repos/charge signalés','Entretien']];
  for(const r of teamRows().rows){
    rows.push([nameOf(r.uid), r.hr.email, r.hr.fonction, r.hr.categorie, r.hr.restaurant, r.hr.n1, r.al.plafond, r.started?r.sum.real:'', r.started?r.pj.noRtt:'', r.started?r.pj.withRtt:'', r.started?r.sum.cp:'', r.al.cp, r.started?r.sum.rtt:'', r.al.rtt, r.started?r.sum.off:'', r.started?r.sum.blank:'', STATUS[r.m.status], r.started?r.sum.validated.length:'', r.started?r.late.length:'', r.started?r.sum.maxStreak:'', r.started?(r.sum.issues.length?'oui':'non'):'', r.iv.label]);
  }
  saveBlob(`forfait-jours-equipe-${cycLabel(cyc())}.xlsx`, makeXlsx([{ name:'Équipe', rows, widths:[26,30,24,12,18,18,9,14,22,22,13,13,13,13,10,16,28,13,16,14,16,16] }]));
}
function defaultFor(d, hol){ const iso = toIso(d); return hol[iso] ? 'JF' : (d.getDay()===0||d.getDay()===6) ? 'OFF' : 'JT'; }
async function changeCycle(c){
  S.cycle = c; S.mi = defaultMonthIndex(c); S.signing = null; padStrokes = [];
  S.loading = true; render();
  try { await loadData(); } catch(e){ toast(msg(e)); }
  S.loading = false; render();
}
const numOrNull = id => { const el = document.getElementById(id); if(!el) return null; const v = el.value.trim(); return v==='' ? null : Number(v); };
const emailOrNull = id => { const v = document.getElementById(id).value.trim().toLowerCase(); return v || null; };

$app.addEventListener('submit', async ev => {
  const form = ev.target.closest('[data-form]'); if(!form) return;
  ev.preventDefault();
  const kind = form.dataset.form, btn = form.querySelector('button[type=submit]');
  const val = id => document.getElementById(id).value.trim();
  btn.disabled = true;
  try {
    if(kind==='login'){
      const { error } = await sb.auth.signInWithPassword({ email:val('au-email').toLowerCase(), password:document.getElementById('au-pwd').value });
      if(error) throw error;
      S.loading = true; render(); await startSession();
    } else if(kind==='send'){
      const email = val('au-email').toLowerCase();
      const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:true, emailRedirectTo: location.origin + location.pathname } });
      if(error) throw error;
      S.auth = { mode:'code', step:2, email }; render(); authMsg('E-mail envoyé. Il reste valable quelques minutes.', true);
    } else if(kind==='verify'){
      const { error } = await sb.auth.verifyOtp({ email:S.auth.email, token:val('au-code').replace(/\s/g,''), type:'email' });
      if(error) throw error;
      S.auth = { mode:'code', step:3, email:S.auth.email }; render();
    } else if(kind==='setpwd'){
      const p1 = document.getElementById('au-new').value, p2 = document.getElementById('au-new2').value;
      if(p1.length<12) throw new Error('12 caractères minimum.');
      if(p1!==p2) throw new Error('Les deux mots de passe sont différents.');
      const { error } = await sb.auth.updateUser({ password:p1 });
      if(error) throw error;
      S.auth = { mode:'login', step:1, email:'' }; pendingPwd = false; S.loading = true; render(); await startSession();
    }
  } catch(e){ btn.disabled = false; S.loading = false; if(kind==='login'||kind==='setpwd') render(); authMsg(msg(e), false); }
});

$app.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if(!el || el.disabled) return;
  const act = el.dataset.act, v = el.dataset.v, c = cyc();
  if(act==='auth-to-code'){ S.auth = { mode:'code', step:1, email:S.auth.email }; render(); return; }
  if(act==='auth-to-login'){ S.auth = { mode:'login', step:1, email:'' }; render(); return; }
  if(act==='logout'){ logout(); return; }
  if(!S.session || !S.uid) return;
  const hol = holidays(c), doc = S.allDocs[tgt().uid] || emptyCycle(), mo = cycleMonths(c)[S.mi];
  const val = id => document.getElementById(id).value.trim();
  if(act==='tab'){ S.tab=v; S.viewUid=null; S.signing=null; render(); }
  else if(act==='month'){ S.mi = Math.min(11, Math.max(0, S.mi + Number(v))); S.signing=null; padStrokes=[]; render(); }
  else if(act==='brush'){ S.brush=v; render(); }
  else if(act==='layer'){ S.layer=v; render(); }
  else if(act==='day'){
    const cur = (S.layer==='prev' ? doc.prev : doc.reel)[v] || '';
    setCodes(S.layer, { [v]: cur===S.brush ? '' : S.brush });
  }
  else if(act==='week'){
    const layerDoc = S.layer==='prev' ? doc.prev : doc.reel, map = {}, mon = parse(v);
    for(let i=0;i<7;i++){ const d = new Date(mon); d.setDate(d.getDate()+i); const iso = toIso(d);
      if(d.getMonth()===mo.m && d.getFullYear()===mo.y && !layerDoc[iso] && !(doc.from && iso < doc.from)) map[iso]=S.brush; }
    if(Object.keys(map).length) setCodes(S.layer, map); else toast('Aucun jour vide dans cette semaine.');
  }
  else if(act==='fillmonth' || act==='fillcycle'){
    const map = {};
    const days = act==='fillmonth' ? Array.from({length:new Date(mo.y,mo.m+1,0).getDate()}, (_,i) => new Date(mo.y,mo.m,i+1)) : [...cycleDays(c)];
    for(const d of days){ const iso = toIso(d); if(!doc.prev[iso] && !(doc.from && iso < doc.from)) map[iso] = defaultFor(d,hol); }
    if(Object.keys(map).length) setCodes('prev', map); else toast('Tout est déjà planifié.');
  }
  else if(act==='confirm'){
    const map = {}, t = todayIso();
    for(let d=1; d<=new Date(mo.y,mo.m+1,0).getDate(); d++){ const iso = isoOf(mo.y,mo.m,d); if(iso<=t && !doc.reel[iso] && doc.prev[iso]) map[iso] = doc.prev[iso]; }
    if(Object.keys(map).length) setCodes('reel', map); else toast('Rien à confirmer : le prévu est déjà reporté en réel ou vide.');
  }
  else if(act==='draft'){ S.draft[mo.ym] = { ...(S.draft[mo.ym]||{r11:true,r35:true,equilibre:true,charge:'ok',comment:''}), [el.dataset.k]: v==='true' }; render(); }
  else if(act==='sign-open'){ S.signing=v; padStrokes=[]; render(); }
  else if(act==='sign-cancel'){ S.signing=null; padStrokes=[]; render(); }
  else if(act==='sign-clear'){ padStrokes=[]; render(); }
  else if(act==='sign-submit'){
    if(!padStrokes.length){ toast('Dessinez votre signature dans le cadre.'); return; }
    if(!document.getElementById('sign-ok').checked){ toast('Cochez la case de certification avant de signer.'); return; }
    const kind = S.signing, strokes = padStrokes.map(st => st.slice()), at = new Date().toISOString(), name = S.me.name;
    S.signing=null; padStrokes=[];
    enqueue(async () => {
      if(kind==='validate'){
        const dr = S.draft[mo.ym] || {r11:true,r35:true,equilibre:true,charge:'ok',comment:''};
        const rec = { r11:dr.r11!==false, r35:dr.r35!==false, equilibre:dr.equilibre!==false, charge:dr.charge||'ok', comment:(dr.comment||'').trim() };
        const hash = await sha256(canonical(S.myCycle, S.uid, mo.ym, rec));
        await dbDo(sb.from('validations').upsert({ collaborateur_id:S.uid, mois:mo.ym, valide:true, r11:rec.r11, r35:rec.r35, equilibre:rec.equilibre, charge:rec.charge, commentaire:rec.comment, empreinte:hash, signature:{ strokes, name, at } }, { onConflict:'collaborateur_id,mois' }));
        await loadData(); render(); toast('Mois signé et validé.');
      } else if(kind==='visa'){
        const uid = S.viewUid, base = ((S.allDocs[uid]||emptyCycle()).months[mo.ym]) || {};
        await dbDo(sb.from('validations').update({ visa:{ at, by:S.uid, name, strokes, of:base.hash||'' } }).eq('collaborateur_id',uid).eq('mois',mo.ym));
        await loadData(); render(); toast('Mois visé.');
      }
    });
    render();
  }
  else if(act==='goto-cycle'){ changeCycle(Number(v)); }
  else if(act==='save-quotas'){
    const rows = Object.entries(S.hr).filter(([,h]) => h.actif!==false && h.role!=='lecteur').map(([id]) => ({ collaborateur_id:id, cycle:c, plafond:numOrNull('q-p-'+id), cp:numOrNull('q-c-'+id), rtt:numOrNull('q-r-'+id) }));
    enqueue(async () => { await upsertChunks('quotas', rows, 'collaborateur_id,cycle'); await loadData(); render(); toast('Quotas enregistrés.'); });
  }
  else if(act==='open'){ S.viewUid=v; S.mi = defaultMonthIndex(c); render(); if(S.isAdmin) loadHistory(v).then(safeRender).catch(() => {}); }
  else if(act==='back'){ S.viewUid=null; S.confirmDel=null; render(); }
  else if(act==='reopen'){
    const uid = S.viewUid;
    enqueue(async () => {
      await dbDo(sb.from('validations').update({ valide:false, visa:null, signature:null, empreinte:null, signe_le:null, reouvert_le:new Date().toISOString() }).eq('collaborateur_id',uid).eq('mois',v));
      await loadData(); render(); toast('Mois rouvert pour le salarié.');
    });
  }
  else if(act==='save-hr'){
    const uid = S.viewUid;
    const row = { nom:val('hr-nom'), email:emailOrNull('hr-email'), fonction:val('hr-fonction'), categorie:val('hr-categorie')||null, restaurant:val('hr-restaurant'), n1:val('hr-n1'), role:val('hr-role'), niveau:Number(val('hr-niveau'))||4, entretien:val('hr-entretien')||null, date_entree:val('hr-entree')||null };
    if(!row.nom){ toast('Le nom est obligatoire.'); return; }
    if(uid===S.uid && row.role!=='admin'){ toast('Vous ne pouvez pas retirer vos propres droits d\'administrateur.'); return; }
    const q = { collaborateur_id:uid, cycle:c, plafond:numOrNull('hr-plafond'), cp:numOrNull('hr-cp'), rtt:numOrNull('hr-rtt'), cp_anticipe:numOrNull('hr-cpa') };
    enqueue(async () => { await dbDo(sb.from('collaborateurs').update(row).eq('id',uid)); if(row.role!=='lecteur') await upsertChunks('quotas',[q],'collaborateur_id,cycle'); await loadData(); render(); toast('Fiche enregistrée.'); });
  }
  else if(act==='archive' || act==='restore'){
    const uid = S.viewUid;
    if(uid===S.uid){ toast('Vous ne pouvez pas vous retirer vous-même.'); return; }
    enqueue(async () => { await dbDo(sb.from('collaborateurs').update({ actif: act==='restore' }).eq('id',uid)); await loadData(); S.viewUid = act==='archive' ? null : uid; render(); toast(act==='restore' ? 'Collaborateur réintégré.' : 'Collaborateur retiré du suivi.'); });
  }
  else if(act==='delete-ask'){ S.confirmDel=S.viewUid; render(); }
  else if(act==='delete-cancel'){ S.confirmDel=null; render(); }
  else if(act==='delete-final'){
    const uid = S.viewUid; S.confirmDel=null; S.viewUid=null; render();
    enqueue(async () => { await dbDo(sb.from('collaborateurs').delete().eq('id',uid)); await loadData(); render(); toast('Collaborateur supprimé définitivement.'); });
  }
  else if(act==='add-open'){ S.adding=true; render(); }
  else if(act==='add-close'){ S.adding=false; render(); }
  else if(act==='add-save'){
    const row = { nom:val('add-nom'), email:emailOrNull('add-email'), fonction:val('add-fonction'), categorie:val('add-categorie'), restaurant:val('add-restaurant'), n1:val('add-n1'), role:val('add-role'), niveau:Number(val('add-niveau'))||4, actif:true, date_entree:val('add-entree')||null };
    if(!row.nom){ toast('Le nom est obligatoire.'); return; }
    const q = { plafond:numOrNull('add-plafond'), cp:numOrNull('add-cp'), rtt:numOrNull('add-rtt') };
    S.adding=false; render();
    enqueue(async () => {
      const { data, error } = await sb.from('collaborateurs').insert(row).select('id').single(); if(error) throw error;
      await upsertChunks('quotas', [{ collaborateur_id:data.id, cycle:c, ...q }], 'collaborateur_id,cycle');
      await loadData(); render(); toast(`${row.nom} ajouté au suivi.`);
    });
  }
  else if(act==='save-settings'){
    const n = id => Number(document.getElementById(id).value);
    const row = { id:1, cycle:n('set-cycle')||curCycle(), plafond:n('set-plafond')||DEF.plafond, cp:n('set-cp'), rtt:n('set-rtt'), preavis:n('set-preavis'), arret_compte:document.getElementById('set-arret').value==='1' };
    enqueue(async () => { await dbDo(sb.from('parametres').upsert(row)); await loadSettings(); render(); toast('Réglages enregistrés.'); });
  }
  else if(act==='dl') runDownload(v);
  else if(act==='export') exportCsv();
});
$app.addEventListener('keydown', ev => { if((ev.key==='Enter'||ev.key===' ') && ev.target.matches('tr[data-act="open"]')){ ev.preventDefault(); ev.target.click(); } });
$app.addEventListener('input', ev => {
  const t = ev.target;
  if(t.dataset.k){ const ym = cycleMonths(cyc())[S.mi].ym; S.draft[ym] = { ...(S.draft[ym]||{r11:true,r35:true,equilibre:true,charge:'ok',comment:''}), [t.dataset.k]: t.value }; }
  else if(t.dataset.filter==='fQ'){ S.fQ=t.value; const pos=t.selectionStart; render(); const n=document.getElementById('f-q'); if(n){ n.focus(); n.setSelectionRange(pos,pos); } }
});
$app.addEventListener('change', ev => {
  const t = ev.target;
  if(t.dataset.filter==='fRest'){ S.fRest=t.value; render(); }
  else if(t.dataset.filter==='fStatus'){ S.fStatus=t.value; render(); }
  else if(t.dataset.filter==='showArchived'){ S.showArchived=t.value==='1'; render(); }
  else if(t.dataset.heat!==undefined){ S.heat=t.value; render(); }
  else if(t.dataset.cycle!==undefined){ changeCycle(Number(t.value)); }
});

// ---------- démarrage
render();
if(ready){
  sb.auth.onAuthStateChange(ev => { if(ev==='SIGNED_OUT' && S.session) location.reload(); });
  startSession().catch(e => { console.error(e); S.fatal='error'; S.loading=false; render(); });
} else { S.loading = false; render(); }
})();
