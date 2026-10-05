const state = {
  currentUser: null,
  cheques: [],
  config: null,
  users: [],
  filter: "active",
  installmentRows: [],
  editingDealKey: null,
  currentDealKey: null,
  currentView: "home",
  trackerYear: new Date().getFullYear(),
  trackerMonth: new Date().getMonth() + 1,
  trackerSelectedDate: todayStr(),
  trackerTargetUserId: null,
  trackerMonthEntries: [],
  trackerCurrentEntry: null,
  trackerEmployeesLoaded: false,
  trackerPendingRating: null,
  trackerTab: "daily",
  pipelineEntry: null,
  pipelineClientDetails: [],
  pipelineOpenClients: new Set(),
  revealedPasswords: {},
  tasks: [],
  taskEmployees: [],
  taskEmployeesLoaded: false,
  taskPriority: "medium",
  callsYear: new Date().getFullYear(),
  callsMonth: new Date().getMonth() + 1,
  callsSelectedDate: todayStr(),
  callsTargetUserId: null,
  callsMonthAgg: [],
  callsDayEntries: [],
  callsEmployeesLoaded: false,
};

const $ = (sel) => document.querySelector(sel);

let sessionExpiredHandled = false;

const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M8 7v13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21"/><circle cx="12" cy="7.5" r="4"/></svg>',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401 && path !== "/api/login" && !sessionExpiredHandled) {
    sessionExpiredHandled = true;
    showLoginScreen();
    throw new Error("Session expired");
  }
  if (!res.ok && res.status !== 404) {
    let msg = `Request failed: ${res.status}`;
    try { const body = await res.json(); if (body.error) msg = body.error; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function daysUntil(dateStr, today = new Date()) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
}

function classify(cheque) {
  if (cheque.status === "deposited") return "deposited";
  if (cheque.status === "bounced") return "bounced";
  const du = daysUntil(cheque.depositDate);
  if (du < 0) return "overdue";
  if (du <= 3) return "urgent";
  if (du <= 7) return "soon";
  return "later";
}

function badgeFor(cheque) {
  const cls = classify(cheque);
  const du = daysUntil(cheque.depositDate);
  switch (cls) {
    case "deposited": return `<span class="badge ok">Deposited</span>`;
    case "bounced": return `<span class="badge overdue">Bounced</span>`;
    case "overdue": return `<span class="badge overdue">Overdue ${Math.abs(du)}d</span>`;
    case "urgent": return `<span class="badge urgent">${du === 0 ? "Due today" : du + "d left"}</span>`;
    case "soon": return `<span class="badge soon">${du}d left</span>`;
    default: return `<span class="badge later">${du}d left</span>`;
  }
}

function fmtAmount(amount) {
  const symbol = state.config?.currencySymbol || "";
  const n = Number(amount || 0);
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function isAdmin() { return state.currentUser?.role === "admin"; }

// ---------- Login clipart (a different friendly face each time the login page shows) ----------

const CLIPART_EYES = '<circle cx="38" cy="53" r="4.2" fill="#2b2b3a"/><circle cx="62" cy="53" r="4.2" fill="#2b2b3a"/><circle cx="39.3" cy="51.6" r="1.5" fill="#fff"/><circle cx="63.3" cy="51.6" r="1.5" fill="#fff"/>';

function animalClipart({ bg, head, ear, earInner, ears, snout, nose = "#2b2b3a", cheek = "#ff9fb1", patches = "", whiskers = false }) {
  const earShapes = {
    pointy: `<path d="M22 50 L25 14 L48 32 Z" fill="${ear}"/><path d="M78 50 L75 14 L52 32 Z" fill="${ear}"/><path d="M28 40 L29 24 L40 33 Z" fill="${earInner}"/><path d="M72 40 L71 24 L60 33 Z" fill="${earInner}"/>`,
    round: `<circle cx="27" cy="29" r="13" fill="${ear}"/><circle cx="73" cy="29" r="13" fill="${ear}"/><circle cx="27" cy="29" r="6.5" fill="${earInner}"/><circle cx="73" cy="29" r="6.5" fill="${earInner}"/>`,
    long: `<ellipse cx="36" cy="22" rx="8" ry="20" fill="${ear}"/><ellipse cx="64" cy="22" rx="8" ry="20" fill="${ear}"/><ellipse cx="36" cy="23" rx="3.8" ry="14" fill="${earInner}"/><ellipse cx="64" cy="23" rx="3.8" ry="14" fill="${earInner}"/>`,
    floppy: `<ellipse cx="20" cy="52" rx="11" ry="22" fill="${ear}" transform="rotate(12 20 52)"/><ellipse cx="80" cy="52" rx="11" ry="22" fill="${ear}" transform="rotate(-12 80 52)"/>`,
  };
  const whiskerLines = whiskers ? '<g stroke="#2b2b3a" stroke-width="1.4" stroke-linecap="round" opacity="0.6"><line x1="14" y1="62" x2="30" y2="64"/><line x1="14" y1="70" x2="30" y2="68"/><line x1="86" y1="62" x2="70" y2="64"/><line x1="86" y1="70" x2="70" y2="68"/></g>' : "";
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="50" r="50" fill="${bg}"/>
    ${earShapes[ears]}
    <ellipse cx="50" cy="58" rx="30" ry="27" fill="${head}"/>
    ${patches}
    <ellipse cx="50" cy="68" rx="15" ry="11" fill="${snout}"/>
    ${CLIPART_EYES}
    <ellipse cx="50" cy="62" rx="4.2" ry="3" fill="${nose}"/>
    <path d="M44 70 Q50 76 56 70" fill="none" stroke="#2b2b3a" stroke-width="2" stroke-linecap="round"/>
    <circle cx="29" cy="64" r="4.5" fill="${cheek}" opacity="0.55"/><circle cx="71" cy="64" r="4.5" fill="${cheek}" opacity="0.55"/>
    ${whiskerLines}
  </svg>`;
}

const PANDA_PATCHES = '<ellipse cx="38" cy="53" rx="8.5" ry="10.5" fill="#2b2b3a" transform="rotate(-20 38 53)"/><ellipse cx="62" cy="53" rx="8.5" ry="10.5" fill="#2b2b3a" transform="rotate(20 62 53)"/>';

const LOGIN_CLIPARTS = [
  animalClipart({ bg: "#FFE9B8", head: "#F4A340", ear: "#F4A340", earInner: "#FFC9A0", ears: "pointy", snout: "#FFE2B8", whiskers: true }), // cat
  animalClipart({ bg: "#FFD9C2", head: "#EE7B30", ear: "#EE7B30", earInner: "#3b2a20", ears: "pointy", snout: "#FFF1E0" }), // fox
  animalClipart({ bg: "#D8F0E0", head: "#FFFFFF", ear: "#2b2b3a", earInner: "#4a4a5a", ears: "round", snout: "#EDEDED", patches: PANDA_PATCHES }), // panda
  animalClipart({ bg: "#F6E3D0", head: "#B07A4F", ear: "#B07A4F", earInner: "#E7C7A3", ears: "round", snout: "#E7C7A3" }), // bear
  animalClipart({ bg: "#E8E2FA", head: "#FFFFFF", ear: "#FFFFFF", earInner: "#FFB6C8", ears: "long", snout: "#FDF1F5", nose: "#ff8aa6" }), // rabbit
  animalClipart({ bg: "#DDEBFF", head: "#E9B97A", ear: "#8B5A33", earInner: "#8B5A33", ears: "floppy", snout: "#FFF0DB" }), // dog
  // robot
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#D6F1F7"/><line x1="50" y1="15" x2="50" y2="28" stroke="#5b6b7a" stroke-width="3"/><circle cx="50" cy="13" r="5" fill="#FF6B6B"/><rect x="24" y="27" width="52" height="46" rx="12" fill="#9FB4C7"/><rect x="31" y="37" width="38" height="22" rx="8" fill="#2b2b3a"/><circle cx="42" cy="48" r="5" fill="#5CE1E6"/><circle cx="58" cy="48" r="5" fill="#5CE1E6"/><rect x="40" y="65" width="20" height="4" rx="2" fill="#5b6b7a"/><rect x="17" y="41" width="7" height="16" rx="3" fill="#7b8da0"/><rect x="76" y="41" width="7" height="16" rx="3" fill="#7b8da0"/><rect x="34" y="77" width="32" height="14" rx="6" fill="#9FB4C7"/></svg>',
  // astronaut
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#E6E0FF"/><circle cx="18" cy="22" r="1.8" fill="#fff"/><circle cx="82" cy="30" r="2.2" fill="#fff"/><circle cx="76" cy="78" r="1.6" fill="#fff"/><circle cx="50" cy="52" r="31" fill="#FFFFFF" stroke="#CFD3E6" stroke-width="3"/><rect x="31" y="38" width="38" height="28" rx="14" fill="#2b2b3a"/><ellipse cx="42" cy="47" rx="6" ry="3.2" fill="#8B9BFF" opacity="0.65"/><circle cx="50" cy="86" r="14" fill="#FFFFFF" stroke="#CFD3E6" stroke-width="3"/><rect x="43" y="82" width="14" height="8" rx="3" fill="#FF8A6B"/></svg>',
  // owl
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#FFF0D6"/><path d="M26 40 L28 16 L46 30 Z" fill="#8B5A33"/><path d="M74 40 L72 16 L54 30 Z" fill="#8B5A33"/><ellipse cx="50" cy="60" rx="31" ry="30" fill="#A9744F"/><ellipse cx="50" cy="70" rx="19" ry="17" fill="#F3D9B1"/><circle cx="37" cy="50" r="12" fill="#FFFFFF"/><circle cx="63" cy="50" r="12" fill="#FFFFFF"/><circle cx="37" cy="51" r="5.5" fill="#2b2b3a"/><circle cx="63" cy="51" r="5.5" fill="#2b2b3a"/><circle cx="38.8" cy="49" r="1.7" fill="#fff"/><circle cx="64.8" cy="49" r="1.7" fill="#fff"/><path d="M45 58 L55 58 L50 68 Z" fill="#F29A2E"/></svg>',
  // penguin
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#DCEBFA"/><ellipse cx="50" cy="58" rx="30" ry="34" fill="#2F3A4F"/><ellipse cx="50" cy="64" rx="20" ry="25" fill="#FFFFFF"/><circle cx="40" cy="45" r="5.5" fill="#FFFFFF"/><circle cx="60" cy="45" r="5.5" fill="#FFFFFF"/><circle cx="40.5" cy="46" r="2.6" fill="#2b2b3a"/><circle cx="59.5" cy="46" r="2.6" fill="#2b2b3a"/><path d="M43 53 L57 53 L50 62 Z" fill="#F29A2E"/><ellipse cx="22" cy="62" rx="6" ry="16" fill="#2F3A4F" transform="rotate(14 22 62)"/><ellipse cx="78" cy="62" rx="6" ry="16" fill="#2F3A4F" transform="rotate(-14 78 62)"/><ellipse cx="40" cy="92" rx="9" ry="4" fill="#F29A2E"/><ellipse cx="60" cy="92" rx="9" ry="4" fill="#F29A2E"/></svg>',
];

function randomizeLoginClipart() {
  const icon = $("#loginClipart");
  if (!icon) return;
  const previous = Number(icon.dataset.clipart);
  let next;
  do { next = Math.floor(Math.random() * LOGIN_CLIPARTS.length); } while (next === previous && LOGIN_CLIPARTS.length > 1);
  icon.dataset.clipart = String(next);
  icon.innerHTML = LOGIN_CLIPARTS[next];
  icon.classList.add("clipart");
}

$("#loginClipart").addEventListener("click", randomizeLoginClipart);
randomizeLoginClipart();

// ---------- Auth / bootstrap ----------

function showLoginScreen() {
  state.currentUser = null;
  state.revealedPasswords = {};
  randomizeLoginClipart();
  $("#loginScreen").classList.remove("hidden");
  $("#appRoot").classList.add("hidden");
  sessionExpiredHandled = false;
}

function showApp() {
  $("#loginScreen").classList.add("hidden");
  $("#appRoot").classList.remove("hidden");
}

function updateAddBtnVisibility() {
  const view = state.currentView;
  const show = isAdmin() && (view === "home" || view === "tasks");
  const btn = $("#addBtn");
  btn.classList.toggle("hidden", !show);
  const text = view === "tasks" ? "Add Task" : "Add Cheques";
  const label = $("#addBtn .fab-pill-label");
  if (label) label.textContent = text;
  btn.setAttribute("aria-label", text);
}

function applyRoleUI() {
  const admin = isAdmin();
  $("#userBadge").innerHTML = `${ICONS.user}${escapeHtml(state.currentUser.displayName || state.currentUser.username)} · <span class="role-${state.currentUser.role}">${state.currentUser.role}</span>`;
  $("#settingsBtn").classList.toggle("hidden", !admin);
  $("#appVersion").classList.toggle("hidden", !admin);
  updateAddBtnVisibility();
  $("#navRightIcon").innerHTML = admin ? ICONS.settings : ICONS.power;
  $("#navRightLabel").textContent = admin ? "Settings" : "Logout";
  $("#emptyHint").textContent = admin ? "Tap the + button below to add one." : "Nothing to show right now.";
}

function switchView(view) {
  state.currentView = view;
  $("#homeView").classList.toggle("hidden", view !== "home");
  $("#trackerView").classList.toggle("hidden", view !== "tracker");
  $("#tasksView").classList.toggle("hidden", view !== "tasks");
  $("#callsView").classList.toggle("hidden", view !== "calls");
  $("#pageTitle").classList.toggle("hidden", view !== "home");
  $("#pageTagline").classList.toggle("hidden", view !== "home");
  updateAddBtnVisibility();
  document.querySelectorAll(".nav-item[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === view);
  });
  if (view === "tracker") openTrackerView();
  if (view === "tasks") openTasksView();
  if (view === "calls") openCallsView();
}

document.querySelectorAll(".nav-item[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.nav));
});

$("#navRightBtn").addEventListener("click", () => {
  if (isAdmin()) { showSettings(); } else { doLogout(); }
});
$("#settingsBtn").addEventListener("click", showSettings);
$("#settingsLogoutBtn").addEventListener("click", doLogout);

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").classList.add("hidden");
  try {
    const user = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value,
        rememberMe: $("#rememberMe").checked,
      }),
    });
    state.currentUser = user;
    $("#loginForm").reset();
    $("#rememberMe").checked = true;
    await bootstrapApp();
  } catch (err) {
    $("#loginError").textContent = err.message || "Login failed.";
    $("#loginError").classList.remove("hidden");
  }
});

$("#forgotPasswordLink").addEventListener("click", (e) => {
  e.preventDefault();
  $("#loginError").textContent = "Please refer to your admin in case of a forgotten password.";
  $("#loginError").classList.remove("hidden");
});

async function doLogout() {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  showLoginScreen();
}

async function loadDisplaySettings() {
  const settings = await api("/api/display-settings");
  state.config = { ...state.config, ...settings };
}

async function bootstrapApp() {
  showApp();
  applyRoleUI();
  await loadDisplaySettings();
  await loadCheques();
}

(async function init() {
  $("#todayLabelText").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  try {
    state.currentUser = await api("/api/me");
    await bootstrapApp();
  } catch {
    showLoginScreen();
  }
})();

// ---------- Stats / list rendering ----------

function renderStats() {
  const active = state.cheques.filter(c => c.status !== "deposited" && c.status !== "bounced");
  const urgent = active.filter(c => { const d = daysUntil(c.depositDate); return d >= 0 && d <= 3; }).length;
  const week = active.filter(c => { const d = daysUntil(c.depositDate); return d >= 4 && d <= 7; }).length;
  const overdue = active.filter(c => daysUntil(c.depositDate) < 0).length;
  $("#statUrgent").textContent = urgent;
  $("#statWeek").textContent = week;
  $("#statOverdue").textContent = overdue;
  $("#statPending").textContent = active.length;
}

function dealPositionLabel(cheque) {
  const siblings = state.cheques.filter(c => c.dealId && c.dealId === cheque.dealId);
  if (siblings.length <= 1) return "";
  const sorted = [...siblings].sort((a, b) => a.depositDate.localeCompare(b.depositDate));
  const idx = sorted.findIndex(c => c.id === cheque.id) + 1;
  return `<span class="deal-tag">Cheque ${idx} of ${sorted.length}</span>`;
}

function renderList() {
  let list = [...state.cheques];
  if (state.filter === "active") list = list.filter(c => c.status !== "deposited" && c.status !== "bounced");
  else if (state.filter === "urgent") list = list.filter(c => classify(c) === "urgent");
  else if (state.filter === "overdue") list = list.filter(c => classify(c) === "overdue");
  else if (state.filter === "deposited") list = list.filter(c => c.status === "deposited");

  list.sort((a, b) => a.depositDate.localeCompare(b.depositDate));

  const container = $("#chequeList");
  const empty = $("#emptyState");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const admin = isAdmin();

  container.innerHTML = list.map(c => `
    <div class="cheque-card" data-id="${c.id}">
      <div class="card-stripe status-${classify(c)}"></div>
      <div class="card-body">
        <div class="card-top">
          <span>${badgeFor(c)}${dealPositionLabel(c)}</span>
          <span class="card-amount">${fmtAmount(c.amount)}</span>
        </div>
        <p class="card-title">${escapeHtml(c.tenantName)} → ${escapeHtml(c.ownerName)}</p>
        <p class="card-sub">${[c.propertyDetail, c.chequeNumber ? "Cheque #" + c.chequeNumber : null, c.depositDate].filter(Boolean).map(escapeHtml).join(" • ")}</p>
        ${c.notes ? `<p class="card-notes">${escapeHtml(c.notes)}</p>` : ""}
      </div>
      ${admin ? `
      <div class="card-actions">
        ${c.status !== "deposited" ? `<button data-action="deposit" class="action-deposit" title="Mark deposited">${ICONS.check}</button>` : ""}
        <button data-action="edit" title="Edit">${ICONS.edit}</button>
        <button data-action="delete" class="action-delete" title="Delete">${ICONS.trash}</button>
      </div>` : ""}
    </div>
  `).join("");
}

function render() {
  renderStats();
  renderList();
}

async function loadCheques() {
  state.cheques = await api("/api/cheques");
  render();
}

async function depositCheque(id) {
  await api(`/api/cheques/${id}`, { method: "PUT", body: JSON.stringify({ status: "deposited" }) });
  await loadCheques();
}

async function deleteChequeConfirmed(cheque) {
  if (!confirm(`Delete cheque for ${cheque.tenantName}?`)) return false;
  await api(`/api/cheques/${cheque.id}`, { method: "DELETE" });
  await loadCheques();
  return true;
}

$("#chequeList").addEventListener("click", async (e) => {
  const card = e.target.closest(".cheque-card");
  if (!card) return;
  const id = card.dataset.id;
  const cheque = state.cheques.find(c => c.id === id);
  const btn = e.target.closest("button");

  if (btn && isAdmin()) {
    const action = btn.dataset.action;
    if (action === "delete") { await deleteChequeConfirmed(cheque); }
    else if (action === "deposit") { await depositCheque(id); }
    else if (action === "edit") { openEditDealModal(cheque.dealId || cheque.id); }
    return;
  }
  if (btn) return;
  openDealModal(cheque);
});

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  renderList();
});

// ---------- Deal detail ----------

function openDealModal(cheque) {
  state.currentDealKey = cheque.dealId || cheque.id;
  renderDealModal();
  $("#dealModal").classList.remove("hidden");
}

function closeDealModal() {
  $("#dealModal").classList.add("hidden");
  state.currentDealKey = null;
}

function renderDealModal() {
  const key = state.currentDealKey;
  if (!key) return;
  const group = state.cheques.filter(c => (c.dealId || c.id) === key);
  if (group.length === 0) { closeDealModal(); return; }

  const sorted = [...group].sort((a, b) => a.depositDate.localeCompare(b.depositDate));
  const first = sorted[0];
  const total = group.length;
  const deposited = group.filter(c => c.status === "deposited").length;
  const pending = total - deposited;
  const overdue = group.filter(c => c.status !== "deposited" && c.status !== "bounced" && daysUntil(c.depositDate) < 0).length;

  $("#dealTitle").textContent = `${first.tenantName} → ${first.ownerName}`;
  $("#dealSubtitle").textContent = [first.propertyDetail, first.ownerBankDetail].filter(Boolean).join(" • ") || "No property/bank detail on file.";

  const chips = [
    `<div class="deal-stat-chip"><span class="chip-num">${total}</span><span class="chip-label">${total === 1 ? "cheque" : "cheques"}</span></div>`,
    `<div class="deal-stat-chip chip-deposited"><span class="chip-num">${deposited}</span><span class="chip-label">deposited</span></div>`,
    `<div class="deal-stat-chip chip-pending"><span class="chip-num">${pending}</span><span class="chip-label">pending</span></div>`,
  ];
  if (overdue > 0) {
    chips.push(`<div class="deal-stat-chip chip-overdue"><span class="chip-num">${overdue}</span><span class="chip-label">overdue</span></div>`);
  }
  $("#dealStats").innerHTML = chips.join("");

  const admin = isAdmin();
  $("#dealChequeList").innerHTML = sorted.map(c => `
    <div class="deal-cheque-row" data-id="${c.id}">
      <div class="deal-cheque-row-info">
        ${badgeFor(c)}
        <div class="deal-cheque-row-amount">${fmtAmount(c.amount)}</div>
        <div class="deal-cheque-row-sub">${[c.chequeNumber ? "Cheque #" + c.chequeNumber : null, c.depositDate].filter(Boolean).map(escapeHtml).join(" • ")}</div>
      </div>
      ${admin ? `
      <div class="deal-cheque-row-actions">
        ${c.status !== "deposited" ? `<button data-action="deposit" class="action-deposit" title="Mark deposited">${ICONS.check}</button>` : ""}
        <button data-action="edit" title="Edit">${ICONS.edit}</button>
        <button data-action="delete" class="action-delete" title="Delete">${ICONS.trash}</button>
      </div>` : ""}
    </div>
  `).join("");
}

$("#closeDealBtn").addEventListener("click", closeDealModal);
$("#dealModal").addEventListener("click", (e) => { if (e.target.id === "dealModal") closeDealModal(); });

$("#dealChequeList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || !isAdmin()) return;
  const row = e.target.closest(".deal-cheque-row");
  const id = row.dataset.id;
  const cheque = state.cheques.find(c => c.id === id);
  const action = btn.dataset.action;

  if (action === "edit") {
    closeDealModal();
    openEditDealModal(cheque.dealId || cheque.id);
  } else if (action === "delete") {
    if (await deleteChequeConfirmed(cheque)) renderDealModal();
  } else if (action === "deposit") {
    await depositCheque(id);
    renderDealModal();
  }
});

// ---------- Add / Edit deal modal (shared multi-cheque editor) ----------

function todayStr() { return new Date().toISOString().slice(0, 10); }

function newInstallmentRow() {
  return { id: undefined, chequeNumber: "", amount: "", depositDate: todayStr(), status: "pending" };
}

function renderInstallmentRows() {
  const container = $("#installmentRows");
  container.innerHTML = state.installmentRows.map((row, i) => `
    <div class="installment-row" data-index="${i}">
      <span class="row-number">Cheque ${i + 1}${row.status && row.status !== "pending" ? ` · ${row.status}` : ""}</span>
      <label>Cheque number
        <input type="text" data-field="chequeNumber" value="${escapeHtml(row.chequeNumber)}" placeholder="optional">
      </label>
      <label>Amount
        <input type="number" data-field="amount" step="0.01" min="0" value="${escapeHtml(row.amount)}" required>
      </label>
      <label>Deposit date
        <input type="date" data-field="depositDate" value="${row.depositDate}" required>
      </label>
      <button type="button" class="remove-row-btn" data-remove="${i}" ${state.installmentRows.length <= 1 ? "disabled" : ""} title="Remove">${ICONS.close}</button>
    </div>
  `).join("");
  updateInstallmentsTotal();
}

function updateInstallmentsTotal() {
  const total = state.installmentRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const symbol = state.config?.currencySymbol || "";
  $("#installmentsTotal").textContent = `Total: ${symbol}${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${state.installmentRows.length} cheque(s)`;
}

$("#installmentRows").addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const row = e.target.closest(".installment-row");
  const i = Number(row.dataset.index);
  state.installmentRows[i][field] = e.target.value;
  if (field === "amount") updateInstallmentsTotal();
});

$("#installmentRows").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn || state.installmentRows.length <= 1) return;
  const i = Number(btn.dataset.remove);
  const row = state.installmentRows[i];
  if (row.id && !confirm("This cheque already exists. Remove it from the deal? It will be deleted when you save.")) return;
  state.installmentRows.splice(i, 1);
  renderInstallmentRows();
});

$("#addRowBtn").addEventListener("click", () => {
  const last = state.installmentRows[state.installmentRows.length - 1];
  const next = newInstallmentRow();
  if (last?.depositDate) {
    const d = new Date(last.depositDate + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    next.depositDate = d.toISOString().slice(0, 10);
  }
  state.installmentRows.push(next);
  renderInstallmentRows();
});

function openAddModal() {
  state.editingDealKey = null;
  $("#chequeForm").reset();
  $("#chequeFormTitle").textContent = "Add cheques";
  $("#submitBtn").textContent = "Add cheque(s)";
  state.installmentRows = [newInstallmentRow()];
  renderInstallmentRows();
  $("#addFormStatus").classList.add("hidden");
  $("#addModal").classList.remove("hidden");
}

function openEditDealModal(dealKey) {
  const group = state.cheques.filter(c => (c.dealId || c.id) === dealKey);
  if (group.length === 0) return;
  const sorted = [...group].sort((a, b) => a.depositDate.localeCompare(b.depositDate));
  const first = sorted[0];

  state.editingDealKey = dealKey;
  $("#ownerName").value = first.ownerName || "";
  $("#tenantName").value = first.tenantName || "";
  $("#propertyDetail").value = first.propertyDetail || "";
  $("#ownerBankDetail").value = first.ownerBankDetail || "";
  $("#notes").value = first.notes || "";
  $("#chequeFormTitle").textContent = "Edit deal";
  $("#submitBtn").textContent = "Save changes";
  state.installmentRows = sorted.map(c => ({
    id: c.id,
    chequeNumber: c.chequeNumber || "",
    amount: String(c.amount),
    depositDate: c.depositDate,
    status: c.status,
  }));
  renderInstallmentRows();
  $("#addFormStatus").classList.add("hidden");
  $("#addModal").classList.remove("hidden");
}

function closeChequeFormModal() {
  $("#addModal").classList.add("hidden");
  state.editingDealKey = null;
}

$("#addBtn").addEventListener("click", () => {
  if (state.currentView === "tasks") openAddTaskModal();
  else openAddModal();
});
$("#closeAddBtn").addEventListener("click", closeChequeFormModal);
$("#cancelChequeFormBtn").addEventListener("click", closeChequeFormModal);
$("#addModal").addEventListener("click", (e) => { if (e.target.id === "addModal") closeChequeFormModal(); });

$("#chequeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#addFormStatus").classList.add("hidden");
  const sharedFields = {
    ownerName: $("#ownerName").value.trim(),
    tenantName: $("#tenantName").value.trim(),
    propertyDetail: $("#propertyDetail").value.trim(),
    ownerBankDetail: $("#ownerBankDetail").value.trim(),
    notes: $("#notes").value.trim(),
  };
  const cheques = state.installmentRows.map(r => ({
    id: r.id,
    chequeNumber: r.chequeNumber.trim(),
    amount: parseFloat(r.amount),
    depositDate: r.depositDate,
  }));
  try {
    if (state.editingDealKey) {
      await api(`/api/deals/${state.editingDealKey}`, { method: "PUT", body: JSON.stringify({ ...sharedFields, cheques }) });
    } else {
      await api("/api/cheques/batch", { method: "POST", body: JSON.stringify({ ...sharedFields, cheques }) });
    }
    closeChequeFormModal();
    await loadCheques();
  } catch (err) {
    $("#addFormStatus").textContent = err.message;
    $("#addFormStatus").classList.remove("hidden");
  }
});

// ---------- Tracker ----------

function isViewingOwnTracker() {
  return !state.trackerTargetUserId || state.trackerTargetUserId === state.currentUser.id;
}

function trackerUserIdParam() {
  return isAdmin() && state.trackerTargetUserId ? state.trackerTargetUserId : "";
}

async function openTrackerView() {
  if (isAdmin() && !state.trackerEmployeesLoaded) {
    await loadTrackerEmployeeOptions();
  }
  await loadTrackerMonthEntries();
  renderTrackerCalendar();
  await selectTrackerDay(state.trackerSelectedDate);
  if (state.trackerTab === "pipeline") await loadPipeline();
}

async function loadTrackerEmployeeOptions() {
  const allUsers = await api("/api/users");
  state.trackerEmployeesLoaded = true;
  state.trackerTargetUserId = state.currentUser.id;
  const select = $("#trackerEmployeeSelect");
  select.innerHTML = allUsers.map(u => `<option value="${u.id}"${u.id === state.currentUser.id ? " selected" : ""}>${escapeHtml(u.displayName || u.username)}${u.id === state.currentUser.id ? " (you)" : ""}</option>`).join("");
  select.classList.remove("hidden");
}

$("#trackerEmployeeSelect").addEventListener("change", async (e) => {
  state.trackerTargetUserId = e.target.value;
  await loadTrackerMonthEntries();
  renderTrackerCalendar();
  await selectTrackerDay(state.trackerSelectedDate);
  if (state.trackerTab === "pipeline") await loadPipeline();
});

async function loadTrackerMonthEntries() {
  const qs = new URLSearchParams({ year: state.trackerYear, month: state.trackerMonth });
  const uid = trackerUserIdParam();
  if (uid) qs.set("userId", uid);
  state.trackerMonthEntries = await api(`/api/tracker/month?${qs.toString()}`);
}

function renderTrackerCalendar() {
  const year = state.trackerYear, month = state.trackerMonth; // month is 1-12
  $("#trackerMonthLabel").textContent = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstOfMonth = new Date(year, month - 1, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Sun=0..Sat=6 -> Mon=0..Sun=6
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayStr();

  const entryByDate = {};
  state.trackerMonthEntries.forEach((e) => { entryByDate[e.date] = e; });

  let cells = "";
  for (let i = 0; i < startOffset; i++) {
    cells += `<button type="button" class="tracker-cal-day other-month" disabled></button>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = entryByDate[dateStr];
    const hasEntry = !!(entry && (entry.loginTime || entry.plan || entry.remarks || entry.rating || entry.onLeave));
    const classes = ["tracker-cal-day"];
    if (dateStr === today) classes.push("is-today");
    if (dateStr === state.trackerSelectedDate) classes.push("is-selected");
    if (entry && entry.rating) classes.push(`rating-${entry.rating}`);
    if (entry && entry.onLeave) classes.push("on-leave");
    cells += `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${hasEntry ? '<span class="entry-dot"></span>' : ""}</button>`;
  }
  $("#trackerCalGrid").innerHTML = cells;

  const leaveDays = state.trackerMonthEntries.filter((e) => e.onLeave).length;
  $("#trackerLeaveSummary").textContent = leaveDays ? `${leaveDays} day${leaveDays === 1 ? "" : "s"} on leave this month` : "";
  $("#trackerLeaveSummary").classList.toggle("hidden", !leaveDays);
}

$("#trackerCalGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".tracker-cal-day[data-date]");
  if (!btn) return;
  await selectTrackerDay(btn.dataset.date);
  $("#trackerDayPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  promptAttendanceIfNeeded();
});

// Both Tracker tabs share one month, so the calendar and the pipeline never disagree.
async function shiftTrackerMonth(delta) {
  state.trackerMonth += delta;
  if (state.trackerMonth < 1) { state.trackerMonth = 12; state.trackerYear -= 1; }
  if (state.trackerMonth > 12) { state.trackerMonth = 1; state.trackerYear += 1; }
  await loadTrackerMonthEntries();
  renderTrackerCalendar();
  if (state.trackerTab === "pipeline") await loadPipeline();
}

$("#trackerPrevMonth").addEventListener("click", () => shiftTrackerMonth(-1));
$("#trackerNextMonth").addEventListener("click", () => shiftTrackerMonth(1));
$("#pipelinePrevMonth").addEventListener("click", () => shiftTrackerMonth(-1));
$("#pipelineNextMonth").addEventListener("click", () => shiftTrackerMonth(1));

async function selectTrackerDay(dateStr) {
  state.trackerSelectedDate = dateStr;
  state.trackerPendingRating = null;
  document.querySelectorAll(".tracker-cal-day[data-date]").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.date === dateStr);
  });

  const labelDate = new Date(dateStr + "T00:00:00");
  const isToday = dateStr === todayStr();
  $("#trackerSelectedDateLabel").textContent = (isToday ? "Today, " : "") + labelDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const uid = trackerUserIdParam();
  const entry = await api(`/api/tracker/entries/${dateStr}${uid ? `?userId=${encodeURIComponent(uid)}` : ""}`);
  state.trackerCurrentEntry = entry;

  $("#trackerPlanInput").value = entry.plan || "";
  $("#trackerRemarksInput").value = entry.remarks || "";
  ["#trackerPlanStatus", "#trackerRemarksStatus"].forEach((sel) => { $(sel).textContent = ""; });
  renderTrackerSteps();
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Day flow: attendance -> morning plan -> evening plan -> logout. Each step stays locked
// until the one before it has been saved (the server enforces the same order).
function renderTrackerSteps() {
  const entry = state.trackerCurrentEntry || {};
  const readOnly = !isViewingOwnTracker();
  const future = state.trackerSelectedDate > todayStr();
  const hasLogin = !!entry.loginTime;
  const hasPlan = !!String(entry.plan || "").trim();
  const hasRemarks = !!String(entry.remarks || "").trim();
  const onLeave = !!entry.onLeave;
  const leaveNote = "On leave - nothing to log";

  const loginLocked = !readOnly && future;
  const planLocked = !readOnly && (future || onLeave || !hasLogin);
  const remarksLocked = !readOnly && (planLocked || !hasPlan);
  const logoutLocked = !readOnly && (remarksLocked || !hasRemarks);

  const setSection = (id, lockId, locked, note) => {
    $(id).classList.toggle("is-locked", locked);
    $(lockId).textContent = locked ? note : "";
  };
  setSection("#trackerLoginSection", "#trackerLoginLock", loginLocked, "Can't mark attendance for a future date");
  setSection("#trackerPlanSection", "#trackerPlanLock", planLocked, onLeave ? leaveNote : "Mark attendance to unlock");
  setSection("#trackerRemarksSection", "#trackerRemarksLock", remarksLocked, onLeave ? leaveNote : "Save your morning plan to unlock");
  setSection("#trackerLogoutSection", "#trackerLogoutLock", logoutLocked, onLeave ? leaveNote : "Save your evening plan to unlock");

  // Leave days replace the login row with a leave card; attendance and leave are mutually exclusive.
  $("#trackerLoginRowWrap").classList.toggle("hidden", onLeave);
  $("#trackerLeaveCard").classList.toggle("hidden", !onLeave);
  $("#trackerLeaveBtn").classList.toggle("hidden", readOnly || onLeave || hasLogin);
  $("#trackerLeaveEditBtn").classList.toggle("hidden", readOnly);
  $("#trackerLeaveCancelBtn").classList.toggle("hidden", readOnly);
  if (onLeave) {
    $("#trackerLeaveTitle").textContent = `On leave · ${leaveTypeLabel(entry.leaveType)}`;
    $("#trackerLeaveReason").textContent = entry.leaveReason || "";
  }

  renderTrackerTimeRow("#trackerLoginDisplay", "#trackerLoginBtn", entry.loginTime, "Mark attendance", loginLocked, readOnly);
  renderTrackerTimeRow("#trackerLogoutDisplay", "#trackerLogoutBtn", entry.logoutTime, "Mark logout", logoutLocked, readOnly);

  $("#trackerPlanInput").disabled = readOnly || planLocked;
  $("#trackerSavePlanBtn").classList.toggle("hidden", readOnly);
  $("#trackerSavePlanBtn").disabled = planLocked;
  $("#trackerRemarksInput").disabled = readOnly || remarksLocked;
  $("#trackerSaveRemarksBtn").classList.toggle("hidden", readOnly);
  $("#trackerSaveRemarksBtn").disabled = remarksLocked;
  renderTrackerRatingStars(entry.rating, readOnly || remarksLocked);
}

function formatClockTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderTrackerTimeRow(displaySel, btnSel, savedTime, markLabel, locked, readOnly) {
  const display = $(displaySel), btn = $(btnSel);
  display.textContent = savedTime ? formatClockTime(savedTime) : "Not marked";
  display.classList.toggle("is-empty", !savedTime);
  btn.classList.toggle("hidden", readOnly);
  btn.disabled = locked;
  btn.textContent = savedTime ? "Edit" : markLabel;
  btn.classList.toggle("primary", !savedTime);
  btn.classList.toggle("secondary", !!savedTime);
}

function revealTrackerSection(sectionSel) {
  $(sectionSel).scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- Clock popup (login / logout time) ----------

const CLOCK_STEPS = {
  loginTime: { title: "Mark attendance", button: "Mark attendance" },
  logoutTime: { title: "Mark logout", button: "Mark logout" },
};
let clockField = null;

function updateClockHands(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  $("#clockHourHand").setAttribute("transform", `rotate(${((h % 12) + m / 60) * 30} 50 50)`);
  $("#clockMinuteHand").setAttribute("transform", `rotate(${m * 6} 50 50)`);
}

function openClockModal(field) {
  const step = CLOCK_STEPS[field];
  const saved = state.trackerCurrentEntry?.[field];
  clockField = field;
  $("#clockTitle").textContent = step.title;
  $("#clockSubtitle").textContent = $("#trackerSelectedDateLabel").textContent;
  $("#clockTimeInput").value = saved || nowHHMM();
  $("#clockSaveBtn").textContent = saved ? "Save time" : step.button;
  $("#clockLeaveBtn").classList.toggle("hidden", field !== "loginTime" || !!saved);
  $("#clockStatus").textContent = "";
  updateClockHands($("#clockTimeInput").value);
  $("#clockModal").classList.remove("hidden");
}

function closeClockModal() {
  $("#clockModal").classList.add("hidden");
  clockField = null;
}

function promptAttendanceIfNeeded() {
  const entry = state.trackerCurrentEntry || {};
  if (!isViewingOwnTracker() || state.trackerSelectedDate > todayStr() || entry.loginTime || entry.onLeave) return;
  openClockModal("loginTime");
}

$("#clockTimeInput").addEventListener("input", (e) => updateClockHands(e.target.value));
$("#closeClockBtn").addEventListener("click", closeClockModal);
$("#clockModal").addEventListener("click", (e) => {
  if (e.target.id === "clockModal") closeClockModal();
});

$("#clockSaveBtn").addEventListener("click", async () => {
  const value = $("#clockTimeInput").value;
  if (!value) { $("#clockStatus").textContent = "Pick a time first."; return; }
  const field = clockField;
  const hadLogin = !!state.trackerCurrentEntry?.loginTime;
  $("#clockStatus").textContent = "Saving...";
  try {
    state.trackerCurrentEntry = await api(`/api/tracker/entries/${state.trackerSelectedDate}`, { method: "PUT", body: JSON.stringify({ [field]: value }) });
    closeClockModal();
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
    renderTrackerSteps();
    if (field === "loginTime" && !hadLogin) revealTrackerSection("#trackerPlanSection");
  } catch (err) {
    $("#clockStatus").textContent = err.message;
  }
});

$("#trackerLoginBtn").addEventListener("click", () => openClockModal("loginTime"));
$("#trackerLogoutBtn").addEventListener("click", () => openClockModal("logoutTime"));

// ---------- On leave ----------

const LEAVE_TYPES = [
  { value: "sick", label: "Sick leave" },
  { value: "annual", label: "Annual leave" },
  { value: "casual", label: "Casual leave" },
  { value: "other", label: "Other" },
];

function leaveTypeLabel(value) {
  return LEAVE_TYPES.find((t) => t.value === value)?.label || "Leave";
}

function openLeaveModal() {
  const entry = state.trackerCurrentEntry || {};
  $("#leaveSubtitle").textContent = $("#trackerSelectedDateLabel").textContent;
  $("#leaveTypeSelect").value = entry.leaveType || "";
  $("#leaveReasonInput").value = entry.leaveReason || "";
  $("#leaveSaveBtn").textContent = entry.onLeave ? "Save leave" : "Mark on leave";
  $("#leaveStatus").textContent = "";
  $("#leaveModal").classList.remove("hidden");
}

function closeLeaveModal() { $("#leaveModal").classList.add("hidden"); }

// Resolves to null on success, or the error message to show.
async function saveTrackerLeave(body) {
  try {
    state.trackerCurrentEntry = await api(`/api/tracker/entries/${state.trackerSelectedDate}`, { method: "PUT", body: JSON.stringify(body) });
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
    renderTrackerSteps();
    return null;
  } catch (err) {
    return err.message || "Couldn't save.";
  }
}

$("#trackerLeaveBtn").addEventListener("click", openLeaveModal);
$("#trackerLeaveEditBtn").addEventListener("click", openLeaveModal);
$("#clockLeaveBtn").addEventListener("click", () => { closeClockModal(); openLeaveModal(); });
$("#closeLeaveBtn").addEventListener("click", closeLeaveModal);
$("#leaveModal").addEventListener("click", (e) => {
  if (e.target.id === "leaveModal") closeLeaveModal();
});

$("#leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const leaveType = $("#leaveTypeSelect").value;
  if (!leaveType) { $("#leaveStatus").textContent = "Pick a leave type."; return; }
  $("#leaveStatus").textContent = "Saving...";
  const error = await saveTrackerLeave({ onLeave: true, leaveType, leaveReason: $("#leaveReasonInput").value });
  if (error) $("#leaveStatus").textContent = error; else closeLeaveModal();
});

