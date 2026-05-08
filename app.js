const state = {
  user: null,
  data: null,
  tab: "dashboard"
};

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function product(id) {
  return state.data.products.find((p) => p.id === id) || { id, name: id, department: "", unit: "kg", price: 0 };
}

function unitOf(productId) {
  return product(productId).unit || "kg";
}

function stepOf(productId) {
  return unitOf(productId) === "pcs" ? "1" : "0.01";
}

function inputModeOf(productId) {
  return unitOf(productId) === "pcs" ? "numeric" : "decimal";
}

function qtyUnit(amount, productId) {
  return `${qty(amount)} ${unitOf(productId)}`;
}

function outlet(id) {
  return state.data.outlets.find((o) => o.id === id) || { id, name: id };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

function today() {
  return localDate(new Date());
}

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function photoInput(labelText = "Upload handwritten note / challan photo") {
  return `
    <label>${labelText}
      <input type="file" accept="image/*" capture="environment" data-photo-input>
    </label>
    <img class="photo-preview" data-photo-preview alt="Uploaded note preview">
  `;
}

function wirePhoto(root) {
  const input = root.querySelector("[data-photo-input]");
  const preview = root.querySelector("[data-photo-preview]");
  if (!input) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      input.dataset.photo = reader.result;
      if (preview) {
        preview.src = reader.result;
        preview.style.display = "block";
      }
    };
    reader.readAsDataURL(file);
  });
}

function notificationItems() {
  if (!state.data) return [];
  const items = [];
  const pendingDemands = state.data.demands.filter((d) => d.status === "pending");
  const pendingDispatches = state.data.dispatches.filter((d) => d.status === "pending_verification");
  if (state.user?.role !== "outlet") {
    pendingDemands.slice(0, 8).forEach((d) => items.push({
      title: `New demand ${d.challanNo}`,
      text: `${outlet(d.outletId).name} requested ${d.items.length} SKU${d.items.length === 1 ? "" : "s"}`
    }));
  }
  if (state.user?.role !== "factory") {
    pendingDispatches.slice(0, 8).forEach((d) => items.push({
      title: `Dispatch waiting ${d.challanNo}`,
      text: `${outlet(d.outletId).name} has ${d.items.length} item${d.items.length === 1 ? "" : "s"} to verify`
    }));
  }
  return items;
}

function buildShell() {
  const role = state.user.role;
  const tabs = [
    ["dashboard", "Dashboard"],
    ...(role !== "factory" ? [["demand", "Raise Challan"]] : []),
    ...(role !== "factory" ? [["bulk", "Bulk Sheet"]] : []),
    ...(role !== "outlet" ? [["dispatch", "Create Dispatch"]] : []),
    ...(role !== "factory" ? [["verify", "Receive"]] : []),
    ["logs", "Logs"],
    ...(role === "admin" ? [["reports", "Reports"], ["skus", "SKUs"], ["outlets", "Outlets"], ["settings", "Settings"], ["admin", "Admin"]] : [])
  ];
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">M</div>
          <div>
            <h1>Mithai Dispatch</h1>
            <p>${state.user.name} · ${state.user.role}</p>
          </div>
        </div>
        <div class="user-chip">
          <button class="ghost no-print" data-notifications>Alerts <span class="badge warn">${notificationItems().length}</span></button>
          <span class="badge">${state.user.username}</span>
          <button class="ghost no-print" data-logout>Logout</button>
        </div>
      </header>
      <div class="notify-panel hide no-print" data-notify-panel>
        <div class="section-head"><h3>Notifications</h3><button class="ghost" data-close-notify>Close</button></div>
        ${notificationItems().length ? notificationItems().map((n) => `<div class="notify-item"><strong>${n.title}</strong><p class="muted">${n.text}</p></div>`).join("") : `<p class="muted">No pending alerts.</p>`}
      </div>
      <div class="layout">
        <nav class="tabs no-print">
          ${tabs.map(([id, name]) => `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}">${name}</button>`).join("")}
        </nav>
        <section class="content" id="view"></section>
      </div>
    </div>
  `;
  app.querySelector("[data-logout]").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
    state.user = null;
    renderLogin();
  });
  app.querySelector("[data-notifications]").addEventListener("click", () => app.querySelector("[data-notify-panel]").classList.toggle("hide"));
  app.querySelector("[data-close-notify]").addEventListener("click", () => app.querySelector("[data-notify-panel]").classList.add("hide"));
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderView();
    });
  });
  renderView();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login">
        <div class="brand-mark">M</div>
        <h1>Mithai Dispatch</h1>
        <p class="muted">Secure internal dispatch, receiving, returns, and admin reports.</p>
        <div class="stack" style="margin-top:18px">
          <label>Username <input name="username" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn" type="submit">Login</button>
          <div class="notice">Use the username and password issued by the admin.</div>
        </div>
      </form>
    </div>
  `;
  app.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const session = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      state.user = session.user;
      await load();
    } catch (error) {
      toast(error.message);
    }
  });
}

async function load() {
  try {
    state.data = await api("/api/bootstrap");
    state.user = state.data.user;
    buildShell();
  } catch {
    renderLogin();
  }
}

function kpi(label, value, tone = "") {
  return `<div class="panel kpi"><span class="muted">${label}</span><strong class="${tone}">${value}</strong></div>`;
}

