/* ==========================================================================
   Update Candidate (Form + Table) - Full Replacement
   Key changes in this version:
   - Read: robust GViz JSONP + fetch fallback, with correct query params.
   - Save: "full row payload" instead of per-field payload (reduces row-splitting issues).
   - Top form: saves on blur/change (not every keystroke).
   - Table: saves with debounce; duplicate Code is blocked.
   - Sorting is UI-only.
   ========================================================================== */

/* =========================
   CONFIG
   ========================= */

const SPREADSHEET_ID = "108Aw5wiXraypEHwpT6VHTsmL4ALPp02uORv4XTpMGxY";
const SHEET_GID = "0";

/* Apps Script endpoint for writing (JSONP to avoid CORS/file:// issues) */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzWZko6RAM5nlVOpYcz57A2KQce2bKnxR-OQOBieeNDt8vAOFvlg7po_UjjjJ5mmDfkhw/exec";
const API_TOKEN = "tqa2026-secret";

const STEP_STATUS = ["Not Started", "In Progress", "Completed", "Issue"];

const STEP_KEYS = [
  { col: "LearnWorlds Registered" },
  { col: "Hogan Assessment" },
  { col: "Hogan Status" },
  { col: "GCAT ID" },
  { col: "GCAT Status" },
  { col: "CBI Booking" },
  { col: "Simulation Booking" },
  { col: "Feedback Booking" },
];

const H_CODE = "Code";
const H_NAME = "Candidate Name";
const H_EMAIL = "Email";
const H_ISSUE = "Issue";
const H_DECISION = "Decision";
const H_UPDATED_BY = "Last Updated By";
const H_ACTIVE = "Active";

/* Debounce: top form is blur/change, table still debounce */
const TABLE_SAVE_DEBOUNCE_MS = 900;

/* =========================
   UI ELEMENTS
   ========================= */

const el = (id) => document.getElementById(id);

const saveState = el("saveState");
const lastSync = el("lastSync");
const reloadBtn = el("reloadBtn");
const undoBtn = el("undoBtn");

const newCandidateBtn = el("newCandidateBtn");

const searchInput = el("searchInput");
const filterColumn = el("filterColumn");
const filterStatus = el("filterStatus");
const showInactive = el("showInactive");

const addRowBtn = el("addRowBtn");

const tbody = el("tbody");
const tableWrap = el("tableWrap");
const grid = el("grid");

const hscrollTop = el("hscrollTop");
const hscrollTopInner = el("hscrollTopInner");

const candPick = el("candPick");
const candidateList = el("candidateList");

const candCode = el("candCode");
const candName = el("candName");
const candEmail = el("candEmail");
const candUpdatedBy = el("candUpdatedBy");
const candIssue = el("candIssue");
const candDecision = el("candDecision");

const newModeHint = el("newModeHint");
const dupHint = el("dupHint");
const loadHint = el("loadHint");

const stepSelects = [
  el("step0"), el("step1"), el("step2"), el("step3"),
  el("step4"), el("step5"), el("step6"), el("step7"),
];

/* =========================
   STATE
   ========================= */

let MODEL = [];
let ALL_ROWS = [];

let GLOBAL_IN_FLIGHT = 0;
let LAST_ACTION = null;

let SELECTED_ROW = null;
let TOP_FORM_LOCK = false;
let NEW_MODE = false;

let SORT_STATE = { key: "", dir: 0 };

let UID_SEQ = 1;
let LAST_ADDED_UID = null;

/* =========================
   HELPERS
   ========================= */

function nowStamp() {
  return new Date().toLocaleString();
}

function setSavePill(state, text) {
  saveState.className = "save-pill " + state;
  saveState.textContent = text;
}

function setLoadHintVisible(on) {
  if (!loadHint) return;
  loadHint.style.display = on ? "block" : "none";
}

function normalizeKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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

function toBoolActive(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return true;
}

function normalizeStatus(v) {
  const s = String(v || "").trim();
  if (!s) return "Not Started";
  return STEP_STATUS.includes(s) ? s : "Not Started";
}

function ensureUid(row) {
  if (!row._uid) row._uid = "r_" + (UID_SEQ++);
  return row._uid;
}

function normCode(s) {
  return String(s ?? "").trim();
}

