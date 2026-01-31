// ===========================
// NOVAGRAM — app.js (FULL)
// Modern background + modern wireframe globe
// ===========================

// ---- Mock data + state ----
const ADDRESSES = ["neo.eth","trinity.eth","morpheus.eth","oracle.eth","smith.eth"];

const state = {
  mode: "compose", // compose | thread
  activeTo: null,
  activeToResolved: null,
  activeThreadId: null,
  inboxOpen: false,
  inboxUnlocked: false,
  pendingPdf: null,        // { name, size, mime, dataUrl }
};

let myAddress = null;

// LocalStorage keys
const LS_THREADS   = "literanova_threads_v0";
const LS_INBOX     = "literanova_inbox_v0";
const LS_FAVORITES = "literanova_favorites_v0";
const LS_CONTACTS  = "literanova_contacts_v0";
const LS_BLOCKED   = "literanova_blocked_v0";
const LS_REQUESTS  = "literanova_requests_v0";
const LS_SESSION   = "literanova_session_v0";

// ---- ENS resolution with fallback RPCs (reliable) ----
const ENS_RPCS = [
  "https://ethereum.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com"
];

async function resolveEnsWithFallback(name){
  const n = String(name || "").trim().toLowerCase();
  for(const url of ENS_RPCS){
    try{
      const p = new ethers.JsonRpcProvider(url);
      const addr = await p.resolveName(n);
      if(addr) return addr;
    } catch (e){
      console.log("ENS RPC failed:", url, e?.shortMessage || e?.message || e);
    }
  }
  return null;
}

