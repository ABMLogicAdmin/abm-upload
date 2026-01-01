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
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_")) {
    // Don't throw—show a clear UI error for beginners
    console.warn("Missing SUPABASE_ANON_KEY in workbench.js");
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Expose shared config/state for other scripts (admin-export.js)
  window.ABM = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    sb,
    currentRole: null,
    me: null
  };

  const $ = (id) => document.getElementById(id);

  // UI state
  let queueRows = [];
  let currentLead = null;
  let selectedKey = null;

  // Wire up
  $("loginBtn").addEventListener("click", login);
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", () => loadQueue(true));
  $("viewSelect").addEventListener("change", () => loadQueue());
  $("searchInput").addEventListener("input", renderQueue);
  $("clearBtn").addEventListener("click", () => { $("searchInput").value = ""; renderQueue(); });

  $("saveBtn").addEventListener("click", saveLead);
  $("releaseBtn").addEventListener("click", releaseLead);
  $("doneBtn").addEventListener("click", markDone);
  $("rejectBtn").addEventListener("click", markRejected);

  $("saveOutcomeBtn").addEventListener("click", saveOutcome);

  // ---- Init ----
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

    // Role lookup (server-side admin enforcement still happens in Edge Functions)
    try {
      const { data: roleRow, error: roleErr } = await sb
        .from("app_users")
        .select("role")
        .eq("user_id", window.ABM.me.id)
        .maybeSingle();

      if (roleErr) {
        console.warn("Role lookup error:", roleErr.message);
        window.ABM.currentRole = null;
      } else {
        window.ABM.currentRole = roleRow?.role || null;
      }
    } catch (e) {
      console.warn("Role lookup failed:", e);
      window.ABM.currentRole = null;
    }

    renderWhoAmI();

    $("loginCard").style.display = "none";
    $("topNav").style.display = "flex";
    $("appGrid").style.display = "grid";

    await loadQueue(true);
  }

  async function logout() {
    await sb.auth.signOut();
    location.reload();
  }

  // ---- Queue ----
  function leadKey(r) {
    return `${r.ingest_job_id}:${r.row_number}`;
  }

  function ownerLabel(r) {
    if (!r?.enriched_by) return "-";
    if (window.ABM.me && r.enriched_by === window.ABM.me.id) return "me";
    return "•";
  }

  function pill(status) {
    return `<span class="detailPill">${status || "-"}</span>`;
  }

  async function loadQueue(showStatus) {
    if (showStatus) setDetailStatus("Loading queue…");

    const view = $("viewSelect").value;

    let q = sb.from("stg_leads").select("*");

    // You may need to adjust the status values if your DB uses different strings
    if (view === "pending_in_progress") q = q.in("status", ["pending", "in_progress"]);
    if (view === "pending") q = q.eq("status", "pending");
    if (view === "in_progress") q = q.eq("status", "in_progress");
    if (view === "done") q = q.eq("status", "done");
    if (view === "rejected") q = q.eq("status", "rejected");

    // sort newest first if you have created_at; otherwise by row_number
    q = q.order("ingest_job_id", { ascending: false }).order("row_number", { ascending: true });

    const { data, error } = await q;
    if (error) {
      setDetailStatus("ERROR loading queue:\n" + error.message);
      queueRows = [];
      renderQueue();
      return;
    }

    queueRows = data || [];
    renderQueue();

    if (showStatus) setDetailStatus("");
  }

  function renderQueue() {
    const body = $("queueBody");
    const search = ($("searchInput").value || "").trim().toLowerCase();

    const rows = queueRows.filter(r => {
      if (!search) return true;
      const hay = [
        r.first_name, r.last_name, r.email, r.company, r.title, r.status
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });

    $("queueCount").textContent = `Showing ${rows.length} row(s).`;

    body.innerHTML = rows.map(r => {
      const key = leadKey(r);
      const selected = selectedKey === key ? "selected-row" : "";
      return `
        <tr class="${selected}" data-key="${key}">
          <td>${pill(r.status)}</td>
          <td>${r.first_name || ""}</td>
          <td>${r.last_name || ""}</td>
          <td><strong>${r.email || ""}</strong></td>
          <td>
            <div style="font-weight:900; color:#22233D;">${r.company || ""}</div>
            <div class="muted">${r.ingest_job_id?.slice(0,8) || ""}… • row ${r.row_number}</div>
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

    // wire row buttons
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

        // clicking row opens
        await openLead(ingest_job_id, row_number);
      });
    });
  }

  async function fetchLead(ingest_job_id, row_number) {
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

      $("detailStatusPill").textContent = lead.status || "unknown";

      $("leadContext").style.display = "block";
      $("ctxName").textContent = `${lead.first_name || ""} ${lead.last_name || ""}`.trim();
      $("ctxEmail").textContent = lead.email || "";
      $("ctxCompany").textContent = lead.company || "";
      $("ctxTitle").textContent = lead.title || "";
      $("ctxOwner").textContent = ownerLabel(lead);

      $("ingestJobId").value = lead.ingest_job_id;
      $("rowNumber").value = lead.row_number;

      $("phoneCountry").value = lead.phone_country || "";       // adjust if your column name differs
      $("phoneDirect").value = lead.phone_direct || "";         // adjust if your column name differs
      $("phoneMobile").value = lead.phone_mobile || "";         // adjust if your column name differs
      $("enrichmentNotes").value = lead.enrichment_notes || "";

      $("verifiedFields").value = stringifyMaybe(lead.verified_fields);
      $("enrichedPayload").value = stringifyMaybe(lead.enriched_payload);
      $("rawPayload").value = stringifyMaybe(lead.raw_payload);

      const isRejected = lead.status === "rejected";
      $("rejectedBanner").style.display = isRejected ? "block" : "none";

      // Load outcome (optional)
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

  async function claimLead(ingest_job_id, row_number) {
    setDetailStatus("Claiming lead…");

    try {
      // This assumes you have RLS allowing ops/admin to claim + set enriched_by
      const { error } = await sb
        .from("stg_leads")
        .update({
          status: "in_progress",
          enriched_by: window.ABM.me.id
        })
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

      if (error) throw error;

      await loadQueue();
      await openLead(ingest_job_id, row_number);
      setDetailStatus("Claimed.");
    } catch (e) {
      setDetailStatus("ERROR claiming lead:\n" + (e?.message || String(e)));
    }
  }

  // ---- Actions ----
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

    const payload = {
      phone_country: $("phoneCountry").value || null,     // adjust if needed
      phone_direct: $("phoneDirect").value.trim() || null,
      phone_mobile: $("phoneMobile").value.trim() || null,
      enrichment_notes: $("enrichmentNotes").value.trim() || null
    };

    try {
      const { error } = await sb
        .from("stg_leads")
        .update(payload)
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

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
      const { error } = await sb
        .from("stg_leads")
        .update({
          status: "pending",
          enriched_by: null
        })
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

      if (error) throw error;

      currentLead = null;
      selectedKey = null;

      await loadQueue(true);
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
      const { error } = await sb
        .from("stg_leads")
        .update({ status: "done" })
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

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
      const { error } = await sb
        .from("stg_leads")
        .update({
          status: "rejected",
          enrichment_notes: (reason ? `[REJECTED] ${reason}\n\n` : "[REJECTED]\n\n") + ($("enrichmentNotes").value || "")
        })
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

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

  // ---- Outcomes ----
  async function loadOutcome(lead) {
    // NOTE: This assumes a lead_outcomes table keyed by ingest_job_id + row_number
    // If yours uses lead_id instead, tell me and we’ll adjust.
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