function isDuplicateCode(code, selfRow) {
  const c = normCode(code);
  if (!c) return false;
  for (const r of MODEL) {
    if (r === selfRow) continue;
    if (normCode(r.code) === c) return true;
  }
  return false;
}

function isCodeOkForSave(row) {
  const c = normCode(row.code);
  if (!c) return false;
  if (isDuplicateCode(c, row)) return false;
  return true;
}

function setDuplicateHintVisible(isDup) {
  if (!dupHint) return;
  dupHint.style.display = isDup ? "block" : "none";
  if (isDup) candCode?.classList.add("cell-error");
  else candCode?.classList.remove("cell-error");
}

function refreshTopFormModeHints() {
  if (newModeHint) newModeHint.style.display = NEW_MODE ? "block" : "none";
}

/* =========================
   JSONP (Apps Script write)
   ========================= */

function jsonpCall(url, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cb = "__jsonp_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const q = new URLSearchParams({ ...params, callback: cb });

    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes("?") ? "&" : "?") + q.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.head.appendChild(script);
  });
}

/* =========================
   GVIZ (read) - JSONP + fetch fallback
   ========================= */

function buildGvizUrlWithHandler(callbackName) {
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID is not set");

  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
  const params = new URLSearchParams();
  params.set("gid", String(SHEET_GID || "0"));
  params.set("tq", "select *");
  params.set("headers", "1");
  params.set("tqx", `out:json;responseHandler:${callbackName}`);

  /* cache busters */
  params.set("t", String(Date.now()));
  params.set("r", Math.random().toString(16).slice(2));

  return `${base}?${params.toString()}`;
}

function parseGvizResponse(resp) {
  const table = resp?.table;
  const cols = table?.cols || [];
  const rows = table?.rows || [];

  const headers = cols.map((c, i) => String(c?.label || c?.id || `COL_${i}`).trim());
  const out = [];

  for (const r of rows) {
    const obj = {};
    const cells = r?.c || [];
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i] || `COL_${i}`;
      const cell = cells[i];
      obj[h] = (cell && cell.f !== undefined) ? cell.f : (cell ? cell.v : "");
    }
    out.push(obj);
  }
  return out;
}

function loadSheetRowsViaGvizJsonp(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cb = "__gviz_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const url = buildGvizUrlWithHandler(cb);
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("GVIZ JSONP timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }

    window[cb] = (resp) => {
      try {
        cleanup();
        resolve(parseGvizResponse(resp));
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error("GVIZ JSONP load error"));
    };

    document.head.appendChild(script);
  });
}

function buildGvizUrlRaw() {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
  const params = new URLSearchParams();
  params.set("gid", String(SHEET_GID || "0"));
  params.set("tq", "select *");
  params.set("headers", "1");
  params.set("tqx", "out:json");
  params.set("t", String(Date.now()));
  params.set("r", Math.random().toString(16).slice(2));
  return `${base}?${params.toString()}`;
}

async function loadSheetRowsViaGvizFetch(timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(buildGvizUrlRaw(), {
      method: "GET",
      mode: "cors",
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`GVIZ fetch failed: HTTP ${res.status}`);
    const text = await res.text();

    /* Response looks like: google.visualization.Query.setResponse({...}); */
    const m = text.match(/setResponse\(([\s\S]+)\);\s*$/);
    if (!m) throw new Error("GVIZ response parse failed");

    const json = JSON.parse(m[1]);
    return parseGvizResponse(json);
  } finally {
    clearTimeout(t);
  }
}

async function loadSheetRowsRobust() {
  try {
    return await loadSheetRowsViaGvizJsonp(15000);
  } catch (e1) {
    console.warn("GVIZ JSONP failed; trying fetch fallback:", e1);
  }
  return await loadSheetRowsViaGvizFetch(15000);
}

/* =========================
   MODEL
   ========================= */

