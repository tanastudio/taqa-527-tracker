/* ============================
   CONFIG
   ============================ */

const SPREADSHEET_ID = "108Aw5wiXraypEHwpT6VHTsmL4ALPp02uORv4XTpMGxY";
const SHEET_GID = "0";

/* ============================
   MAPPINGS
   ============================ */

const STEP_STATUS = ["Not Started", "In Progress", "Completed", "Issue"];

const STEP_KEYS = [
  { col: "LearnWorlds Registered", out: "learnWorldsRegistered" },
  { col: "Hogan Assessment", out: "hoganAssessment" },
  { col: "Hogan Status", out: "hoganStatus" },
  { col: "GCAT ID", out: "gcatId" },
  { col: "GCAT Status", out: "gcatStatus" },
  { col: "CBI Booking", out: "cbiBooking" },
  { col: "Simulation Booking", out: "simulationBooking" },
  { col: "Feedback Booking", out: "feedbackBooking" },
];

const PROCESS_LABELS = STEP_KEYS.map((x) => x.col);

/* ============================
   UI ELEMENTS
   ============================ */

const tbody = document.getElementById("tbody");
const refreshBtn = document.getElementById("refreshBtn");
const autoRefresh = document.getElementById("autoRefresh");
const lastRefresh = document.getElementById("lastRefresh");

const kpiTotal = document.getElementById("kpiTotal");
const kpiCompleted = document.getElementById("kpiCompleted");
const kpiInProgress = document.getElementById("kpiInProgress");
const kpiIssue = document.getElementById("kpiIssue");
const kpiNotStarted = document.getElementById("kpiNotStarted");

/* Modal UI */
const statusModal = document.getElementById("statusModal");
const modalTitle = document.getElementById("modalTitle");
const modalSub = document.getElementById("modalSub");
const modalTbody = document.getElementById("modalTbody");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalCloseBtn2 = document.getElementById("modalCloseBtn2");

/* KPI clickable cards */
const kpiCards = document.querySelectorAll(".kpi-click");

/* Table scroll sync elements */
const siteHeader = document.getElementById("siteHeader");
const dashboardTableWrap = document.getElementById("dashboardTableWrap");
const dashboardTable = document.getElementById("dashboardTable");
const tableScrollbarTop = document.getElementById("tableScrollbarTop");
const tableScrollbarInner = document.getElementById("tableScrollbarInner");

/* Keep latest items for modal filtering */
let CURRENT_ITEMS = [];

/* ============================
   CHARTS
   ============================ */

const COLORS = {
  Completed: "#00B050",
  "In Progress": "#4F81BD",
  Issue: "#FF0000",
  "Not Started": "#FFC000",
};