function renderDashboard(view) {
  const todayDispatches = state.data.dispatches.filter((d) => localDate(d.createdAt) === today());
  const pendingVerifications = state.data.dispatches.filter((d) => d.status === "pending_verification");
  const pendingDemands = state.data.demands.filter((d) => d.status === "pending");
  const sent = todayDispatches.reduce((sum, d) => sum + d.totals.sentQty, 0);
  view.innerHTML = `
    <div class="section-head">
      <div><h2>Today</h2><p class="muted">Live view of demand, dispatch, receiving, and returns.</p></div>
      <button class="ghost no-print" data-refresh>Refresh</button>
    </div>
    <div class="grid">
      <div class="span-3">${kpi("Dispatch count", todayDispatches.length)}</div>
      <div class="span-3">${kpi("Pending verification", pendingVerifications.length, pendingVerifications.length ? "bad" : "")}</div>
      <div class="span-3">${kpi("Total sent", `${qty(sent)} units`)}</div>
      <div class="span-3">${kpi("Open demands", pendingDemands.length, pendingDemands.length ? "warn" : "")}</div>
      <div class="span-6 panel">
        <div class="section-head"><h3>Latest Demands</h3><span class="badge warn">${pendingDemands.length} pending</span></div>
        ${miniDemandList(pendingDemands.slice(0, 6))}
      </div>
      <div class="span-6 panel">
        <div class="section-head"><h3>Incoming Dispatches</h3><span class="badge">${pendingVerifications.length} waiting</span></div>
        ${miniDispatchList(pendingVerifications.slice(0, 6))}
      </div>
    </div>
  `;
  view.querySelector("[data-refresh]").addEventListener("click", async () => { await load(); toast("Updated"); });
}

function miniDemandList(rows) {
  if (!rows.length) return `<p class="muted">No open challan demand.</p>`;
  return `<div class="stack">${rows.map((d) => `
    <div>
      <strong>${d.challanNo}</strong> <span class="muted">${outlet(d.outletId).name}${d.mode === "bulk" ? " · bulk sheet" : ""}</span><br>
      <span class="muted">${d.items.map((i) => `${esc(product(i.productId).name)} ${qtyUnit(i.qty, i.productId)}${i.currentStock != null ? ` · stock ${qtyUnit(i.currentStock, i.productId)}` : ""}${i.lowStock ? " · low" : ""}`).join(", ")}</span>
    </div>
  `).join("")}</div>`;
}

function miniDispatchList(rows) {
  if (!rows.length) return `<p class="muted">No dispatch waiting for outlet verification.</p>`;
  return `<div class="stack">${rows.map((d) => `
    <div>
      <strong>${d.challanNo}</strong> <span class="muted">${outlet(d.outletId).name}</span><br>
      <span class="muted">${d.items.map((i) => `${product(i.productId).name} ${qtyUnit(i.qty, i.productId)}`).join(", ")}</span>
    </div>
  `).join("")}</div>`;
}

function itemRowsHtml(prefix = "") {
  return `
    <div class="stack" data-lines></div>
    <div class="actions">
      <button class="ghost" type="button" data-add-line>${prefix}Add product</button>
    </div>
  `;
}

function fillLine(line, selected = {}) {
  const deptSelect = line.querySelector(".department-select");
  const productSelect = line.querySelector(".product-select");
  deptSelect.innerHTML = `<option value="">Department</option>${state.data.departments.map((d) => `<option value="${d}">${d}</option>`).join("")}`;
  deptSelect.value = selected.department || "";
  function refreshProducts() {
    const dept = deptSelect.value;
    const products = state.data.products.filter((p) => !dept || p.department === dept);
    productSelect.innerHTML = `<option value="">Product</option>${products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}`;
    if (selected.productId && products.some((p) => p.id === selected.productId)) productSelect.value = selected.productId;
  }
  deptSelect.addEventListener("change", refreshProducts);
  productSelect.addEventListener("change", () => {
    const p = product(productSelect.value);
    if (p.department) deptSelect.value = p.department;
    line.querySelector(".qty-input").step = stepOf(productSelect.value);
    line.querySelector(".qty-input").inputMode = inputModeOf(productSelect.value);
    line.querySelector(".qty-input").placeholder = `Qty ${unitOf(productSelect.value)}`;
  });
  line.querySelector(".qty-input").value = selected.qty || "";
  line.querySelector(".qty-input").step = stepOf(selected.productId);
  line.querySelector(".qty-input").inputMode = inputModeOf(selected.productId);
  line.querySelector(".qty-input").placeholder = `Qty ${unitOf(selected.productId)}`;
  line.querySelector(".remove-line").addEventListener("click", () => line.remove());
  refreshProducts();
}

function addLine(root, selected = {}) {
  const template = document.querySelector("#line-item-template").content.cloneNode(true);
  const line = template.querySelector(".line-item");
  fillLine(line, selected);
  root.querySelector("[data-lines]").append(line);
}

function collectItems(root) {
  return [...root.querySelectorAll(".line-item")].map((line) => ({
    productId: line.querySelector(".product-select").value,
    qty: Number(line.querySelector(".qty-input").value)
  })).filter((item) => item.productId && item.qty > 0);
}

function wireLineEditor(root) {
  root.querySelector("[data-add-line]").addEventListener("click", () => addLine(root));
  if (!root.querySelector(".line-item")) addLine(root);
}

function outletOptions(selected = "") {
  return state.data.outlets.map((o) => `<option value="${o.id}" ${o.id === selected ? "selected" : ""}>${o.name}</option>`).join("");
}

