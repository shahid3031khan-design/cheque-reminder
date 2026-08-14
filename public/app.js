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

// ---------- Auth / bootstrap ----------

function showLoginScreen() {
  state.currentUser = null;
  $("#loginScreen").classList.remove("hidden");
  $("#appRoot").classList.add("hidden");
  sessionExpiredHandled = false;
}

function showApp() {
  $("#loginScreen").classList.add("hidden");
  $("#appRoot").classList.remove("hidden");
}

function updateAddBtnVisibility() {
  const show = isAdmin() && state.currentView === "home";
  $(".nav-fab-slot").classList.toggle("hidden", !show);
  $("#addBtn").classList.toggle("hidden", !show);
}

function applyRoleUI() {
  const admin = isAdmin();
  $("#userBadge").innerHTML = `${ICONS.user}${escapeHtml(state.currentUser.displayName || state.currentUser.username)} · <span class="role-${state.currentUser.role}">${state.currentUser.role}</span>`;
  $("#settingsBtn").classList.toggle("hidden", !admin);
  updateAddBtnVisibility();
  $("#navRightIcon").innerHTML = admin ? ICONS.settings : ICONS.power;
  $("#navRightLabel").textContent = admin ? "Settings" : "Logout";
  $("#emptyHint").textContent = admin ? "Tap the + button below to add one." : "Nothing to show right now.";
}

function switchView(view) {
  state.currentView = view;
  $("#homeView").classList.toggle("hidden", view !== "home");
  $("#trackerView").classList.toggle("hidden", view !== "tracker");
  $("#pageTitle").classList.toggle("hidden", view !== "home");
  updateAddBtnVisibility();
  document.querySelectorAll(".nav-item[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === view);
  });
  if (view === "tracker") openTrackerView();
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

$("#addBtn").addEventListener("click", openAddModal);
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
    const hasEntry = !!(entry && (entry.plan || entry.remarks || entry.rating));
    const classes = ["tracker-cal-day"];
    if (dateStr === today) classes.push("is-today");
    if (dateStr === state.trackerSelectedDate) classes.push("is-selected");
    if (entry && entry.rating) classes.push(`rating-${entry.rating}`);
    cells += `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${hasEntry ? '<span class="entry-dot"></span>' : ""}</button>`;
  }
  $("#trackerCalGrid").innerHTML = cells;
}

$("#trackerCalGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".tracker-cal-day[data-date]");
  if (!btn) return;
  await selectTrackerDay(btn.dataset.date);
});

$("#trackerPrevMonth").addEventListener("click", async () => {
  state.trackerMonth -= 1;
  if (state.trackerMonth < 1) { state.trackerMonth = 12; state.trackerYear -= 1; }
  await loadTrackerMonthEntries();
  renderTrackerCalendar();
});

$("#trackerNextMonth").addEventListener("click", async () => {
  state.trackerMonth += 1;
  if (state.trackerMonth > 12) { state.trackerMonth = 1; state.trackerYear += 1; }
  await loadTrackerMonthEntries();
  renderTrackerCalendar();
});

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

  const readOnly = !isViewingOwnTracker();
  $("#trackerPlanInput").value = entry.plan || "";
  $("#trackerPlanInput").disabled = readOnly;
  $("#trackerRemarksInput").value = entry.remarks || "";
  $("#trackerRemarksInput").disabled = readOnly;
  $("#trackerSavePlanBtn").classList.toggle("hidden", readOnly);
  $("#trackerSaveRemarksBtn").classList.toggle("hidden", readOnly);
  $("#trackerPlanStatus").textContent = "";
  $("#trackerRemarksStatus").textContent = "";
  renderTrackerRatingStars(entry.rating, readOnly);
}

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
  $("#trackerPlanStatus").textContent = "Saving...";
  try {
    const entry = await api(`/api/tracker/entries/${dateStr}`, { method: "PUT", body: JSON.stringify({ plan: $("#trackerPlanInput").value }) });
    state.trackerCurrentEntry = entry;
    $("#trackerPlanStatus").textContent = "Saved.";
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
  } catch (err) {
    $("#trackerPlanStatus").textContent = err.message;
  }
  setTimeout(() => { $("#trackerPlanStatus").textContent = ""; }, 2000);
});