$("#trackerLeaveCancelBtn").addEventListener("click", async () => {
  $("#trackerLeaveTitle").textContent = "Cancelling...";
  const error = await saveTrackerLeave({ onLeave: false });
  if (error) {
    renderTrackerSteps();
    $("#trackerLeaveReason").textContent = error;
  }
});

// ---------- Pipeline (monthly progress per person) ----------

const PIPELINE_METRICS = [
  { key: "leadsReceived", label: "Leads received", badge: "badge-blue",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>' },
  { key: "clientsInProcess", label: "Clients in process", badge: "badge-purple",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { key: "expectedClosures", label: "Expected closures this month", badge: "badge-coral",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>' },
  { key: "dealsClosed", label: "Deals closed this month", badge: "badge-mint",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' },
];

function trackerMonthKey() {
  return `${state.trackerYear}-${String(state.trackerMonth).padStart(2, "0")}`;
}

function renderPipelineForm() {
  $("#pipelineMetrics").innerHTML = PIPELINE_METRICS.map((m) => `
    <div class="tracker-section pipeline-metric">
      <div class="pipeline-metric-head">
        <span class="stat-icon-badge ${m.badge}">${m.icon}</span>
        <span class="pipeline-metric-title">${m.label}</span>
        <input type="number" id="pipeline-${m.key}" min="0" step="1" inputmode="numeric" placeholder="0" aria-label="${m.label}">
      </div>
      <textarea id="pipeline-${m.key}Remark" rows="2" maxlength="1000" placeholder="Add a remark..." aria-label="Remark for ${m.label}"></textarea>
      ${m.key === "clientsInProcess" ? '<div class="pipeline-clients hidden" id="pipelineClients"></div>' : ""}
    </div>`).join("");
}

function fillPipelineForm() {
  const entry = state.pipelineEntry || {};
  const readOnly = !isViewingOwnTracker();
  $("#pipelineMonthLabel").textContent = new Date(state.trackerYear, state.trackerMonth - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  PIPELINE_METRICS.forEach((m) => {
    const count = $(`#pipeline-${m.key}`), remark = $(`#pipeline-${m.key}Remark`);
    count.value = entry[m.key] ?? "";
    remark.value = entry[`${m.key}Remark`] || "";
    count.disabled = readOnly;
    remark.disabled = readOnly;
  });
  state.pipelineClientDetails = Array.isArray(entry.clientDetails)
    ? entry.clientDetails.map((c) => (c && typeof c === "object" ? { ...c } : {}))
    : [];
  renderClientDetails();
  $("#pipelineSaveBtn").classList.toggle("hidden", readOnly);
  $("#pipelineStatus").textContent = "";
}

// "Clients in process" expands into one details card per client (Client 1, Client 2, ...).
const MAX_CLIENTS = 100;
const CLIENT_TYPES = [
  { value: "family", label: "Family" },
  { value: "bachelor", label: "Bachelor" },
  { value: "staff_sharing", label: "Staff sharing" },
  { value: "family_sharing", label: "Family sharing" },
];
const CLIENT_FIELDS = ["name", "looking", "budget", "locations", "type", "remark"];

function clientCount() {
  const n = parseInt($("#pipeline-clientsInProcess").value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_CLIENTS) : 0;
}

function syncClientDetailsFromDom() {
  document.querySelectorAll("#pipelineClients .pipeline-client").forEach((card, i) => {
    const details = state.pipelineClientDetails[i] || {};
    card.querySelectorAll("[data-field]").forEach((el) => { details[el.dataset.field] = el.value; });
    state.pipelineClientDetails[i] = details;
  });
}

const CHEVRON_SVG = '<svg class="pipeline-client-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

// One-line summary shown on a collapsed client row: name · who it's for · budget.
function updateClientSummary(card) {
  const val = (f) => card.querySelector(`[data-field="${f}"]`).value.trim();
  const typeLabel = CLIENT_TYPES.find((t) => t.value === val("type"))?.label || "";
  card.querySelector(".pipeline-client-sub").textContent = [val("name"), typeLabel, val("budget")].filter(Boolean).join(" · ") || "Tap to add details";
}

function renderClientDetails() {
  const count = clientCount();
  const readOnly = !isViewingOwnTracker();
  const box = $("#pipelineClients");
  box.classList.toggle("hidden", count === 0);
  if (count === 0) { box.innerHTML = ""; return; }
  const typeOptions = `<option value="">Select...</option>` + CLIENT_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join("");
  box.innerHTML = `<div class="pipeline-clients-title">Client details</div>` +
    Array.from({ length: count }, (_, i) => `
      <details class="pipeline-client"${state.pipelineOpenClients.has(i) ? " open" : ""}>
        <summary class="pipeline-client-head">
          <div class="pipeline-client-titles">
            <span class="pipeline-client-label">Client ${i + 1}</span>
            <span class="pipeline-client-sub"></span>
          </div>
          ${CHEVRON_SVG}
        </summary>
        <div class="pipeline-client-body">
        <div class="pipeline-field">
          <span class="pipeline-field-label">Client name</span>
          <input type="text" data-field="name" maxlength="100" placeholder="e.g. Mr. Ahmed" aria-label="Client ${i + 1} name">
        </div>
        <div class="pipeline-field">
          <span class="pipeline-field-label">Looking for</span>
          <textarea rows="2" data-field="looking" maxlength="500" placeholder="e.g. 2BR apartment, close to the metro" aria-label="What client ${i + 1} is looking for"></textarea>
        </div>
        <div class="pipeline-field-row">
          <div class="pipeline-field">
            <span class="pipeline-field-label">Budget</span>
            <input type="text" data-field="budget" maxlength="100" placeholder="e.g. AED 90k / year" aria-label="Client ${i + 1} budget">
          </div>
          <div class="pipeline-field">
            <span class="pipeline-field-label">For</span>
            <select data-field="type" aria-label="Client ${i + 1} is looking for">${typeOptions}</select>
          </div>
        </div>
        <div class="pipeline-field">
          <span class="pipeline-field-label">Preferred locations</span>
          <input type="text" data-field="locations" maxlength="300" placeholder="e.g. Marina, JVC, Business Bay" aria-label="Client ${i + 1} preferred locations">
        </div>
        <div class="pipeline-field">
          <span class="pipeline-field-label">Remark</span>
          <textarea rows="2" data-field="remark" maxlength="1000" placeholder="Remark for client ${i + 1}..." aria-label="Remark for client ${i + 1}"></textarea>
        </div>
        </div>
      </details>`).join("");
  box.querySelectorAll(".pipeline-client").forEach((card, i) => {
    const details = state.pipelineClientDetails[i] || {};
    card.querySelectorAll("[data-field]").forEach((el) => {
      el.value = details[el.dataset.field] || "";
      el.disabled = readOnly;
    });
    updateClientSummary(card);
  });
}

$("#pipelineMetrics").addEventListener("input", (e) => {
  if (e.target.id === "pipeline-clientsInProcess") {
    syncClientDetailsFromDom();
    renderClientDetails();
    return;
  }
  const card = e.target.closest(".pipeline-client");
  if (card && ["name", "type", "budget"].includes(e.target.dataset.field)) updateClientSummary(card);
});

// Remember which client rows are expanded across re-renders (toggle doesn't bubble, so listen in the capture phase).
$("#pipelineMetrics").addEventListener("toggle", (e) => {
  const card = e.target;
  if (!card.classList || !card.classList.contains("pipeline-client")) return;
  const index = [...card.parentElement.querySelectorAll(".pipeline-client")].indexOf(card);
  if (card.open) state.pipelineOpenClients.add(index); else state.pipelineOpenClients.delete(index);
}, true);

async function loadPipeline() {
  const uid = trackerUserIdParam();
  state.pipelineEntry = await api(`/api/tracker/pipeline/${trackerMonthKey()}${uid ? `?userId=${encodeURIComponent(uid)}` : ""}`);
  state.pipelineOpenClients = new Set();
  fillPipelineForm();
}

function setTrackerTab(tab) {
  state.trackerTab = tab;
  document.querySelectorAll(".tracker-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.trackerTab === tab));
  $("#trackerDailyPane").classList.toggle("hidden", tab !== "daily");
  $("#trackerPipelinePane").classList.toggle("hidden", tab !== "pipeline");
  if (tab === "pipeline") loadPipeline();
}

document.querySelectorAll(".tracker-tab").forEach((btn) => {
  btn.addEventListener("click", () => setTrackerTab(btn.dataset.trackerTab));
});

$("#pipelineForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  PIPELINE_METRICS.forEach((m) => {
    const raw = $(`#pipeline-${m.key}`).value.trim();
    body[m.key] = raw === "" ? null : Number(raw);
    body[`${m.key}Remark`] = $(`#pipeline-${m.key}Remark`).value;
  });
  syncClientDetailsFromDom();
  body.clientDetails = Array.from({ length: clientCount() }, (_, i) => {
    const details = state.pipelineClientDetails[i] || {};
    return Object.fromEntries(CLIENT_FIELDS.map((f) => [f, details[f] || ""]));
  });
  $("#pipelineStatus").textContent = "Saving...";
  try {
    state.pipelineEntry = await api(`/api/tracker/pipeline/${trackerMonthKey()}`, { method: "PUT", body: JSON.stringify(body) });
    fillPipelineForm();
    $("#pipelineStatus").textContent = "Saved.";
  } catch (err) {
    $("#pipelineStatus").textContent = err.message;
  }
  setTimeout(() => { $("#pipelineStatus").textContent = ""; }, 2500);
});

renderPipelineForm();

function renderTrackerRatingStars(rating, readOnly) {
  const starIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><polygon points="12 2.5 15.1 9 22 10 17 15 18.2 22 12 18.6 5.8 22 7 15 2 10 8.9 9"/></svg>';
  const container = $("#trackerRatingStars");
  container.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="tracker-star ${rating >= n ? "active" : ""}" data-star="${n}" ${readOnly ? "disabled" : ""}>${starIcon}</button>`).join("");
}

$("#trackerRatingStars").addEventListener("click", (e) => {
  const btn = e.target.closest(".tracker-star");
  if (!btn || btn.disabled) return;
  const value = Number(btn.dataset.star);
  state.trackerPendingRating = value;
  renderTrackerRatingStars(value, false);
});

$("#trackerSavePlanBtn").addEventListener("click", async () => {
  const dateStr = state.trackerSelectedDate;
  const hadPlan = !!String(state.trackerCurrentEntry?.plan || "").trim();
  $("#trackerPlanStatus").textContent = "Saving...";
  try {
    const entry = await api(`/api/tracker/entries/${dateStr}`, { method: "PUT", body: JSON.stringify({ plan: $("#trackerPlanInput").value }) });
    state.trackerCurrentEntry = entry;
    $("#trackerPlanStatus").textContent = "Saved.";
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
    renderTrackerSteps();
    if (!hadPlan && String(entry.plan || "").trim()) revealTrackerSection("#trackerRemarksSection");
  } catch (err) {
    $("#trackerPlanStatus").textContent = err.message;
  }
  setTimeout(() => { $("#trackerPlanStatus").textContent = ""; }, 2000);
});

$("#trackerSaveRemarksBtn").addEventListener("click", async () => {
  const dateStr = state.trackerSelectedDate;
  const rating = state.trackerPendingRating !== null ? state.trackerPendingRating : (state.trackerCurrentEntry?.rating ?? null);
  const hadRemarks = !!String(state.trackerCurrentEntry?.remarks || "").trim();
  $("#trackerRemarksStatus").textContent = "Saving...";
  try {
    const entry = await api(`/api/tracker/entries/${dateStr}`, { method: "PUT", body: JSON.stringify({ remarks: $("#trackerRemarksInput").value, rating }) });
    state.trackerCurrentEntry = entry;
    state.trackerPendingRating = null;
    $("#trackerRemarksStatus").textContent = "Saved.";
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
    renderTrackerSteps();
    if (!hadRemarks && String(entry.remarks || "").trim() && !entry.logoutTime) openClockModal("logoutTime");
  } catch (err) {
    $("#trackerRemarksStatus").textContent = err.message;
  }
  setTimeout(() => { $("#trackerRemarksStatus").textContent = ""; }, 2000);
});

// ---------- Tasks (admin assigns work to employees) ----------

async function openTasksView() {
  if (isAdmin() && !state.taskEmployeesLoaded) {
    await loadTaskEmployees();
  }
  await loadTasks();
  renderTasksList();
}

async function loadTaskEmployees() {
  state.taskEmployees = await api("/api/users");
  state.taskEmployeesLoaded = true;
}

async function loadTasks() {
  state.tasks = await api("/api/tasks");
}

function priorityLabel(p) { return p === "high" ? "High" : p === "low" ? "Low" : "Medium"; }

function renderTasksList() {
  const admin = isAdmin();
  const container = $("#tasksList");
  const empty = $("#tasksEmptyState");
  const tasks = [...state.tasks].sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  if (tasks.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  container.innerHTML = tasks.map((t) => {
    const assigneeNames = admin
      ? t.assignedTo.map((id) => {
          const u = state.taskEmployees.find((e) => e.id === id);
          return escapeHtml(u ? (u.displayName || u.username) : "Unknown");
        }).join(", ")
      : "";
    const due = t.dueDate ? new Date(t.dueDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    return `
      <div class="task-card" data-id="${t.id}">
        <div class="task-card-top">
          <span class="badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
          ${due ? `<span class="task-due">${due}</span>` : ""}
        </div>
        <h3 class="task-title">${escapeHtml(t.title)}</h3>
        ${t.description ? `<p class="task-desc">${escapeHtml(t.description)}</p>` : ""}
        ${admin ? `<p class="task-assignees">${assigneeNames}</p>` : ""}
        <div class="task-status-row">
          <button type="button" class="task-status-btn ${t.status === "pending" ? "active" : ""}" data-status="pending">To Do</button>
          <button type="button" class="task-status-btn ${t.status === "in_progress" ? "active" : ""}" data-status="in_progress">In Progress</button>
          <button type="button" class="task-status-btn ${t.status === "done" ? "active" : ""}" data-status="done">Done</button>
        </div>
        ${admin ? `<button type="button" class="task-delete-btn" data-id="${t.id}">Delete task</button>` : ""}
      </div>
    `;
  }).join("");
}

$("#tasksList").addEventListener("click", async (e) => {
  const statusBtn = e.target.closest(".task-status-btn");
  if (statusBtn) {
    const id = statusBtn.closest(".task-card").dataset.id;
    await api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status: statusBtn.dataset.status }) });
    await loadTasks();
    renderTasksList();
    return;
  }
  const delBtn = e.target.closest(".task-delete-btn");
  if (delBtn) {
    if (!confirm("Delete this task?")) return;
    await api(`/api/tasks/${delBtn.dataset.id}`, { method: "DELETE" });
    await loadTasks();
    renderTasksList();
  }
});

function renderTaskAssigneeOptions() {
  const container = $("#taskAssigneeSelect");
  container.innerHTML = state.taskEmployees
    .filter((u) => u.role === "employee")
    .map((u) => `
      <label class="assignee-chip">
        <input type="checkbox" value="${u.id}">
        <span>${escapeHtml(u.displayName || u.username)}</span>
      </label>
    `).join("");
}

function openAddTaskModal() {
  $("#addTaskForm").reset();
  state.taskPriority = "medium";
  document.querySelectorAll("#taskPrioritySelect .priority-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.priority === "medium");
  });
  renderTaskAssigneeOptions();
  $("#addTaskStatus").classList.add("hidden");
  $("#addTaskModal").classList.remove("hidden");
}

function closeAddTaskModal() {
  $("#addTaskModal").classList.add("hidden");
}

$("#taskPrioritySelect").addEventListener("click", (e) => {
  const btn = e.target.closest(".priority-pill");
  if (!btn) return;
  state.taskPriority = btn.dataset.priority;
  document.querySelectorAll("#taskPrioritySelect .priority-pill").forEach((b) => b.classList.toggle("active", b === btn));
});

$("#closeAddTaskBtn").addEventListener("click", closeAddTaskModal);
$("#cancelAddTaskBtn").addEventListener("click", closeAddTaskModal);
$("#addTaskModal").addEventListener("click", (e) => { if (e.target.id === "addTaskModal") closeAddTaskModal(); });

$("#addTaskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const assignedTo = Array.from(document.querySelectorAll("#taskAssigneeSelect input:checked")).map((i) => i.value);
  $("#addTaskStatus").classList.add("hidden");
  if (assignedTo.length === 0) {
    $("#addTaskStatus").textContent = "Select at least one employee to assign this task to.";
    $("#addTaskStatus").classList.remove("hidden");
    return;
  }
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: $("#taskTitle").value.trim(),
        description: $("#taskDescription").value.trim(),
        dueDate: $("#taskDueDate").value || null,
        priority: state.taskPriority,
        assignedTo,
      }),
    });
    closeAddTaskModal();
    await loadTasks();
    renderTasksList();
  } catch (err) {
    $("#addTaskStatus").textContent = err.message || "Failed to create task.";
    $("#addTaskStatus").classList.remove("hidden");
  }
});

// ---------- Calls (employee logs each call they make) ----------

function callsUserIdParam() {
  return isAdmin() && state.callsTargetUserId ? state.callsTargetUserId : "";
}

async function openCallsView() {
  if (isAdmin() && !state.callsEmployeesLoaded) {
    await loadCallsEmployeeOptions();
  }
  await loadCallsMonth();
  renderCallsCalendar();
  await selectCallsDay(state.callsSelectedDate);
}

async function loadCallsEmployeeOptions() {
  const allUsers = await api("/api/users");
  state.callsEmployeesLoaded = true;
  state.callsTargetUserId = state.currentUser.id;
  const select = $("#callsEmployeeSelect");
  select.innerHTML = allUsers.map(u => `<option value="${u.id}"${u.id === state.currentUser.id ? " selected" : ""}>${escapeHtml(u.displayName || u.username)}${u.id === state.currentUser.id ? " (you)" : ""}</option>`).join("");
  select.classList.remove("hidden");
}

$("#callsEmployeeSelect").addEventListener("change", async (e) => {
  state.callsTargetUserId = e.target.value;
  await loadCallsMonth();
  renderCallsCalendar();
  await selectCallsDay(state.callsSelectedDate);
});

async function loadCallsMonth() {
  const qs = new URLSearchParams({ year: state.callsYear, month: state.callsMonth });
  const uid = callsUserIdParam();
  if (uid) qs.set("userId", uid);
  state.callsMonthAgg = await api(`/api/calls/month?${qs.toString()}`);
}

function renderCallsCalendar() {
  const year = state.callsYear, month = state.callsMonth;
  $("#callsMonthLabel").textContent = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstOfMonth = new Date(year, month - 1, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayStr();

  const aggByDate = {};
  state.callsMonthAgg.forEach((a) => { aggByDate[a.date] = a; });

  let cells = "";
  for (let i = 0; i < startOffset; i++) {
    cells += `<button type="button" class="tracker-cal-day other-month" disabled></button>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const agg = aggByDate[dateStr];
    const classes = ["tracker-cal-day"];
    if (dateStr === today) classes.push("is-today");
    if (dateStr === state.callsSelectedDate) classes.push("is-selected");
    cells += `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${agg ? '<span class="entry-dot"></span>' : ""}</button>`;
  }
  $("#callsCalGrid").innerHTML = cells;
}

$("#callsCalGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".tracker-cal-day[data-date]");
  if (!btn) return;
  await selectCallsDay(btn.dataset.date);
});

$("#callsPrevMonth").addEventListener("click", async () => {
  state.callsMonth -= 1;
  if (state.callsMonth < 1) { state.callsMonth = 12; state.callsYear -= 1; }
  await loadCallsMonth();
  renderCallsCalendar();
});

$("#callsNextMonth").addEventListener("click", async () => {
  state.callsMonth += 1;
  if (state.callsMonth > 12) { state.callsMonth = 1; state.callsYear += 1; }
  await loadCallsMonth();
  renderCallsCalendar();
});

async function selectCallsDay(dateStr) {
  state.callsSelectedDate = dateStr;
  document.querySelectorAll("#callsCalGrid .tracker-cal-day[data-date]").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.date === dateStr);
  });
  const isToday = dateStr === todayStr();
  $("#callsSelectedDateLabel").textContent = isToday
    ? `Today, ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`
    : new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const qs = new URLSearchParams();
  const uid = callsUserIdParam();
  if (uid) qs.set("userId", uid);
  state.callsDayEntries = await api(`/api/calls/day/${dateStr}?${qs.toString()}`);
  renderCallsDay();
}