function renderDemand(view) {
  const pending = state.data.demands.filter((d) => d.status === "pending");
  view.innerHTML = `
    <div class="requirement-hero">
      <div>
        <h2>Raise Challan</h2>
        <p>Select department, choose SKU, enter required quantity, then submit.</p>
      </div>
      <button class="ghost no-print" type="button" data-window-print>Print</button>
    </div>
    <div class="grid">
      <div class="span-5 panel">
        <div class="section-head"><h3>Pending Challans</h3><span class="badge warn">${pending.length} pending</span></div>
        ${miniDemandList(pending.slice(0, 12))}
      </div>
      <form class="span-7 panel stack" data-demand-form>
        <h3>Requirement Entry</h3>
        ${state.user.role === "admin" ? `<label>Outlet <select name="outletId">${outletOptions()}</select></label>` : ""}
        <div class="quick-entry">
          <label>Department
            <select data-demand-dept>
              <option value="">Select department</option>
              ${state.data.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}
            </select>
          </label>
          <label>SKU
            <select data-demand-sku>
              <option value="">Select SKU</option>
            </select>
          </label>
          <label data-demand-qty-label>Required quantity
            <input data-demand-qty type="number" min="0" step="0.01" inputmode="decimal" placeholder="Qty">
          </label>
          <button class="btn" type="button" data-add-demand-item>Add</button>
        </div>
        <div class="table-wrap">
          <table class="requirement-table">
            <thead><tr><th>Department</th><th>SKU</th><th>Required</th><th class="no-print">Action</th></tr></thead>
            <tbody data-demand-items><tr><td colspan="4">No items added.</td></tr></tbody>
          </table>
        </div>
        <label>Note <textarea name="note" placeholder="Urgent timing, quality preference, or vehicle note"></textarea></label>
        ${photoInput()}
        <div class="actions">
          <button class="btn" type="submit">Submit Challan</button>
          <span class="muted" data-demand-count>0 items selected</span>
        </div>
      </form>
    </div>
  `;
  const form = view.querySelector("[data-demand-form]");
  view.querySelector("[data-window-print]").addEventListener("click", () => window.print());
  wirePhoto(form);
  const selected = new Map();
  const dept = form.querySelector("[data-demand-dept]");
  const sku = form.querySelector("[data-demand-sku]");
  const qtyInput = form.querySelector("[data-demand-qty]");
  const qtyLabel = form.querySelector("[data-demand-qty-label]");
  const tbody = form.querySelector("[data-demand-items]");
  const count = form.querySelector("[data-demand-count]");
  const refreshSkus = () => {
    const products = state.data.products.filter((p) => p.department === dept.value);
    sku.innerHTML = `<option value="">Select SKU</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}`;
  };
  const renderSelected = () => {
    const rows = [...selected.values()];
    count.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"} selected`;
    tbody.innerHTML = rows.length ? rows.map((item) => {
      const p = product(item.productId);
      return `
        <tr data-selected-product="${item.productId}">
          <td>${esc(p.department)}</td>
          <td><strong>${esc(p.name)}</strong></td>
          <td><input name="selectedQty" type="number" min="0" step="${stepOf(item.productId)}" inputmode="${inputModeOf(item.productId)}" value="${item.qty}"> <span class="muted">${unitOf(item.productId)}</span></td>
          <td class="no-print"><button class="ghost" type="button" data-remove-selected>Remove</button></td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="4">No items added.</td></tr>`;
  };
  dept.addEventListener("input", refreshSkus);
  sku.addEventListener("input", () => {
    const unit = unitOf(sku.value);
    qtyInput.step = stepOf(sku.value);
    qtyInput.inputMode = inputModeOf(sku.value);
    qtyInput.placeholder = unit;
    qtyLabel.firstChild.textContent = `Required ${unit}`;
  });
  form.querySelector("[data-add-demand-item]").addEventListener("click", () => {
    const productId = sku.value;
    const amount = Number(qtyInput.value);
    if (!productId || !(amount > 0)) {
      toast("Select SKU and enter required quantity");
      return;
    }
    if (unitOf(productId) === "pcs" && !Number.isInteger(amount)) {
      toast("Piece SKUs must use whole numbers");
      return;
    }
    selected.set(productId, { productId, qty: amount });
    qtyInput.value = "";
    renderSelected();
  });
  tbody.addEventListener("input", (event) => {
    const input = event.target.closest("[name=selectedQty]");
    if (!input) return;
    const row = input.closest("[data-selected-product]");
    const item = selected.get(row.dataset.selectedProduct);
    if (item) item.qty = Number(input.value);
  });
  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-selected]");
    if (!button) return;
    selected.delete(button.closest("[data-selected-product]").dataset.selectedProduct);
    renderSelected();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const items = [...selected.values()].filter((item) => item.qty > 0);
      const body = {
        outletId: form.outletId?.value,
        items,
        note: form.note.value,
        photo: form.querySelector("[data-photo-input]")?.dataset.photo || null
      };
      await api("/api/demands", { method: "POST", body: JSON.stringify(body) });
      toast("Challan demand sent to factory");
      state.tab = "dashboard";
      await load();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderBulk(view) {
  const outletControl = state.user.role === "admin" ? `<label class="span-4">Outlet <select name="outletId">${outletOptions()}</select></label>` : "";
  view.innerHTML = `
    <div class="section-head">
      <div><h2>Bulk Order Sheet</h2><p class="muted">Use this for night or rush paper-style entry. Fill only required quantities; blank rows are ignored.</p></div>
      <button class="ghost no-print" data-clear-bulk>Clear Sheet</button>
    </div>
    <form class="panel stack" data-bulk-form>
      <div class="grid no-print">
        ${outletControl}
        <label class="span-4">Department <select data-bulk-dept><option value="">All departments</option>${state.data.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select></label>
        <label class="span-4">Search SKU <input data-bulk-search placeholder="Search product"></label>
      </div>
      <div class="notice">Fill current stock when available, tick low stock for urgent items, and enter required quantity. Blank required rows are ignored.</div>
      <div class="bulk-wrap">
        <table class="bulk-table">
          <thead><tr><th>Department</th><th>SKU</th><th>Unit</th><th>Current stock</th><th>Low</th><th>Required</th></tr></thead>
          <tbody data-bulk-rows></tbody>
        </table>
      </div>
      <label>Sheet note <textarea name="note" placeholder="Night count, urgent items, vehicle timing"></textarea></label>
      ${photoInput("Upload paper sheet photo")}
      <div class="actions">
        <button class="btn" type="submit">Submit Bulk Challan</button>
        <span class="muted" data-bulk-count>0 items selected</span>
      </div>
    </form>
  `;
  const form = view.querySelector("[data-bulk-form]");
  wirePhoto(form);
  const dept = view.querySelector("[data-bulk-dept]");
  const search = view.querySelector("[data-bulk-search]");
  const rows = view.querySelector("[data-bulk-rows]");
  const count = view.querySelector("[data-bulk-count]");
  const renderRows = () => {
    const deptValue = dept.value;
    const term = search.value.trim().toLowerCase();
    const products = state.data.products.filter((p) => (!deptValue || p.department === deptValue) && (!term || p.name.toLowerCase().includes(term)));
    rows.innerHTML = products.map((p) => `
      <tr data-bulk-product="${p.id}">
        <td>${esc(p.department)}</td>
        <td><strong>${esc(p.name)}</strong></td>
        <td><span class="badge">${p.unit || "kg"}</span></td>
        <td><input name="currentStock" type="number" min="0" step="${stepOf(p.id)}" inputmode="${inputModeOf(p.id)}" placeholder="Stock"></td>
        <td class="right"><input name="lowStock" type="checkbox" aria-label="Low stock for ${esc(p.name)}"></td>
        <td><input name="requiredQty" type="number" min="0" step="${stepOf(p.id)}" inputmode="${inputModeOf(p.id)}" placeholder="Order"></td>
      </tr>
    `).join("");
    updateCount();
  };
  const updateCount = () => {
    const selected = [...rows.querySelectorAll("[name=requiredQty]")].filter((input) => Number(input.value) > 0).length;
    count.textContent = `${selected} item${selected === 1 ? "" : "s"} selected`;
  };
  dept.addEventListener("input", renderRows);
  search.addEventListener("input", renderRows);
  rows.addEventListener("input", updateCount);
  view.querySelector("[data-clear-bulk]").addEventListener("click", () => {
    form.reset();
    renderRows();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const items = [...rows.querySelectorAll("[data-bulk-product]")].map((row) => ({
      productId: row.dataset.bulkProduct,
      qty: Number(row.querySelector("[name=requiredQty]").value),
      currentStock: row.querySelector("[name=currentStock]").value === "" ? null : Number(row.querySelector("[name=currentStock]").value),
      lowStock: row.querySelector("[name=lowStock]").checked
    })).filter((item) => item.qty > 0);
    if (items.some((item) => unitOf(item.productId) === "pcs" && (!Number.isInteger(item.qty) || (item.currentStock != null && !Number.isInteger(item.currentStock))))) {
      toast("Piece SKUs must use whole numbers for required and current stock");
      return;
    }
    try {
      await api("/api/demands", {
        method: "POST",
        body: JSON.stringify({
          mode: "bulk",
          outletId: form.outletId?.value,
          items,
          note: form.note.value,
          photo: form.querySelector("[data-photo-input]")?.dataset.photo || null
        })
      });
      toast("Bulk challan sent to factory");
      state.tab = "dashboard";
      await load();
    } catch (error) {
      toast(error.message);
    }
  });
  renderRows();
}

function demandSelectOptions() {
  const open = state.data.demands.filter((d) => d.status === "pending");
  return `<option value="">Dispatch without demand</option>${open.map((d) => `<option value="${d.id}">${d.challanNo} · ${outlet(d.outletId).name}</option>`).join("")}`;
}

function renderDispatch(view) {
  view.innerHTML = `
    <div class="section-head"><div><h2>Create Dispatch</h2><p class="muted">Dispatch can be against a demand or sent directly during rush.</p></div></div>
    <form class="panel stack" data-dispatch-form>
      <div class="grid">
        <label class="span-6">Demand <select name="demandId">${demandSelectOptions()}</select></label>
        <label class="span-6">Outlet <select name="outletId">${outletOptions()}</select></label>
      </div>
      <div class="notice" data-demand-hint>Negative stock is warning-only because production stock entry is disabled. Dispatch more than demand will show as extra against demand.</div>
      <div data-demand-details></div>
      ${itemRowsHtml()}
      <label>Dispatch note <textarea name="note" placeholder="Vehicle, timing, manual note reference"></textarea></label>
      ${photoInput("Upload dispatch/challan photo")}
      <div class="actions"><button class="btn" type="submit">Save Dispatch</button></div>
    </form>
  `;
  const form = view.querySelector("[data-dispatch-form]");
  wireLineEditor(form);
  wirePhoto(form);
  form.demandId.addEventListener("change", () => {
    const demand = state.data.demands.find((d) => d.id === form.demandId.value);
    const details = form.querySelector("[data-demand-details]");
    if (!demand) {
      details.innerHTML = "";
      return;
    }
    form.outletId.value = demand.outletId;
    details.innerHTML = `
      <div class="notice">
        ${demand.mode === "bulk" ? "Bulk sheet demand" : "Manual demand"}: ${demand.items.map((item) => `${esc(product(item.productId).name)} required ${qtyUnit(item.qty, item.productId)}${item.currentStock != null ? `, current ${qtyUnit(item.currentStock, item.productId)}` : ""}${item.lowStock ? ", marked low" : ""}${item.lineNote ? `, ${esc(item.lineNote)}` : ""}`).join(" | ")}
      </div>
    `;
    form.querySelector("[data-lines]").innerHTML = "";
    demand.items.forEach((item) => addLine(form, { productId: item.productId, department: product(item.productId).department, qty: item.qty }));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const body = {
        demandId: form.demandId.value || null,
        outletId: form.outletId.value,
        items: collectItems(form),
        note: form.note.value,
        photo: form.querySelector("[data-photo-input]")?.dataset.photo || null
      };
      await api("/api/dispatches", { method: "POST", body: JSON.stringify(body) });
      toast("Dispatch saved and sent to outlet");
      state.tab = "logs";
      await load();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderVerify(view) {
  const rows = state.data.dispatches.filter((d) => d.status === "pending_verification");
  view.innerHTML = `
    <div class="section-head"><div><h2>Receive Verification</h2><p class="muted">Confirm received quantity and record damaged, quality return, or excess stock return.</p></div></div>
    <div class="stack">
      ${rows.length ? rows.map(verifyCard).join("") : `<div class="panel"><p class="muted">No dispatch waiting for verification.</p></div>`}
    </div>
  `;
  view.querySelectorAll("[data-verify-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const items = [...form.querySelectorAll("[data-product-id]")].map((line) => ({
        productId: line.dataset.productId,
        receivedQty: Number(line.querySelector("[name=receivedQty]").value),
        damagedQty: Number(line.querySelector("[name=damagedQty]").value),
        excessReturnQty: Number(line.querySelector("[name=excessReturnQty]").value),
        returnReason: line.querySelector("[name=returnReason]").value
      }));
      try {
        await api(`/api/dispatches/${form.dataset.verifyForm}/verify`, { method: "POST", body: JSON.stringify({ items }) });
        toast("Receiving verified");
        await load();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  view.querySelectorAll("[data-print-challan]").forEach((button) => button.addEventListener("click", () => printChallan(button.dataset.printChallan)));
}

function verifyCard(d) {
  return `
    <form class="panel stack" data-verify-form="${d.id}">
      <div class="section-head">
        <div><h3>${d.challanNo} · ${outlet(d.outletId).name}</h3><p class="muted">${new Date(d.createdAt).toLocaleString()}</p></div>
        <button class="ghost no-print" type="button" data-print-challan="${d.id}">Print Challan</button>
      </div>
      ${d.photo ? `<img src="${d.photo}" class="photo-preview" style="display:block" alt="Dispatch note">` : ""}
      ${d.items.map((item) => {
        const p = product(item.productId);
        return `
          <div class="verify-line" data-product-id="${item.productId}">
            <div class="full"><strong>${p.name}</strong><br><span class="muted">${p.department} · Sent ${qtyUnit(item.qty, item.productId)}${item.requestedQty != null ? ` · Demand ${qtyUnit(item.requestedQty, item.productId)}` : ""}</span></div>
            <label>Received ${unitOf(item.productId)}<input name="receivedQty" type="number" min="0" step="${stepOf(item.productId)}" inputmode="${inputModeOf(item.productId)}" value="${item.qty}"></label>
            <label>Damaged ${unitOf(item.productId)}<input name="damagedQty" type="number" min="0" step="${stepOf(item.productId)}" inputmode="${inputModeOf(item.productId)}" value="0"></label>
            <label>Excess return ${unitOf(item.productId)}<input name="excessReturnQty" type="number" min="0" step="${stepOf(item.productId)}" inputmode="${inputModeOf(item.productId)}" value="0"></label>
            <label>Reason <input name="returnReason" placeholder="Damage, low quality, excess"></label>
          </div>
        `;
      }).join("")}
      <div class="actions"><button class="btn" type="submit">Confirm Receiving</button></div>
    </form>
  `;
}

function renderLogs(view) {
  const rows = [...state.data.dispatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  view.innerHTML = `
    <div class="section-head"><div><h2>Dispatch Logs</h2><p class="muted">Date range filter works across dispatch and receiving records.</p></div></div>
    <div class="panel stack">
      <div class="grid no-print">
        <label class="span-4">From <input type="date" data-from></label>
        <label class="span-4">To <input type="date" data-to></label>
        <label class="span-4">Outlet <select data-outlet><option value="">All outlets</option>${outletOptions()}</select></label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Challan</th><th>Date</th><th>Outlet</th><th>Status</th><th>Items</th><th>Sent</th><th>Sold after returns</th><th class="no-print">Action</th></tr></thead>
        <tbody data-log-rows>${logRows(rows)}</tbody>
      </table></div>
    </div>
  `;
  const renderFiltered = () => {
    const from = view.querySelector("[data-from]").value || "0000-01-01";
    const to = view.querySelector("[data-to]").value || "9999-12-31";
    const oid = view.querySelector("[data-outlet]").value;
    const filtered = rows.filter((d) => localDate(d.createdAt) >= from && localDate(d.createdAt) <= to && (!oid || d.outletId === oid));
    view.querySelector("[data-log-rows]").innerHTML = logRows(filtered);
  };
  view.querySelectorAll("[data-from], [data-to], [data-outlet]").forEach((el) => el.addEventListener("input", renderFiltered));
  view.addEventListener("click", (event) => {
    const button = event.target.closest("[data-print-challan]");
    if (button) printChallan(button.dataset.printChallan);
  });
}

function logRows(rows) {
  if (!rows.length) return `<tr><td colspan="8">No records found.</td></tr>`;
  return rows.map((d) => `
    <tr>
      <td><strong>${d.challanNo}</strong></td>
      <td>${localDate(d.createdAt)}</td>
      <td>${outlet(d.outletId).name}</td>
      <td><span class="badge ${d.status === "verified" ? "good" : "warn"}">${d.status.replace("_", " ")}</span></td>
      <td>${d.items.map((i) => `${product(i.productId).name}: ${qtyUnit(i.qty, i.productId)}`).join("<br>")}</td>
      <td>${qty(d.totals.sentQty)} units</td>
      <td>${d.status === "verified" ? `${qty(d.totals.soldQty)} units` : "-"}</td>
      <td class="no-print"><button class="ghost" data-print-challan="${d.id}">Print</button></td>
    </tr>
  `).join("");
}

async function renderReports(view) {
  const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const to = today();
  view.innerHTML = `
    <div class="section-head"><div><h2>Admin Reports</h2><p class="muted">Verified dispatch is treated as sale; damaged, low quality, and excess returns are deducted.</p></div></div>
    <div class="panel stack">
      <div class="grid no-print">
        <label class="span-5">From <input type="date" data-report-from value="${from}"></label>
        <label class="span-5">To <input type="date" data-report-to value="${to}"></label>
        <div class="span-2" style="align-self:end"><button class="btn" data-run-report>Run</button></div>
      </div>
      <div class="actions no-print">
        <button class="ghost" data-export="dispatches" type="button">Export Challans CSV</button>
        <button class="ghost" data-export="shortages" type="button">Export Shortages CSV</button>
        <button class="ghost" data-export="daily-summary" type="button">Export Daily Summary CSV</button>
      </div>
      <div data-report-output></div>
    </div>
  `;
  const run = async () => {
    const start = view.querySelector("[data-report-from]").value;
    const end = view.querySelector("[data-report-to]").value;
    const report = await api(`/api/reports?from=${start}&to=${end}`);
    view.querySelector("[data-report-output]").innerHTML = reportHtml(report);
  };
  view.querySelector("[data-run-report]").addEventListener("click", run);
  view.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => {
      const start = view.querySelector("[data-report-from]").value;
      const end = view.querySelector("[data-report-to]").value;
      window.open(`/api/exports?kind=${button.dataset.export}&from=${start}&to=${end}`, "_blank");
    });
  });
  await run();
}

function reportHtml(report) {
  return `
    <div class="grid">
      <div class="span-3">${kpi("Verified dispatches", report.summary.verifiedDispatches)}</div>
      <div class="span-3">${kpi("Sold qty", `${qty(report.summary.soldQty)} units`)}</div>
      <div class="span-3">${kpi("Returned qty", `${qty(report.summary.returnedQty)} units`)}</div>
      <div class="span-3">${kpi("Sales value", money.format(report.summary.value))}</div>
      <div class="span-7">
        <h3>Product Movement</h3>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Dept</th><th>Sold</th><th>Returned</th><th>Shortage</th><th>Value</th></tr></thead>
        <tbody>${report.movement.map((r) => `<tr><td>${r.product}</td><td>${r.department}</td><td>${qty(r.soldQty)} ${r.unit}</td><td>${qty(r.returnedQty)} ${r.unit}</td><td>${qty(r.shortageQty)} ${r.unit}</td><td>${money.format(r.value)}</td></tr>`).join("") || `<tr><td colspan="6">No verified dispatches.</td></tr>`}</tbody></table></div>
      </div>
      <div class="span-5">
        <h3>Shortage / Return Report</h3>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Outlet</th><th>Product</th><th>Shortage</th><th>Return</th></tr></thead>
        <tbody>${report.shortages.map((r) => `<tr><td>${r.date}</td><td>${r.outlet}</td><td>${r.product}</td><td>${qty(r.shortage)} ${r.unit || ""}</td><td>${qty(r.returned)} ${r.unit || ""}</td></tr>`).join("") || `<tr><td colspan="5">No shortages or returns.</td></tr>`}</tbody></table></div>
      </div>
    </div>
  `;
}

function renderAdmin(view) {
  view.innerHTML = `
    <div class="section-head"><div><h2>Admin Control</h2><p class="muted">Audit log, SKU count, backup status, and setup notes.</p></div></div>
    <div class="grid">
      <div class="span-4">${kpi("Master SKUs", state.data.products.length)}</div>
      <div class="span-4">${kpi("Departments", state.data.departments.length)}</div>
      <div class="span-4">${kpi("Outlets", state.data.outlets.length)}</div>
      <div class="span-12 panel">
        <h3>Security and Deployment Notes</h3>
        <p class="muted">This local build has role permissions, server-side validation, audit logs, and automatic JSON backup snapshots. For access from anywhere, deploy this server behind HTTPS on a cloud VM or managed app host, use a managed database backup schedule, and replace demo passwords before live use.</p>
      </div>
      <div class="span-12 panel">
        <h3>Recent Audit</h3>
        <div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Note</th></tr></thead>
        <tbody>${state.data.audit.map((a) => `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${a.actor}</td><td>${a.role || ""}</td><td>${a.action}</td><td>${a.entity}</td><td>${a.note || ""}</td></tr>`).join("")}</tbody></table></div>
      </div>
    </div>
  `;
}

function renderSkus(view) {
  view.innerHTML = `
    <div class="section-head">
      <div><h2>SKU Master</h2><p class="muted">Add one SKU quickly, or search and edit one existing SKU at a time.</p></div>
    </div>
    <div class="grid">
      <form class="span-4 panel stack" data-sku-form>
        <h3>Add New SKU</h3>
        <label>Department <input name="department" list="department-list" required placeholder="bengali"></label>
        <label>Product name <input name="name" required placeholder="Rasmalai"></label>
        <label>Unit <select name="unit"><option value="kg">kg</option><option value="pcs">pcs</option></select></label>
        <label>Price per unit <input name="price" type="number" min="0" step="0.01" required placeholder="0"></label>
        <button class="btn" type="submit">Add SKU</button>
      </form>
      <div class="span-8 panel stack">
        <div class="grid no-print">
          <label class="span-6">Department <select data-sku-dept><option value="">All departments</option>${state.data.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select></label>
          <label class="span-6">Search <input data-sku-search placeholder="Search SKU"></label>
        </div>
        <div class="sku-results" data-sku-results></div>
        <form class="sku-editor hide" data-sku-editor>
          <h3>Edit Selected SKU</h3>
          <input name="id" type="hidden">
          <div class="grid">
            <label class="span-6">Department <input name="department" list="department-list" required></label>
            <label class="span-6">Product name <input name="name" required></label>
            <label class="span-6">Unit <select name="unit"><option value="kg">kg</option><option value="pcs">pcs</option></select></label>
            <label class="span-6">Price per unit <input name="price" type="number" min="0" step="0.01" required></label>
          </div>
          <div class="actions"><button class="btn" type="submit">Save Changes</button><button class="ghost" type="button" data-clear-sku-edit>Close</button></div>
        </form>
      </div>
    </div>
    <datalist id="department-list">${state.data.departments.map((d) => `<option value="${esc(d)}"></option>`).join("")}</datalist>
  `;
  const form = view.querySelector("[data-sku-form]");
  const dept = view.querySelector("[data-sku-dept]");
  const search = view.querySelector("[data-sku-search]");
  const results = view.querySelector("[data-sku-results]");
  const editor = view.querySelector("[data-sku-editor]");
  const renderRows = () => {
    const deptValue = dept.value;
    const term = search.value.trim().toLowerCase();
    const products = state.data.products
      .filter((p) => (!deptValue || p.department === deptValue) && (!term || p.name.toLowerCase().includes(term)))
      .slice(0, 24);
    results.innerHTML = products.length ? products.map((p) => `
      <button class="sku-result" data-pick-sku="${p.id}" type="button">
        <strong>${esc(p.name)}</strong>
        <span>${esc(p.department)} · ${p.unit || "kg"} · ${money.format(Number(p.price || 0))}</span>
      </button>
    `).join("") : `<p class="muted">No SKUs found. Add it from the form on the left.</p>`;
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api("/api/products", { method: "POST", body: JSON.stringify(body) });
      toast("SKU added");
      await load();
      state.tab = "skus";
      renderView();
    } catch (error) {
      toast(error.message);
    }
  });
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick-sku]");
    if (!button) return;
    const p = state.data.products.find((item) => item.id === button.dataset.pickSku);
    if (!p) return;
    editor.classList.remove("hide");
    editor.querySelector("[name=id]").value = p.id;
    editor.department.value = p.department;
    editor.name.value = p.name;
    editor.unit.value = p.unit || "kg";
    editor.price.value = Number(p.price || 0);
  });
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      department: editor.department.value,
      name: editor.name.value,
      unit: editor.unit.value,
      price: Number(editor.price.value)
    };
    try {
      await api(`/api/products/${editor.querySelector("[name=id]").value}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("SKU updated");
      await load();
      state.tab = "skus";
      renderView();
    } catch (error) {
      toast(error.message);
    }
  });
  view.querySelector("[data-clear-sku-edit]").addEventListener("click", () => editor.classList.add("hide"));
  dept.addEventListener("input", renderRows);
  search.addEventListener("input", renderRows);
  renderRows();
}

function roleOptions(selected = "outlet") {
  return ["admin", "factory", "outlet"].map((role) => `<option value="${role}" ${role === selected ? "selected" : ""}>${role}</option>`).join("");
}

function renderOutlets(view) {
  view.innerHTML = `
    <div class="section-head"><div><h2>Outlet Management</h2><p class="muted">Create outlets and assign login users to factory, admin, or outlet roles.</p></div></div>
    <div class="grid">
      <form class="span-4 panel stack" data-outlet-form>
        <h3>Add Outlet</h3>
        <label>Outlet name <input name="name" required placeholder="Vijay Chowk"></label>
        <label><span>Active</span><select name="active"><option value="true">Active</option><option value="false">Inactive</option></select></label>
        <button class="btn" type="submit">Add Outlet</button>
      </form>
      <form class="span-8 panel stack" data-user-form>
        <h3>Add User</h3>
        <div class="grid">
          <label class="span-6">Name <input name="name" required placeholder="Outlet Staff"></label>
          <label class="span-6">Username <input name="username" required placeholder="outletuser"></label>
          <label class="span-4">Role <select name="role">${roleOptions("outlet")}</select></label>
          <label class="span-4">Outlet <select name="outletId"><option value="">None</option>${outletOptions()}</select></label>
          <label class="span-4">Temporary password <input name="password" placeholder="changeme123"></label>
        </div>
        <button class="btn" type="submit">Add User</button>
      </form>
      <div class="span-6 panel stack">
        <h3>Outlets</h3>
        <div class="stack">${state.data.outlets.map((o) => `
          <form class="inline-edit" data-edit-outlet="${o.id}">
            <input name="name" value="${esc(o.name)}">
            <select name="active"><option value="true" ${o.active !== false ? "selected" : ""}>Active</option><option value="false" ${o.active === false ? "selected" : ""}>Inactive</option></select>
            <button class="ghost" type="submit">Save</button>
          </form>
        `).join("")}</div>
      </div>
      <div class="span-6 panel stack">
        <h3>Users</h3>
        <div class="stack">${(state.data.users || []).map((u) => `
          <form class="inline-edit user-edit" data-edit-user="${u.id}">
            <input name="name" value="${esc(u.name)}">
            <input name="username" value="${esc(u.username)}">
            <select name="role">${roleOptions(u.role)}</select>
            <select name="outletId"><option value="">None</option>${outletOptions(u.outletId || "")}</select>
            <input name="password" placeholder="new password">
            <button class="ghost" type="submit">Save</button>
          </form>
        `).join("")}</div>
      </div>
    </div>
  `;
  view.querySelector("[data-outlet-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/outlets", { method: "POST", body: JSON.stringify({ name: form.name.value, active: form.active.value === "true" }) });
      toast("Outlet added");
      await load();
      state.tab = "outlets";
      renderView();
    } catch (error) { toast(error.message); }
  });
  view.querySelector("[data-user-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      toast("User added");
      await load();
      state.tab = "outlets";
      renderView();
    } catch (error) { toast(error.message); }
  });
  view.querySelectorAll("[data-edit-outlet]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/outlets/${form.dataset.editOutlet}`, { method: "PATCH", body: JSON.stringify({ name: form.name.value, active: form.active.value === "true" }) });
        toast("Outlet updated");
        await load();
        state.tab = "outlets";
        renderView();
      } catch (error) { toast(error.message); }
    });
  });
  view.querySelectorAll("[data-edit-user]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      if (!body.password) delete body.password;
      try {
        await api(`/api/users/${form.dataset.editUser}`, { method: "PATCH", body: JSON.stringify(body) });
        toast("User updated");
        await load();
        state.tab = "outlets";
        renderView();
      } catch (error) { toast(error.message); }
    });
  });
}