$("#trackerSaveRemarksBtn").addEventListener("click", async () => {
  const dateStr = state.trackerSelectedDate;
  const rating = state.trackerPendingRating !== null ? state.trackerPendingRating : (state.trackerCurrentEntry?.rating ?? null);
  $("#trackerRemarksStatus").textContent = "Saving...";
  try {
    const entry = await api(`/api/tracker/entries/${dateStr}`, { method: "PUT", body: JSON.stringify({ remarks: $("#trackerRemarksInput").value, rating }) });
    state.trackerCurrentEntry = entry;
    state.trackerPendingRating = null;
    $("#trackerRemarksStatus").textContent = "Saved.";
    await loadTrackerMonthEntries();
    renderTrackerCalendar();
  } catch (err) {
    $("#trackerRemarksStatus").textContent = err.message;
  }
  setTimeout(() => { $("#trackerRemarksStatus").textContent = ""; }, 2000);
});

// ---------- Settings ----------

async function loadConfig() {
  state.config = await api("/api/config");
  $("#currencySymbol").value = state.config.currencySymbol || "";
  $("#emailEnabled").checked = !!state.config.email?.enabled;
  $("#smtpUser").value = state.config.email?.smtpUser || "";
  $("#smtpAppPassword").value = state.config.email?.smtpAppPassword || "";
  $("#emailTo").value = state.config.email?.to || "";
  $("#whatsappEnabled").checked = !!state.config.whatsapp?.enabled;
  $("#waPhone").value = state.config.whatsapp?.phone || "";
  $("#waApiKey").value = state.config.whatsapp?.apiKey || "";
  $("#pushEnabled").checked = !!state.config.push?.enabled;
  $("#ntfyTopic").value = state.config.push?.ntfyTopic || "";
}

function openSettingsModal() { $("#settingsModal").classList.remove("hidden"); }
function closeSettingsModal() { $("#settingsModal").classList.add("hidden"); }

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
      to: $("#emailTo").value,
    },
    whatsapp: {
      enabled: $("#whatsappEnabled").checked,
      phone: $("#waPhone").value,
      apiKey: $("#waApiKey").value,
    },
    push: {
      enabled: $("#pushEnabled").checked,
      ntfyTopic: $("#ntfyTopic").value,
    },
  };
  await api("/api/config", { method: "PUT", body: JSON.stringify(config) });
  state.config = config;
  $("#settingsStatus").textContent = "Saved.";
  render();
  setTimeout(() => { $("#settingsStatus").textContent = ""; }, 2000);
});

document.querySelectorAll(".test-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    btn.textContent = "Sending...";
    try {
      await api("/api/test-reminder", { method: "POST" });
      btn.textContent = "Sent! Check now";
    } catch {
      btn.textContent = "Failed";
    }
    setTimeout(() => { btn.textContent = "Send test"; }, 2500);
  });
});

// ---------- Manage users ----------

async function loadUsers() {
  state.users = await api("/api/users");
  renderUsers();
}

function renderUsers() {
  $("#usersList").innerHTML = state.users.map(u => `
    <div class="user-row" data-id="${u.id}">
      <div class="user-row-info">
        <span class="user-row-name">${escapeHtml(u.displayName || u.username)}</span>
        <span class="user-row-role ${u.role}">${u.role}</span>
        <div class="hint" style="margin:2px 0 0;">@${escapeHtml(u.username)}${u.username === state.currentUser.username ? " (you)" : ""}</div>
      </div>
      <div class="user-row-actions">
        <button type="button" data-action="reset-pw">Reset password</button>
        <button type="button" data-action="delete-user" class="danger">Delete</button>
      </div>
    </div>
  `).join("");
}

$("#usersList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const row = e.target.closest(".user-row");
  const id = row.dataset.id;
  const user = state.users.find(u => u.id === id);
  $("#usersStatus").classList.add("hidden");

  if (btn.dataset.action === "delete-user") {
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