// ---- Basic store helpers ----
function load(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function isAddr(x){
  try { return ethers.isAddress(x); } catch { return false; }
}
function shortAddr(a){
  if(!a || typeof a !== "string") return "";
  if(!a.startsWith("0x")) return a;
  return a.slice(0,6) + "..." + a.slice(-4);
}
function uniqByAddress(list){
  const seen = new Set();
  const out = [];
  for(const item of list){
    const addr = (item?.address || "").toLowerCase();
    if(!addr) continue;
    if(seen.has(addr)) continue;
    seen.add(addr);
    out.push(item);
  }
  return out;
}

function normAddr(a){ return String(a||"").toLowerCase(); }
function getContacts(){ return load(LS_CONTACTS, []); }
function getFavorites(){ return load(LS_FAVORITES, []); }
function getBlocked(){ return load(LS_BLOCKED, []); }
function getRequests(){ return load(LS_REQUESTS, []); }

function isKnownContact(address){
  const a = normAddr(address);
  return getContacts().some(x => normAddr(x.address) === a);
}
function isBlocked(address){
  const a = normAddr(address);
  return getBlocked().some(x => normAddr(x.address) === a);
}

// ---- UI refs ----
const inboxBtn = document.getElementById("inboxBtn");
const inboxMenu = document.getElementById("inboxMenu");
const inboxItems = document.getElementById("inboxItems");
const requestItems = document.getElementById("requestItems");
const unlockBtn = document.getElementById("unlockBtn");

const addressList = document.getElementById("addressList");
const favoritesList = document.getElementById("favoritesList");
const contactsList = document.getElementById("contactsList");

const toInput = document.getElementById("toInput");
const toGoBtn = document.getElementById("toGoBtn");

const centerText = document.getElementById("centerText");

const addButtons = document.getElementById("addButtons");
const addFavBtn = document.getElementById("addFavBtn");
const addContactBtn = document.getElementById("addContactBtn");

const composerLabel = document.getElementById("composerLabel");
const composerInput = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");

const certifyToggle = document.getElementById("certifyToggle");
const pdfInput = document.getElementById("pdfInput");
const attachStatus = document.getElementById("attachStatus");

const connectBtn = document.getElementById("connectBtn");
const walletStatus = document.getElementById("walletStatus");

// ---- Small UI helpers ----
function showAddButtons(show){
  if(!addButtons) return;
  addButtons.classList.toggle("hidden", !show);
}
function showAttachStatus(show, msg=""){
  if(!attachStatus) return;
  attachStatus.classList.toggle("hidden", !show);
  attachStatus.textContent = msg;
}
function setCenter(msg){
  centerText.textContent = msg;
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---- Saved lists ----
function addToList(key, label, address){
  const list = load(key, []);
  list.push({ label, address, ts: Date.now() });
  save(key, uniqByAddress(list));
  renderSavedLists();
}

function renderSavedLists(){
  if(favoritesList){
    favoritesList.innerHTML = "";
    const favs = getFavorites();
    if(favs.length === 0){
      favoritesList.innerHTML = `<div class="address" style="opacity:.6">—</div>`;
    } else {
      favs.forEach(item => {
        const el = document.createElement("div");
        el.className = "address";
        el.textContent = String(item.label || shortAddr(item.address)).toUpperCase();
        el.onclick = () => openComposer(item.label || item.address);
        favoritesList.appendChild(el);
      });
    }
  }

  if(contactsList){
    contactsList.innerHTML = "";
    const cons = getContacts();
    if(cons.length === 0){
      contactsList.innerHTML = `<div class="address" style="opacity:.6">—</div>`;
    } else {
      cons.forEach(item => {
        const el = document.createElement("div");
        el.className = "address";
        el.textContent = String(item.label || shortAddr(item.address)).toUpperCase();
        el.onclick = () => openComposer(item.label || item.address);
        contactsList.appendChild(el);
      });
    }
  }
}

// ---- Recipient parsing (0x or ENS) ----
async function normalizeRecipient(input){
  const raw = (input || "").trim();
  if(!raw) return { ok:false, reason:"EMPTY" };

  if(raw.startsWith("0x")){
    const ok = isAddr(raw);
    if(!ok) return { ok:false, reason:"INVALID_ADDRESS" };
    return { ok:true, display: shortAddr(raw), address: raw, ens: null };
  }

  if(raw.includes(".")){
    try{
      const resolved = await resolveEnsWithFallback(raw);
      if(!resolved) return { ok:false, reason:"ENS_NOT_FOUND" };
      return { ok:true, display: raw, address: resolved, ens: raw };
    } catch (e){
      console.log("ENS resolution error:", e);
      return { ok:false, reason:"ENS_ERROR" };
    }
  }

  return { ok:false, reason:"UNKNOWN_FORMAT" };
}

// ---- Render right-rail addresses ----
function renderAddresses(){
  addressList.innerHTML = "";
  ADDRESSES.forEach(addr => {
    const el = document.createElement("div");
    el.className = "address";
    el.textContent = addr.toUpperCase();
    el.onclick = () => openComposer(addr);
    addressList.appendChild(el);
  });
}

// ---- Inbox + Requests ----
function ensureUnlockedFromSession(){
  const sess = load(LS_SESSION, null);
  if(!sess || !sess.addr || !sess.exp) return false;
  if(Date.now() > sess.exp) return false;
  if(myAddress && normAddr(sess.addr) !== normAddr(myAddress)) return false;
  return true;
}

function setUnlockedUI(){
  state.inboxUnlocked = ensureUnlockedFromSession();
  if(unlockBtn){
    unlockBtn.textContent = state.inboxUnlocked ? "INBOX UNLOCKED" : "UNLOCK INBOX (SIGN ONCE)";
    unlockBtn.disabled = state.inboxUnlocked;
    unlockBtn.style.opacity = state.inboxUnlocked ? "0.6" : "1";
  }
}

function renderInbox(){
  setUnlockedUI();

  if(!state.inboxUnlocked){
    if(requestItems) requestItems.innerHTML = `<div class="inbox-item"><div class="title">LOCKED</div></div>`;
    inboxItems.innerHTML = `<div class="inbox-item"><div class="title">UNLOCK TO VIEW</div></div>`;
    return;
  }

  // Requests
  if(requestItems){
    const reqs = getRequests().filter(r => !isBlocked(r.from));
    requestItems.innerHTML = "";
    if(reqs.length === 0){
      requestItems.innerHTML = `<div class="inbox-item"><div class="title">—</div></div>`;
    } else {
      reqs.forEach(r => {
        const el = document.createElement("div");
        el.className = "inbox-item";
        el.innerHTML = `
          <div class="from">FROM: ${escapeHtml(String(r.from)).toUpperCase()}</div>
          <div class="title">REQUEST</div>
          <div class="row-actions">
            <button class="mini-btn" data-act="accept" data-id="${r.id}">ACCEPT</button>
            <button class="mini-btn" data-act="block" data-id="${r.id}">BLOCK</button>
          </div>
        `;
        requestItems.appendChild(el);
      });
    }
  }

  // Messages
  const inbox = load(LS_INBOX, []).filter(m => !isBlocked(m.from));
  inboxItems.innerHTML = "";

  if(inbox.length === 0){
    inboxItems.innerHTML = `<div class="inbox-item"><div class="title">NO NEW MESSAGES</div></div>`;
    return;
  }

  inbox.forEach(item => {
    const el = document.createElement("div");
    el.className = "inbox-item";
    el.innerHTML = `
      <div class="from">FROM: ${escapeHtml(String(item.from)).toUpperCase()}</div>
      <div class="title">${item.certified ? "CERTIFIED MESSAGE" : "NEW MESSAGE"}</div>
    `;
    el.onclick = () => openThread(item.threadId);
    inboxItems.appendChild(el);
  });
}

function acceptRequest(requestId){
  const reqs = getRequests();
  const r = reqs.find(x => x.id === requestId);
  if(!r) return;

  const label = r.ens || shortAddr(r.from);
  addToList(LS_CONTACTS, label, r.from);

  const inbox = load(LS_INBOX, []);
  inbox.unshift({ threadId: r.threadId, from: r.from, ts: Date.now(), certified: !!r.certified });
  save(LS_INBOX, inbox);

  save(LS_REQUESTS, reqs.filter(x => x.id !== requestId));
  renderInbox();
}

function blockRequest(requestId){
  const reqs = getRequests();
  const r = reqs.find(x => x.id === requestId);
  if(!r) return;

  const blocked = load(LS_BLOCKED, []);
  blocked.push({ address: r.from, ts: Date.now() });
  save(LS_BLOCKED, uniqByAddress(blocked));

  save(LS_REQUESTS, reqs.filter(x => x.id !== requestId));

  const inbox = load(LS_INBOX, []);
  save(LS_INBOX, inbox.filter(m => normAddr(m.from) !== normAddr(r.from)));

  renderInbox();
}

if(requestItems){
  requestItems.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if(!btn) return;
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");
    if(act === "accept") acceptRequest(id);
    if(act === "block") blockRequest(id);
  });
}