function renderCallsDay() {
  const entries = state.callsDayEntries;
  $("#callsStatCount").textContent = entries.length;
  $("#callsStatMinutes").textContent = entries.reduce((sum, c) => sum + (Number(c.durationMinutes) || 0), 0);

  const readOnly = isAdmin() && state.callsTargetUserId && state.callsTargetUserId !== state.currentUser.id;
  $("#callAddSection").classList.toggle("hidden", readOnly);

  const list = $("#callsList");
  const empty = $("#callsEmptyState");
  if (entries.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = entries.map((c) => {
    const time = new Date(c.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const canDelete = !readOnly && (isAdmin() || c.userId === state.currentUser.id);
    return `
      <div class="call-entry" data-id="${c.id}">
        <span class="call-entry-duration">${c.durationMinutes} min</span>
        <div class="call-entry-main">${c.note ? `<span class="call-entry-note">${escapeHtml(c.note)}</span>` : ""}</div>
        <span class="call-entry-time">${time}</span>
        ${canDelete ? `<button type="button" class="call-entry-delete" data-id="${c.id}">&times;</button>` : ""}
      </div>
    `;
  }).join("");
}

$("#callsList").addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".call-entry-delete");
  if (!delBtn) return;
  await api(`/api/calls/${delBtn.dataset.id}`, { method: "DELETE" });
  await selectCallsDay(state.callsSelectedDate);
  await loadCallsMonth();
  renderCallsCalendar();
});