function renderSettings(view) {
  view.innerHTML = `
    <div class="section-head"><div><h2>Settings</h2><p class="muted">Change your password before real use. Admin can reset another user's password.</p></div></div>
    <div class="grid">
      <form class="span-6 panel stack" data-own-password>
        <h3>Change My Password</h3>
        <label>Current password <input name="currentPassword" type="password" required></label>
        <label>New password <input name="newPassword" type="password" minlength="6" required></label>
        <button class="btn" type="submit">Change Password</button>
      </form>
      ${state.user.role === "admin" ? `
      <form class="span-6 panel stack" data-reset-password>
        <h3>Admin Password Reset</h3>
        <label>User <select name="userId">${(state.data.users || []).map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.username)}</option>`).join("")}</select></label>
        <label>New password <input name="newPassword" type="password" minlength="6" required></label>
        <button class="btn" type="submit">Reset Password</button>
      </form>` : ""}
    </div>
  `;
  view.querySelector("[data-own-password]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/change-password", { method: "POST", body: JSON.stringify({ currentPassword: form.currentPassword.value, newPassword: form.newPassword.value }) });
      form.reset();
      toast("Password changed");
    } catch (error) { toast(error.message); }
  });
  const reset = view.querySelector("[data-reset-password]");
  if (reset) reset.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/change-password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(reset))) });
      reset.reset();
      toast("Password reset");
    } catch (error) { toast(error.message); }
  });
}

window.printChallan = function printChallan(id) {
  const d = state.data.dispatches.find((row) => row.id === id);
  if (!d) return;
  const rows = d.items.map((item, index) => {
    const p = product(item.productId);
    return `<tr><td>${index + 1}</td><td>${p.department}</td><td>${p.name}</td><td>${qtyUnit(item.qty, item.productId)}</td><td>${item.receivedQty == null ? "" : qtyUnit(item.receivedQty, item.productId)}</td></tr>`;
  }).join("");
  const html = `
    <html><head><title>${d.challanNo}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{margin:0 0 4px} table{width:100%;border-collapse:collapse;margin-top:18px} td,th{border:1px solid #aaa;padding:8px;text-align:left} .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}.sign{display:flex;justify-content:space-between;margin-top:50px}
    </style></head><body>
    <h1>Dispatch Challan</h1><strong>${d.challanNo}</strong>
    <div class="meta"><div>Outlet: ${outlet(d.outletId).name}</div><div>Date: ${new Date(d.createdAt).toLocaleString()}</div><div>Status: ${d.status}</div><div>Created by: ${d.createdBy}</div></div>
    <table><thead><tr><th>#</th><th>Department</th><th>Product</th><th>Dispatched</th><th>Received</th></tr></thead><tbody>${rows}</tbody></table>
    <p>Note: ${d.note || ""}</p>
    <div class="sign"><div>Factory Signature</div><div>Outlet Signature</div></div>
    <script>print();<\/script></body></html>
  `;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
};

function renderView() {
  const view = document.querySelector("#view");
  if (!view) return;
  if (state.tab === "dashboard") renderDashboard(view);
  if (state.tab === "demand") renderDemand(view);
  if (state.tab === "bulk") renderBulk(view);
  if (state.tab === "dispatch") renderDispatch(view);
  if (state.tab === "verify") renderVerify(view);
  if (state.tab === "logs") renderLogs(view);
  if (state.tab === "reports") renderReports(view).catch((e) => toast(e.message));
  if (state.tab === "skus") renderSkus(view);
  if (state.tab === "outlets") renderOutlets(view);
  if (state.tab === "settings") renderSettings(view);
  if (state.tab === "admin") renderAdmin(view);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

load();