// ---- Composer / Threads ----
function resetComposerHeight(){
  if(!composerInput) return;
  composerInput.style.height = "auto";
  composerInput.style.height = composerInput.scrollHeight + "px";
}

async function openComposer(toAddress){
  state.mode = "compose";
  state.activeTo = toAddress;
  state.activeToResolved = null;
  state.activeThreadId = null;
  state.pendingPdf = null;
  showAttachStatus(false);

  showAddButtons(false);

  setCenter(
    `NEW MESSAGE TO: ${String(toAddress).toUpperCase()}\n` +
    `RESOLVED: (RESOLVING...)\n\n` +
    `TYPE YOUR MESSAGE BELOW.`
  );

  let resolved = null;

  if(String(toAddress).includes(".")){
    resolved = await resolveEnsWithFallback(toAddress);
  } else if(String(toAddress).startsWith("0x") && isAddr(toAddress)){
    resolved = toAddress;
  }

  state.activeToResolved = resolved;

  setCenter(
    `NEW MESSAGE TO: ${String(toAddress).toUpperCase()}\n` +
    (resolved ? `RESOLVED: ${resolved}\n\n` : `RESOLVED: (NOT FOUND)\n\n`) +
    `TYPE YOUR MESSAGE BELOW.`
  );

  showAddButtons(!!resolved && isAddr(resolved));

  composerLabel.textContent = "SEND NEW MESSAGE";
  composerInput.value = "";
  resetComposerHeight();
  sendBtn.textContent = "SEND";
  composerInput.focus();
}

