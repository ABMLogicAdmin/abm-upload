/* contact-workbench.js — Slice B UI (Field Review layout)
   Requires:
   - app.shell.js (window.ABM.sb, requireAuth, getRoleSafe, getUserSafe)

   HTML expects:
   - #queueBody, #queueStatus
   - #detailEmpty, #detailForm
   - #rawKv (optional; we will not use it now, but safe if present)
   - #decisionBodyKey (key editable fields)
   - #decisionBodyAll (all other raw fields)
   - #fNotes
   - #detailMsg
*/

(function () {

// Use the same shared Supabase client pattern as other pages
function getSbSafe() {
  return window.ABM_SB || (window.ABM && window.ABM.sb) || null;
}
   
 function sbNow() {
     return getSbSafe();
   }
   function sbReq() {
     const sb = sbNow();
     if (!sb) throw new Error("Supabase client not ready");
     return sb;
   }


  // ---------- DOM ----------
  function $(id) {
    return document.getElementById(String(id).replace(/^#/, "")) || document.querySelector(id);
  }

  const els = {
    // optional (may not exist)
    role: $("#wbRole"),
    me: $("#wbMe"),

    filterClient: $("#filterClient"),
    filterCampaign: $("#filterCampaign"),
    filterQueue: $("#filterQueue"),
    filterSearch: $("#filterSearch"),

    queueStatus: $("#queueStatus"),
    queueBody: $("#queueBody"),

    btnRefresh: $("#btnRefresh"),
    btnClaim: $("#btnClaim"),
    btnSave: $("#btnSave"),
    btnVerify: $("#btnVerify"),
    btnReject: $("#btnReject"),

    detailEmpty: $("#detailEmpty"),
    detailForm: $("#detailForm"),

    // optional legacy container (safe to keep)
    rawKv: $("#rawKv"),

    // NEW: two tbody blocks
    decisionBodyKey: $("#decisionBodyKey"),
    decisionBodyAll: $("#decisionBodyAll"),

    dStatus: $("#dStatus"),
    dPriority: $("#dPriority"),
    dAssigned: $("#dAssigned"),
    dScore: $("#dScore"),
    dReady: $("#dReady"),

    fNotes: $("#fNotes"),
    detailMsg: $("#detailMsg")
  };
      
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function fmtDt(x) {
    if (!x) return "—";
    try { return new Date(x).toLocaleString(); } catch { return String(x); }
  }

  function normalizeUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return "https:" + s;
    return "https://" + s;
  }

  function statusDotClass(status) {
    const s = String(status || "").toLowerCase();
    if (s === "pending") return "statusDot status-pending";
    if (s === "in_progress") return "statusDot status-in_progress";
    if (s === "enriched") return "statusDot status-enriched";
    if (s === "verified") return "statusDot status-verified";
    if (s === "rejected") return "statusDot status-rejected";
    return "statusDot";
  }

  function normStatus(s) {
    return String(s || "").trim().toLowerCase();
  }

  function formatScore(x) {
    if (x === null || x === undefined || x === "") return "—";
    const n = Number(x);
    if (Number.isNaN(n)) return String(x);
    if (n >= 0 && n <= 1) return Math.round(n * 100) + "%";
    if (n > 1 && n <= 100) return Math.round(n) + "%";
    return String(n);
  }

  // ---------- State ----------
const state = {
  user: null,
  role: null,
  userId: null,

  campaignOpts: [],

  queueRows: [],
  selectedId: null,
  selectedDetail: null,
  selectedQueueRow: null,   // <-- ADD THIS

  wired: false,
  _inited: false
};
window.__cw_state = state;
   

async function waitForUser(maxMs = 2500) {
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    // 1) shell helper
    try {
      const s = await window.ABM.getSessionSafe();
      const u = s?.session?.user;
      if (u) return u;
    } catch {}

    // 2) direct supabase session (only if sb exists)
    try {
      const sb = sbNow();
      if (sb?.auth?.getSession) {
        const { data } = await sb.auth.getSession();
        const u = data?.session?.user;
        if (u) return u;
      }
    } catch {}

    await new Promise(r => setTimeout(r, 150));
  }

  return null;
}


function redirectToLoginOnce() {
  // Prevent infinite bounce loops (sessionStorage is per-tab)
  const key = "abm_cw_redirect_guard";
  const last = Number(sessionStorage.getItem(key) || "0");
  const now = Date.now();

  // if we already redirected within 3 seconds, STOP
  if (now - last < 3000) {
    console.error("[Contact WB] Redirect loop stopped. Auth did not settle.");
    if (els.queueStatus) {
      els.queueStatus.textContent =
        "Auth did not settle (redirect loop stopped). Hard refresh. If still broken, send app.shell.js auth helpers.";
    }
    return false;
  }

  sessionStorage.setItem(key, String(now));
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  location.replace(`/abm-upload/login.html?next=${next}`);
  return true;
}

  // ---------- Init ----------
async function init() {
  // ✅ Always wire events first (safe even if elements missing)
  wireEventsOnce();

  if (!window.ABM || !window.ABM.getSessionSafe) {
    console.error("[Contact WB] ABM shell helpers missing (app.shell.js not ready)");
    return;
  }

  const sb = sbNow();
  if (!sb) {
    // ✅ Give the user visible feedback instead of a silent return
    if (els.queueStatus) els.queueStatus.textContent = "Loading app…";
    console.warn("[Contact WB] Waiting for Supabase client (app.shell.js)...");
    return;
  }

  // ✅ AUTH GATE: wait for session to settle, otherwise redirect to login
  const user = await waitForUser(2500);
  if (!user) {
    redirectToLoginOnce();
    return;
  }

  // We are authed — show app (login UI does not exist on this page)
  const ag = $("#appGrid");
  if (ag) ag.style.display = "block";

  state.user = { ...user };
  state.role = await window.ABM.getRoleSafe();
  state.userId = state.user?.id || null;

  // Keep navbar identity in sync (optional but good)
  if (state.user?.email) {
    window.ABM_USER_EMAIL = state.user.email;
    window.ABM_ROLE = state.role || "user";
    window.dispatchEvent(new Event("abm:nav:refresh"));
  }

  if (els.role) els.role.textContent = state.role || "—";
  if (els.me) els.me.textContent = state.user?.email || "—";

  if (!state.userId || !(state.role === "ops" || state.role === "admin")) {
    if (els.queueStatus) els.queueStatus.textContent = "Access denied: requires ops or admin.";
    disableAllActions();
    return;
  }

  await loadCampaignOptions();
  await loadQueue();
}

  function wireEventsOnce() {
    if (state.wired) return;
    state.wired = true;

    function on(el, evt, fn, name) {
      if (!el) {
        console.warn(`[Contact WB] Missing element: ${name} (skipping ${evt} binding)`);
        return;
      }
      el.addEventListener(evt, fn);
    }

    on(els.filterClient, "change", () => {
      repopulateCampaignDropdown();
      loadQueue();
    }, "#filterClient");

    on(els.filterCampaign, "change", () => loadQueue(), "#filterCampaign");
    on(els.filterQueue, "change", () => loadQueue(), "#filterQueue");
    on(els.filterSearch, "input", debounce(() => loadQueue(), 250), "#filterSearch");
   
    on(els.btnRefresh, "click", async () => {
      await loadQueue();
      if (state.selectedId) await loadDetail(state.selectedId);
    }, "#btnRefresh");

    on(els.btnClaim, "click", onClaim, "#btnClaim");
    on(els.btnSave, "click", onSave, "#btnSave");
    on(els.btnVerify, "click", onVerify, "#btnVerify");
    on(els.btnReject, "click", onReject, "#btnReject");
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function setMsg(msg, isError = false) {
    if (!els.detailMsg) return;
    els.detailMsg.textContent = msg || "";
    els.detailMsg.style.color = isError ? "#b91c1c" : "";
  }

  function disableAllActions() {
    [els.btnClaim, els.btnSave, els.btnVerify, els.btnReject].forEach(b => {
      if (b) b.disabled = true;
    });
  }
   
  function canEdit(detail) {
    if (!detail) return false;
    if (state.role === "admin") return true;
    return String(detail.enrichment_assigned_to || "") === String(state.userId || "");
  }

  // ---------- Data Loads ----------
  async function loadCampaignOptions() {
    const { data, error } = await sbReq()
      .from("v_contact_workbench_campaign_options")
      .select("campaign_id,campaign_name,client_name")
      .order("client_name", { ascending: true })
      .order("campaign_name", { ascending: true });

    if (error) {
      console.warn("[Contact WB] campaign options error:", error);
      return;
    }

    state.campaignOpts = (data || []).map(r => ({
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      client_name: r.client_name
    }));

    if (els.filterClient) {
      const clients = [...new Set(state.campaignOpts.map(x => x.client_name).filter(Boolean))].sort();
      const keep = els.filterClient.value || "";
      els.filterClient.innerHTML =
        `<option value="">All clients</option>` +
        clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
      if (keep) els.filterClient.value = keep;
    }

    repopulateCampaignDropdown();
  }

  function repopulateCampaignDropdown() {
    if (!els.filterCampaign) {
      console.warn("[Contact WB] Missing element: #filterCampaign (cannot populate campaigns)");
      return;
    }

    const selectedCampaign = els.filterCampaign.value || "";
    const selectedClient = els.filterClient ? (els.filterClient.value || "") : "";

    const filtered = selectedClient
      ? state.campaignOpts.filter(x => x.client_name === selectedClient)
      : state.campaignOpts;

    const opts = filtered.map(r => ({
      id: r.campaign_id,
      label: `${r.client_name} — ${r.campaign_name}`
    }));

    els.filterCampaign.innerHTML =
      `<option value="">All active campaigns</option>` +
      opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");

    if (selectedCampaign) els.filterCampaign.value = selectedCampaign;
  }

  async function loadQueue() {
    if (!els.queueStatus || !els.queueBody) return;

    els.queueStatus.textContent = "Loading queue…";
    els.queueBody.innerHTML = "";
    state.queueRows = [];

    const selectedClient = els.filterClient ? (els.filterClient.value || "") : "";
    const campaignId = els.filterCampaign ? (els.filterCampaign.value || "") : "";
    const qMode = els.filterQueue ? (els.filterQueue.value || "all") : "all";
    const search = (els.filterSearch ? (els.filterSearch.value || "") : "").trim().toLowerCase();

    let viewName = "v_contact_workbench_queue_v2";
    if (qMode === "mine") viewName = "v_contact_workbench_queue_mine_v2";
    if (qMode === "done") viewName = "v_contact_workbench_queue_done_v2";

    let query = sbReq()
      .from(viewName)
      .select([
        "campaign_contact_id",
        "campaign_id",
        "client_name",
        "campaign_name",
        "enrichment_status",
        "enrichment_priority",
        "enrichment_assigned_to",
        "enrichment_assigned_at",
        "enrichment_due_at",
        "email",
        "first_name",
        "last_name",
        "title",
        "company",
        "domain",
        "country",
        "industry",
        "source_system",
        "created_at",
        "completeness_score_sql",
        "is_complete_sql",
        "missing_fields_sql",
        "activation_ready"
      ].join(","))
      .order("enrichment_priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (selectedClient) query = query.eq("client_name", selectedClient);
    if (campaignId) query = query.eq("campaign_id", campaignId);

    if (qMode === "pending") query = query.eq("enrichment_status", "pending");
    if (qMode === "in_progress") query = query.eq("enrichment_status", "in_progress");
    if (qMode === "verified") query = query.eq("enrichment_status", "verified");
    if (qMode === "rejected") query = query.eq("enrichment_status", "rejected");

    const { data, error } = await query;

    if (error) {
     console.error("[Contact WB] queue error:", error);
     els.queueStatus.textContent = "Queue load failed: " + (error.message || "Unknown error");
     return;
   }

    let rows = (data || []);
    if (search) {
      rows = rows.filter(r => {
        const email = String(r.email || "").toLowerCase();
        const comp  = String(r.company || "").toLowerCase();
        const dom   = String(r.domain || "").toLowerCase();
        const fn    = String(r.first_name || "").toLowerCase();
        const ln    = String(r.last_name || "").toLowerCase();
        const name  = (fn + " " + ln).trim();
        return (
          email.includes(search) ||
          comp.includes(search) ||
          dom.includes(search)  ||
          fn.includes(search)   ||
          ln.includes(search)   ||
          name.includes(search)
        );
      });
    }

    state.queueRows = rows;
    els.queueStatus.textContent = `${rows.length} row(s)`;
    renderQueue(rows);
  }

  function renderQueue(rows) {
    if (!els.queueBody) return;

    els.queueBody.innerHTML = rows.map(r => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";
      const company = r.company || r.domain || "—";
      const ready = (r.activation_ready === true) ? "Yes" : "No";
      const score = formatScore(r.completeness_score_sql);
      const active = (state.selectedId && r.campaign_contact_id === state.selectedId) ? "active" : "";
      const statusClass = statusDotClass(r.enrichment_status);

      return `
        <tr class="queueRow ${active}" data-id="${esc(r.campaign_contact_id)}">
          <td><span class="${statusClass}"></span> <span class="small">${esc(r.enrichment_status)}</span></td>
          <td>
            <div><b>${esc(name)}</b></div>
            <div class="small">${esc(r.email || "")}</div>
            <div class="small">${esc(r.title || "")}</div>
          </td>
          <td>
            <div><b>${esc(company)}</b></div>
            <div class="small">${esc(r.country || "")} ${r.industry ? "• " + esc(r.industry) : ""}</div>
          </td>
          <td>
            <div><b>${esc(r.client_name || "")}</b></div>
            <div class="small">${esc(r.campaign_name || "")}</div>
          </td>
          <td>
            <div><b>${esc(ready)}</b></div>
            <div class="small">Score: ${esc(score)}</div>
          </td>
        </tr>
      `;
    }).join("");

   [...els.queueBody.querySelectorAll(".queueRow")].forEach(tr => {
  tr.addEventListener("click", async () => {
    const id = tr.getAttribute("data-id");
    if (!id) return;

    state.selectedId = id;

    // NEW: store the clicked queue row (contains enrichment_status/assigned_to)
    state.selectedQueueRow = (state.queueRows || []).find(
      r => String(r.campaign_contact_id) === String(id)
    ) || null;

    renderQueue(state.queueRows);
    await loadDetail(id);
  });
});

  }

  // ---------- Detail ----------
  async function loadDetail(campaignContactId) {
    setMsg("");

    if (els.detailEmpty) els.detailEmpty.style.display = "none";

   if (els.detailForm) {
     els.detailForm.style.display = "flex";          // <-- KEY CHANGE
     els.detailForm.style.flexDirection = "column";  // ensure flex column
     els.detailForm.style.flex = "1 1 auto";
     els.detailForm.style.minHeight = "0";           // CRITICAL for scrolling
     els.detailForm.style.overflow = "hidden";       // prevent double-scroll
   }


    // clear tables
    if (els.decisionBodyKey) els.decisionBodyKey.innerHTML = "";
    if (els.decisionBodyAll) els.decisionBodyAll.innerHTML = "";

    const { data, error } = await sbReq()
      .from("v_contact_workbench_detail_v5")
      .select("*")
      .eq("campaign_contact_id", campaignContactId)
      .maybeSingle();

    if (error || !data) {
      console.error("[Contact WB] detail error:", error);
      disableAllActions();
      setMsg("Failed to load detail.", true);
      return;
    }

    state.selectedDetail = data;
    window.__cw_detail = data;
    window.__cw_selected_id = campaignContactId;

    // NEW: fallback to queue row because detail view may not include these fields
      const qRow =
        state.selectedQueueRow ||
        (state.queueRows || []).find(r => String(r.campaign_contact_id) === String(campaignContactId)) ||
        null;
      
      const effectiveStatusRaw =
        (data.enrichment_status !== null && data.enrichment_status !== undefined)
          ? data.enrichment_status
          : (qRow ? qRow.enrichment_status : null);
      
      const effectiveAssignedToRaw =
        (data.enrichment_assigned_to !== null && data.enrichment_assigned_to !== undefined)
          ? data.enrichment_assigned_to
          : (qRow ? qRow.enrichment_assigned_to : null);
      
      const statusNorm = normStatus(effectiveStatusRaw);
      const assignedTo = String(effectiveAssignedToRaw || "").trim();
      const isAssigned = !!assignedTo;
      
      const isUnassignedClaimable =
        (!isAssigned) && (!statusNorm || statusNorm === "pending");





    if (els.dStatus) els.dStatus.textContent = statusNorm || "—";
    if (els.dPriority) els.dPriority.textContent = String(data.enrichment_priority ?? "—");
    if (els.dAssigned) els.dAssigned.textContent = isAssigned ? "Yes" : "No";

    const sqlScore = data.completeness_score_effective ?? data.completeness_score_sql ?? data.completeness_score;
    if (els.dScore) {
      if (sqlScore === null || sqlScore === undefined || sqlScore === "") {
        els.dScore.textContent = "—";
        console.error("[Contact WB] Missing completeness score from SQL view", data);
      } else {
        els.dScore.textContent = formatScore(sqlScore);
      }
    }

    if (els.dReady) els.dReady.textContent = (data.activation_ready === true) ? "Yes" : "No";

    // render the single unified table
    renderUnifiedReviewTable(data);

    // Notes
    if (els.fNotes) els.fNotes.value = data.notes || "";

    // Enable/disable actions
    const editable = canEdit(data);
    const canClaim = (state.role === "ops" || state.role === "admin");

    if (els.btnClaim) els.btnClaim.disabled = !(isUnassignedClaimable && canClaim);
    if (els.btnSave) els.btnSave.disabled = !editable;
    if (els.btnVerify) els.btnVerify.disabled = !editable;
    if (els.btnReject) els.btnReject.disabled = !editable;

    setFormDisabled(!editable);

    if (!editable && !isUnassignedClaimable) {
      setMsg("Read-only: this contact is assigned to someone else (or you lack permission).");
    }
  }

  // ---------- Unified Review Table ----------
  function renderUnifiedReviewTable(data) {
    if (!els.decisionBodyKey || !els.decisionBodyAll) {
      console.warn("[Contact WB] Missing decision tbody elements (#decisionBodyKey / #decisionBodyAll)");
      return;
    }

    const vf = (data.verified_fields && typeof data.verified_fields === "object") ? data.verified_fields : {};

    // Build “best raw” values (same heuristics as before)
    const best = computeBestRawFields(data);

    // Key fields you want operators to work through
   const keyFields = [
     { key: "email",           label: "Email",          raw: best.rawEmail,      placeholder: "Edit email (optional)" },
     { key: "name",            label: "Name",           raw: best.rawName,       placeholder: "Edit name (optional)" },
     { key: "title",           label: "Title",          raw: best.rawTitle,      placeholder: "Edit title (optional)" },
     { key: "linkedin_url",    label: "LinkedIn URL",   raw: best.rawLinkedIn,   placeholder: "https://www.linkedin.com/in/…" },
     { key: "phone_mobile",    label: "Mobile Phone",   raw: best.rawMobile,     placeholder: "+44…" },
     { key: "phone_corporate", label: "Corporate Phone",raw: best.rawCorp,       placeholder: "+44…" },
     { key: "phone_other",     label: "Other Phone",    raw: best.rawOther,      placeholder: "+44…" },
     { key: "company_size",    label: "Company Size",   raw: best.rawCompanySize,placeholder: "e.g. 201-500" },
   
     { key: "company",         label: "Company",        raw: String(data.company || "").trim(),      placeholder: "Edit company (optional)" },
     { key: "domain",          label: "Domain",         raw: String(data.domain || "").trim(),       placeholder: "Edit domain (optional)" },
     { key: "department",      label: "Department",     raw: String(data.department || "").trim(),   placeholder: "Edit department (optional)" },
     { key: "seniority",       label: "Seniority",      raw: String(data.seniority || "").trim(),    placeholder: "Edit seniority (optional)" },
     { key: "country",         label: "Country",        raw: String(data.country || "").trim(),      placeholder: "Edit country (optional)" },
     { key: "industry",        label: "Industry",       raw: String(data.industry || "").trim(),     placeholder: "Edit industry (optional)" },
     { key: "city",            label: "City",           raw: String(data.city || "").trim(),         placeholder: "Edit city (optional)" }
   ];

    // Verification dropdown options
    const options = [
      { v: "",             t: "—" },
      { v: "verified",     t: "verified" },
      { v: "unverified",   t: "unverified" },
      { v: "inconclusive", t: "inconclusive" }
    ];

    // Render KEY rows (editable + verified)
    els.decisionBodyKey.innerHTML = keyFields.map(f => {
      // status stored as vf[key]
      const status = String(vf[f.key] || "").trim();
      // edit value stored as vf[key + "_value"]
      const edited = String(vf[f.key + "_value"] || "").trim();

      return `
        <tr data-field="${esc(f.key)}">
          <td><div class="small"><b>${esc(f.label)}</b></div></td>
          <td>${renderRawCell(f.key, f.raw)}</td>
          <td>
            <input
              type="text"
              data-cw-edit="1"
              data-field="${esc(f.key)}"
              placeholder="${esc(f.placeholder)}"
              value="${esc(edited)}"
            />
          </td>
          <td>
            <select data-cw-verify="1" data-field="${esc(f.key)}">
              ${options.map(o => `<option value="${esc(o.v)}" ${o.v === status ? "selected" : ""}>${esc(o.t)}</option>`).join("")}
            </select>
          </td>
        </tr>
      `;
    }).join("");

    // Now render ALL remaining fields (raw-only)
    // Strategy:
    // - flatten the row into display pairs
    // - exclude keys already shown (keyFields) + internal/system columns
    // - show everything else as “Field | Raw | — | —”
    const shownKeys = new Set(keyFields.map(x => x.key));

    // “don’t show” keys (internal / noisy / duplicates)
    const skip = new Set([
      "verified_fields",
      "notes",
      "completeness_score",
      "completeness_score_sql",
      "completeness_score_effective",
      "is_complete_sql",
      "missing_fields_sql",
      "has_email_valid",
      "has_linkedin",
      "has_any_phone",
      "has_title",
      "has_company",
      "has_country",
      "is_complete",
      "is_complete_effective",
      "has_email",
      "has_email_sql",
      "has_email_valid_sql",
      "has_linkedin_sql",
      "has_any_phone_sql",
      "has_title_sql",
      "has_company_sql",
      "has_country_sql",
      "is_complete_effective_sql",
      "phone_mobile_raw",
      "phone_corporate_raw",
      "phone_other_raw",

      // assignment/status fields are already in pills
      "enrichment_status",
      "enrichment_priority",
      "enrichment_assigned_to",
      "enrichment_assigned_at",
      "enrichment_due_at",
      "enrichment_locked_at",

      // we already show in queue or as key
      "email", "first_name", "last_name", "title",
      "raw_linkedin_url", "linkedin_url", "linkedin", "linkedin_profile_url", "person_linkedin_url",
      "raw_phone_mobile_best", "raw_phone_corporate_best", "raw_phone_other_best",
      "phones", "raw_phones",

      // ids
      "campaign_contact_id"
    ]);

    // Add shownKeys to skip (so we don’t duplicate)
    shownKeys.forEach(k => skip.add(k));

    const pairs = buildAllDisplayPairs(data, best);

    const allRows = pairs
      .filter(p => !skip.has(p.key))
      .map(p => ({
        label: p.label,
        key: p.key,
        value: p.value
      }));

    els.decisionBodyAll.innerHTML = allRows.map(r => {
      return `
        <tr data-field="${esc(r.key)}">
          <td><div class="small"><b>${esc(r.label)}</b></div></td>
          <td>${renderRawCell(r.key, r.value)}</td>
          <td><span class="small">—</span></td>
          <td><span class="small">—</span></td>
        </tr>
      `;
    }).join("");
  }

  function computeBestRawFields(data) {
    // ---- typed raw phones best-effort (same logic as your old renderRawSnapshot) ----
    let rawMobile = String(data.raw_phone_mobile_best || "").trim();
    let rawCorp   = String(data.raw_phone_corporate_best || "").trim();
    let rawOther  = String(data.raw_phone_other_best || "").trim();

    const rawFallbackBlob = String(data.phones || data.raw_phones || rawOther || "").trim();

    function splitPhones(blob) {
      if (!blob) return [];
      return blob.split(/[,\n;|]+/).map(p => p.trim()).filter(Boolean);
    }

    function classifyPhones(list) {
      let mobile = "";
      let corporate = "";
      let other = "";
      for (const p of list) {
        const norm = p.replace(/\s+/g, " ").trim();
        if (!mobile && /^\+32\s*4/.test(norm)) { mobile = norm; continue; }
        if (!corporate) { corporate = norm; continue; }
        if (!other) { other = norm; continue; }
      }
      if (!mobile && list.length >= 1) corporate = corporate || list[0];
      if (!other && list.length >= 2) other = list[1];
      return { mobile, corporate, other };
    }

    const otherLooksLikeBlob = /[,;|]/.test(rawOther) || /[,;|]/.test(rawFallbackBlob);
    if (!rawMobile || !rawOther || otherLooksLikeBlob) {
      const list = splitPhones(rawFallbackBlob);
      const c = classifyPhones(list);
      rawMobile = rawMobile || c.mobile;
      rawCorp   = rawCorp   || c.corporate;
      rawOther  = rawOther  || c.other;

      const norm = (s) => String(s || "").replace(/\s+/g, "").trim();
      if (norm(rawOther) && norm(rawCorp) && norm(rawOther).includes(norm(rawCorp))) {
        const cleaned = splitPhones(rawOther).filter(p => norm(p) !== norm(rawCorp));
        rawOther = cleaned.join(", ") || "—";
      }
    }

    const rawLinkedIn = String(
      data.raw_linkedin_url ||
      data.linkedin_url ||
      data.linkedin ||
      data.linkedin_profile_url ||
      data.person_linkedin_url ||
      ""
    ).trim();

    const rawName = ([data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "—");

    const rawCompanySize = String(data.company_size || data.raw_company_size || data.verified_company_size || "").trim();

    return {
      rawEmail: String(data.email || "").trim(),
      rawName,
      rawTitle: String(data.title || "").trim(),
      rawLinkedIn: rawLinkedIn || "",
      rawMobile: rawMobile || "",
      rawCorp: rawCorp || "",
      rawOther: rawOther || (rawFallbackBlob || ""),
      rawCompanySize: rawCompanySize || ""
    };
  }

  function buildAllDisplayPairs(data, best) {
    // We want “all raw fields operators need” in readable labels
    // This list can grow without breaking anything. Anything not in here will still appear
    // via the generic object iteration below.
    const pairs = [];

    // Common “business” fields
    pushPair(pairs, "company", "Company", data.company);
    pushPair(pairs, "domain", "Domain", data.domain);
    pushPair(pairs, "department", "Department", data.department);
    pushPair(pairs, "seniority", "Seniority", data.seniority);
    pushPair(pairs, "country", "Country", data.country);
    pushPair(pairs, "industry", "Industry", data.industry);
    pushPair(pairs, "city", "City", data.city);
    pushPair(pairs, "source_system", "Source System", data.source_system);

    // Dates / ops metadata (these are useful even if not editable)
    pushPair(pairs, "created_at", "Created", fmtDt(data.created_at));
    pushPair(pairs, "enrichment_assigned_at", "Assigned At", fmtDt(data.enrichment_assigned_at));
    pushPair(pairs, "enrichment_due_at", "Due At", fmtDt(data.enrichment_due_at));
    pushPair(pairs, "enrichment_locked_at", "Locked At", fmtDt(data.enrichment_locked_at));

    // Generic: include anything else on the row that has a value and isn’t already present.
    // This is what guarantees “ALL raw fields”.
    const already = new Set(pairs.map(p => p.key));
    Object.keys(data || {}).forEach(k => {
      if (already.has(k)) return;
      const v = data[k];
      if (v === null || v === undefined) return;
      const s = String(v).trim();
      if (!s) return;

      // human-ish label
      const label = k
        .replace(/_/g, " ")
        .replace(/\b\w/g, m => m.toUpperCase());

      pairs.push({ key: k, label, value: v });
    });

    return pairs;
  }

  function pushPair(arr, key, label, value) {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (!s) return;
    arr.push({ key, label, value });
  }

  function renderRawCell(fieldKey, rawValue) {
    const v = String(rawValue || "").trim();
    if (!v) return `<span class="small">—</span>`;

    // clickable linkedin-like fields
    if (String(fieldKey).toLowerCase().includes("linkedin")) {
      const href = normalizeUrl(v);
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>`;
    }
    return `<span class="small">${esc(v)}</span>`;
  }

  function setFormDisabled(disabled) {
    const root = els.detailForm;
    if (!root) return;

    root.querySelectorAll("[data-cw-edit],[data-cw-verify]").forEach(el => {
      el.disabled = !!disabled;
    });

    if (els.fNotes) els.fNotes.disabled = !!disabled;
  }

  // ---------- Actions ----------
  async function onClaim() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

   const qRow = state.selectedQueueRow || null;
   
   const effectiveStatusRaw =
     (d.enrichment_status !== null && d.enrichment_status !== undefined)
       ? d.enrichment_status
       : (qRow ? qRow.enrichment_status : null);
   
   const effectiveAssignedToRaw =
     (d.enrichment_assigned_to !== null && d.enrichment_assigned_to !== undefined)
       ? d.enrichment_assigned_to
       : (qRow ? qRow.enrichment_assigned_to : null);
   
   const statusNorm = normStatus(effectiveStatusRaw);
   const assignedTo = String(effectiveAssignedToRaw || "").trim();

   
   if (assignedTo || (statusNorm && statusNorm !== "pending")) {
     setMsg("Cannot claim: not pending/unassigned.", true);
     return;
   }

    setMsg("Claiming…");

   const { data: updRows, error: updErr } = await sbReq()
     .from("campaign_contacts")
     .update({
       enrichment_assigned_to: state.userId,
       enrichment_assigned_at: new Date().toISOString(),
       enrichment_status: "in_progress"
     })
     .eq("campaign_contact_id", d.campaign_contact_id)
     .or("enrichment_status.is.null,enrichment_status.eq.pending")
     .is("enrichment_assigned_to", null)
     .select("campaign_contact_id,enrichment_status,enrichment_assigned_to"); // <-- no maybeSingle
   
   if (updErr) {
     setMsg("Claim failed (RLS or validation).", true);
     console.error("[Contact WB] claim error:", updErr);
     return;
   }
   
   if (!updRows || updRows.length !== 1) {
     // This is your case right now
     setMsg("Claim failed: 0 rows updated (RLS blocked or already claimed).", true);
     console.warn("[Contact WB] claim updated rows:", updRows);
     return;
   }
   
   const upd = updRows[0];

    await insertEvent(d.campaign_contact_id, "assigned", {});
    setMsg("Claimed.");
    await loadQueue();
    await loadDetail(d.campaign_contact_id);
  }

  async function onSave() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    if (!canEdit(d)) {
      setMsg("Cannot save: not assigned to you (or admin).", true);
      return;
    }

    setMsg("Saving…");

    const vf = (d.verified_fields && typeof d.verified_fields === "object") ? { ...d.verified_fields } : {};
    const root = els.detailForm;

    if (!root) {
      setMsg("Save failed: detail form missing.", true);
      return;
    }

    const edits = {};
    const statuses = {};

    root.querySelectorAll("[data-cw-edit]").forEach(inp => {
      const k = inp.getAttribute("data-field");
      if (!k) return;
      const val = String(inp.value || "").trim();
      if (val) edits[k] = val;
    });

    root.querySelectorAll("[data-cw-verify]").forEach(sel => {
      const k = sel.getAttribute("data-field");
      if (!k) return;
      const val = String(sel.value || "").trim();
      if (val) statuses[k] = val;
    });

    Object.keys(statuses).forEach(k => { vf[k] = statuses[k]; });
    Object.keys(edits).forEach(k => { vf[k + "_value"] = edits[k]; });

    Object.keys(vf).forEach(k => {
      if (vf[k] === null || vf[k] === undefined || String(vf[k]).trim() === "") delete vf[k];
    });

    // Persist: phones go to campaign_contacts
    const phoneUpd = {};
    if (edits.phone_mobile) phoneUpd.phone_mobile = edits.phone_mobile;
    if (edits.phone_corporate) phoneUpd.phone_corporate = edits.phone_corporate;
    if (edits.phone_other) phoneUpd.phone_other = edits.phone_other;

    if (Object.keys(phoneUpd).length > 0) {
      const { error: phoneErr } = await sbReq()
        .from("campaign_contacts")
        .update(phoneUpd)
        .eq("campaign_contact_id", d.campaign_contact_id);

      if (phoneErr) {
        setMsg("Save failed (phone update).", true);
        console.error("[Contact WB] phone save error:", phoneErr);
        return;
      }
    }

    const payload = {
      campaign_contact_id: d.campaign_contact_id,
      notes: (els.fNotes ? (els.fNotes.value || "").trim() : "") || null,
      verified_fields: vf,
      enriched_by: state.userId,
      enriched_at: new Date().toISOString(),

      linkedin_url: (edits.linkedin_url || "").trim() || null,
      company_size: (edits.company_size || "").trim() || null
    };

    if (!payload.linkedin_url && d.linkedin_url) payload.linkedin_url = d.linkedin_url;
    if (!payload.company_size && (d.company_size || d.verified_company_size)) {
      payload.company_size = d.company_size || d.verified_company_size;
    }

    const { error } = await sbReq()
      .from("campaign_contact_enrichment")
      .upsert(payload, { onConflict: "campaign_contact_id" });

    if (error) {
      setMsg("Save failed (RLS blocked or validation error).", true);
      console.error("[Contact WB] save error:", error);
      return;
    }

    await insertEvent(d.campaign_contact_id, "saved", {
      statuses: Object.keys(statuses),
      edits: Object.keys(edits)
    });

    setMsg("Saved.");
    await loadQueue();
    await loadDetail(d.campaign_contact_id);
  }

  async function onVerify() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    if (!canEdit(d)) {
      setMsg("Cannot verify: not assigned to you (or admin).", true);
      return;
    }

    setMsg("Marking verified…");

    const { error } = await sbReq()
      .from("campaign_contacts")
      .update({
        enrichment_status: "verified",
        enrichment_locked_at: new Date().toISOString()
      })
      .eq("campaign_contact_id", d.campaign_contact_id);

    if (error) {
      setMsg("Verify failed.", true);
      console.error("[Contact WB] verify error:", error);
      return;
    }

    await insertEvent(d.campaign_contact_id, "verified", {});
    setMsg("Verified.");
    await loadQueue();
    await loadDetail(d.campaign_contact_id);
  }

  async function onReject() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    if (!canEdit(d)) {
      setMsg("Cannot reject: not assigned to you (or admin).", true);
      return;
    }

    const reason = (els.fNotes ? (els.fNotes.value || "").trim() : "");
    if (!reason) {
      setMsg("Add a rejection reason in Notes first.", true);
      return;
    }

    setMsg("Rejecting…");

    const { error } = await sbReq()
      .from("campaign_contacts")
      .update({
        enrichment_status: "rejected",
        enrichment_locked_at: new Date().toISOString()
      })
      .eq("campaign_contact_id", d.campaign_contact_id);

    if (error) {
      setMsg("Reject failed.", true);
      console.error("[Contact WB] reject error:", error);
      return;
    }

    await insertEvent(d.campaign_contact_id, "rejected", { reason });
    setMsg("Rejected.");
    await loadQueue();
    await loadDetail(d.campaign_contact_id);
  }

  async function insertEvent(campaign_contact_id, event_type, event_payload) {
    const { error } = await sbReq()
      .from("campaign_contact_enrichment_events")
      .insert({
        campaign_contact_id,
        event_type,
        event_payload: event_payload || {},
        created_by: state.userId
      });

    if (error) console.warn("[Contact WB] event insert failed:", error);
  }

  // ---------- BOOT ----------
  let _booted = false;

  async function boot() {
    if (_booted) return;
    try {
      // Try init; if it returns early due to sb not ready, we’ll retry below
      await init();
      // If init got far enough to set userId/role, we consider it booted
      if (state.userId) _booted = true;
    } catch (err) {
      console.error("[Contact WB] init failed:", err);
    }
  }

  // 1) Listen for shell event (good when it fires)
  window.addEventListener("abm:shell:ready", boot);

  // 2) Also try immediately (covers “event fired before listener attached”)
  boot();

  // 3) And retry briefly (covers slow auth settle / slow supabase load)
   (function retryBoot(n = 20) {
     if (_booted || n <= 0) return;
     setTimeout(() => {
       boot();
       retryBoot(n - 1);
     }, 150);
   })();


})();

