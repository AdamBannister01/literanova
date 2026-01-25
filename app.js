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
  activeToResolved: null,   // ✅ add this
  activeThreadId: null,
  inboxOpen: false
};
let myAddress = null; // becomes 0x... after connect


// LocalStorage keys
const LS_THREADS = "literanova_threads_v0";
const LS_INBOX = "literanova_inbox_v0";

// ENS resolution should use Ethereum mainnet (works even if wallet is on Base)
const ENS_MAINNET_RPC = "https://cloudflare-eth.com";
const ensProvider = new ethers.JsonRpcProvider(ENS_MAINNET_RPC);


// Basic store helpers
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

// ---- UI refs ----
const inboxBtn = document.getElementById("inboxBtn");
const inboxMenu = document.getElementById("inboxMenu");
const inboxItems = document.getElementById("inboxItems");
const addressList = document.getElementById("addressList");
const toInput = document.getElementById("toInput");
const toGoBtn = document.getElementById("toGoBtn");
const centerText = document.getElementById("centerText");
const composerLabel = document.getElementById("composerLabel");
const composerInput = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");
const connectBtn = document.getElementById("connectBtn");
const walletStatus = document.getElementById("walletStatus");

// --- Debug checks ---
if(!connectBtn){
  centerText.textContent = "ERROR: CONNECT BUTTON NOT FOUND (connectBtn is null).";
}
if(!walletStatus){
  centerText.textContent = "ERROR: WALLET STATUS ELEMENT NOT FOUND (walletStatus is null).";
}