const overallPie = new Chart(document.getElementById("overallPie"), {
  type: "pie",
  data: {
    labels: ["Completed", "In Progress", "Issue", "Not Started"],
    datasets: [
      {
        data: [0, 0, 0, 0],
        backgroundColor: [
          COLORS["Completed"],
          COLORS["In Progress"],
          COLORS["Issue"],
          COLORS["Not Started"],
        ],
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" } },
    onClick: (evt, elements) => {
      if (!elements || elements.length === 0) return;
      const idx = elements[0].index;
      const status = overallPie.data.labels[idx];
      openStatusModal(status);
    },
  },
});

const processStacked = new Chart(document.getElementById("processStacked"), {
  type: "bar",
  data: {
    labels: PROCESS_LABELS,
    datasets: [
      { label: "Completed", data: Array(8).fill(0), backgroundColor: COLORS["Completed"] },
      { label: "In Progress", data: Array(8).fill(0), backgroundColor: COLORS["In Progress"] },
      { label: "Issue", data: Array(8).fill(0), backgroundColor: COLORS["Issue"] },
      { label: "Not Started", data: Array(8).fill(0), backgroundColor: COLORS["Not Started"] },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    scales: {
      x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      y: { stacked: true },
    },
    plugins: { legend: { position: "top" } },
  },
});

/* ============================
   HELPERS
   ============================ */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildNormalizedRow(row) {
  const out = {};
  for (const k of Object.keys(row || {})) out[normalizeKey(k)] = row[k];
  return out;
}

function getField(row, headerName) {
  const exact = row?.[headerName];
  if (exact !== undefined) return exact;

  const nr = buildNormalizedRow(row);
  const v = nr[normalizeKey(headerName)];
  return v === undefined ? "" : v;
}

function countOf(arr, v) {
  return arr.filter((x) => x === v).length;
}

function computeOverall(stepStatuses) {
  if (countOf(stepStatuses, "Issue") > 0) return "Issue";
  if (countOf(stepStatuses, "Completed") === STEP_KEYS.length) return "Completed";

  const inProgress = countOf(stepStatuses, "In Progress");
  const completed = countOf(stepStatuses, "Completed");
  const notStarted = countOf(stepStatuses, "Not Started");

  if (inProgress > 0 || (completed > 0 && notStarted > 0)) return "In Progress";
  return "Not Started";
}

function overallPill(overall) {
  const cls = `overall-pill pill-${overall.replace(" ", "\\ ")}`;
  return `<span class="${cls}">${escapeHtml(overall)}</span>`;
}

function normalizeStatus(v) {
  const s = String(v || "").trim();
  if (!s) return "Not Started";
  return STEP_STATUS.includes(s) ? s : "Not Started";
}

function isActiveRow(row) {
  const v = String(getField(row, "Active") || "").trim().toLowerCase();
  if (!v) return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/* ============================
   Sticky header offset + scroll sync
   ============================ */

function setTableStickyTop() {}

let _scrollSyncWired = false;
function wireScrollSync() {
  if (_scrollSyncWired) return;
  if (!dashboardTableWrap || !tableScrollbarTop) return;

  _scrollSyncWired = true;
  let lock = false;

  dashboardTableWrap.addEventListener("scroll", () => {
    if (lock) return;
    lock = true;
    tableScrollbarTop.scrollLeft = dashboardTableWrap.scrollLeft;
    lock = false;
  });

  tableScrollbarTop.addEventListener("scroll", () => {
    if (lock) return;
    lock = true;
    dashboardTableWrap.scrollLeft = tableScrollbarTop.scrollLeft;
    lock = false;
  });
}

function syncTopScrollbarWidth() {
  if (!dashboardTable || !tableScrollbarInner) return;
  tableScrollbarInner.style.width = dashboardTable.scrollWidth + "px";
}

/* ============================
   GVIZ JSONP (no CORS, works on file://)
   ============================ */

function buildGvizUrl(callbackName) {
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID is not set");

  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
  const params = new URLSearchParams();

  params.set("gid", String(SHEET_GID || "0"));
  params.set("tq", "select *");
  params.set("headers", "1");
  params.set("tqx", `out:json;responseHandler:${callbackName}`);

  params.set("t", String(Date.now()));
  params.set("r", Math.random().toString(16).slice(2));

  return `${base}?${params.toString()}`;
}

function loadSheetRowsViaGviz() {
  return new Promise((resolve, reject) => {
    const cb = `__gviz_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    window[cb] = (resp) => {
      try {
        delete window[cb];

        if (!resp || !resp.table) {
          reject(new Error("GViz response has no table"));
          return;
        }

        const cols = resp.table.cols || [];
        const rows = resp.table.rows || [];
        const headers = cols.map((c, i) => (c.label || c.id || `COL_${i}`).trim());

        const out = rows.map((r) => {
          const cells = r.c || [];
          const obj = {};
          for (let i = 0; i < headers.length; i++) {
            const key = headers[i] || `COL_${i}`;
            const cell = cells[i];
            const val = cell ? (cell.f ?? cell.v ?? "") : "";
            obj[key] = val;
          }
          return obj;
        });

        resolve(out);
      } catch (e) {
        reject(e);
      }
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = buildGvizUrl(cb);

    script.onerror = () => {
      delete window[cb];
      reject(new Error("Failed to load GViz script. Check sharing/publish settings."));
    };

    document.head.appendChild(script);
    script.onload = () => script.remove();
  });
}

async function loadSheetRowsViaGvizFetch(timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
    const params = new URLSearchParams();
    params.set("gid", String(SHEET_GID || "0"));
    params.set("tq", "select *");
    params.set("headers", "1");
    params.set("tqx", "out:json");
    params.set("t", String(Date.now()));
    params.set("r", Math.random().toString(16).slice(2));

    const res = await fetch(`${base}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`GVIZ fetch failed: HTTP ${res.status}`);

    const text = await res.text();
    const m = text.match(/setResponse\(([\s\S]+)\);\s*$/);
    if (!m) throw new Error("GVIZ response parse failed");

    const json = JSON.parse(m[1]);
    if (!json || !json.table) throw new Error("GViz response has no table");

    const cols = json.table.cols || [];
    const rows = json.table.rows || [];
    const headers = cols.map((c, i) => (c.label || c.id || `COL_${i}`).trim());

    return rows.map((r) => {
      const cells = r.c || [];
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const key = headers[i] || `COL_${i}`;
        const cell = cells[i];
        const val = cell ? (cell.f ?? cell.v ?? "") : "";
        obj[key] = val;
      }
      return obj;
    });
  } finally {
    clearTimeout(t);
  }
}

async function loadSheetRowsRobust() {
  try {
    return await loadSheetRowsViaGviz();
  } catch (e) {
    console.warn("GVIZ JSONP failed; trying fetch fallback:", e);
    return await loadSheetRowsViaGvizFetch();
  }
}


/* ============================
   TRANSFORM + RENDER
   ============================ */

function mapSheetRowsToItems(sheetRows) {
  const items = [];

  for (const row of sheetRows) {
    const code = getField(row, "Code");
    const candidateName = getField(row, "Candidate Name");
    const email = getField(row, "Email");
    const lastUpdatedBy = getField(row, "Last Updated By");
    const issue = getField(row, "Issue");
    const decision = getField(row, "Decision");
    const active = isActiveRow(row);

    if (!active) continue;
    if (!String(code).trim() && !String(candidateName).trim()) continue;

    const it = { code, candidateName, email, issue, decision, lastUpdatedBy };

    const stepStatuses = [];
    for (const s of STEP_KEYS) {
      const raw = getField(row, s.col);
      const norm = normalizeStatus(raw);
      it[s.out] = norm;
      stepStatuses.push(norm);
    }

    it.overallStatus = computeOverall(stepStatuses);
    items.push(it);
  }

  return items;
}

function computeOverallCounts(items) {
  const c = { Completed: 0, "In Progress": 0, Issue: 0, "Not Started": 0 };
  for (const it of items) c[it.overallStatus] = (c[it.overallStatus] || 0) + 1;
  return c;
}

function computeProcessCounts(items) {
  const byStep = STEP_KEYS.map(() => ({
    Completed: 0,
    "In Progress": 0,
    Issue: 0,
    "Not Started": 0,
  }));

  for (const it of items) {
    STEP_KEYS.forEach((s, idx) => {
      const v = it[s.out] || "Not Started";
      byStep[idx][v] = (byStep[idx][v] || 0) + 1;
    });
  }

  return byStep;
}

function renderDashboard(items) {
  const overall = computeOverallCounts(items);

  kpiTotal.textContent = items.length;
  kpiCompleted.textContent = overall["Completed"];
  kpiInProgress.textContent = overall["In Progress"];
  kpiIssue.textContent = overall["Issue"];
  kpiNotStarted.textContent = overall["Not Started"];

  overallPie.data.datasets[0].data = [
    overall["Completed"],
    overall["In Progress"],
    overall["Issue"],
    overall["Not Started"],
  ];
  overallPie.update();

  const byStep = computeProcessCounts(items);
  const series = (status) => byStep.map((x) => x[status] || 0);

  processStacked.data.datasets[0].data = series("Completed");
  processStacked.data.datasets[1].data = series("In Progress");
  processStacked.data.datasets[2].data = series("Issue");
  processStacked.data.datasets[3].data = series("Not Started");
  processStacked.update();
}

function renderTable(items) {
    if (!tbody) return;

    tbody.innerHTML = "";

    for (const it of items || []) {
        const tr = document.createElement("tr");

        // Code (sticky col 1)
        const tdCode = document.createElement("td");
        tdCode.className = "sticky-col sticky-col-1";
        tdCode.textContent = String(it.code || "");
        tr.appendChild(tdCode);

        // Candidate Name (sticky col 2)
        const tdName = document.createElement("td");
        tdName.className = "sticky-col sticky-col-2";
        tdName.innerHTML = `<b>${escapeHtml(it.candidateName || "")}</b>`;
        tr.appendChild(tdName);

        // Email
        const tdEmail = document.createElement("td");
        tdEmail.textContent = String(it.email || "");
        tr.appendChild(tdEmail);

        // Steps (keep the same column order as index.html header)
        for (const s of STEP_KEYS) {
            const td = document.createElement("td");
            td.textContent = String(it[s.out] || "Not Started");
            tr.appendChild(td);
        }

        // Overall Status pill
        const tdOverall = document.createElement("td");
        tdOverall.innerHTML = overallPill(it.overallStatus || "Not Started");
        tr.appendChild(tdOverall);

        // Issue / Decision / Last Updated By
        const tdIssue = document.createElement("td");
        tdIssue.textContent = String(it.issue || "");
        tr.appendChild(tdIssue);

        const tdDecision = document.createElement("td");
        tdDecision.textContent = String(it.decision || "");
        tr.appendChild(tdDecision);

        const tdUpd = document.createElement("td");
        tdUpd.textContent = String(it.lastUpdatedBy || "");
        tr.appendChild(tdUpd);

        tbody.appendChild(tr);
    }

    // Keep top scrollbar width in sync with table width
    syncTopScrollbarWidth();
}



  // หลัง render ค่อย sync ความกว้าง scrollbar
  syncTopScrollbarWidth();


/* ============================
   MODAL (DETAIL LIST)
   ============================ */

function openStatusModal(status) {
  const label = status === "Total" ? "Total Candidates" : status;

  const list = status === "Total"
    ? [...CURRENT_ITEMS]
    : CURRENT_ITEMS.filter((x) => x.overallStatus === status);

  list.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));

  modalTitle.textContent = `Candidates: ${label}`;
  modalSub.textContent = `Rows: ${list.length}`;

  modalTbody.innerHTML = "";

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" style="color:#6b7280;">No candidates found.</td>`;
    modalTbody.appendChild(tr);
  } else {
    for (const it of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(it.code)}</td>
        <td><b>${escapeHtml(it.candidateName)}</b></td>
        <td class="issue-cell">${escapeHtml(it.issue)}</td>
        <td class="issue-cell">${escapeHtml(it.decision)}</td>
      `;
      modalTbody.appendChild(tr);
    }
  }

  statusModal.classList.add("open");
  statusModal.setAttribute("aria-hidden", "false");
}

function closeStatusModal() {
  statusModal.classList.remove("open");
  statusModal.setAttribute("aria-hidden", "true");
}

modalCloseBtn.addEventListener("click", closeStatusModal);
modalCloseBtn2.addEventListener("click", closeStatusModal);

statusModal.addEventListener("click", (e) => {
  if (e.target === statusModal) closeStatusModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeStatusModal();
});

kpiCards.forEach((el) => {
  el.addEventListener("click", () => {
    const status = el.getAttribute("data-status") || "Total";
    openStatusModal(status);
  });
});

/* ============================
   REFRESH FLOW
   ============================ */

async function refresh() {
  try {
    const sheetRows = await loadSheetRowsRobust();

    const items = mapSheetRowsToItems(sheetRows);
    CURRENT_ITEMS = items;

    renderDashboard(items);
    renderTable(items);

    lastRefresh.textContent = new Date().toLocaleString();

    // ensure sticky top is correct after fonts/layout settle
    setTableStickyTop();
  } catch (err) {
    console.error(err);
    alert("Loaded rows, but failed to render. Check Console in DevTools.");
  }
}

/* ============================
   AUTO REFRESH
   ============================ */

let timer = null;

function setAutoRefresh(seconds) {
  if (timer) clearInterval(timer);
  timer = null;
  if (!seconds || seconds <= 0) return;
  timer = setInterval(refresh, seconds * 1000);
}

refreshBtn.addEventListener("click", refresh);
autoRefresh.addEventListener("change", () => setAutoRefresh(Number(autoRefresh.value)));

/* init */
window.addEventListener("load", () => {
  // setTableStickyTop();
  wireScrollSync();
  syncTopScrollbarWidth();
});

window.addEventListener("resize", () => {
  // setTableStickyTop();
  syncTopScrollbarWidth();
});

setAutoRefresh(Number(autoRefresh.value));
refresh();
