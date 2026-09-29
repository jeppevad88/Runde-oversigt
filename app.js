let sb = null;
let supabaseInitError = null;
try {
  if (!window.supabase?.createClient) throw new Error("Supabase-biblioteket blev ikke indlæst");
  if (!window.SUPABASE_CONFIG?.url || !window.SUPABASE_CONFIG?.anonKey) throw new Error("Supabase-konfiguration mangler");
  sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
} catch (err) {
  console.error(err);
  supabaseInitError = err;
}

const DATA = window.APP_DATA;
const teamMap = Object.fromEntries(DATA.teams.map(t => [t.id, t]));
const playerMap = Object.fromEntries(DATA.teams.flatMap(t => t.players.map(p => [p.id, {...p, originalTeamId:t.id}])));
let rosterState = {}; // key: round-team -> {slots: [], absences: []}
function getCurrentDateLocal(){
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseMatchDate(dateText){
  const [day, month, year] = String(dateText).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getInitialRound(){
  const today = getCurrentDateLocal();
  const rounds = [...DATA.rounds].sort((a,b)=>a.round-b.round);

  // Keep the user on a round as long as at least one match in that round
  // is today or in the future. Once every match date has passed, move on.
  const nextRound = rounds.find(r =>
    r.matches.some(m => parseMatchDate(m.date).getTime() >= today.getTime())
  );

  return nextRound ? nextRound.round : (rounds.length ? rounds[rounds.length - 1].round : 1);
}

let currentRound = getInitialRound();
let statsMode = 'teams';
let usingLocalFallback = false;

const $ = (sel) => document.querySelector(sel);

function rosterKey(round, teamId){ return `${round}-${teamId}`; }

function baseRoster(teamId){
  const team = teamMap[teamId];
  return [...team.players.map(p => ({playerId:p.id,name:p.name,originalTeamId:teamId,kind:"fast"})),
          ...Array.from({length:Math.max(0,8-team.players.length)},()=>null)];
}

function cloneRoster(arr){ return arr.map(x => x ? {...x} : null); }

function normalizeStored(value, teamId){
  // Backwards compatible with the old database format, where `players` was just an array.
  let slots = Array.isArray(value) ? value : (value && Array.isArray(value.slots) ? value.slots : []);
  let absences = Array.isArray(value && value.absences) ? value.absences : [];

  // Villads Kaptain (p33) is originally on Hjallerup 6 only.
  // Remove an old fixed entry from Hjallerup 5, but allow him to be added as a loan.
  slots = slots.filter(x => !(teamId === "hold5" && x && x.playerId === "p33" && x.kind !== "loan"));
  slots = slots.slice(0,8).map(x => x && x.playerId ? x : null);
  while(slots.length < 8) slots.push(null);

  // Clean old/duplicate absence entries and never show an absence for someone currently on the team.
  const currentIds = new Set(slots.filter(Boolean).map(x => x.playerId));
  const seen = new Set();
  absences = absences.filter(x => x && x.playerId && !currentIds.has(x.playerId) && !seen.has(x.playerId) && playerMap[x.playerId]);
  absences.forEach(x => seen.add(x.playerId));

  return {slots, absences};
}

function getState(round, teamId){
  const key=rosterKey(round,teamId);
  if(!rosterState[key]) rosterState[key]={slots:baseRoster(teamId),absences:[]};
  return rosterState[key];
}

function getRoster(round, teamId){ return getState(round,teamId).slots; }
function getAbsences(round, teamId){ return getState(round,teamId).absences; }

function setAbsence(round, teamId, player){
  const absences=getAbsences(round,teamId);
  if(!absences.some(x=>x.playerId===player.playerId)) absences.push({...player, reason:""});
}
function setAbsenceReason(round, teamId, playerId, reason){
  const absence=getAbsences(round,teamId).find(x=>x.playerId===playerId);
  if(absence) absence.reason=reason;
}
function removeAbsence(round, teamId, playerId){
  const state=getState(round,teamId);
  state.absences=state.absences.filter(x=>x.playerId!==playerId);
}

function setStatus(text, offline=false){
  $("#saveStatus").innerHTML = `<span class="status-dot ${offline?'offline':''}"></span>${text}`;
}

function withTimeout(promise, ms=9000){
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error("Forbindelsen til Supabase tog for lang tid")), ms))
  ]);
}

