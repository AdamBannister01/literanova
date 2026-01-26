// ---- Mock data + state ----
const ADDRESSES = [
  "neo.eth",
  "trinity.eth",
  "morpheus.eth",
  "oracle.eth",
  "smith.eth"
];

const state = {
  mode: "compose", // compose | thread
  activeTo: null,
  activeToResolved: null,
  activeThreadId: null,
  inboxOpen: false
};

let myAddress = null; // becomes 0x... after connect

// LocalStorage keys
const LS_THREADS   = "literanova_threads_v0";
const LS_INBOX     = "literanova_inbox_v0";
const LS_FAVORITES = "literanova_favorites_v0";
const LS_CONTACTS  = "literanova_contacts_v0";

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

// ---- UI refs ----
const inboxBtn = document.getElementById("inboxBtn");
const inboxMenu = document.getElementById("inboxMenu");
const inboxItems = document.getElementById("inboxItems");

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

const connectBtn = document.getElementById("connectBtn");
const walletStatus = document.getElementById("walletStatus");

// ---- Small UI helpers ----
function showAddButtons(show){
  if(!addButtons) return;
  addButtons.classList.toggle("hidden", !show);
}

function setCenter(msg){
  centerText.textContent = msg;
}

// ---- Favorites / Contacts ----
function getFavorites(){ return load(LS_FAVORITES, []); }
function getContacts(){ return load(LS_CONTACTS, []); }

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
      const el = document.createElement("div");
      el.className = "address";
      el.style.opacity = "0.6";
      el.textContent = "—";
      favoritesList.appendChild(el);
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
      const el = document.createElement("div");
      el.className = "address";
      el.style.opacity = "0.6";
      el.textContent = "—";
      contactsList.appendChild(el);
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

  // 0x address
  if(raw.startsWith("0x")){
    const ok = isAddr(raw);
    if(!ok) return { ok:false, reason:"INVALID_ADDRESS" };
    return { ok:true, display: shortAddr(raw), address: raw, ens: null };
  }

  // ENS name
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

// ---- Render functions ----
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

function renderInbox(){
  const inbox = load(LS_INBOX, []);
  inboxItems.innerHTML = "";

  if(inbox.length === 0){
    const empty = document.createElement("div");
    empty.className = "inbox-item";
    empty.innerHTML = `<div class="title">NO NEW MESSAGES</div>`;
    inboxItems.appendChild(empty);
    return;
  }

  inbox.forEach(item => {
    const el = document.createElement("div");
    el.className = "inbox-item";
    el.innerHTML = `
      <div class="from">FROM: ${String(item.from).toUpperCase()}</div>
      <div class="title">NEW MESSAGE</div>
    `;
    el.onclick = () => openThread(item.threadId);
    inboxItems.appendChild(el);
  });
}

// ---- Composer / Threads ----
async function openComposer(toAddress){
  state.mode = "compose";
  state.activeTo = toAddress;
  state.activeToResolved = null;
  state.activeThreadId = null;

  // ALWAYS hide first
  showAddButtons(false);

  setCenter(
    `NEW MESSAGE TO: ${String(toAddress).toUpperCase()}\n` +
    `RESOLVED: (RESOLVING...)\n\n` +
    `TYPE YOUR MESSAGE BELOW.`
  );

  let resolved = null;

  // Resolve ENS via fallback RPCs
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

  // Only show when resolved is a valid address
  showAddButtons(!!resolved && isAddr(resolved));

  composerLabel.textContent = "SEND";
  composerInput.value = "";
  composerInput.placeholder = "";
  sendBtn.textContent = "SEND";
  composerInput.focus();
}

