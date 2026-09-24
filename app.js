const { createClient } = window.supabase;
const sb = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

const DATA = window.APP_DATA;
const teamMap = Object.fromEntries(DATA.teams.map(t => [t.id, t]));
const playerMap = Object.fromEntries(DATA.teams.flatMap(t => t.players.map(p => [p.id, {...p, originalTeamId:t.id}])));
let rosterState = {}; // key: round-team
let currentRound = 1;
let usingLocalFallback = false;

const $ = (sel) => document.querySelector(sel);

function rosterKey(round, teamId){ return `${round}-${teamId}`; }

function baseRoster(teamId){
  const team = teamMap[teamId];
  return [...team.players.map(p => ({playerId:p.id,name:p.name,originalTeamId:teamId,kind:"fast"})),
          ...Array.from({length:Math.max(0,8-team.players.length)},()=>null)];
}

function cloneRoster(arr){ return arr.map(x => x ? {...x} : null); }

function setStatus(text, offline=false){
  $("#saveStatus").innerHTML = `<span class="status-dot ${offline?'offline':''}"></span>${text}`;
}

async function loadAll(){
  setStatus("Henter fælles data…");
  try{
    const {data,error} = await sb.from("u11_rosters").select("round_no,team_id,players");
    if(error) throw error;
    for(const row of data || []){
      rosterState[rosterKey(row.round_no,row.team_id)] = normalizeRoster(row.players,row.team_id);
    }
    usingLocalFallback = false;
    setStatus("Fælles data gemmes automatisk");
  }catch(err){
    console.error(err);
    usingLocalFallback = true;
    try{
      const saved = JSON.parse(localStorage.getItem("u11-rosters") || "{}");
      rosterState = saved;
    }catch{}
    setStatus("Lokal tilstand – Supabase skal sættes op", true);
  }
  renderRound();
}

function normalizeRoster(players, teamId){
  const arr = Array.isArray(players) ? players : [];
  const clean = arr.slice(0,8).map(x => x && x.playerId ? x : null);
  while(clean.length < 8) clean.push(null);
  return clean;
}

function getRoster(round, teamId){
  const key=rosterKey(round,teamId);
  if(!rosterState[key]) rosterState[key]=baseRoster(teamId);
  return rosterState[key];
}

async function saveRoster(round, teamId){
  const key=rosterKey(round,teamId);
  const players=getRoster(round,teamId);
  if(usingLocalFallback){
    localStorage.setItem("u11-rosters",JSON.stringify(rosterState));
    setStatus("Gemt lokalt", true);
    return;
  }
  setStatus("Gemmer…");
  const {error}=await sb.from("u11_rosters").upsert({
    round_no:round, team_id:teamId, players, updated_at:new Date().toISOString()
  });
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
  el.querySelector("[data-stats]").onclick=()=>{currentRound='stats';renderAll()};
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
      <div class="player-name">${escapeHtml(p.name)}</div>
      ${isLoan?`<span class="loan-tag">LÅN</span>`:""}
      <div class="player-actions"><button class="icon-btn remove" title="Fjern spiller" data-remove="${m.teamId}" data-slot="${i}">×</button></div>
    </div>`;
  }).join("");
  return `<article class="team-card">
    <div class="team-head">
      <div class="team-title"><h3>${team.name}</h3><span class="badge">${filled}/8 spillere</span></div>
      <div class="match"><strong>${m.day} ${m.date} kl. ${m.time}</strong><br>${escapeHtml(m.home)} – ${escapeHtml(m.away)}<br><span class="venue">${escapeHtml(m.venue)}</span></div>
    </div>
    <div class="roster">${playersHtml}</div>
    <div class="team-footer"><span>${filled<8?`${8-filled} ledige pladser`:"Holdet er fyldt"}</span>${filled<8?`<button class="add-btn" data-add="${m.teamId}" data-slot="${roster.findIndex(x=>!x)}">+ Lån spiller</button>`:`<span class="full">✓ Klar</span>`}</div>
  </article>`;
}

function attachTeamActions(){
  document.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=async()=>{
    const teamId=btn.dataset.remove, slot=Number(btn.dataset.slot);
    getRoster(currentRound,teamId)[slot]=null;
    renderRound(); renderTabs();
    await saveRoster(currentRound,teamId);
    toast("Spilleren er fjernet fra holdet");
  });
  document.querySelectorAll("[data-add]").forEach(btn=>btn.onclick=()=>{
    openPlayerModal(btn.dataset.add,Number(btn.dataset.slot));
  });
}

function availablePlayers(teamId){
  const usedElsewhere=new Map();
  for(const m of DATA.rounds.find(r=>r.round===currentRound).matches){
    const roster=getRoster(currentRound,m.teamId);
    for(const p of roster.filter(Boolean)){
      if(p.originalTeamId!==teamId) usedElsewhere.set(p.playerId,m.teamId);
    }
  }
  const currentIds=new Set(getRoster(currentRound,teamId).filter(Boolean).map(p=>p.playerId));
  return Object.values(playerMap)
    .filter(p=>!currentIds.has(p.id))
    .sort((a,b)=>a.name.localeCompare(b.name,'da'))
    .map(p=>({...p,usedOn:usedElsewhere.get(p.id)}));
}

function openPlayerModal(teamId,slot){
  const options=availablePlayers(teamId);
  const modal=document.createElement("div");
  modal.className="modal-backdrop";
  modal.innerHTML=`<div class="modal">
    <h3>Tilføj spiller til ${teamMap[teamId].name}</h3>
    <p>Vælg den spiller, der lånes til denne kamp. En spiller, der allerede står på et andet hold i samme runde, markeres.</p>
    <select id="loanSelect">
      <option value="">Vælg spiller…</option>
      ${options.map(p=>`<option value="${p.id}" ${p.usedOn?'disabled':''}>${escapeHtml(p.name)} · ${escapeHtml(teamMap[p.originalTeamId].name)}${p.usedOn?` · allerede på ${escapeHtml(teamMap[p.usedOn].name)}`:""}</option>`).join("")}
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
    roster[target]={playerId:p.id,name:p.name,originalTeamId:p.originalTeamId,kind:"loan"};
    modal.remove();
    renderRound(); renderTabs();
    await saveRoster(currentRound,teamId);
    toast(`${p.name} er tilføjet til ${teamMap[teamId].name}`);
  };
}