function initializeBaseRosters(){
  for(const r of DATA.rounds){
    for(const m of r.matches){
      const key=rosterKey(r.round,m.teamId);
      if(!rosterState[key]) rosterState[key]={slots:baseRoster(m.teamId),absences:[]};
    }
  }
}

function serializeState(){
  const rounds = {};
  for(const [key,value] of Object.entries(rosterState)){
    rounds[key] = {
      slots: value.slots,
      absences: value.absences || []
    };
  }
  return {rounds, updatedAt:new Date().toISOString()};
}

function applyStoredState(state){
  rosterState={};
  const rounds = state && typeof state === "object" && state.rounds && typeof state.rounds === "object" ? state.rounds : {};
  for(const [key,value] of Object.entries(rounds)){
    const parts=key.split("-");
    const teamId=parts.slice(1).join("-");
    rosterState[key]=normalizeStored(value,teamId);
  }
  initializeBaseRosters();
}

async function seedEmptyDatabase(){
  initializeBaseRosters();
  const payload = serializeState();
  const {error}=await withTimeout(
    sb.from("u11_state").update({state:payload,updated_at:new Date().toISOString()}).eq("id","main")
  );
  if(error) throw error;
}

async function loadAll(){
  setStatus("Henter fælles data…");
  try{
    if(supabaseInitError || !sb) throw supabaseInitError || new Error("Supabase er ikke initialiseret");
    const {data,error}=await withTimeout(sb.from("u11_state").select("id,state,updated_at").eq("id","main").maybeSingle());
    if(error) throw error;
    if(!data) throw new Error("Fandt ikke rækken main i u11_state");

    const stored=data.state || {};
    const hasRounds=stored && stored.rounds && Object.keys(stored.rounds).length>0;
    if(hasRounds){
      applyStoredState(stored);
    }else{
      setStatus("Opretter grunddata…");
      initializeBaseRosters();
      await seedEmptyDatabase();
    }
    usingLocalFallback = false;
    setStatus("Fælles data gemmes automatisk");
  }catch(err){
    console.error("Supabase-fejl:",err);
    usingLocalFallback = true;
    try{
      const saved = JSON.parse(localStorage.getItem("u11-rosters") || "{}");
      rosterState = Object.fromEntries(Object.entries(saved).map(([k,v])=>{
        const parts=k.split("-");
        const teamId=parts.slice(1).join("-");
        return [k,normalizeStored(v,teamId)];
      }));
    }catch{}
    initializeBaseRosters();
    const detail = err?.message ? ` · ${err.message}` : "";
    setStatus(`⚠️ Supabase-forbindelse fejlede${detail}`, true);
    toast("Kunne ikke hente fælles data fra Supabase");
  }
  renderAll();
}

async function saveRoster(round, teamId){
  const state=getState(round,teamId);
  if(usingLocalFallback){
    localStorage.setItem("u11-rosters",JSON.stringify(rosterState));
    setStatus("Gemt lokalt", true);
    return;
  }
  setStatus("Gemmer…");
  const payload=serializeState();
  const {error}=await withTimeout(
    sb.from("u11_state").update({state:payload,updated_at:new Date().toISOString()}).eq("id","main")
  );
  if(error){
    console.error(error);
    usingLocalFallback=true;
    localStorage.setItem("u11-rosters",JSON.stringify(rosterState));
    setStatus("Gemmet lokalt – forbindelse fejlede", true);
    toast("Ændringen er gemt lokalt. Tjek Supabase.");
  }else{
    setStatus("Gemt · alle kan se ændringen");
  }
}

function roundDateText(r){
  const dates = r.matches.map(m=>m.date);
  return [...new Set(dates)].join(" · ");
}