function openThread(threadId){
  const inbox = load(LS_INBOX, []);
  save(LS_INBOX, inbox.filter(m => m.threadId !== threadId));

  state.mode = "thread";
  state.activeThreadId = threadId;

  showAddButtons(false);
  showAttachStatus(false);
  state.pendingPdf = null;

  const threads = load(LS_THREADS, {});
  const thread = threads[threadId];
  if(!thread){
    setCenter("THREAD NOT FOUND.");
    return;
  }

  const last = thread.messages[thread.messages.length - 1];
  const lines = [];
  lines.push(`FROM: ${String(last.from).toUpperCase()}`);
  lines.push(`TO: ${String(last.to).toUpperCase()}`);
  if(last.certified) lines.push(`CERTIFIED: YES`);
  lines.push("");
  lines.push(String(last.body || ""));

  if(last.pdf && last.pdf.name){
    lines.push("");
    lines.push(`[PDF ATTACHED] ${last.pdf.name}`);
    lines.push(`(OPEN: click the attachment status below)`);
    showAttachStatus(true, `OPEN PDF: ${last.pdf.name}`);
    attachStatus.onclick = () => window.open(last.pdf.dataUrl, "_blank");
  } else {
    attachStatus.onclick = null;
  }

  setCenter(lines.join("\n"));

  composerLabel.textContent = "REPLY TO MESSAGE";
  composerInput.value = "";
  resetComposerHeight();
  sendBtn.textContent = "SEND";
  composerInput.focus();

  renderInbox();
}

function send(){
  const body = composerInput.value.trim();
  if(!body) return;

  if(!myAddress){
    setCenter("CONNECT WALLET FIRST.");
    return;
  }

  const certified = !!(certifyToggle && certifyToggle.checked);
  const pdf = state.pendingPdf ? { ...state.pendingPdf } : null;

  if(state.mode === "compose"){
    const threadId = uid();
    const toTarget = state.activeToResolved || state.activeTo;

    const threads = load(LS_THREADS, {});
    threads[threadId] = {
      threadId,
      participants: [myAddress, toTarget],
      messages: [{
        id: uid(),
        from: myAddress,
        to: toTarget,
        body,
        ts: Date.now(),
        certified,
        pdf
      }]
    };
    save(LS_THREADS, threads);

    // demo routing
    const fromMe = myAddress;
    if(isKnownContact(fromMe)){
      const inbox = load(LS_INBOX, []);
      inbox.unshift({ threadId, from: myAddress, ts: Date.now(), certified });
      save(LS_INBOX, inbox);
    } else {
      const reqs = load(LS_REQUESTS, []);
      reqs.unshift({ id: uid(), threadId, from: myAddress, ens: null, ts: Date.now(), certified });
      save(LS_REQUESTS, reqs);
    }

    setCenter(
      `TO: ${String(toTarget).toUpperCase()}\n` +
      (state.activeToResolved && String(state.activeTo).includes(".") ? `ENS: ${String(state.activeTo).toUpperCase()}\n` : ``) +
      (certified ? `CERTIFIED: YES\n` : ``) +
      (pdf ? `PDF: ${pdf.name}\n` : ``) +
      `\n${body}\n\n[SENT]`
    );

    composerInput.value = "";
    resetComposerHeight();
    state.pendingPdf = null;
    showAttachStatus(false);
    if(pdfInput) pdfInput.value = "";

    renderInbox();
    return;
  }

  if(state.mode === "thread"){
    const threads = load(LS_THREADS, {});
    const thread = threads[state.activeThreadId];
    if(!thread) return;

    const other = thread.participants.find(p => normAddr(p) !== normAddr(myAddress)) || "unknown";

    thread.messages.push({
      id: uid(),
      from: myAddress,
      to: other,
      body,
      ts: Date.now(),
      certified,
      pdf
    });
    save(LS_THREADS, threads);

    const inbox = load(LS_INBOX, []);
    inbox.unshift({ threadId: thread.threadId, from: myAddress, ts: Date.now(), certified });
    save(LS_INBOX, inbox);

    setCenter(
      `TO: ${String(other).toUpperCase()}\n` +
      (certified ? `CERTIFIED: YES\n` : ``) +
      (pdf ? `PDF: ${pdf.name}\n` : ``) +
      `\n${body}\n\n[SENT REPLY]`
    );

    composerInput.value = "";
    resetComposerHeight();
    state.pendingPdf = null;
    showAttachStatus(false);
    if(pdfInput) pdfInput.value = "";

    renderInbox();
  }
}