// ---- Render functions ----
async function normalizeRecipient(input){
  const raw = (input || "").trim();
  if(!raw) return { ok:false, reason:"EMPTY" };

  // If wallet not connected, we can still accept raw input but can't ENS-resolve
  const hasProvider = !!window.ethereum;

  // If it's a 0x address, validate
  if(raw.startsWith("0x")){
    try{
      const isValid = ethers.isAddress(raw);
      if(!isValid) return { ok:false, reason:"INVALID_ADDRESS" };
      return { ok:true, display: raw, address: raw, ens: null };
    } catch {
      return { ok:false, reason:"INVALID_ADDRESS" };
    }
  }

  // Otherwise treat like ENS name and attempt resolution if possible
  if(raw.includes(".")){
  try{
    const resolved = await ensProvider.resolveName(raw);
    if(!resolved) return { ok:false, reason:"ENS_NOT_FOUND" };
    return { ok:true, display: raw, address: resolved, ens: raw };
  } catch (e){
    console.log("ENS resolution error:", e);
    return { ok:false, reason:"ENS_ERROR" };
  }
}


  return { ok:false, reason:"UNKNOWN_FORMAT" };
}

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
      <div class="from">FROM: ${item.from.toUpperCase()}</div>
      <div class="title">NEW MESSAGE</div>
    `;
    el.onclick = () => openThread(item.threadId);
    inboxItems.appendChild(el);
  });
}

async function openComposer(toAddress){
  state.mode = "compose";
  state.activeTo = toAddress;
  state.activeToResolved = null;
  state.activeThreadId = null;

  // Show immediately so you see something happen
  centerText.textContent =
    `NEW MESSAGE TO: ${toAddress.toUpperCase()}\n` +
    `RESOLVED: (RESOLVING...)\n\n` +
    `TYPE YOUR MESSAGE BELOW.`;

  let resolved = null;

  // Only attempt resolution if wallet is available
  if(window.ethereum && toAddress.includes(".")){
    try{
      const provider = new ethers.BrowserProvider(window.ethereum);
      resolved = await provider.resolveName(toAddress);
    } catch(e){
      resolved = null;
    }
  }

  state.activeToResolved = resolved;

  // Update after resolution attempt
  centerText.textContent =
    `NEW MESSAGE TO: ${toAddress.toUpperCase()}\n` +
    (resolved ? `RESOLVED: ${resolved}\n\n` : `RESOLVED: (NOT FOUND)\n\n`) +
    `TYPE YOUR MESSAGE BELOW.`;

  composerLabel.textContent = "SEND";
  composerInput.value = "";
  composerInput.placeholder = "";
  sendBtn.textContent = "SEND";
  composerInput.focus();
}


function openThread(threadId){
  // remove from inbox on open
  const inbox = load(LS_INBOX, []);
  save(LS_INBOX, inbox.filter(m => m.threadId !== threadId));

  state.mode = "thread";
  state.activeThreadId = threadId;

  const threads = load(LS_THREADS, {});
  const thread = threads[threadId];
  if(!thread){
    centerText.textContent = "THREAD NOT FOUND.";
    return;
  }

  // Display the latest message in the center (MVP)
  const last = thread.messages[thread.messages.length - 1];
  centerText.textContent =
    `FROM: ${last.from.toUpperCase()}\n` +
    `TO: ${last.to.toUpperCase()}\n` +
    `\n` +
    `${last.body}\n`;

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
    centerText.textContent = "CONNECT WALLET FIRST.";
    return;
  }


  // Compose mode: create a new "thread" (represents minting the thread NFT later)
  if(state.mode === "compose"){
    const threadId = uid();

    const threads = load(LS_THREADS, {});
    threads[threadId] = {
      threadId,
      participants: [myAddress, state.activeToResolved || state.activeTo],
      messages: [{
        id: uid(),
        from: myAddress,
        to: state.activeToResolved || state.activeTo,
        body,
        ts: Date.now()
      }]
    };
    save(LS_THREADS, threads);

    // Simulate that recipient got a "new message"
    const inbox = load(LS_INBOX, []);
    inbox.unshift({ threadId, from: myAddress, ts: Date.now() });
    save(LS_INBOX, inbox);

    // Show sent message in center
    const toDisplay = (state.activeToResolved || state.activeTo);
centerText.textContent =
  `TO: ${String(toDisplay).toUpperCase()}\n` +
  (state.activeToResolved ? `ENS: ${state.activeTo.toUpperCase()}\n\n` : `\n`) +
  `${body}\n\n` +
  `[SENT]`;
    composerInput.value = "";
    renderInbox();
    return;
  }

  // Thread mode: append to existing thread (represents postMessage() later)
  if(state.mode === "thread"){
    const threads = load(LS_THREADS, {});
    const thread = threads[state.activeThreadId];
    if(!thread) return;

    // Determine "other participant"
    const other = thread.participants.find(p => p !== myAddress) || "unknown.eth";

    thread.messages.push({
      id: uid(),
      from: myAddress,
      to: other,
      body,
      ts: Date.now()
    });
    save(LS_THREADS, threads);

    // Simulate recipient receives message again
    const inbox = load(LS_INBOX, []);
    inbox.unshift({ threadId: thread.threadId, from: myAddress, ts: Date.now() });
    save(LS_INBOX, inbox);

    // Update center with your reply (or you could show last received; MVP simple)
    centerText.textContent =
      `TO: ${other.toUpperCase()}\n\n` +
      `${body}\n\n` +
      `[SENT REPLY]`;
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

// Close dropdown if click elsewhere
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

/* ===========================
   MANUAL "TO:" INPUT HANDLER
   =========================== */

async function handleToGo(){
  const result = await normalizeRecipient(toInput.value);

  if(!result.ok){
    const msg = {
      EMPTY: "TYPE AN ADDRESS OR ENS NAME.",
      INVALID_ADDRESS: "INVALID 0x ADDRESS.",
      NO_PROVIDER_FOR_ENS: "CONNECT WALLET TO RESOLVE ENS.",
      ENS_NOT_FOUND: "ENS NAME NOT FOUND.",
      ENS_ERROR: "ENS RESOLUTION ERROR.",
      UNKNOWN_FORMAT: "ENTER 0x... OR name.eth"
    }[result.reason] || "INVALID RECIPIENT.";

    centerText.textContent = msg;
    return;
  }

  state.activeTo = result.ens || result.address;
  state.activeToResolved = result.address;
  state.mode = "compose";
  state.activeThreadId = null;

  centerText.textContent =
    `NEW MESSAGE TO: ${String(state.activeTo).toUpperCase()}\n` +
    `RESOLVED: ${result.address}\n\n` +
    `TYPE YOUR MESSAGE BELOW.`;

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
} else {
  // If the HTML isn't updated yet, don't crash the app
  // (You just won't see the TO box until index.html is updated)
  console.log("TO input UI not found (toInput/toGoBtn missing in HTML).");
}


async function connectWallet(){
  if(!window.ethereum){
    centerText.textContent = "METAMASK NOT FOUND. INSTALL METAMASK EXTENSION.";
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

    centerText.textContent = "WALLET CONNECTED.\n\nSELECT AN ADDRESS OR OPEN INBOX.";
  } catch (e){
    centerText.textContent = "WALLET CONNECTION CANCELLED.";
  }
}

connectBtn.onclick = connectWallet;

// ---- Init ----
renderAddresses();
renderInbox();
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
    // minimal "scanlines"
    for(let y=0; y<c.height; y+=6){
      const a = 0.03 + 0.02*Math.sin(t + y*0.02);
      ctx.fillStyle = `rgba(57,255,20,${a})`;
      ctx.fillRect(0,y,c.width,1);
    }
    requestAnimationFrame(loop);
  }
  loop();
})();