$("#callAddBtn").addEventListener("click", async () => {
  const duration = Number($("#callDurationInput").value);
  if (!duration || duration <= 0) {
    $("#callAddStatus").textContent = "Enter a duration in minutes.";
    return;
  }
  $("#callAddStatus").textContent = "Saving...";
  try {
    await api("/api/calls", {
      method: "POST",
      body: JSON.stringify({
        date: state.callsSelectedDate,
        durationMinutes: duration,
        note: $("#callNoteInput").value.trim(),
      }),
    });
    $("#callDurationInput").value = "";
    $("#callNoteInput").value = "";
    $("#callAddStatus").textContent = "Added.";
    await selectCallsDay(state.callsSelectedDate);
    await loadCallsMonth();
    renderCallsCalendar();
  } catch (err) {
    $("#callAddStatus").textContent = err.message || "Failed to add call.";
  }
  setTimeout(() => { $("#callAddStatus").textContent = ""; }, 2000);
});

// ---------- Settings ----------

async function loadConfig() {
  state.config = await api("/api/config");
  $("#currencySymbol").value = state.config.currencySymbol || "";
  $("#emailEnabled").checked = !!state.config.email?.enabled;
  $("#smtpUser").value = state.config.email?.smtpUser || "";
  $("#smtpAppPassword").value = state.config.email?.smtpAppPassword || "";
}

