/* contact-workbench.js — Slice B UI
   Uses:
   - Reads: v_contact_workbench_queue, _mine, _done, _detail, campaign_options
   - Writes: campaign_contacts, campaign_contact_enrichment, campaign_contact_enrichment_events
   Requires:
   - app.shell.js (window.ABM.sb, getRoleSafe, getUserSafe)
*/

(function () {
  const sb = window.ABM && window.ABM.sb;
  if (!sb) {
    console.error("[Contact WB] Supabase client missing (app.shell.js not loaded?)");
    return;
  }

  // ---------- DOM ----------
  const els = {
    role: $("#wbRole"),
    me: $("#wbMe"),

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
    fPhone: $("#fPhone"),
    fCompanySize: $("#fCompanySize"),
    fNotes: $("#fNotes"),

    vfEmail: $("#vfEmail"),
    vfLinkedIn: $("#vfLinkedIn"),
    vfPhone: $("#vfPhone"),

    detailMsg: $("#detailMsg")
  };

  function $(id) {
    return document.getElementById(id.replace(/^#/, "")) || document.querySelector(id);
  }

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

    queueRows: [],
    selectedId: null,
    selectedDetail: null
  };

  // ---------- Init ----------
  async function init() {
    await window.ABM.requireAuth({ redirectTo: "/abm-upload/index.html" });

    state.user = await window.ABM.getUserSafe();
    state.role = await window.ABM.getRoleSafe(); // 'ops' | 'admin' | 'uploader'
    state.userId = state.user?.id || null;

    els.role.textContent = state.role || "—";
    els.me.textContent = state.user?.email || "—";

    if (!state.userId || !(state.role === "ops" || state.role === "admin")) {
      els.queueStatus.textContent = "Access denied: requires ops or admin.";
      disableAllActions();
      return;
    }

    wireEvents();
    await loadCampaignOptions();
    await loadQueue();
  }

  function wireEvents() {
    els.filterCampaign.addEventListener("change", () => loadQueue());
    els.filterQueue.addEventListener("change", () => loadQueue());
    els.filterSearch.addEventListener("input", debounce(() => loadQueue(), 250));

    els.btnRefresh.addEventListener("click", async () => {
      await loadQueue();
      if (state.selectedId) await loadDetail(state.selectedId);
    });

    els.btnClaim.addEventListener("click", onClaim);
    els.btnSave.addEventListener("click", onSave);
    els.btnVerify.addEventListener("click", onVerify);
    els.btnReject.addEventListener("click", onReject);
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
    els.btnClaim.disabled = true;
    els.btnSave.disabled = true;
    els.btnVerify.disabled = true;
    els.btnReject.disabled = true;
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

    const opts = (data || []).map(r => ({
      id: r.campaign_id,
      label: `${r.client_name} — ${r.campaign_name}`
    }));

    // Keep selected if possible
    const selected = els.filterCampaign.value;

    els.filterCampaign.innerHTML = `<option value="">All active campaigns</option>` +
      opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");

    if (selected) els.filterCampaign.value = selected;
  }

  async function loadQueue() {
    els.queueStatus.textContent = "Loading queue…";
    els.queueBody.innerHTML = "";
    state.queueRows = [];

    const campaignId = els.filterCampaign.value || "";
    const qMode = els.filterQueue.value || "all";
    const search = (els.filterSearch.value || "").trim().toLowerCase();

    // Pick base view
    let viewName = "v_contact_workbench_queue";
    if (qMode === "mine") viewName = "v_contact_workbench_queue_mine";
    if (qMode === "done") viewName = "v_contact_workbench_queue_done";

    // Columns that exist on all queue views per your schema dump
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
        "verified_phone",
        "verified_company_size",
        "completeness_score",
        "activation_ready"
      ].join(","))
      .order("enrichment_priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (campaignId) query = query.eq("campaign_id", campaignId);

    // Status filters (only apply when not using _done view)
    if (qMode === "pending") query = query.eq("enrichment_status", "pending");
    if (qMode === "in_progress") query = query.eq("enrichment_status", "in_progress");
    if (qMode === "verified") query = query.eq("enrichment_status", "verified");
    if (qMode === "rejected") query = query.eq("enrichment_status", "rejected");

    const { data, error } = await query;

    if (error) {
      els.queueStatus.textContent = "Queue load failed.";
      console.error("[Contact WB] queue error:", error);
      return;
    }

    // Client-side search (Supabase ilike across multiple cols is possible, but keep simple)
    let rows = (data || []);
    if (search) {
      rows = rows.filter(r => {
        const email = String(r.email || "").toLowerCase();
        const comp = String(r.company || "").toLowerCase();
        const dom  = String(r.domain || "").toLowerCase();
        return email.includes(search) || comp.includes(search) || dom.includes(search);
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

    // row click
    [...els.queueBody.querySelectorAll(".queueRow")].forEach(tr => {
      tr.addEventListener("click", async () => {
        const id = tr.getAttribute("data-id");
        if (!id) return;
        state.selectedId = id;
        // re-render highlights quickly
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
      .from("v_contact_workbench_detail")
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

    // Header pills
    els.dStatus.textContent = data.enrichment_status || "—";
    els.dPriority.textContent = String(data.enrichment_priority ?? "—");
    els.dAssigned.textContent = data.enrichment_assigned_to ? "Yes" : "No";
    els.dScore.textContent = String(data.completeness_score ?? "—");
    els.dReady.textContent = (data.activation_ready === true) ? "Yes" : "No";

    // Raw KV (read-only)
    const rawPairs = [
      ["Email", data.email],
      ["Name", ([data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "—")],
      ["Title", data.title],
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

    els.rawKv.innerHTML = rawPairs.map(([k, v]) => `
      <div class="k">${esc(k)}</div><div>${esc(v ?? "—")}</div>
    `).join("");

    // Verified layer fields
    els.fLinkedIn.value = data.linkedin_url || "";
    els.fPhone.value = data.phone || "";
    els.fCompanySize.value = data.company_size || "";
    els.fNotes.value = data.notes || "";

    const vf = (data.verified_fields && typeof data.verified_fields === "object") ? data.verified_fields : {};
    els.vfEmail.value = vf.email || "";
    els.vfLinkedIn.value = vf.linkedin_url || "";
    els.vfPhone.value = vf.phone || "";

    // Buttons + editability
    const editable = canEdit(data);
    const isUnassignedPending = (!data.enrichment_assigned_to) && (data.enrichment_status === "pending");

    // Claim is only valid when unassigned+pending (matches cc_claim_ops_unassigned)
    els.btnClaim.disabled = !(isUnassignedPending && state.role === "ops");

    // Save/Verify/Reject only if editable
    els.btnSave.disabled = !editable;
    els.btnVerify.disabled = !editable;
    els.btnReject.disabled = !editable;

    // Lock the form when not editable
    setFormDisabled(!editable);

    if (!editable && !isUnassignedPending) {
      setMsg("Read-only: this contact is assigned to someone else (or you lack permission).");
    } else {
      setMsg("");
    }
  }

  function setFormDisabled(disabled) {
    [
      els.fLinkedIn, els.fPhone, els.fCompanySize, els.fNotes,
      els.vfEmail, els.vfLinkedIn, els.vfPhone
    ].forEach(el => el.disabled = !!disabled);
  }

  // ---------- Actions ----------
  async function onClaim() {
    const d = state.selectedDetail;
    if (!d?.campaign_contact_id) return;

    // Enforce policy match: unassigned + pending
    if (d.enrichment_assigned_to || d.enrichment_status !== "pending") {
      setMsg("Cannot claim: not pending/unassigned.", true);
      return;
    }

    setMsg("Claiming…");

    // Update campaign_contacts (RLS: cc_claim_ops_unassigned)
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

    // Insert event (RLS: ccee_insert_ops_assigned will now pass)
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
      phone: els.vfPhone.value || null
    };

    // Clean nulls out of json (optional)
    Object.keys(verified_fields).forEach(k => {
      if (verified_fields[k] === null || verified_fields[k] === "") delete verified_fields[k];
    });

    const payload = {
      campaign_contact_id: d.campaign_contact_id,
      linkedin_url: (els.fLinkedIn.value || "").trim() || null,
      phone: (els.fPhone.value || "").trim() || null,
      company_size: (els.fCompanySize.value || "").trim() || null,
      notes: (els.fNotes.value || "").trim() || null,
      verified_fields,
      enriched_by: state.userId,
      enriched_at: new Date().toISOString()
      // completeness_score + activation_ready can be computed by triggers/functions if you added them
    };

    // Upsert enrichment (RLS: cce_insert_ops_assigned / cce_update_ops_assigned)
    const { error } = await sb
      .from("campaign_contact_enrichment")
      .upsert(payload, { onConflict: "campaign_contact_id" });

    if (error) {
      setMsg("Save failed (RLS blocked or validation error).", true);
      console.error("[Contact WB] save error:", error);
      return;
    }

    await insertEvent(d.campaign_contact_id, "saved", {
      fields: {
        linkedin_url: !!payload.linkedin_url,
        phone: !!payload.phone,
        company_size: !!payload.company_size,
        verified_fields: Object.keys(verified_fields)
      }
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
    // RLS enforces admin OR assigned-to-me via can_edit_campaign_contact()
    const { error } = await sb
      .from("campaign_contact_enrichment_events")
      .insert({
        campaign_contact_id,
        event_type,
        event_payload: event_payload || {},
        created_by: state.userId
      });

    if (error) {
      // Don’t fail the UI if audit insert fails; but log it.
      console.warn("[Contact WB] event insert failed:", error);
    }
  }

  // ---------- boot ----------
  window.addEventListener("abm:shell:ready", () => init().catch(console.error));
  init().catch(console.error);
})();