function renderStats(){
  $("#roundView").classList.add("hidden");
  $("#statsView").classList.remove("hidden");
  const rows=Object.values(playerMap).map(p=>{
    let appearances=0, other=0, loans=0;
    const otherTeams=new Map();
    for(const r of DATA.rounds){
      const roundSeen=new Set();
      for(const m of r.matches){
        const roster=getRoster(r.round,m.teamId);
        for(const x of roster.filter(Boolean)){
          if(x.playerId!==p.id || roundSeen.has(m.teamId)) continue;
          roundSeen.add(m.teamId); appearances++;
          if(m.teamId!==p.originalTeamId){other++; otherTeams.set(m.teamId,(otherTeams.get(m.teamId)||0)+1); if(x.kind==="loan") loans++;}
        }
      }
    }
    return {...p,appearances,other,loans,otherTeams:[...otherTeams.entries()].map(([id,n])=>`${teamMap[id].name} (${n})`).join(", ")};
  }).sort((a,b)=>b.other-a.other || b.appearances-a.appearances || a.name.localeCompare(b.name,'da'));

  $("#statsView").innerHTML=`
    <div class="round-head"><div><h2>Spillerstatistik</h2><p>Optællingen hentes direkte fra holdene i alle runder.</p></div></div>
    <div class="notice">“Andre hold” viser, hvor mange gange spilleren står på et andet hold end sit oprindelige hold. “Lån” viser de gange, hvor spilleren er registreret som lånt spiller.</div>
    <div class="stats-table-wrap"><table><thead><tr><th>Spiller</th><th>Oprindeligt hold</th><th>Antal kampe</th><th>Andre hold</th><th>Lån</th><th>Andre hold – hvilke?</th></tr></thead>
    <tbody>${rows.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(teamMap[p.originalTeamId].name)}</td><td class="count">${p.appearances}</td><td class="count highlight">${p.other}</td><td class="count">${p.loans}</td><td class="small">${p.otherTeams||"—"}</td></tr>`).join("")}</tbody>
    </table></div>`;
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
    const {data,error}=await sb.from("u11_rosters").select("round_no,team_id,players");
    if(error) throw error;
    for(const row of data||[]) rosterState[rosterKey(row.round_no,row.team_id)]=normalizeRoster(row.players,row.team_id);
    if(currentRound!=="stats") renderRound(); else renderStats();
    setStatus("Fælles data gemmes automatisk");
  }catch(e){console.warn("Refresh failed",e)}
},15000);