function openSettingsModal() { $("#settingsModal").classList.remove("hidden"); }
function closeSettingsModal() {
  $("#settingsModal").classList.add("hidden");
  state.revealedPasswords = {}; // never leave revealed passwords sitting on screen
  if (state.users.length) renderUsers();
}

async function showSettings() {
  await loadConfig();
  await loadUsers();
  openSettingsModal();
}

$("#closeSettingsBtn").addEventListener("click", closeSettingsModal);
$("#settingsModal").addEventListener("click", (e) => {
  if (e.target.id === "settingsModal") closeSettingsModal();
});

$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const config = {
    currencySymbol: $("#currencySymbol").value || "",
    reminderTime: state.config.reminderTime || "09:00",
    email: {
      enabled: $("#emailEnabled").checked,
      smtpHost: state.config.email?.smtpHost || "smtp.gmail.com",
      smtpPort: state.config.email?.smtpPort || 587,
      smtpUser: $("#smtpUser").value,
      smtpAppPassword: $("#smtpAppPassword").value,
    },
  };
  await api("/api/config", { method: "PUT", body: JSON.stringify(config) });
  state.config = config;
  $("#settingsStatus").textContent = "Saved.";
  render();
  setTimeout(() => { $("#settingsStatus").textContent = ""; }, 2000);
});