function openThread(threadId){
  const inbox = load(LS_INBOX, []);
  save(LS_INBOX, inbox.filter(m => m.threadId !== threadId));

  state.mode = "thread";
  state.activeThreadId = threadId;

  showAddButtons(false);

  const threads = load(LS_THREADS, {});
  const thread = threads[threadId];
  if(!thread){
    setCenter("THREAD NOT FOUND.");
    return;
  }

  const last = thread.messages[thread.messages.length - 1];
  setCenter(
    `FROM: ${String(last.from).toUpperCase()}\n` +
    `TO: ${String(last.to).toUpperCase()}\n\n` +
    `${last.body}\n`
  );

  composerLabel.textContent = "REPLY";
  composerInput.value = "";
  composerInput.placeholder = "";
  sendBtn.textContent = "SEND";
  composerInput.focus();
}

function send(){
  const body = composerInput.value.trim();
  if(!body) return;

  if(!myAddress){
    setCenter("CONNECT WALLET FIRST.");
    return;
  }

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
        ts: Date.now()
      }]
    };
    save(LS_THREADS, threads);

    const inbox = load(LS_INBOX, []);
    inbox.unshift({ threadId, from: myAddress, ts: Date.now() });
    save(LS_INBOX, inbox);

    setCenter(
      `TO: ${String(toTarget).toUpperCase()}\n` +
      (state.activeToResolved && String(state.activeTo).includes(".")
        ? `ENS: ${String(state.activeTo).toUpperCase()}\n\n`
        : `\n`) +
      `${body}\n\n[SENT]`
    );

    composerInput.value = "";
    renderInbox();
    return;
  }

  if(state.mode === "thread"){
    const threads = load(LS_THREADS, {});
    const thread = threads[state.activeThreadId];
    if(!thread) return;

    const other = thread.participants.find(p => p !== myAddress) || "unknown";

    thread.messages.push({
      id: uid(),
      from: myAddress,
      to: other,
      body,
      ts: Date.now()
    });
    save(LS_THREADS, threads);

    const inbox = load(LS_INBOX, []);
    inbox.unshift({ threadId: thread.threadId, from: myAddress, ts: Date.now() });
    save(LS_INBOX, inbox);

    setCenter(
      `TO: ${String(other).toUpperCase()}\n\n` +
      `${body}\n\n[SENT REPLY]`
    );

    composerInput.value = "";
    renderInbox();
  }
}

// ---- Inbox dropdown toggle ----
inboxBtn.onclick = () => {
  state.inboxOpen = !state.inboxOpen;
  inboxMenu.classList.toggle("hidden", !state.inboxOpen);
  renderInbox();
};

document.addEventListener("click", (e) => {
  const clickedInside = e.target.closest(".inbox");
  if(!clickedInside && state.inboxOpen){
    state.inboxOpen = false;
    inboxMenu.classList.add("hidden");
  }
});

// Enter key sends
composerInput.addEventListener("keydown", (e) => {
  if(e.key === "Enter"){
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

  composerLabel.textContent = "SEND";
  composerInput.value = "";
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
    });

    setCenter("WALLET CONNECTED.\n\nSELECT AN ADDRESS OR OPEN INBOX.");
  } catch (e){
    setCenter("WALLET CONNECTION CANCELLED.");
  }
}

connectBtn.onclick = connectWallet;

// ---- Init ----
showAddButtons(false);
renderAddresses();
renderInbox();
renderSavedLists();
openComposer("neo.eth");

// Optional: simple canvas flicker so it doesn't feel dead
(function subtleBG(){
  const c = document.getElementById("bg");
  const ctx = c.getContext("2d");
  function resize(){
    c.width = window.innerWidth;
    c.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  let t = 0;
  function loop(){
    t += 0.01;
    ctx.clearRect(0,0,c.width,c.height);
    for(let y=0; y<c.height; y+=6){
      const a = 0.03 + 0.02*Math.sin(t + y*0.02);
      ctx.fillStyle = `rgba(57,255,20,${a})`;
      ctx.fillRect(0,y,c.width,1);
    }
    requestAnimationFrame(loop);
  }
  loop();
})();