function buildModel(sheetRows) {
  const items = [];

  for (const row of sheetRows) {
    const code = String(getField(row, H_CODE) || "").trim();
    const name = String(getField(row, H_NAME) || "").trim();
    const email = String(getField(row, H_EMAIL) || "").trim();

    if (!code && !name && !email) continue;

    const it = {
      _fromSheet: true,
      _saving: false,
      _dirty: {},
      _timer: null,
      _uid: "sheet_" + (code || (UID_SEQ++)),

      code,
      name,
      email,

      issue: String(getField(row, H_ISSUE) || ""),
      decision: String(getField(row, H_DECISION) || ""),
      updatedBy: String(getField(row, H_UPDATED_BY) || ""),

      active: toBoolActive(getField(row, H_ACTIVE)),
      steps: {},
    };

    for (const s of STEP_KEYS) {
      it.steps[s.col] = normalizeStatus(getField(row, s.col));
    }

    items.push(it);
  }

  return items;
}

/* =========================
   TOP FORM
   ========================= */

function fillStepOptions() {
  for (const sel of stepSelects) {
    if (!sel) continue;
    sel.innerHTML = "";
    for (const s of STEP_STATUS) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    }
  }
}

function buildCandidatePicker() {
  if (!candidateList || !candPick) return;

  candidateList.innerHTML = "";
  for (const r of MODEL) {
    if (!String(r.code || "").trim()) continue;
    const opt = document.createElement("option");
    opt.value = `${r.code} — ${r.name || ""}`.trim();
    candidateList.appendChild(opt);
  }
}