// ---------- My Notifications (per-user prefs) ----------

async function loadNotifPrefs() {
  const notify = await api("/api/me/notifications");
  $("#notifEmailEnabled").checked = !!notify.email?.enabled;
  $("#notifEmailAddress").value = notify.email?.address || "";
  $("#notifWaEnabled").checked = !!notify.whatsapp?.enabled;
  $("#notifWaPhone").value = notify.whatsapp?.phone || "";
  $("#notifWaApiKey").value = notify.whatsapp?.apiKey || "";
  $("#notifPushEnabled").checked = !!notify.push?.enabled;
  $("#notifPushTopic").value = notify.push?.ntfyTopic || "";
}

function openNotifModal() { $("#notifModal").classList.remove("hidden"); }
function closeNotifModal() { $("#notifModal").classList.add("hidden"); }

$("#notifBtn").addEventListener("click", async () => {
  await loadNotifPrefs();
  $("#notifIntro").textContent = isAdmin()
    ? "Choose how you personally get reminded about upcoming cheques and your tasks."
    : "Choose how you personally get reminded about your tasks.";
  openNotifModal();
});
$("#closeNotifBtn").addEventListener("click", closeNotifModal);
$("#notifModal").addEventListener("click", (e) => {
  if (e.target.id === "notifModal") closeNotifModal();
});

