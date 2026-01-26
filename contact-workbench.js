
/* contact-workbench.js — Slice B UI
   Requires:
   - app.shell.js (window.ABM.sb, requireAuth, getRoleSafe, getUserSafe)
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
    // optional (we removed from HTML, but keep safe)
    role: $("#wbRole"),
    me: $("#wbMe"),

    filterClient: $("#filterClient"),      // NEW (optional)
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

    dStatus: $("#dStatus"),
    dPriority: $("#dPriority"),
    dAssigned: $("#dAssigned"),
    dScore: $("#dScore"),
    dReady: $("#dReady"),

fLinkedIn: $("#fLinkedIn"),
fPhoneMobile: $("#fPhoneMobile"),
fPhoneCorporate: $("#fPhoneCorporate"),
fPhoneOther: $("#fPhoneOther"),
fCompanySize: $("#fCompanySize"),
fNotes: $("#fNotes"),

vfEmail: $("#vfEmail"),
vfLinkedIn: $("#vfLinkedIn"),
vfPhoneMobile: $("#vfPhoneMobile"),
vfPhoneCorporate: $("#vfPhoneCorporate"),
vfPhoneOther: $("#vfPhoneOther"),


    detailMsg: $("#detailMsg")
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtDt(x) {
    if (!x) return "—";
    try { return new Date(x).toLocaleString(); } catch { return String(x); }
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

  // ---------- State ----------
  const state = {
    user: null,
    role: null,
    userId: null,

    // campaign options cache for client/campaign selectors
    campaignOpts: [],

    queueRows: [],
    selectedId: null,
    selectedDetail: null,

    wired: false
  };

  // ---------- Init ----------
  async function init() {
    // prevent double init if both events fire
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
    await loadCampaignOptions();      // fills campaign + client (if present)
    await loadQueue();
  }

function wireEventsOnce() {
  if (state.wired) return;
  state.wired = true;

  // Helper: bind only if the element exists
  function on(el, evt, fn, name) {
    if (!el) {
      console.warn(`[Contact WB] Missing element: ${name} (skipping ${evt} binding)`);
      return;
    }
    el.addEventListener(evt, fn);
  }

  // Filters (some are optional by design)
  on(els.filterClient, "change", () => {
    repopulateCampaignDropdown();
    loadQueue();
  }, "#filterClient");

  on(els.filterCampaign, "change", () => loadQueue(), "#filterCampaign");
  on(els.filterQueue, "change", () => loadQueue(), "#filterQueue");
  on(els.filterSearch, "input", debounce(() => loadQueue(), 250), "#filterSearch");

  // Actions
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

    // Populate Client dropdown (if present)
    if (els.filterClient) {
      const clients = [...new Set(state.campaignOpts.map(x => x.client_name).filter(Boolean))].sort();
      const keep = els.filterClient.value || "";
      els.filterClient.innerHTML =
        `<option value="">All clients</option>` +
        clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
      if (keep) els.filterClient.value = keep;
    }

    // Populate Campaign dropdown (filtered by selected client if used)
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
    els.queueStatus.textContent = "Loading queue…";
    els.queueBody.innerHTML = "";
    state.queueRows = [];

    const selectedClient = els.filterClient ? (els.filterClient.value || "") : "";
    const campaignId = els.filterCampaign.value || "";
    const qMode = els.filterQueue.value || "all";
    const search = (els.filterSearch.value || "").trim().toLowerCase();

    // Pick base view
    let viewName = "v_contact_workbench_queue";
    if (qMode === "mine") viewName = "v_contact_workbench_queue_mine";
    if (qMode === "done") viewName = "v_contact_workbench_queue_done";

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
        "verified_linkedin_url",
        "verified_company_size",
        "completeness_score",
        "activation_ready"
      ].join(","))
      .order("enrichment_priority", { ascending: true })
   
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
    els.queueBody.innerHTML = rows.map(r => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";
      const company = r.company || r.domain || "—";
      const ready = (r.activation_ready === true) ? "Yes" : "No";
      const score = (r.completeness_score ?? "—");
      const active = (state.selectedId && r.campaign_contact_id === state.selectedId) ? "active" : "";
      const statusClass = statusDotClass(r.enrichment_status);

      return `
        <tr class="queueRow ${active}" data-id="${esc(r.campaign_contact_id)}">
          <td><span class="${statusClass}"></span> <span class="small">${esc(r.enrichment_status)}</span></td>
          <td>
            <div><b>${esc(name)}</b></div>
            <div class="small">${esc(r.email)}</div>
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

  async function loadDetail(campaignContactId) {
    setMsg("");
    els.detailEmpty.style.display = "none";
    els.detailForm.style.display = "block";
    els.rawKv.innerHTML = "Loading…";

    const { data, error } = await sb
      .from("v_contact_workbench_detail_v3")
      .select("*")
      .eq("campaign_contact_id", campaignContactId)
      .maybeSingle();

    if (error || !data) {
      els.rawKv.innerHTML = `<div class="small">Failed to load detail.</div>`;
      console.error("[Contact WB] detail error:", error);
      disableAllActions();
      return;
    }

    state.selectedDetail = data;
      console.log("[Contact WB] Detail row:", data);

    els.dStatus.textContent = data.enrichment_status || "—";
    els.dPriority.textContent = String(data.enrichment_priority ?? "—");
    els.dAssigned.textContent = data.enrichment_assigned_to ? "Yes" : "No";
    els.dScore.textContent = String(data.completeness_score ?? "—");
    els.dReady.textContent = (data.activation_ready === true) ? "Yes" : "No";

// ---- Typed raw phones (best-effort) ----
let rawMobile = String(data.raw_phone_mobile_best || "").trim();
let rawCorp   = String(data.raw_phone_corporate_best || "").trim();
let rawOther  = String(data.raw_phone_other_best || "").trim();

// fallback: if typed raws aren’t present, use the legacy blob and split it
const rawFallbackBlob = String(data.phones || data.raw_phones || rawOther || "").trim();

function splitPhones(blob) {
  if (!blob) return [];
  return blob
    .split(/[,\n;|]+/)
    .map(p => p.trim())
    .filter(Boolean);
}

// very simple heuristic (works well for your current Belgian-style data):
// - treat +32 4xx... as "mobile"
// - otherwise first becomes corporate, second becomes other
function classifyPhones(list) {
  let mobile = "";
  let corporate = "";
  let other = "";

  for (const p of list) {
    const norm = p.replace(/\s+/g, " ").trim();
    if (!mobile && /^\+32\s*4/.test(norm)) {
      mobile = norm;
      continue;
    }
    if (!corporate) { corporate = norm; continue; }
    if (!other) { other = norm; continue; }
  }

  // if we never found a mobile, just assign sequentially
  if (!mobile && list.length >= 1) corporate = corporate || list[0];
  if (!other && list.length >= 2) other = list[1];

  return { mobile, corporate, other };
}

if (!rawMobile && !rawCorp) {
  const list = splitPhones(rawFallbackBlob);
  const c = classifyPhones(list);

  rawMobile = rawMobile || c.mobile;
  rawCorp   = rawCorp   || c.corporate;
  rawOther  = rawOther  || c.other;
}

const rawPairs = [
  ["Email", data.email],
  ["Name", ([data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "—")],
  ["Title", data.title],
  ["LinkedIn", data.raw_linkedin_url || "—"],

  ["Mobile Phone (raw)", rawMobile || "—"],
  ["Corporate Phone (raw)", rawCorp || "—"],
  ["Other Phone (raw)", rawOther || (rawFallbackBlob || "—")],

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
      
        const rightSide = (isLinkedIn && val && val !== "—")
          ? `<a href="${esc(val)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`
          : esc(val || "—");
   
        return `<div class="k">${esc(k)}</div><div>${rightSide}</div>`;
   }).join("");

els.fLinkedIn.value = data.verified_linkedin_url || "";

// verified phones now come from campaign_contacts (via the v3 view)
els.fPhoneMobile.value = data.phone_mobile || "";
els.fPhoneCorporate.value = data.phone_corporate || "";
els.fPhoneOther.value = data.phone_other || "";

els.fCompanySize.value = data.company_size || "";
els.fNotes.value = data.notes || "";

const vf = (data.verified_fields && typeof data.verified_fields === "object") ? data.verified_fields : {};
els.vfEmail.value = vf.email || "";
els.vfLinkedIn.value = vf.linkedin_url || "";

els.vfPhoneMobile.value = vf.phone_mobile || "";
els.vfPhoneCorporate.value = vf.phone_corporate || "";
els.vfPhoneOther.value = vf.phone_other || "";

    const editable = canEdit(data);
    const isUnassignedPending =
     (!data.enrichment_assigned_to) &&
     (data.enrichment_status === "pending");
   
    const canClaim =
    state.role === "ops" || state.role === "admin";
    els.btnClaim.disabled = !(isUnassignedPending && canClaim);

    els.btnSave.disabled = !editable;
    els.btnVerify.disabled = !editable;
    els.btnReject.disabled = !editable;

    setFormDisabled(!editable);

    if (!editable && !isUnassignedPending) {
      setMsg("Read-only: this contact is assigned to someone else (or you lack permission).");
    }
  }

  function setFormDisabled(disabled) {
    [
  els.fLinkedIn,
  els.fPhoneMobile, els.fPhoneCorporate, els.fPhoneOther,
  els.fCompanySize, els.fNotes,
  els.vfEmail, els.vfLinkedIn,
  els.vfPhoneMobile, els.vfPhoneCorporate, els.vfPhoneOther
]
      .forEach(el => { if (el) el.disabled = !!disabled; });
  }

  // ---------- Actions ----------
  async function onClaim() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    if (d.enrichment_assigned_to || d.enrichment_status !== "pending") {
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
      .is("enrichment_assigned_to", null)
      .eq("enrichment_status", "pending")
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

const verified_fields = {
  ...(d.verified_fields && typeof d.verified_fields === "object" ? d.verified_fields : {}),
  email: els.vfEmail.value || null,
  linkedin_url: els.vfLinkedIn.value || null,
  phone_mobile: els.vfPhoneMobile.value || null,
  phone_corporate: els.vfPhoneCorporate.value || null,
  phone_other: els.vfPhoneOther.value || null
};


    Object.keys(verified_fields).forEach(k => {
      if (verified_fields[k] === null || verified_fields[k] === "") delete verified_fields[k];
    });

   const payload = {
  campaign_contact_id: d.campaign_contact_id,
  linkedin_url: (els.fLinkedIn.value || "").trim() || null,
  company_size: (els.fCompanySize.value || "").trim() || null,
  notes: (els.fNotes.value || "").trim() || null,
  verified_fields,
  enriched_by: state.userId,
  enriched_at: new Date().toISOString()
};

// Save structured verified phones on campaign_contacts
const phoneUpd = {
  phone_mobile: (els.fPhoneMobile.value || "").trim() || null,
  phone_corporate: (els.fPhoneCorporate.value || "").trim() || null,
  phone_other: (els.fPhoneOther.value || "").trim() || null
};

const { error: phoneErr } = await sb
  .from("campaign_contacts")
  .update(phoneUpd)
  .eq("campaign_contact_id", d.campaign_contact_id);

if (phoneErr) {
  setMsg("Save failed (phone update).", true);
  console.error("[Contact WB] phone save error:", phoneErr);
  return;
}


    const { error } = await sb
      .from("campaign_contact_enrichment")
      .upsert(payload, { onConflict: "campaign_contact_id" });

    if (error) {
      setMsg("Save failed (RLS blocked or validation error).", true);
      console.error("[Contact WB] save error:", error);
      return;
    }

    await insertEvent(d.campaign_contact_id, "saved", { fields: Object.keys(verified_fields) });
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

    const reason = (els.fNotes.value || "").trim();
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

  // preferred: shell-ready event
  window.addEventListener("abm:shell:ready", bootOnce);
  // fallback: DOM ready (in case event isn’t dispatched)
  window.addEventListener("DOMContentLoaded", bootOnce);
})();