function buildCandidatePickerFiltered(queryLower) {
  if (!candidateList) return;

  const q = String(queryLower || "").trim();
  candidateList.innerHTML = "";

  for (const r of MODEL) {
    if (!String(r.code || "").trim()) continue;

    const hay = `${r.code} ${r.name || ""} ${r.email || ""}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    const opt = document.createElement("option");
    opt.value = `${r.code} — ${r.name || ""}`.trim();
    candidateList.appendChild(opt);
  }
}


function parseCodeFromPick(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  return t.split("—")[0].trim();
}

function updateTopFormFromRow(row) {
  if (!row) return;

  TOP_FORM_LOCK = true;

  candPick.value = row.code ? `${row.code} — ${row.name || ""}`.trim() : "";
  candCode.value = row.code || "";
  candName.value = row.name || "";
  candEmail.value = row.email || "";
  candUpdatedBy.value = row.updatedBy || "";
  candIssue.value = row.issue || "";
  candDecision.value = row.decision || "";

  for (let i = 0; i < STEP_KEYS.length; i++) {
    const col = STEP_KEYS[i].col;
    const sel = stepSelects[i];
    if (sel) sel.value = row.steps[col] || "Not Started";
  }

  /* Code is readonly for existing sheet rows (unless in NEW_MODE) */
  candCode.readOnly = (!NEW_MODE && row._fromSheet && !!row.code);

  TOP_FORM_LOCK = false;

  setDuplicateHintVisible(isDuplicateCode(candCode.value, row));
}

function setSelectedRowByCode(code) {
  const c = String(code || "").trim();
  if (!c) return;

  const row = MODEL.find(r => String(r.code || "").trim() === c);
  if (!row) return;

  SELECTED_ROW = row;
  NEW_MODE = false;
  refreshTopFormModeHints();
  updateTopFormFromRow(row);
}

function clearTopFormForNewCandidate() {
  TOP_FORM_LOCK = true;

  candPick.value = "";
  candCode.value = "";
  candName.value = "";
  candEmail.value = "";
  candUpdatedBy.value = "";
  candIssue.value = "";
  candDecision.value = "";

  for (let i = 0; i < STEP_KEYS.length; i++) {
    const sel = stepSelects[i];
    if (sel) sel.value = "Not Started";
  }

  TOP_FORM_LOCK = false;

  setDuplicateHintVisible(false);
  candCode.readOnly = false;
  candCode.focus();
}

function createNewCandidate() {
  NEW_MODE = true;
  refreshTopFormModeHints();

  const r = {
    _fromSheet: false,
    _saving: false,
    _dirty: {},
    _timer: null,
    _uid: "newcand_" + (UID_SEQ++),

    code: "",
    name: "",
    email: "",
    issue: "",
    decision: "",
    updatedBy: "",
    active: true,
    steps: {},
  };

  for (const s of STEP_KEYS) r.steps[s.col] = "Not Started";

  MODEL.push(r);
  SELECTED_ROW = r;

  clearTopFormForNewCandidate();
  renderTable();
  buildCandidatePicker();
}

/* Top form save policy:
   - Code: save on blur (and when it becomes valid/unique).
   - Other text fields: save on blur.
   - Dropdowns: save on change.
*/
function bindTopFormEvents() {
  candPick?.addEventListener("change", () => {
    const code = parseCodeFromPick(candPick.value);
    setSelectedRowByCode(code);
  });

  candCode?.addEventListener("input", () => {
    if (TOP_FORM_LOCK) return;
    if (!SELECTED_ROW) return;
    if (!NEW_MODE && SELECTED_ROW._fromSheet) return;

    SELECTED_ROW.code = candCode.value.trim();
    setDuplicateHintVisible(isDuplicateCode(SELECTED_ROW.code, SELECTED_ROW));
  });

  candCode?.addEventListener("blur", () => {
    if (TOP_FORM_LOCK) return;
    if (!SELECTED_ROW) return;
    if (!NEW_MODE && SELECTED_ROW._fromSheet) return;

    SELECTED_ROW.code = candCode.value.trim();
    const isDup = isDuplicateCode(SELECTED_ROW.code, SELECTED_ROW);
    setDuplicateHintVisible(isDup);

    if (!isCodeOkForSave(SELECTED_ROW)) {
      setSavePill("save-failed", "Duplicate/empty Code (not saved)");
      renderTable();
      return;
    }

    markDirtyRow(SELECTED_ROW, H_CODE, SELECTED_ROW.code);
    scheduleRowSave(SELECTED_ROW);
    renderTable();
    buildCandidatePicker();
  });

  const saveOnBlur = (header, getValueFn) => {
    const handler = () => {
      if (TOP_FORM_LOCK) return;
      if (!SELECTED_ROW) return;
      if (NEW_MODE && !isCodeOkForSave(SELECTED_ROW)) return;

      const v = getValueFn();

      if (header === H_NAME) SELECTED_ROW.name = v;
      if (header === H_EMAIL) SELECTED_ROW.email = v;
      if (header === H_UPDATED_BY) SELECTED_ROW.updatedBy = v;
      if (header === H_ISSUE) SELECTED_ROW.issue = v;
      if (header === H_DECISION) SELECTED_ROW.decision = v;

      markDirtyRow(SELECTED_ROW, header, v);
      scheduleRowSave(SELECTED_ROW);

      renderTable();
      buildCandidatePicker();
    };

    return handler;
  };

  candName?.addEventListener("blur", saveOnBlur(H_NAME, () => candName.value));
  candEmail?.addEventListener("blur", saveOnBlur(H_EMAIL, () => candEmail.value));
  candUpdatedBy?.addEventListener("blur", saveOnBlur(H_UPDATED_BY, () => candUpdatedBy.value));
  candIssue?.addEventListener("blur", saveOnBlur(H_ISSUE, () => candIssue.value));
  candDecision?.addEventListener("blur", saveOnBlur(H_DECISION, () => candDecision.value));

  for (let i = 0; i < STEP_KEYS.length; i++) {
    const sel = stepSelects[i];
    const col = STEP_KEYS[i].col;
    if (!sel) continue;

    sel.addEventListener("change", () => {
      if (TOP_FORM_LOCK) return;
      if (!SELECTED_ROW) return;
      if (NEW_MODE && !isCodeOkForSave(SELECTED_ROW)) return;

      SELECTED_ROW.steps[col] = sel.value;
      markDirtyRow(SELECTED_ROW, col, SELECTED_ROW.steps[col]);
      scheduleRowSave(SELECTED_ROW);

      renderTable();
    });
  }
}

/* =========================
   FILTERS + SORT
   ========================= */

function buildFilterControls() {
  filterColumn.innerHTML = "";

  const cols = [
    { value: "", label: "No column filter" },
    ...STEP_KEYS.map((s) => ({ value: s.col, label: s.col })),
    { value: H_ACTIVE, label: "Active" },
  ];

  for (const c of cols) {
    const opt = document.createElement("option");
    opt.value = c.value;
    opt.textContent = c.label;
    filterColumn.appendChild(opt);
  }

  rebuildStatusOptions();
}

function rebuildStatusOptions() {
  const col = filterColumn.value;

  filterStatus.innerHTML = "";
  const addOpt = (v, t) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    filterStatus.appendChild(o);
  };

  addOpt("", "All");

  if (!col) return;

  if (col === H_ACTIVE) {
    addOpt("true", "Active");
    addOpt("false", "Inactive");
    return;
  }

  for (const s of STEP_STATUS) addOpt(s, s);
}

function getSortValue(row, key) {
  if (!key) return "";
  if (key === "code") return row.code || "";
  if (key === "name") return row.name || "";
  if (key === "email") return row.email || "";
  if (key === "issue") return row.issue || "";
  if (key === "decision") return row.decision || "";
  if (key === "updatedBy") return row.updatedBy || "";
  if (key === "active") return row.active ? "Active" : "Inactive";
  if (STEP_KEYS.some(s => s.col === key)) return row.steps[key] || "Not Started";
  return "";
}

function applySort(rows) {
  if (!SORT_STATE.key || SORT_STATE.dir === 0) return rows;

  const dir = SORT_STATE.dir;
  return [...rows].sort((a, b) => {
    const as = String(getSortValue(a, SORT_STATE.key) ?? "");
    const bs = String(getSortValue(b, SORT_STATE.key) ?? "");
    const cmp = as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
    return dir * cmp;
  });
}

function setSortIcon(key, dir) {
  const icons = document.querySelectorAll("[data-sort-icon]");
  icons.forEach((node) => {
    const k = node.getAttribute("data-sort-icon");
    if (k === key) {
      node.textContent = dir === 1 ? "↑" : dir === -1 ? "↓" : "↕";
      node.style.opacity = dir === 0 ? "0.75" : "1";
    } else {
      node.textContent = "↕";
      node.style.opacity = "0.75";
    }
  });
}

function bindSortButtons() {
  const btns = document.querySelectorAll(".sort-btn");
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.getAttribute("data-key") || "";
      if (SORT_STATE.key !== key) SORT_STATE = { key, dir: 1 };
      else SORT_STATE.dir = (SORT_STATE.dir === 0) ? 1 : (SORT_STATE.dir === 1 ? -1 : 0);

      setSortIcon(SORT_STATE.key, SORT_STATE.dir);
      renderTable();
    });
  });
  setSortIcon(SORT_STATE.key, SORT_STATE.dir);
}

function currentFilteredModel() {
  const q = String(searchInput.value || "").trim().toLowerCase();
  const col = filterColumn.value;
  const st = filterStatus.value;
  const showInact = !!showInactive.checked;

  let rows = MODEL.filter((r) => {
    if (!showInact && !r.active) return false;

    if (q) {
      const hay = `${r.code} ${r.name} ${r.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (col) {
      if (col === H_ACTIVE) {
        const want = st === "" ? null : (st === "true");
        if (want !== null && r.active !== want) return false;
      } else {
        const v = r.steps[col] || "Not Started";
        if (st && v !== st) return false;
      }
    }

    return true;
  });

  rows = applySort(rows);
  return rows;
}