function renderTabs(){
  const el=$("#roundTabs");
  el.innerHTML = DATA.rounds.map(r=>`<button class="tab ${currentRound===r.round?'active':''}" data-round="${r.round}">Runde ${r.round}</button>`).join("")
    + `<button class="tab stats ${currentRound==='stats'?'active':''}" data-stats="1">Spillerstatistik</button>`;
  el.querySelectorAll("[data-round]").forEach(b=>b.onclick=()=>{currentRound=Number(b.dataset.round);renderAll()});
  el.querySelector("[data-stats]").onclick=()=>{currentRound='stats';statsMode='teams';renderAll()};
}

function renderRound(){
  $("#statsView").classList.add("hidden");
  $("#roundView").classList.remove("hidden");
  const r=DATA.rounds.find(x=>x.round===currentRound);
  if(!r) return;
  $("#roundView").innerHTML=`
    <div class="round-head">
      <div>
        <h2>Runde ${r.round}</h2>
        <p>${roundDateText(r)} · ${r.matches.length} Hjallerup-hold i kamp</p>
      </div>
    </div>
    <div class="round-grid">${r.matches.map(renderTeamCard).join("")}</div>`;
  attachTeamActions();
}

function renderTeamCard(m){
  const roster=getRoster(currentRound,m.teamId);
  const absences=getAbsences(currentRound,m.teamId);
  const filled=roster.filter(Boolean).length;
  const team=teamMap[m.teamId];
  const playersHtml=roster.map((p,i)=>{
    if(!p) return `<div class="player-row">
      <div class="player-number">${i+1}</div>
      <div class="player-name empty">Ledig plads</div>
      <div class="player-actions"><button class="add-btn" data-add="${m.teamId}" data-slot="${i}">+ Tilføj</button></div>
    </div>`;
    const isLoan=p.originalTeamId!==m.teamId;
    return `<div class="player-row">
      <div class="player-number">${i+1}</div>
      <div class="player-name ${isLoan?"loaned-player":""}">${escapeHtml(p.name)}</div>
      ${isLoan?`<span class="loan-tag">LÅN</span>`:""}
      <div class="player-actions"><button class="icon-btn remove" title="Fjern spiller" data-remove="${m.teamId}" data-slot="${i}">×</button></div>
    </div>`;
  }).join("");

  const absencesHtml=absences.length
    ? absences.map(p=>`<div class="absence-row">
        <div class="absence-main">
          <span class="absence-dot">!</span>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.originalTeamId!==m.teamId?`<span class="absence-note">lånt spiller</span>`:""}
        </div>
        <input class="absence-reason" type="text" maxlength="120" value="${escapeHtml(p.reason||"")}" placeholder="Årsag til afbud…" data-absence-reason="${m.teamId}" data-player-id="${p.playerId}">
      </div>`).join("")
    : `<div class="no-absence">Ingen registrerede afbud</div>`;

  return `<article class="team-card">
    <div class="team-head">
      <div class="team-title"><h3>${team.name}</h3><span class="badge">${filled}/8 spillere</span></div>
      <div class="match"><strong>${m.day} ${m.date} kl. ${m.time}</strong><br>${escapeHtml(m.home)} – ${escapeHtml(m.away)}<br><span class="venue">${escapeHtml(m.venue)}</span></div>
    </div>
    <div class="roster">${playersHtml}</div>
    <div class="team-footer"><span>${filled<8?`${8-filled} ledige pladser`:"Holdet er fyldt"}</span>${filled<8?`<button class="add-btn" data-add="${m.teamId}" data-slot="${roster.findIndex(x=>!x)}">+ Lån spiller</button>`:`<span class="full">✓ Klar</span>`}</div>
    <div class="absence-box">
      <div class="absence-head"><span>Afbud</span><span class="absence-count">${absences.length}</span></div>
      <div class="absence-list">${absencesHtml}</div>
    </div>
  </article>`;
}