// ---- Inbox dropdown toggle ----
inboxBtn.onclick = () => {
  state.inboxOpen = !state.inboxOpen;
  inboxMenu.classList.toggle("hidden", !state.inboxOpen);
  renderInbox();
};

// Close dropdown if click elsewhere
document.addEventListener("click", (e) => {
  const clickedInside = e.target.closest(".inbox");
  if(!clickedInside && state.inboxOpen){
    state.inboxOpen = false;
    inboxMenu.classList.add("hidden");
  }
});

// ✅ Auto-expand + wrap + correct Enter behavior
composerInput.addEventListener("input", () => {
  resetComposerHeight();
});

composerInput.addEventListener("keydown", (e) => {
  // Enter sends, Shift+Enter makes a newline
  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    send();
  }
});

sendBtn.onclick = send;

// ---- Manual "TO:" input handler ----
async function handleToGo(){
  const result = await normalizeRecipient(toInput.value);

  if(!result.ok){
    const msg = {
      EMPTY: "TYPE AN ADDRESS OR ENS NAME.",
      INVALID_ADDRESS: "INVALID 0x ADDRESS.",
      ENS_NOT_FOUND: "ENS NAME NOT FOUND.",
      ENS_ERROR: "ENS RESOLUTION ERROR.",
      UNKNOWN_FORMAT: "ENTER 0x... OR name.eth"
    }[result.reason] || "INVALID RECIPIENT.";
    setCenter(msg);
    showAddButtons(false);
    return;
  }

  state.activeTo = result.ens || result.address;
  state.activeToResolved = result.address;
  state.mode = "compose";
  state.activeThreadId = null;

  setCenter(
    `NEW MESSAGE TO: ${String(state.activeTo).toUpperCase()}\n` +
    `RESOLVED: ${result.address}\n\n` +
    `TYPE YOUR MESSAGE BELOW.`
  );

  showAddButtons(!!result.address && isAddr(result.address));

  composerLabel.textContent = "SEND NEW MESSAGE";
  composerInput.value = "";
  resetComposerHeight();
  sendBtn.textContent = "SEND";
  composerInput.focus();
}

if(toGoBtn && toInput){
  toGoBtn.onclick = handleToGo;
  toInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter"){
      e.preventDefault();
      handleToGo();
    }
  });
}

// ---- Add buttons behavior ----
if(addFavBtn){
  addFavBtn.onclick = () => {
    if(!state.activeToResolved || !isAddr(state.activeToResolved)) return;
    const label = (String(state.activeTo).includes(".") ? String(state.activeTo) : shortAddr(state.activeToResolved));
    addToList(LS_FAVORITES, label, state.activeToResolved);
    setCenter(`ADDED TO FAVORITES:\n${label.toUpperCase()}\n${state.activeToResolved}`);
  };
}

if(addContactBtn){
  addContactBtn.onclick = () => {
    if(!state.activeToResolved || !isAddr(state.activeToResolved)) return;
    const label = (String(state.activeTo).includes(".") ? String(state.activeTo) : shortAddr(state.activeToResolved));
    addToList(LS_CONTACTS, label, state.activeToResolved);
    setCenter(`ADDED TO CONTACTS:\n${label.toUpperCase()}\n${state.activeToResolved}`);
  };
}

// ---- Unlock Inbox (sign once) ----
async function unlockInbox(){
  if(!window.ethereum){
    setCenter("METAMASK NOT FOUND. INSTALL METAMASK EXTENSION.");
    return;
  }
  if(!myAddress){
    setCenter("CONNECT WALLET FIRST.");
    return;
  }

  try{
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    const nonce = uid();
    const msg =
`NOVAGRAM UNLOCK REQUEST
ADDRESS: ${myAddress}
NONCE: ${nonce}
TIME: ${new Date().toISOString()}`;

    const sig = await signer.signMessage(msg);

    save(LS_SESSION, {
      addr: myAddress,
      sig,
      msg,
      exp: Date.now() + 12 * 60 * 60 * 1000
    });

    setCenter("INBOX UNLOCKED.\n\nOPEN THE INBOX.");
    renderInbox();
  } catch (e){
    setCenter("SIGNATURE CANCELLED.");
  }
}

