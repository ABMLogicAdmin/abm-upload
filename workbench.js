// workbench.js
(() => {
  // =========================
  // CONFIG (EDIT THIS!)
  // =========================
  const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";
  // =========================

  if (!window.supabase) {
    alert("Supabase SDK failed to load. Check CDN/network.");
    throw new Error("Supabase SDK not loaded");
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Shared globals for admin-export.js
  window.ABM = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    sb,
    currentRole: null,
    me: null
  };

  const $ = (id) => document.getElementById(id);

  // State
  let queueRows = [];
  let currentLead = null;
  let selectedKey = null;

  // Wire UI
  $("loginBtn").addEventListener("click", login);
  $("logoutBtn").addEventListener("click", logout);

  $("refreshBtn").addEventListener("click", () => loadQueue());
  $("viewSelect").addEventListener("change", () => loadQueue());
  $("searchInput").addEventListener("input", renderQueue);
  $("clearBtn").addEventListener("click", () => { $("searchInput").value = ""; renderQueue(); });

  $("saveBtn").addEventListener("click", saveLead);
  $("releaseBtn").addEventListener("click", releaseLead);
  $("doneBtn").addEventListener("click", markDone);
  $("rejectBtn").addEventListener("click", markRejected);

  $("saveOutcomeBtn").addEventListener("click", saveOutcome);

  init();

  async function init() {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      await afterLogin();
    }
  }

  function setLoginStatus(t) { $("loginStatus").textContent = t || ""; }
  function setDetailStatus(t) { $("detailStatus").textContent = t || ""; }
  function setOutcomeStatus(t) { $("outcomeStatus").textContent = t || ""; }

  function formatRole(role) {
    if (!role) return "User";
    if (role === "admin") return "Admin";
    if (role === "ops") return "Ops";
    if (role === "uploader") return "Uploader";
    return role;
  }

  function displayName(user) {
    const md = user?.user_metadata || {};
    return md.full_name || md.name || user?.email || "Unknown";
  }

  function renderWhoAmI() {
    const el = $("whoAmI");
    if (!window.ABM.me) { el.textContent = ""; return; }
    el.textContent = `${formatRole(window.ABM.currentRole)}, ${displayName(window.ABM.me)}`;
  }

  async function login() {
    setLoginStatus("Signing in…");

    const email = $("email").value.trim();
    const password = $("password").value;

    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_")) {
      setLoginStatus("ERROR: Set SUPABASE_ANON_KEY in workbench.js (public anon key).");
      return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginStatus(error.message);
      return;
    }

    setLoginStatus("Signed in.");
    await afterLogin();
  }

  async function afterLogin() {
    const { data: userRes, error: userErr } = await sb.auth.getUser();
    if (userErr || !userRes?.user) {
      setLoginStatus("Login succeeded but user fetch failed.");
      return;
    }
    window.ABM.me = userRes.user;

    // Role lookup (UI only; server enforcement still via RLS/RPC/Edge)
    try {
      const { data: roleRow, error: roleErr } = await sb
        .from("app_users")
        .select("role")
        .eq("user_id", window.ABM.me.id)
        .maybeSingle();

      if (roleErr) window.ABM.currentRole = null;
      else window.ABM.currentRole = roleRow?.role || null;
    } catch {
      window.ABM.currentRole = null;
    }

    renderWhoAmI();

    $("loginCard").style.display = "none";
    $("topNav").style.display = "flex";
    $("appGrid").style.display = "grid";

    await loadQueue();
  }

  async function logout() {
    await sb.auth.signOut();
    location.reload();
  }

  // ---------- Queue ----------

  function leadKey(r) {
    return `${r.ingest_job_id}:${r.row_number}`;
  }

  function pill(text) {
    return `<span class="detailPill">${text || "-"}</span>`;
  }

  function ownerLabel(r) {
    // v_enrichment_queue_all should provide enriched_by (uuid) or enriched_by_email, etc.
    if (!r?.enriched_by) return "-";
    if (window.ABM.me && r.enriched_by === window.ABM.me.id) return "me";
    return "•";
  }

  function mapViewToStatuses(view) {
    if (view === "pending_in_progress") return ["pending", "in_progress"];
    if (view === "pending") return ["pending"];
    if (view === "in_progress") return ["in_progress"];
    if (view === "done") return ["done"];
    if (view === "rejected") return ["rejected"];
    return ["pending", "in_progress"];
  }

  async function loadQueue() {
    setDetailStatus("");

    const view = $("viewSelect").value;
    const statuses = mapViewToStatuses(view);

    // IMPORTANT: use the VIEW and enrichment_status
    const { data, error } = await sb
      .from("v_enrichment_queue_all")
      .select("*")
      .in("enrichment_status", statuses)
      .order("enrichment_status", { ascending: true })
      .order("ingest_job_id", { ascending: false })
      .order("row_number", { ascending: true });

    if (error) {
      setDetailStatus("ERROR loading queue:\n" + error.message);
      queueRows = [];
      renderQueue();
      return;
    }

    queueRows = data || [];
    renderQueue();
  }

  function renderQueue() {
    const body = $("queueBody");
    const search = ($("searchInput").value || "").trim().toLowerCase();

    const rows = queueRows.filter(r => {
      if (!search) return true;
      const hay = [
        r.first_name, r.last_name, r.email, r.company, r.title,
        r.enrichment_status
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });

    $("queueCount").textContent = `Showing ${rows.length} row(s).`;

    body.innerHTML = rows.map(r => {
      const key = leadKey(r);
      const selected = selectedKey === key ? "selected-row" : "";
      return `
        <tr class="${selected}" data-key="${key}">
          <td>${pill(r.enrichment_status)}</td>
          <td>${r.first_name || ""}</td>
          <td>${r.last_name || ""}</td>
          <td><strong>${r.email || ""}</strong></td>
          <td>
            <div style="font-weight:900; color:#22233D;">${r.company || ""}</div>
            <div class="muted">${(r.ingest_job_id || "").slice(0,8)}… • row ${r.row_number}</div>
          </td>
          <td>${r.title || ""}</td>
          <td>${ownerLabel(r)}</td>
          <td style="text-align:right;">
            <div class="actions">
              <button class="btn-ghost" data-action="open">Open</button>
              <button class="btn" data-action="claim">Claim</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    body.querySelectorAll("tr").forEach(tr => {
      tr.addEventListener("click", async (e) => {
        const btn = e.target?.closest("button");
        const key = tr.dataset.key;
        if (!key) return;

        const [ingest_job_id, rowStr] = key.split(":");
        const row_number = parseInt(rowStr, 10);

        if (btn) {
          const action = btn.dataset.action;
          if (action === "open") await openLead(ingest_job_id, row_number);
          if (action === "claim") await claimLead(ingest_job_id, row_number);
          e.stopPropagation();
          return;
        }

        await openLead(ingest_job_id, row_number);
      });
    });
  }

  async function fetchLead(ingest_job_id, row_number) {
    // Pull full row from stg_leads (not the view)
    const { data, error } = await sb
      .from("stg_leads")
      .select("*")
      .eq("ingest_job_id", ingest_job_id)
      .eq("row_number", row_number)
      .single();
    if (error) throw error;
    return data;
  }

  async function openLead(ingest_job_id, row_number) {
    setDetailStatus("Opening lead…");

    try {
      const lead = await fetchLead(ingest_job_id, row_number);
      currentLead = lead;
      selectedKey = leadKey(lead);

      // Your system uses enrichment_status (not status)
      $("detailStatusPill").textContent = lead.enrichment_status || "unknown";

      $("leadContext").style.display = "block";
      $("ctxName").textContent = `${lead.first_name || ""} ${lead.last_name || ""}`.trim();
      $("ctxEmail").textContent = lead.email || "";
      $("ctxCompany").textContent = lead.company || "";
      $("ctxTitle").textContent = lead.title || "";
      $("ctxOwner").textContent = (lead.enriched_by === window.ABM.me?.id) ? "me" : (lead.enriched_by ? "•" : "-");

      $("ingestJobId").value = lead.ingest_job_id;
      $("rowNumber").value = lead.row_number;

      // These field names must match your stg_leads columns
      $("phoneCountry").value = lead.phone_country_iso2 || "";   // common in your older build
      $("phoneDirect").value = lead.direct_phone || "";
      $("phoneMobile").value = lead.mobile_phone || "";
      $("enrichmentNotes").value = lead.enrichment_notes || "";

      $("verifiedFields").value = stringifyMaybe(lead.verified_fields);
      $("enrichedPayload").value = stringifyMaybe(lead.enriched_payload);
      $("rawPayload").value = stringifyMaybe(lead.raw_payload);

      const isRejected = lead.enrichment_status === "rejected";
      $("rejectedBanner").style.display = isRejected ? "block" : "none";

      await loadOutcome(lead);

      renderQueue();
      setDetailStatus("");
    } catch (e) {
      setDetailStatus("ERROR opening lead:\n" + (e?.message || String(e)));
    }
  }

  function stringifyMaybe(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  // ---------- RPC Actions (the “correct” model) ----------

  async function claimLead(ingest_job_id, row_number) {
    setDetailStatus("Claiming lead…");

    try {
      const { error } = await sb.rpc("claim_lead", {
        p_ingest_job_id: ingest_job_id,
        p_row_number: row_number
      });
      if (error) throw error;

      await loadQueue();
      await openLead(ingest_job_id, row_number);
      setDetailStatus("Claimed.");
    } catch (e) {
      setDetailStatus("ERROR claiming lead:\n" + (e?.message || String(e)));
    }
  }

  function requireCurrentLead() {
    if (!currentLead) {
      setDetailStatus("Select a lead first.");
      return false;
    }
    return true;
  }

  async function saveLead() {
    if (!requireCurrentLead()) return;
    setDetailStatus("Saving…");

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    // Match your schema: update via RPC to keep logic + RLS consistent
    const payload = {
      p_ingest_job_id: ingest_job_id,
      p_row_number: row_number,
      p_phone_country_iso2: $("phoneCountry").value || null,
      p_direct_phone: $("phoneDirect").value.trim() || null,
      p_mobile_phone: $("phoneMobile").value.trim() || null,
      p_enrichment_notes: $("enrichmentNotes").value.trim() || null
    };

    try {
      const { error } = await sb.rpc("update_enrichment", payload);
      if (error) throw error;

      await loadQueue();
      await openLead(ingest_job_id, row_number);
      setDetailStatus("Saved.");
    } catch (e) {
      setDetailStatus("ERROR saving:\n" + (e?.message || String(e)));
    }
  }

  async function releaseLead() {
    if (!requireCurrentLead()) return;
    setDetailStatus("Releasing…");

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    try {
      const { error } = await sb.rpc("release_lead", {
        p_ingest_job_id: ingest_job_id,
        p_row_number: row_number
      });
      if (error) throw error;

      currentLead = null;
      selectedKey = null;

      await loadQueue();
      clearDetail();
      setDetailStatus("Released.");
    } catch (e) {
      setDetailStatus("ERROR releasing:\n" + (e?.message || String(e)));
    }
  }

  async function markDone() {
    if (!requireCurrentLead()) return;
    setDetailStatus("Marking done…");

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    try {
      const { error } = await sb.rpc("mark_lead_done", {
        p_ingest_job_id: ingest_job_id,
        p_row_number: row_number
      });
      if (error) throw error;

      await loadQueue();
      await openLead(ingest_job_id, row_number);
      setDetailStatus("Done.");
    } catch (e) {
      setDetailStatus("ERROR marking done:\n" + (e?.message || String(e)));
    }
  }

  async function markRejected() {
    if (!requireCurrentLead()) return;

    const reason = prompt("Enter rejection reason (optional):") || "";
    setDetailStatus("Rejecting…");

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    try {
      const { error } = await sb.rpc("reject_lead", {
        p_ingest_job_id: ingest_job_id,
        p_row_number: row_number,
        p_reason: reason
      });
      if (error) throw error;

      await loadQueue();
      await openLead(ingest_job_id, row_number);
      setDetailStatus("Rejected.");
    } catch (e) {
      setDetailStatus("ERROR rejecting:\n" + (e?.message || String(e)));
    }
  }

  function clearDetail() {
    $("detailStatusPill").textContent = "No lead selected";
    $("leadContext").style.display = "none";
    $("ingestJobId").value = "";
    $("rowNumber").value = "";
    $("phoneCountry").value = "";
    $("phoneDirect").value = "";
    $("phoneMobile").value = "";
    $("enrichmentNotes").value = "";
    $("verifiedFields").value = "";
    $("enrichedPayload").value = "";
    $("rawPayload").value = "";
    $("rejectedBanner").style.display = "none";
    $("outcomePill").textContent = "No outcome";
    $("outcomeType").value = "";
    $("outcomeNotes").value = "";
    setOutcomeStatus("");
  }

  // ---------- Outcomes ----------
  async function loadOutcome(lead) {
    try {
      const { data, error } = await sb
        .from("lead_outcomes")
        .select("*")
        .eq("ingest_job_id", lead.ingest_job_id)
        .eq("row_number", lead.row_number)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        $("outcomePill").textContent = "No outcome";
        $("outcomeType").value = "";
        $("outcomeNotes").value = "";
        setOutcomeStatus("");
        return;
      }

      $("outcomePill").textContent = data.outcome_type || "Outcome";
      $("outcomeType").value = data.outcome_type || "";
      $("outcomeNotes").value = data.outcome_notes || "";
    } catch (e) {
      console.warn("Outcome load failed:", e?.message || e);
    }
  }

  async function saveOutcome() {
    if (!requireCurrentLead()) return;

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);
    const outcome_type = $("outcomeType").value || null;
    const outcome_notes = $("outcomeNotes").value.trim() || null;

    if (!outcome_type) {
      setOutcomeStatus("Pick an outcome first.");
      return;
    }

    setOutcomeStatus("Saving outcome…");

    try {
      const payload = {
        ingest_job_id,
        row_number,
        outcome_type,
        outcome_notes,
        updated_by: window.ABM.me.id
      };

      const { error } = await sb
        .from("lead_outcomes")
        .upsert(payload, { onConflict: "ingest_job_id,row_number" });

      if (error) throw error;

      $("outcomePill").textContent = outcome_type;
      setOutcomeStatus("Outcome saved.");
    } catch (e) {
      setOutcomeStatus("ERROR saving outcome:\n" + (e?.message || String(e)));
    }
  }
})();