/* =========================
   TABLE RENDER
   ========================= */

function makeSelect(statusValue, onChange) {
  const sel = document.createElement("select");
  sel.className = "cell-select";
  for (const s of STEP_STATUS) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    sel.appendChild(o);
  }
  sel.value = statusValue;
  sel.addEventListener("change", onChange);
  return sel;
}

function makeInput(value, onInput, { readOnly = false, bold = false } = {}) {
  const inp = document.createElement("input");
  inp.className = "cell-input" + (readOnly ? " cell-readonly" : "");
  inp.value = value ?? "";
  inp.readOnly = !!readOnly;
  if (bold) inp.style.fontWeight = "950";
  inp.addEventListener("input", onInput);
  return inp;
}

function makeTextarea(value, onInput) {
  const ta = document.createElement("textarea");
  ta.className = "cell-textarea";
  ta.value = value ?? "";
  ta.addEventListener("input", onInput);
  return ta;
}

function activePill(active) {
  const span = document.createElement("span");
  span.className = "mini-pill " + (active ? "pill-active" : "pill-inactive");
  span.textContent = active ? "Active" : "Inactive";
  return span;
}

function scrollToRowUid(uid) {
  if (!uid) return;
  const tr = tbody.querySelector(`tr[data-uid="${CSS.escape(uid)}"]`);
  if (!tableWrap || !tr) return;
  tr.scrollIntoView({ behavior: "smooth", block: "center" });
  const firstInput = tr.querySelector('td input.cell-input');
  if (firstInput) firstInput.focus();
}