if(unlockBtn){
  unlockBtn.onclick = unlockInbox;
}

// ---- PDF attachment ----
async function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

if(pdfInput){
  pdfInput.addEventListener("change", async () => {
    const file = pdfInput.files && pdfInput.files[0];
    if(!file){
      state.pendingPdf = null;
      showAttachStatus(false);
      return;
    }
    if(file.type !== "application/pdf"){
      state.pendingPdf = null;
      pdfInput.value = "";
      showAttachStatus(true, "PDF ONLY.");
      return;
    }
    if(file.size > 5 * 1024 * 1024){
      state.pendingPdf = null;
      pdfInput.value = "";
      showAttachStatus(true, "PDF TOO LARGE (MAX 5MB FOR DEMO).");
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    state.pendingPdf = { name: file.name, size: file.size, mime: file.type, dataUrl };
    showAttachStatus(true, `ATTACHED: ${file.name}`);
    attachStatus.onclick = () => window.open(dataUrl, "_blank");
  });
}

// ---- Wallet connect ----
async function connectWallet(){
  if(!window.ethereum){
    setCenter("METAMASK NOT FOUND. INSTALL METAMASK EXTENSION.");
    return;
  }

  try{
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    myAddress = accounts[0];
    walletStatus.textContent = myAddress;

    window.ethereum.on("accountsChanged", (accs) => {
      myAddress = accs?.[0] || null;
      walletStatus.textContent = myAddress || "NOT CONNECTED";
      renderInbox();
    });

    setCenter("WALLET CONNECTED.\n\nOPEN INBOX → UNLOCK (SIGN ONCE).");
    renderInbox();
  } catch (e){
    setCenter("WALLET CONNECTION CANCELLED.");
  }
}
connectBtn.onclick = connectWallet;

// ---- Init ----
showAddButtons(false);
renderAddresses();
renderSavedLists();
renderInbox();
openComposer("neo.eth");


// ===========================
// MODERN TECH BACKGROUND (CANVAS)
// Stronger / more dynamic
// ===========================
(function modernBG(){
  const canvas = document.getElementById("bg");
  if(!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let w = 0, h = 0;

  const segs = [];
  const streaks = [];

  function resize(){
    w = Math.floor(window.innerWidth);
    h = Math.floor(window.innerHeight);
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    segs.length = 0;
    const count = Math.floor((w*h) / 45000);
    for(let i=0;i<count;i++) segs.push(makeSeg());
  }

  function makeSeg(){
    const diagonal = Math.random() < 0.55;
    const angle = diagonal ? (Math.random() < 0.5 ? -0.35 : 0.35) : 0;
    const len = 90 + Math.random() * 320;
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      len,
      angle,
      speed: 0.25 + Math.random() * 0.95,
      alpha: 0.05 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      gap: 10 + Math.random() * 90
    };
  }

  function spawnStreak(){
    streaks.push({
      x: -520,
      y: Math.random() * h,
      vx: 10 + Math.random() * 20,
      alpha: 0.16 + Math.random() * 0.18,
      life: 0,
      max: 26 + Math.random() * 44
    });
  }

  function tick(t){
    ctx.clearRect(0,0,w,h);

    // vignette
    const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)*0.85);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    // micro dust
    ctx.fillStyle = "rgba(235,238,245,0.03)";
    for(let i=0;i<80;i++){
      const x = (i*131 + (t*0.03)) % w;
      const y = (i*83) % h;
      ctx.fillRect(x, y, 1, 1);
    }

    // segments
    ctx.lineWidth = 1;
    for(const s of segs){
      s.x += s.speed;
      if(s.x - s.len > w + 120){
        Object.assign(s, makeSeg(), { x: -120 });
      }

      const pulse = (Math.sin(t*0.0012 + s.phase) + 1) * 0.5;
      const a = s.alpha * (0.35 + 0.75 * pulse);

      const x1 = s.x - s.len;
      const y1 = s.y;
      const x2 = s.x;
      const y2 = s.y + s.angle * s.len;

      ctx.setLineDash([s.gap, 22]);
      ctx.strokeStyle = `rgba(235,238,245,${a})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // accent streaks
    if(Math.random() < 0.03) spawnStreak();

    for(let i = streaks.length - 1; i >= 0; i--){
      const S = streaks[i];
      S.x += S.vx;
      S.life += 1;

      const fade = 1 - (S.life / S.max);
      ctx.strokeStyle = `rgba(125,255,205,${S.alpha * fade})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(S.x, S.y);
      ctx.lineTo(S.x + 640, S.y);
      ctx.stroke();

      if(S.life >= S.max) streaks.splice(i, 1);
    }

    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(tick);
})();


