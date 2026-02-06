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
    for (const k of Object.keys(row || {})) {
        out[normalizeKey(k)] = row[k];
    }
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
    if (countOf(stepStatuses, "Completed") === 8) return "Completed";

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

/* ============================
   GVIZ JSONP (no CORS, works on file://)
   ============================ */

function buildGvizUrl(callbackName) {
    if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID is not set");

    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
    const params = new URLSearchParams();

    params.set("gid", String(SHEET_GID || "0"));
    params.set("tq", "select *");

    /* Force header row = 1 (important for correct column labels) */
    params.set("headers", "1");

    params.set("tqx", `out:json;responseHandler:${callbackName}`);

    /* Cache-bust */
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

                /* Prefer label; fallback to id (A, B, C...) */
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

/* ============================
   TRANSFORM + RENDER
   ============================ */

function mapSheetRowsToItems(sheetRows) {
    const items = [];

    for (const row of sheetRows) {
        const code = getField(row, "Code");
        const candidateName = getField(row, "Candidate Name");
        const email = getField(row, "Email");
        const issueDetailsDecision = getField(row, "Issue details and Decision");
        const lastUpdatedBy = getField(row, "Last Updated By");

        if (!String(code).trim() && !String(candidateName).trim()) continue;

        const it = {
            code,
            candidateName,
            email,
            issueDetailsDecision,
            lastUpdatedBy,
        };

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
    tbody.innerHTML = "";

    for (const it of items) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${escapeHtml(it.code)}</td>
      <td><b>${escapeHtml(it.candidateName)}</b></td>
      <td>${escapeHtml(it.email)}</td>

      <td>${escapeHtml(it.learnWorldsRegistered)}</td>
      <td>${escapeHtml(it.hoganAssessment)}</td>
      <td>${escapeHtml(it.hoganStatus)}</td>
      <td>${escapeHtml(it.gcatId)}</td>
      <td>${escapeHtml(it.gcatStatus)}</td>
      <td>${escapeHtml(it.cbiBooking)}</td>
      <td>${escapeHtml(it.simulationBooking)}</td>
      <td>${escapeHtml(it.feedbackBooking)}</td>

      <td>${overallPill(it.overallStatus)}</td>
      <td>${escapeHtml(it.issueDetailsDecision)}</td>
      <td>${escapeHtml(it.lastUpdatedBy)}</td>
    `;
        tbody.appendChild(tr);
    }
}

/* ============================
   REFRESH FLOW
   ============================ */

async function refresh() {
    try {
        const sheetRows = await loadSheetRowsViaGviz();

        console.log("[tracker] rows loaded:", sheetRows.length);
        console.log("[tracker] keys in first row:", Object.keys(sheetRows[0] || {}));
        console.log("[tracker] first row example:", sheetRows[0]);

        const items = mapSheetRowsToItems(sheetRows);

        console.log("[tracker] items mapped:", items.length);
        if (items.length === 0) {
            console.warn("[tracker] items is empty; likely header mismatch. Check keys above.");
        }

        renderDashboard(items);
        renderTable(items);

        lastRefresh.textContent = new Date().toLocaleString();
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

setAutoRefresh(Number(autoRefresh.value));
refresh();