function renderTable() {
  const rows = currentFilteredModel();
  tbody.innerHTML = "";

  for (const r of rows) {
    ensureUid(r);

    const tr = document.createElement("tr");
    tr.dataset.uid = r._uid;

    const dup = isDuplicateCode(r.code, r);
    if (dup) tr.classList.add("row-dupcode");

    /* Code */
    const tdCode = document.createElement("td");
    tdCode.className = "sticky-col sticky-col-1";
    const codeReadonly = r._fromSheet && !!r.code;

    const inpCode = makeInput(r.code, () => {
      if (codeReadonly) return;

      r.code = inpCode.value.trim();
      const isDupNow = isDuplicateCode(r.code, r);
      if (isDupNow) inpCode.classList.add("cell-error");
      else inpCode.classList.remove("cell-error");

      if (!isCodeOkForSave(r)) return;

      markDirtyRow(r, H_CODE, r.code);
      scheduleRowSave(r);
      buildCandidatePicker();
    }, { readOnly: codeReadonly, bold: true });

    if (dup) inpCode.classList.add("cell-error");
    tdCode.appendChild(inpCode);

    /* Name */
    const tdName = document.createElement("td");
    tdName.className = "sticky-col sticky-col-2";
    const inpName = makeInput(r.name, () => {
      if (!r._fromSheet && !isCodeOkForSave(r)) return;
      r.name = inpName.value;
      markDirtyRow(r, H_NAME, r.name);
      scheduleRowSave(r);
      buildCandidatePicker();
    }, { bold: true });
    tdName.appendChild(inpName);

    /* Email */
    const tdEmail = document.createElement("td");
    const inpEmail = makeInput(r.email, () => {
      if (!r._fromSheet && !isCodeOkForSave(r)) return;
      r.email = inpEmail.value;
      markDirtyRow(r, H_EMAIL, r.email);
      scheduleRowSave(r);
    });
    tdEmail.appendChild(inpEmail);

    tr.appendChild(tdCode);
    tr.appendChild(tdName);
    tr.appendChild(tdEmail);

    /* Steps */
    for (const s of STEP_KEYS) {
      const td = document.createElement("td");
      const sel = makeSelect(r.steps[s.col], () => {
        if (!r._fromSheet && !isCodeOkForSave(r)) return;
        r.steps[s.col] = sel.value;
        markDirtyRow(r, s.col, r.steps[s.col]);
        scheduleRowSave(r);
      });
      td.appendChild(sel);
      tr.appendChild(td);
    }

    /* Issue */
    const tdIssue = document.createElement("td");
    const taIssue = makeTextarea(r.issue, () => {
      if (!r._fromSheet && !isCodeOkForSave(r)) return;
      r.issue = taIssue.value;
      markDirtyRow(r, H_ISSUE, r.issue);
      scheduleRowSave(r);
    });
    tdIssue.appendChild(taIssue);
    tr.appendChild(tdIssue);

    /* Decision */
    const tdDecision = document.createElement("td");
    const taDecision = makeTextarea(r.decision, () => {
      if (!r._fromSheet && !isCodeOkForSave(r)) return;
      r.decision = taDecision.value;
      markDirtyRow(r, H_DECISION, r.decision);
      scheduleRowSave(r);
    });
    tdDecision.appendChild(taDecision);
    tr.appendChild(tdDecision);

    /* Updated By */
    const tdUpd = document.createElement("td");
    const inpUpd = makeInput(r.updatedBy, () => {
      if (!r._fromSheet && !isCodeOkForSave(r)) return;
      r.updatedBy = inpUpd.value;
      markDirtyRow(r, H_UPDATED_BY, r.updatedBy);
      scheduleRowSave(r);
    });
    tdUpd.appendChild(inpUpd);
    tr.appendChild(tdUpd);

    /* Active */
    const tdActive = document.createElement("td");
    tdActive.appendChild(activePill(r.active));
    tr.appendChild(tdActive);

    /* Actions */
    const tdAct = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const btnToggle = document.createElement("button");
    btnToggle.className = "mini-btn " + (r.active ? "mini-btn-danger" : "mini-btn-ok");
    btnToggle.textContent = r.active ? "Deactivate" : "Reactivate";
    btnToggle.disabled = (!r._fromSheet && !isCodeOkForSave(r));
    btnToggle.addEventListener("click", async () => {
      const prev = r.active;
      r.active = !r.active;

      LAST_ACTION = { type: "toggleActive", code: r.code, prevValue: prev, newValue: r.active };
      undoBtn.disabled = false;

      markDirtyRow(r, H_ACTIVE, r.active ? "TRUE" : "FALSE");
      await saveRowNow(r);
      renderTable();
    });
    wrap.appendChild(btnToggle);
    tdAct.appendChild(wrap);
    tr.appendChild(tdAct);

    /* Click row to load into top form (but ignore clicks on controls) */
    tr.addEventListener("click", (ev) => {
      const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : "";
      if (["input", "select", "textarea", "button"].includes(tag)) return;

      if (r.code) {
        SELECTED_ROW = r;
        NEW_MODE = false;
        refreshTopFormModeHints();
        updateTopFormFromRow(r);
        setDuplicateHintVisible(false);
      }
    });

    tbody.appendChild(tr);
  }

  lastSync.textContent = nowStamp();

  if (LAST_ADDED_UID) {
    const uid = LAST_ADDED_UID;
    LAST_ADDED_UID = null;
    setTimeout(() => scrollToRowUid(uid), 0);
  }

  syncHorizontalScrollbars();
}