$("#notifForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const notify = {
    email: { enabled: $("#notifEmailEnabled").checked, address: $("#notifEmailAddress").value },
    whatsapp: { enabled: $("#notifWaEnabled").checked, phone: $("#notifWaPhone").value, apiKey: $("#notifWaApiKey").value },
    push: { enabled: $("#notifPushEnabled").checked, ntfyTopic: $("#notifPushTopic").value },
  };
  await api("/api/me/notifications", { method: "PUT", body: JSON.stringify(notify) });
  $("#notifStatus").textContent = "Saved.";
  setTimeout(() => { $("#notifStatus").textContent = ""; }, 2000);
});

document.querySelectorAll(".test-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const channel = btn.dataset.channel;
    btn.textContent = "Sending...";
    try {
      await api("/api/me/notifications/test", { method: "POST", body: JSON.stringify({ channel }) });
      btn.textContent = "Sent! Check now";
    } catch (err) {
      btn.textContent = "Failed";
      $("#notifStatus").textContent = err.message || "Test failed.";
    }
    setTimeout(() => { btn.textContent = "Send test"; }, 2500);
  });
});

// ---------- Manage users ----------

async function loadUsers() {
  state.users = await api("/api/users");
  renderUsers();
}

// ---------- My account (everyone can see their own password) ----------

function resetAccountPassword() {
  $("#accountPw").classList.add("hidden");
  $("#accountPw").innerHTML = "";
  $("#accountPwBtn").textContent = "Show my password";
  $("#accountStatus").textContent = "";
}

function openAccountModal() {
  const user = state.currentUser;
  if (!user) return;
  $("#accountName").textContent = user.displayName || user.username;
  $("#accountRole").textContent = user.role === "admin" ? "Admin" : "Employee";
  $("#accountRole").className = `user-row-role ${user.role}`;
  $("#accountUsername").textContent = `@${user.username}`;
  $("#accountNote").classList.toggle("hidden", user.role !== "employee"); // admins can reset passwords themselves
  resetAccountPassword();
  $("#accountModal").classList.remove("hidden");
}

function closeAccountModal() {
  $("#accountModal").classList.add("hidden");
  resetAccountPassword(); // never leave the password sitting on screen
}

$("#userBadge").addEventListener("click", openAccountModal);
$("#userBadge").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAccountModal(); }
});
$("#closeAccountBtn").addEventListener("click", closeAccountModal);
$("#accountModal").addEventListener("click", (e) => {
  if (e.target.id === "accountModal") closeAccountModal();
});

$("#accountPwBtn").addEventListener("click", async () => {
  if (!$("#accountPw").classList.contains("hidden")) { resetAccountPassword(); return; }
  try {
    const result = await api(`/api/users/${state.currentUser.id}/password`);
    $("#accountPw").innerHTML = result.available
      ? `<span class="muted">Password</span><code>${escapeHtml(result.password)}</code><button type="button" id="accountCopyBtn">Copy</button>`
      : `<span class="muted">Not available right now - ask your admin to reset your password.</span>`;
    $("#accountPw").classList.remove("hidden");
    $("#accountPwBtn").textContent = "Hide password";
  } catch (err) {
    $("#accountStatus").textContent = err.message;
  }
});

$("#accountPw").addEventListener("click", async (e) => {
  if (e.target.id !== "accountCopyBtn") return;
  try {
    await navigator.clipboard.writeText($("#accountPw code").textContent);
    e.target.textContent = "Copied";
  } catch {
    e.target.textContent = "Select & copy";
  }
  setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
});

// Limits (also enforced by the server): 1 main admin (Shahid), 3 sub admins and 12 employees.
const MAX_SUB_ADMINS = 3;
const MAX_EMPLOYEES = 12;

function iAmMainAdmin() {
  return !!state.users.find((u) => u.id === state.currentUser.id)?.isMainAdmin;
}

function renderUsers() {
  const viewerIsMain = iAmMainAdmin();
  const mainCount = state.users.filter((u) => u.isMainAdmin).length;
  const subAdminCount = state.users.filter((u) => u.role === "admin" && !u.isMainAdmin).length;
  const employeeCount = state.users.filter((u) => u.role === "employee").length;
  $("#usersCounts").innerHTML =
    `<span>Main admin ${mainCount}/1</span>` +
    `<span class="${subAdminCount >= MAX_SUB_ADMINS ? "full" : ""}">Sub admins ${subAdminCount}/${MAX_SUB_ADMINS}</span>` +
    `<span class="${employeeCount >= MAX_EMPLOYEES ? "full" : ""}">Employees ${employeeCount}/${MAX_EMPLOYEES}</span>`;

  $("#usersList").innerHTML = state.users.map((u) => {
    const roleLabel = u.isMainAdmin ? "Main admin" : u.role === "admin" ? "Sub admin" : "Employee";
    const roleClass = u.isMainAdmin ? "main" : u.role;
    const lockedForMe = u.isMainAdmin && !viewerIsMain; // sub admins can't see or change the main admin's account
    const revealed = state.revealedPasswords[u.id];
    let pwLine = "";
    if (revealed) {
      pwLine = revealed.available
        ? `<div class="user-row-pw"><span class="muted">Password</span><code>${escapeHtml(revealed.password)}</code><button type="button" data-action="copy-pw">Copy</button></div>`
        : `<div class="user-row-pw"><span class="muted">Not available yet - it shows up after ${escapeHtml(u.displayName || u.username)} next signs in, or reset it.</span></div>`;
    }
    const actions = lockedForMe
      ? `<span class="hint" style="margin:0;">Only Shahid can manage this account</span>`
      : `<button type="button" data-action="toggle-pw">${revealed ? "Hide password" : "Show password"}</button>
         <button type="button" data-action="reset-pw">Reset password</button>
         ${u.isMainAdmin ? "" : '<button type="button" data-action="delete-user" class="danger">Delete</button>'}`;
    return `
    <div class="user-row" data-id="${u.id}">
      <div class="user-row-info">
        <span class="user-row-name">${escapeHtml(u.displayName || u.username)}</span>
        <span class="user-row-role ${roleClass}">${roleLabel}</span>
        <div class="hint" style="margin:2px 0 0;">@${escapeHtml(u.username)}${u.username === state.currentUser.username ? " (you)" : ""}</div>
      </div>
      <div class="user-row-actions">${actions}</div>
      ${pwLine}
    </div>`;
  }).join("");
}

$("#usersList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const row = e.target.closest(".user-row");
  const id = row.dataset.id;
  const user = state.users.find(u => u.id === id);
  $("#usersStatus").classList.add("hidden");

  if (btn.dataset.action === "toggle-pw") {
    if (state.revealedPasswords[id]) {
      delete state.revealedPasswords[id];
    } else {
      try {
        state.revealedPasswords[id] = await api(`/api/users/${id}/password`);
      } catch (err) {
        $("#usersStatus").textContent = err.message;
        $("#usersStatus").classList.remove("hidden");
        return;
      }
    }
    renderUsers();
  } else if (btn.dataset.action === "copy-pw") {
    try {
      await navigator.clipboard.writeText(state.revealedPasswords[id].password);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select & copy";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  } else if (btn.dataset.action === "delete-user") {
    if (!confirm(`Delete the login for ${user.username}?`)) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      await loadUsers();
    } catch (err) {
      $("#usersStatus").textContent = err.message;
      $("#usersStatus").classList.remove("hidden");
    }
  } else if (btn.dataset.action === "reset-pw") {
    const newPw = prompt(`New password for ${user.username}:`);
    if (!newPw) return;
    try {
      await api(`/api/users/${id}/password`, { method: "PUT", body: JSON.stringify({ password: newPw }) });
      delete state.revealedPasswords[id];
      await loadUsers();
      alert(`Password updated for ${user.username}.`);
    } catch (err) {
      $("#usersStatus").textContent = err.message;
      $("#usersStatus").classList.remove("hidden");
    }
  }
});

$("#addUserForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#usersStatus").classList.add("hidden");
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#newUsername").value.trim(),
        displayName: $("#newDisplayName").value.trim(),
        password: $("#newUserPassword").value,
        role: $("#newUserRole").value,
      }),
    });
    $("#addUserForm").reset();
    await loadUsers();
  } catch (err) {
    $("#usersStatus").textContent = err.message;
    $("#usersStatus").classList.remove("hidden");
  }
});
