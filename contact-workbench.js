/* contact-workbench.js — Slice B UI (Field Review layout)
   Requires:
   - app.shell.js (window.ABM.sb, requireAuth, getRoleSafe, getUserSafe)

   HTML expects:
   - #queueBody, #queueStatus
   - #detailEmpty, #detailForm
   - #rawKv
   - #decisionBody
   - #fNotes
   - #detailMsg
*/

(function () {
  const sb = window.ABM && window.ABM.sb;
  if (!sb) {
    console.error("[Contact WB] Supabase client missing (app.shell.js not loaded?)");
    return;
  }

  // ---------- DOM ----------
  function $(id) {
    return document.getElementById(id.replace(/^#/, "")) || document.querySelector(id);
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
    rawKv: $("#rawKv"),

    decisionBody: $("#decisionBody"),

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

    wired: false,
    _inited: false
  };

  // ---------- Init ----------
  async function init() {
    if (state._inited) return;
    state._inited = true;

    await window.ABM.requireAuth({ redirectTo: "/abm-upload/index.html" });

    state.user = await window.ABM.getUserSafe();
    state.role = await window.ABM.getRoleSafe();
    state.userId = state.user?.id || null;

    if (els.role) els.role.textContent = state.role || "—";
    if (els.me) els.me.textContent = state.user?.email || "—";

    if (!state.userId || !(state.role === "ops" || state.role === "admin")) {
      if (els.queueStatus) els.queueStatus.textContent = "Access denied: requires ops or admin.";
      disableAllActions();
      return;
    }

    wireEventsOnce();
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
    const { data, error } = await sb
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

    // Pick base view
    let viewName = "v_contact_workbench_queue_v2";
    if (qMode === "mine") viewName = "v_contact_workbench_queue_mine_v2";
    if (qMode === "done") viewName = "v_contact_workbench_queue_done_v2";

    let query = sb
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
      els.queueStatus.textContent = "Queue load failed (check console).";
      console.error("[Contact WB] queue error:", error);
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
        renderQueue(state.queueRows);
        await loadDetail(id);
      });
    });
  }

  // ---------- Detail ----------
  async function loadDetail(campaignContactId) {
    setMsg("");
    if (els.detailEmpty) els.detailEmpty.style.display = "none";
    if (els.detailForm) els.detailForm.style.display = "block";
    if (els.rawKv) els.rawKv.innerHTML = "Loading…";
    if (els.decisionBody) els.decisionBody.innerHTML = "";

    const { data, error } = await sb
      .from("v_contact_workbench_detail_v5")
      .select("*")
      .eq("campaign_contact_id", campaignContactId)
      .maybeSingle();

    if (error || !data) {
      if (els.rawKv) els.rawKv.innerHTML = `<div class="small">Failed to load detail.</div>`;
      console.error("[Contact WB] detail error:", error);
      disableAllActions();
      return;
    }

    state.selectedDetail = data;
    window.__cw_detail = data;
    window.__cw_selected_id = campaignContactId;

    const statusNorm = normStatus(data.enrichment_status) || "pending";
    const assignedTo = String(data.enrichment_assigned_to || "").trim();
    const isAssigned = !!assignedTo;

    if (els.dStatus) els.dStatus.textContent = statusNorm || "—";
    if (els.dPriority) els.dPriority.textContent = String(data.enrichment_priority ?? "—");
    if (els.dAssigned) els.dAssigned.textContent = isAssigned ? "Yes" : "No";

    // Completeness (SQL only; keep your current contract)
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

    // Render RAW snapshot (keep everything operators need)
    renderRawSnapshot(data);

    // Render Field Review grid
    renderDecisionGrid(data);

    // Notes
    if (els.fNotes) els.fNotes.value = data.notes || "";

    // Enable/disable actions
    const editable = canEdit(data);
    const isUnassignedPending = (!isAssigned) && (statusNorm === "pending");
    const canClaim = (state.role === "ops" || state.role === "admin");

    if (els.btnClaim) els.btnClaim.disabled = !(isUnassignedPending && canClaim);
    if (els.btnSave) els.btnSave.disabled = !editable;
    if (els.btnVerify) els.btnVerify.disabled = !editable;
    if (els.btnReject) els.btnReject.disabled = !editable;

    setFormDisabled(!editable);

    if (!editable && !isUnassignedPending) {
      setMsg("Read-only: this contact is assigned to someone else (or you lack permission).");
    }
  }

  function renderRawSnapshot(data) {
    if (!els.rawKv) return;

    // ---- typed raw phones best-effort (your existing logic) ----
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

    const rawPairs = [
      ["Email", data.email],
      ["Name", ([data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "—")],
      ["Title", data.title],
      ["LinkedIn", rawLinkedIn || "—"],
      ["Mobile Phone", rawMobile || "—"],
      ["Corporate Phone", rawCorp || "—"],
      ["Other Phone", rawOther || (rawFallbackBlob || "—")],
      ["Company", data.company],
      ["Domain", data.domain],
      ["Department", data.department],
      ["Seniority", data.seniority],
      ["Country", data.country],
      ["Industry", data.industry],
      ["City", data.city],
      ["Source System", data.source_system],
      ["Created", fmtDt(data.created_at)],
      ["Assigned At", fmtDt(data.enrichment_assigned_at)],
      ["Due At", fmtDt(data.enrichment_due_at)],
      ["Locked At", fmtDt(data.enrichment_locked_at)]
    ];

    els.rawKv.innerHTML = rawPairs.map(([k, v]) => {
      const val = String(v ?? "").trim();
      const isLinkedIn = String(k).toLowerCase().includes("linkedin");
      const href = normalizeUrl(val);

      const rightSide = (isLinkedIn && val && val !== "—")
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`
        : esc(val || "—");

      return `<div class="k">${esc(k)}</div><div>${rightSide}</div>`;
    }).join("");
  }

  function renderDecisionGrid(data) {
    if (!els.decisionBody) return;

    const vf = (data.verified_fields && typeof data.verified_fields === "object") ? data.verified_fields : {};

    // Helper: get raw values (best-effort)
    const rawEmail = String(data.email || "").trim();
    const rawLinkedIn = String(
      data.raw_linkedin_url ||
      data.linkedin_url ||
      data.linkedin ||
      data.linkedin_profile_url ||
      data.person_linkedin_url ||
      ""
    ).trim();

    const rawMobile = String(data.raw_phone_mobile_best || "").trim();
    const rawCorp   = String(data.raw_phone_corporate_best || "").trim();
    const rawOther  = String(data.raw_phone_other_best || "").trim();

    const rawCompanySize = String(data.company_size || data.raw_company_size || "").trim();

    const fields = [
      { key: "email",         label: "Email",          raw: rawEmail,      placeholder: "Edit email (optional)" },
      { key: "linkedin_url",  label: "LinkedIn URL",   raw: rawLinkedIn,   placeholder: "https://www.linkedin.com/in/…" },
      { key: "phone_mobile",  label: "Mobile Phone",   raw: rawMobile,     placeholder: "+44…" },
      { key: "phone_corporate",label:"Corporate Phone",raw: rawCorp,       placeholder: "+44…" },
      { key: "phone_other",   label: "Other Phone",    raw: rawOther,      placeholder: "+44…" },
      { key: "company_size",  label: "Company Size",   raw: rawCompanySize,placeholder: "e.g. 201-500" }
    ];

    const options = [
      { v: "",            t: "—" },
      { v: "verified",    t: "verified" },
      { v: "unverified",  t: "unverified" },
      { v: "inconclusive",t: "inconclusive" }
    ];

    // Build rows
    els.decisionBody.innerHTML = fields.map(f => {
      const status = String(vf[f.key] || "").trim();                 // status stored as vf.email etc
      const edited = String(vf[f.key + "_value"] || "").trim();      // edited value stored as vf.email_value etc

      const rawCell = renderRawCell(f.key, f.raw);

      return `
        <tr data-field="${esc(f.key)}">
          <td><div class="small"><b>${esc(f.label)}</b></div></td>
          <td>${rawCell}</td>
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
  }

  function renderRawCell(fieldKey, rawValue) {
    const v = String(rawValue || "").trim();
    if (!v) return `<span class="small">—</span>`;

    // make linkedin clickable
    if (fieldKey === "linkedin_url") {
      const href = normalizeUrl(v);
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>`;
    }
    return `<span class="small">${esc(v)}</span>`;
  }

  function setFormDisabled(disabled) {
    const root = els.detailForm;
    if (!root) return;

    // Disable dynamic decision controls
    root.querySelectorAll("[data-cw-edit],[data-cw-verify]").forEach(el => {
      el.disabled = !!disabled;
    });

    // Notes
    if (els.fNotes) els.fNotes.disabled = !!disabled;
  }

  // ---------- Actions ----------
  async function onClaim() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    const statusNorm = normStatus(d.enrichment_status);
    const assignedTo = String(d.enrichment_assigned_to || "").trim();

    if (assignedTo || statusNorm !== "pending") {
      setMsg("Cannot claim: not pending/unassigned.", true);
      return;
    }

    setMsg("Claiming…");

    const { data: upd, error: updErr } = await sb
      .from("campaign_contacts")
      .update({
        enrichment_assigned_to: state.userId,
        enrichment_assigned_at: new Date().toISOString(),
        enrichment_status: "in_progress"
      })
      .eq("campaign_contact_id", d.campaign_contact_id)
      .or("enrichment_status.eq.pending,enrichment_status.is.null")
      .or("enrichment_assigned_to.is.null,enrichment_assigned_to.eq.")
      .select("campaign_contact_id")
      .maybeSingle();

    if (updErr || !upd) {
      setMsg("Claim failed (RLS blocked or already claimed).", true);
      console.error("[Contact WB] claim error:", updErr);
      return;
    }

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

    // Read decision grid controls
    const vf = (d.verified_fields && typeof d.verified_fields === "object") ? { ...d.verified_fields } : {};

    const root = els.detailForm;
    if (!root) {
      setMsg("Save failed: detail form missing.", true);
      return;
    }

    // collect edits (value) + verification status
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

    // Merge into verified_fields:
    // - vf[key] = status
    // - vf[key + "_value"] = edit value
    Object.keys(statuses).forEach(k => { vf[k] = statuses[k]; });
    Object.keys(edits).forEach(k => { vf[k + "_value"] = edits[k]; });

    // prune empties
    Object.keys(vf).forEach(k => {
      if (vf[k] === null || vf[k] === undefined || String(vf[k]).trim() === "") delete vf[k];
    });

    // Persist: phones go to campaign_contacts (structured)
    const phoneUpd = {};
    if (edits.phone_mobile) phoneUpd.phone_mobile = edits.phone_mobile;
    if (edits.phone_corporate) phoneUpd.phone_corporate = edits.phone_corporate;
    if (edits.phone_other) phoneUpd.phone_other = edits.phone_other;

    if (Object.keys(phoneUpd).length > 0) {
      const { error: phoneErr } = await sb
        .from("campaign_contacts")
        .update(phoneUpd)
        .eq("campaign_contact_id", d.campaign_contact_id);

      if (phoneErr) {
        setMsg("Save failed (phone update).", true);
        console.error("[Contact WB] phone save error:", phoneErr);
        return;
      }
    }

    // Persist: enrichment table (linkedin + company size + notes + verified_fields)
    const payload = {
      campaign_contact_id: d.campaign_contact_id,
      notes: (els.fNotes ? (els.fNotes.value || "").trim() : "") || null,
      verified_fields: vf,
      enriched_by: state.userId,
      enriched_at: new Date().toISOString(),

      // Store these in native columns if present in your table
      linkedin_url: (edits.linkedin_url || "").trim() || null,
      company_size: (edits.company_size || "").trim() || null
    };

    // If operator didn't edit linkedin/company_size, keep existing stored values from row if available
    if (!payload.linkedin_url && d.linkedin_url) payload.linkedin_url = d.linkedin_url;
    if (!payload.company_size && (d.company_size || d.verified_company_size)) {
      payload.company_size = d.company_size || d.verified_company_size;
    }

    const { error } = await sb
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

    const { error } = await sb
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

    const { error } = await sb
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
    const { error } = await sb
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
  function bootOnce() {
    init().catch(err => console.error("[Contact WB] init failed:", err));
  }

  window.addEventListener("abm:shell:ready", bootOnce);
  window.addEventListener("DOMContentLoaded", bootOnce);
})();