/* =========================
   SAVE (FULL ROW PAYLOAD)
   ========================= */

function markDirtyRow(row, header, value) {
  row._dirty[header] = value;
}

function setGlobalSaveState() {
  if (GLOBAL_IN_FLIGHT > 0) setSavePill("save-saving", "Saving...");
  else setSavePill("save-saved", "Saved ✓");
}

/* Build a full payload for the row, so the server updates everything at once.
   This reduces the chance of "splitting updates into multiple rows" if the server logic is imperfect. */
function buildFullRowUpdates(row) {
  const updates = {};
  updates[H_CODE] = String(row.code || "").trim();
  updates[H_NAME] = String(row.name || "");
  updates[H_EMAIL] = String(row.email || "");
  updates[H_UPDATED_BY] = String(row.updatedBy || "");
  updates[H_ISSUE] = String(row.issue || "");
  updates[H_DECISION] = String(row.decision || "");
  updates[H_ACTIVE] = row.active ? "TRUE" : "FALSE";

  for (const s of STEP_KEYS) {
    updates[s.col] = String(row.steps[s.col] || "Not Started");
  }

  return updates;
}

function scheduleRowSave(row) {
  if (!isCodeOkForSave(row)) return;
  if (row._timer) clearTimeout(row._timer);
  row._timer = setTimeout(() => saveRowNow(row).catch(() => {}), TABLE_SAVE_DEBOUNCE_MS);
}

async function saveRowNow(row) {
  const code = String(row.code || "").trim();
  if (!code) return;

  if (isDuplicateCode(code, row)) {
    setSavePill("save-failed", "Duplicate Code (not saved)");
    return;
  }

  /* If nothing changed, skip */
  if (!row._dirty || Object.keys(row._dirty).length === 0) return;

  row._saving = true;
  GLOBAL_IN_FLIGHT++;
  setGlobalSaveState();

  try {
    const fullUpdates = buildFullRowUpdates(row);

    const params = {
      action: "upsert",
      token: API_TOKEN,
      code,
      updates: JSON.stringify(fullUpdates),
    };

    const data = await jsonpCall(APPS_SCRIPT_URL, params);
    if (!data || data.ok !== true) throw new Error((data && data.error) ? data.error : "Save failed");

    row._fromSheet = true;
    row._dirty = {};

    if (NEW_MODE && SELECTED_ROW === row) {
      NEW_MODE = false;
      refreshTopFormModeHints();
      candCode.readOnly = true;
    }

    buildCandidatePicker();
  } catch (err) {
    console.error(err);
    setSavePill("save-failed", "Failed (check API)");
  } finally {
    row._saving = false;
    GLOBAL_IN_FLIGHT = Math.max(0, GLOBAL_IN_FLIGHT - 1);
    setGlobalSaveState();
  }
}

/* =========================
   ACTIONS
   ========================= */