function attachTeamActions(){
  document.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=async()=>{
    const teamId=btn.dataset.remove, slot=Number(btn.dataset.slot);
    const roster=getRoster(currentRound,teamId);
    const player=roster[slot];
    if(!player) return;
    roster[slot]=null;
    setAbsence(currentRound,teamId,player);
    renderRound(); renderTabs();
    await saveRoster(currentRound,teamId);
    toast(`${player.name} er registreret som afbud`);
  });
  document.querySelectorAll("[data-add]").forEach(btn=>btn.onclick=()=>{
    openPlayerModal(btn.dataset.add,Number(btn.dataset.slot));
  });
  document.querySelectorAll("[data-absence-reason]").forEach(input=>{
    input.onchange=async()=>{
      const teamId=input.dataset.absenceReason;
      const playerId=input.dataset.playerId;
      setAbsenceReason(currentRound,teamId,playerId,input.value.trim());
      await saveRoster(currentRound,teamId);
    };
  });
}

function availablePlayers(teamId){
  const usedElsewhere=new Map();
  const round=DATA.rounds.find(r=>r.round===currentRound);
  for(const m of round.matches){
    if(m.teamId===teamId) continue;
    const roster=getRoster(currentRound,m.teamId);
    for(const p of roster.filter(Boolean)){
      if(!usedElsewhere.has(p.playerId)) usedElsewhere.set(p.playerId,[]);
      usedElsewhere.get(p.playerId).push(m.teamId);
    }
  }
  const currentIds=new Set(getRoster(currentRound,teamId).filter(Boolean).map(p=>p.playerId));
  return Object.values(playerMap)
    .filter(p=>!currentIds.has(p.id))
    .sort((a,b)=>a.name.localeCompare(b.name,'da'))
    .map(p=>({...p,usedOn:usedElsewhere.get(p.id)||[]}));
}

function openPlayerModal(teamId,slot){
  const options=availablePlayers(teamId);
  const modal=document.createElement("div");
  modal.className="modal-backdrop";
  modal.innerHTML=`<div class="modal">
    <h3>Tilføj spiller til ${teamMap[teamId].name}</h3>
    <p>Vælg den spiller, der skal med på dette hold. En spiller må gerne spille på flere hold i samme runde.</p>
    <select id="loanSelect">
      <option value="">Vælg spiller…</option>
      ${options.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} · ${escapeHtml(teamMap[p.originalTeamId].name)}${p.usedOn.length?` · også på ${p.usedOn.map(id=>escapeHtml(teamMap[id].name)).join(", ")}`:""}</option>`).join("")}
    </select>
    <div class="modal-actions"><button class="btn cancel">Annuller</button><button class="btn save">Tilføj</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".cancel").onclick=()=>modal.remove();
  modal.addEventListener("click",e=>{if(e.target===modal)modal.remove()});
  modal.querySelector(".save").onclick=async()=>{
    const id=modal.querySelector("#loanSelect").value;
    if(!id) return;
    const p=playerMap[id];
    const roster=getRoster(currentRound,teamId);
    const target=slot>=0 && !roster[slot] ? slot : roster.findIndex(x=>!x);
    if(target<0){toast("Holdet har allerede 8 spillere");return}
    roster[target]={playerId:p.id,name:p.name,originalTeamId:p.originalTeamId,kind:p.originalTeamId===teamId?"fast":"loan"};
    removeAbsence(currentRound,teamId,p.id);
    modal.remove();
    renderRound(); renderTabs();
    await saveRoster(currentRound,teamId);
    toast(`${p.name} er tilføjet til ${teamMap[teamId].name}`);
  };
}

function buildStats(){
  const grouped=DATA.teams.map(team=>{
    const players=team.players.map(p=>{
      let own=0,total=0,loans=0;
      const extraTeams=new Map();
      for(const r of DATA.rounds){
        for(const m of r.matches){
          const roster=getRoster(r.round,m.teamId);
          const entries=roster.filter(x=>x && x.playerId===p.id);
          if(!entries.length) continue;
          total += entries.length;
          if(m.teamId===team.id) own += entries.length;
          else {
            extraTeams.set(m.teamId,(extraTeams.get(m.teamId)||0)+entries.length);
            loans += entries.filter(x=>x.kind==="loan").length;
          }
        }
      }
      return {...p,own,total,extra:total-own,loans,extraTeams:[...extraTeams.entries()]};
    });
    return {...team,players};
  });
  return grouped;
}