// ===========================
// MODERN WIREFRAME GLOBE (CANVAS)
// Silver primary lines, subtle accent, soft glow
// ===========================
(function modernWireGlobe(){
  const canvas = document.getElementById("globe");
  if(!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });

  function resize(){
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    if(rect.width < 2 || rect.height < 2) return;

    canvas.width  = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  function W(){ return canvas.getBoundingClientRect().width; }
  function H(){ return canvas.getBoundingClientRect().height; }

  const baseR = 0.38;
  function R(){ return Math.max(60, Math.min(W(), H()) * baseR); }

  function rotY(p, a){
    const s = Math.sin(a), c = Math.cos(a);
    return { x: p.x*c + p.z*s, y: p.y, z: -p.x*s + p.z*c };
  }
  function rotX(p, a){
    const s = Math.sin(a), c = Math.cos(a);
    return { x: p.x, y: p.y*c - p.z*s, z: p.y*s + p.z*c };
  }
  function project(p){
    const depth = 420;
    const scale = depth / (depth + p.z);
    return { x: W()/2 + p.x * scale, y: H()/2 + p.y * scale };
  }

  function drawPath(points, strokeStyle, lineWidth){
    ctx.beginPath();
    for(let i=0;i<points.length;i++){
      const p = project(points[i]);
      if(i===0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  let t = 0;
  function frame(){
    const w = W(), h = H();
    if(w < 2 || h < 2){
      requestAnimationFrame(frame);
      return;
    }

    resize();

    ctx.clearRect(0,0,w,h);

    // soft glow
    ctx.shadowColor = "rgba(125,255,205,0.10)";
    ctx.shadowBlur = 22;

    t += 0.010;
    const ay = t;
    const ax = -0.35;

    const r = R();

    const silver  = "rgba(235,238,245,0.26)";
    const silver2 = "rgba(235,238,245,0.14)";
    const accent  = "rgba(125,255,205,0.22)";

    // latitude rings
    for(let lat = -72; lat <= 72; lat += 12){
      const pts = [];
      const phi = (lat * Math.PI) / 180;
      const y = Math.sin(phi) * r;
      const rr = Math.cos(phi) * r;

      for(let deg=0; deg<=360; deg+=6){
        const th = (deg * Math.PI) / 180;
        let p = { x: Math.cos(th)*rr, y, z: Math.sin(th)*rr };
        p = rotY(p, ay);
        p = rotX(p, ax);
        pts.push(p);
      }

      const isEquator = Math.abs(lat) < 1;
      drawPath(pts, isEquator ? accent : silver, 1);
    }

    // longitude arcs
    for(let lon = 0; lon < 180; lon += 14){
      const pts = [];
      const th0 = (lon * Math.PI) / 180;

      for(let deg=-90; deg<=90; deg+=5){
        const phi = (deg * Math.PI) / 180;
        let p = {
          x: Math.cos(th0)*Math.cos(phi)*r,
          y: Math.sin(phi)*r,
          z: Math.sin(th0)*Math.cos(phi)*r
        };
        p = rotY(p, ay);
        p = rotX(p, ax);
        pts.push(p);
      }

      drawPath(pts, silver2, 1);
    }

    // silhouette
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(w/2, h/2, r, 0, Math.PI*2);
    ctx.strokeStyle = "rgba(235,238,245,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // tiny node highlight
    const node = rotX(rotY({x: 0, y: -r, z: 0}, ay), ax);
    const pn = project(node);
    ctx.shadowBlur = 26;
    ctx.fillStyle = "rgba(125,255,205,0.60)";
    ctx.beginPath();
    ctx.arc(pn.x, pn.y, 2.2, 0, Math.PI*2);
    ctx.fill();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