function addEmptyRow() {
  const r = {
    _fromSheet: false,
    _saving: false,
    _dirty: {},
    _timer: null,
    _uid: "row_" + (UID_SEQ++),

    code: "",
    name: "",
    email: "",
    issue: "",
    decision: "",
    updatedBy: "",
    active: true,
    steps: {},
  };

  for (const s of STEP_KEYS) r.steps[s.col] = "Not Started";
  MODEL.push(r);
  LAST_ADDED_UID = r._uid;
  renderTable();
}

async function undoLastAction() {
  if (!LAST_ACTION) return;

  if (LAST_ACTION.type === "toggleActive") {
    const row = MODEL.find((x) => String(x.code || "").trim() === String(LAST_ACTION.code || "").trim());
    if (!row) {
      LAST_ACTION = null;
      undoBtn.disabled = true;
      return;
    }

    row.active = LAST_ACTION.prevValue;
    markDirtyRow(row, H_ACTIVE, row.active ? "TRUE" : "FALSE");
    await saveRowNow(row);

    LAST_ACTION = null;
    undoBtn.disabled = true;
    renderTable();
  }
}

/* =========================
   HORIZONTAL SCROLLBAR (SYNC)
   ========================= */

let SCROLL_SYNC_LOCK = false;

function syncHorizontalScrollbars() {
  if (!grid || !tableWrap || !hscrollTopInner || !hscrollTop) return;
  hscrollTopInner.style.width = grid.scrollWidth + "px";
  if (!SCROLL_SYNC_LOCK) hscrollTop.scrollLeft = tableWrap.scrollLeft;
}

function bindHorizontalScrollSync() {
  if (!tableWrap || !hscrollTop) return;

  tableWrap.addEventListener("scroll", () => {
    if (SCROLL_SYNC_LOCK) return;
    SCROLL_SYNC_LOCK = true;
    hscrollTop.scrollLeft = tableWrap.scrollLeft;
    SCROLL_SYNC_LOCK = false;
  });

  hscrollTop.addEventListener("scroll", () => {
    if (SCROLL_SYNC_LOCK) return;
    SCROLL_SYNC_LOCK = true;
    tableWrap.scrollLeft = hscrollTop.scrollLeft;
    SCROLL_SYNC_LOCK = false;
  });

  window.addEventListener("resize", syncHorizontalScrollbars);
}

/* =========================
   INIT / RELOAD
   ========================= */

async function reloadAll() {
  setSavePill("save-saving", "Loading...");
  setLoadHintVisible(false);
  GLOBAL_IN_FLIGHT = 0;

  try {
    ALL_ROWS = await loadSheetRowsRobust();
    MODEL = buildModel(ALL_ROWS);

    fillStepOptions();
    buildCandidatePicker();
    buildFilterControls();
    bindSortButtons();
    buildCandidatePickerFiltered(String(searchInput?.value || "").trim().toLowerCase());


    if (!SELECTED_ROW && MODEL.length) {
      SELECTED_ROW = MODEL[0];
      NEW_MODE = false;
      refreshTopFormModeHints();
      updateTopFormFromRow(SELECTED_ROW);
    }

    setSavePill("save-idle", "Idle");
    renderTable();
  } catch (e) {
    console.error(e);
    setSavePill("save-failed", "Failed to load (check sheet access)");
    setLoadHintVisible(true);

    /* Keep page usable for creating/saving new candidates */
    MODEL = [];
    fillStepOptions();
    buildCandidatePicker();
    buildFilterControls();
    renderTable();
  }
}

function wireEvents() {
  searchInput?.addEventListener("input", () => {
  const q = String(searchInput.value || "").trim().toLowerCase();

  // Make search immediately visible in the top section too
  buildCandidatePickerFiltered(q);

  // Keep filtering the table below as designed
  renderTable();
});


  showInactive?.addEventListener("change", renderTable);

  filterColumn?.addEventListener("change", () => {
    rebuildStatusOptions();
    renderTable();
  });

  filterStatus?.addEventListener("change", renderTable);

  reloadBtn?.addEventListener("click", () => reloadAll());

  addRowBtn?.addEventListener("click", addEmptyRow);

  undoBtn?.addEventListener("click", () => undoLastAction().catch(console.error));

  newCandidateBtn?.addEventListener("click", createNewCandidate);
}

/* =========================
   BOOT
   ========================= */

wireEvents();
bindTopFormEvents();
bindHorizontalScrollSync();
reloadAll();