function renderStats(){
  $("#roundView").classList.add("hidden");
  $("#statsView").classList.remove("hidden");

  const grouped=buildStats();
  const allPlayers=grouped.flatMap(team=>team.players.map(p=>({...p,originalTeamName:team.name})));
  allPlayers.sort((a,b)=>b.total-a.total || b.extra-a.extra || a.name.localeCompare(b.name,'da'));

  const modeTabs=`<div class="stats-switch" role="tablist" aria-label="Spillerstatistikvisning">
    <button class="stats-switch-btn ${statsMode==='teams'?'active':''}" data-stats-mode="teams">Efter oprindeligt hold</button>
    <button class="stats-switch-btn ${statsMode==='all'?'active':''}" data-stats-mode="all">Samlet liste · flest kampe</button>
  </div>`;

  const teamView=`<div class="stats-groups">
      ${grouped.map(team=>`
        <section class="stats-team">
          <div class="stats-team-head"><h3>${escapeHtml(team.name)}</h3><span>${team.players.length} spillere</span></div>
          <div class="stats-table-wrap"><table><thead><tr><th>Spiller</th><th>Eget hold</th><th>Ekstra kampe</th><th>Ekstra for</th><th>Samlet</th></tr></thead>
          <tbody>${team.players.map(p=>`<tr>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td class="count">${p.own}</td>
            <td class="count highlight">${p.extra}</td>
            <td class="small">${p.extraTeams.length?p.extraTeams.map(([id,n])=>`${escapeHtml(teamMap[id].name)} (${n})`).join(", "):"—"}</td>
            <td class="count total-count">${p.total}</td>
          </tr>`).join("")}</tbody></table></div>
        </section>`).join("")}
    </div>`;

  const allView=`<section class="stats-team stats-all">
      <div class="stats-team-head"><h3>Alle spillere</h3><span>Sorteret efter samlet antal kampe</span></div>
      <div class="stats-table-wrap"><table><thead><tr><th>#</th><th>Spiller</th><th>Oprindeligt hold</th><th>Eget hold</th><th>Ekstra</th><th>Ekstra for</th><th>Samlet</th></tr></thead>
      <tbody>${allPlayers.map((p,i)=>`<tr>
        <td class="rank">${i+1}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.originalTeamName)}</td>
        <td class="count">${p.own}</td>
        <td class="count highlight">${p.extra}</td>
        <td class="small">${p.extraTeams.length?p.extraTeams.map(([id,n])=>`${escapeHtml(teamMap[id].name)} (${n})`).join(", "):"—"}</td>
        <td class="count total-count">${p.total}</td>
      </tr>`).join("")}</tbody></table></div>
    </section>`;

  $("#statsView").innerHTML=`
    <div class="round-head"><div><h2>Spillerstatistik</h2><p>${statsMode==='teams'?'Spillerne er grupperet efter deres oprindelige hold.':'Samlet oversigt – flest samlede kampe øverst.'}</p></div></div>
    ${modeTabs}
    <div class="notice">Her kan du se, hvor mange kampe hver spiller har spillet for sit eget hold, og hvor mange ekstra kampe spilleren har spillet for andre hold. En spiller kan tælle på flere hold i samme runde.</div>
    ${statsMode==='teams'?teamView:allView}`;

  document.querySelectorAll('[data-stats-mode]').forEach(btn=>btn.onclick=()=>{statsMode=btn.dataset.statsMode;renderStats();});
}

function renderAll(){renderTabs(); currentRound==='stats'?renderStats():renderRound();}

function toast(msg){
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove("show"),2200);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

loadAll();
setInterval(async()=>{
  if(usingLocalFallback) return;
  try{
    const {data,error}=await withTimeout(sb.from("u11_state").select("id,state,updated_at").eq("id","main").maybeSingle());
    if(error) throw error;
    if(data?.state){
      applyStoredState(data.state);
      renderAll();
      setStatus("Fælles data gemmes automatisk");
    }
  }catch(e){console.warn("Refresh failed",e)}
},15000);
