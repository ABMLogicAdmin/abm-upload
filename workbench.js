// workbench.js
(() => {
  // =========================
  // CONFIG (EDIT THIS!)
  // =========================
  const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";
    // =========================

  if (!window.supabase) {
    alert("Supabase SDK failed to load. Check the <script> tag in workbench.html.");
    throw new Error("Supabase SDK not loaded");
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.sb = sb;

  // Expose for admin-export.js (CSV export)
  window.ABM = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    sb,
    me: null,
    currentRole: null,
  };

  const $ = (id) => document.getElementById(id);

  // =========================
  // Phone country → dial code
  // =========================
  // Format: [ISO2, Country Name, DialCode]
  const COUNTRY_DIAL_CODES = [
    ["AF","Afghanistan","+93"], ["AL","Albania","+355"], ["DZ","Algeria","+213"], ["AR","Argentina","+54"],
    ["AM","Armenia","+374"], ["AU","Australia","+61"], ["AT","Austria","+43"], ["AZ","Azerbaijan","+994"],
    ["BH","Bahrain","+973"], ["BD","Bangladesh","+880"], ["BY","Belarus","+375"], ["BE","Belgium","+32"],
    ["BR","Brazil","+55"], ["BG","Bulgaria","+359"], ["CA","Canada","+1"], ["CL","Chile","+56"],
    ["CN","China","+86"], ["CO","Colombia","+57"], ["HR","Croatia","+385"], ["CY","Cyprus","+357"],
    ["CZ","Czechia","+420"], ["DK","Denmark","+45"], ["EG","Egypt","+20"], ["EE","Estonia","+372"],
    ["FI","Finland","+358"], ["FR","France","+33"], ["GE","Georgia","+995"], ["DE","Germany","+49"],
    ["GH","Ghana","+233"], ["GR","Greece","+30"], ["HK","Hong Kong","+852"], ["HU","Hungary","+36"],
    ["IS","Iceland","+354"], ["IN","India","+91"], ["ID","Indonesia","+62"], ["IE","Ireland","+353"],
    ["IL","Israel","+972"], ["IT","Italy","+39"], ["JP","Japan","+81"], ["JO","Jordan","+962"],
    ["KZ","Kazakhstan","+7"], ["KE","Kenya","+254"], ["KW","Kuwait","+965"], ["LV","Latvia","+371"],
    ["LB","Lebanon","+961"], ["LT","Lithuania","+370"], ["LU","Luxembourg","+352"], ["MY","Malaysia","+60"],
    ["MT","Malta","+356"], ["MX","Mexico","+52"], ["MA","Morocco","+212"], ["NL","Netherlands","+31"],
    ["NZ","New Zealand","+64"], ["NG","Nigeria","+234"], ["NO","Norway","+47"], ["PK","Pakistan","+92"],
    ["PE","Peru","+51"], ["PH","Philippines","+63"], ["PL","Poland","+48"], ["PT","Portugal","+351"],
    ["QA","Qatar","+974"], ["RO","Romania","+40"], ["RU","Russia","+7"], ["SA","Saudi Arabia","+966"],
    ["RS","Serbia","+381"], ["SG","Singapore","+65"], ["SK","Slovakia","+421"], ["SI","Slovenia","+386"],
    ["ZA","South Africa","+27"], ["KR","South Korea","+82"], ["ES","Spain","+34"], ["LK","Sri Lanka","+94"],
    ["SE","Sweden","+46"], ["CH","Switzerland","+41"], ["TW","Taiwan","+886"], ["TH","Thailand","+66"],
    ["TN","Tunisia","+216"], ["TR","Türkiye","+90"], ["UA","Ukraine","+380"], ["AE","United Arab Emirates","+971"],
    ["GB","United Kingdom","+44"], ["US","United States","+1"], ["VN","Vietnam","+84"]
  ];

  const DIAL_BY_ISO2 = Object.fromEntries(COUNTRY_DIAL_CODES.map(([iso, , dial]) => [iso, dial]));

  function applyDialCodeToInput(inputEl, dialCode) {
    if (!inputEl || !dialCode) return;

    const v = (inputEl.value || "").trim();

    // Empty -> just insert
    if (!v) {
      inputEl.value = dialCode + " ";
      return;
    }

    // If already has +digits prefix -> replace prefix
    if (/^\+\d+/.test(v)) {
      inputEl.value = v.replace(/^\+\d+/, dialCode);
      return;
    }

    // Otherwise -> prepend
    inputEl.value = dialCode + " " + v;
  }

  function setupPhoneCountryDropdown() {
    const sel = $("phoneCountry");
    const direct = $("phoneDirect");
    const mobile = $("phoneMobile");
    if (!sel || !direct || !mobile) return;

    // Populate options (sorted by name)
    sel.innerHTML =
      `<option value="">Select country…</option>` +
      COUNTRY_DIAL_CODES
        .slice()
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([iso, name, dial]) => `<option value="${iso}">${name} (${dial})</option>`)
        .join("");

    sel.addEventListener("change", () => {
      const iso2 = sel.value;
      const dial = DIAL_BY_ISO2[iso2];
      if (!dial) return;
      applyDialCodeToInput(direct, dial);
      applyDialCodeToInput(mobile, dial);
    });
  }

  // =========================
  // State
  // =========================
  let queueRows = [];
  let currentLead = null;
  let selectedKey = null;

  // =========================
  // Wire buttons
  // =========================
  $("loginBtn")?.addEventListener("click", login);
  $("logoutBtn")?.addEventListener("click", logout);
  $("refreshBtn")?.addEventListener("click", async () => {
  const btn = $("refreshBtn");
  const old = btn?.textContent || "Refresh";

  // Visual feedback so it never feels "inactive"
  if (btn) {
    btn.textContent = "Refreshing…";
    btn.disabled = true;
  }

  try {
    await loadQueue();
    setDetailStatus("Refreshed.");
    setTimeout(() => setDetailStatus(""), 800);
  } catch (e) {
    console.warn("Refresh failed:", e?.message || e);
    setDetailStatus("ERROR refreshing:\n" + (e?.message || String(e)));
  } finally {
    if (btn) {
      btn.textContent = old;
      btn.disabled = false;
    }
  }
});

  $("viewSelect")?.addEventListener("change", () => loadQueue());
  $("searchInput")?.addEventListener("input", renderQueue);
  $("clearBtn")?.addEventListener("click", async () => {
  $("searchInput").value = "";
  if ($("clientSelect")) $("clientSelect").value = "";
  if ($("campaignSelect")) $("campaignSelect").value = "";
  await loadQueue();
});
  $("clientSelect")?.addEventListener("change", async () => {
  // reset campaign every time client changes
  if ($("campaignSelect")) $("campaignSelect").value = "";

  // re-render campaign list for this client
  renderCampaignDropdownForClient($("clientSelect").value || "");

  // reload queue with new filters
  await loadQueue();
});

  $("campaignSelect")?.addEventListener("change", () => loadQueue());


  $("saveBtn")?.addEventListener("click", saveLead);
  $("releaseBtn")?.addEventListener("click", releaseLead);
  $("doneBtn")?.addEventListener("click", markDone);
  $("rejectBtn")?.addEventListener("click", markRejected);
  $("saveOutcomeBtn")?.addEventListener("click", saveOutcome);

  init();

  // =========================
  // Helpers
  // =========================
 function showEmptyState(show) {
  const empty = document.getElementById("emptyState");
  if (empty) empty.style.display = show ? "block" : "none";

  const ctx = document.getElementById("leadContext");
  if (ctx) ctx.style.display = show ? "none" : "block";
}

  function setLoginStatus(t) { if ($("loginStatus")) $("loginStatus").textContent = t || ""; }
  function setDetailStatus(t) { if ($("detailStatus")) $("detailStatus").textContent = t || ""; }
  function setOutcomeStatus(t) { if ($("outcomeStatus")) $("outcomeStatus").textContent = t || ""; }

  function leadKey(r) { return `${r.ingest_job_id}:${r.row_number}`; }

  function stringifyMaybe(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  function mapViewToStatuses(view) {
    if (view === "pending_in_progress") return ["pending", "in_progress"];
    if (view === "pending") return ["pending"];
    if (view === "in_progress") return ["in_progress"];
    if (view === "done") return ["done"];
    if (view === "rejected") return ["rejected"];
    return ["pending", "in_progress"];
  }
  function mapViewToWorkbenchView(view) {
  if (view === "done" || view === "rejected") {
    return "v_workbench_queue_done";
  }
  return "v_workbench_queue";
}

  
// =========================
// Client/Campaign options
// =========================
let campaignOptionsCache = [];

function renderCampaignDropdownForClient(clientId) {
  const clientSel = $("clientSelect");
  const campaignSel = $("campaignSelect");
  if (!clientSel || !campaignSel) return;

  const cid = (clientId || "").toString();
  const rows = cid
    ? (campaignOptionsCache || []).filter(
        r => (r.client_id || "").toString() === cid
      )
    : (campaignOptionsCache || []);

  campaignSel.innerHTML =
    `<option value="">All campaigns</option>` +
    rows
      .filter(r => r.campaign_id && r.campaign_name)
      .map(
        r => `<option value="${r.campaign_id}">${r.campaign_name}</option>`
      )
      .join("");
}

async function loadClientCampaignOptions() {
  const clientSel = $("clientSelect");
  const campaignSel = $("campaignSelect");
  if (!clientSel || !campaignSel) return;

  const { data, error } = await sb
    .from("v_workbench_campaign_options")
    .select("client_id, client_name, campaign_id, campaign_name")
    .order("client_name", { ascending: true })
    .order("campaign_name", { ascending: true });

  if (error) {
    console.warn("ERROR loading client/campaign options:", error.message);
    return;
  }

  campaignOptionsCache = data || [];

  // Build unique clients
  const clients = new Map();
  (campaignOptionsCache || []).forEach(r => {
    if (r.client_id && r.client_name) {
      clients.set(r.client_id, r.client_name);
    }
  });

  // Populate client dropdown
  clientSel.innerHTML =
    `<option value="">All clients</option>` +
    [...clients.entries()]
      .map(([id, name]) => `<option value="${id}">${name}</option>`)
      .join("");

  // Render campaigns for currently selected client
  renderCampaignDropdownForClient(clientSel.value || "");
}

  // =========================
  // Init / Auth
  // =========================
  async function init() {
    // Populate phone dropdown early (safe even before login)
    setupPhoneCountryDropdown();

    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      await afterLogin();
    }
  }

  async function login() {
    setLoginStatus("Signing in…");

    const email = $("email").value.trim();
    const password = $("password").value;

    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_")) {
      setLoginStatus("ERROR: Paste your Supabase anon public key into workbench.js");
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
    window.ABM_USER_EMAIL = window.ABM.me.email;
   
    // Role lookup (UI-only; server enforcement still via RLS/Edge)
    
    try {
  const { data: roleRow } = await sb
    .from("app_users")
    .select("role")
    .eq("user_id", window.ABM.me.id)
    .maybeSingle();

  window.ABM.currentRole = roleRow?.role || null;
  window.ABM_ROLE = window.ABM.currentRole || "user";
} catch {
  window.ABM.currentRole = null;
  window.ABM_ROLE = "user";
}

// ALWAYS refresh navbar after email + role are set

    if ($("whoAmI")) {
      const md = window.ABM.me.user_metadata || {};
      const name = md.full_name || md.name || window.ABM.me.email || "User";
      $("whoAmI").textContent = `${window.ABM.currentRole || "user"}, ${name}`;
    }

      const loginCard = $("loginCard");
      if (loginCard) loginCard.style.display = "none";
      
      // old nav removed; nav.js injects it now, so do nothing here
      
      const appGrid = $("appGrid");
      if (appGrid) appGrid.style.display = "grid";
      showEmptyState(true);

   await loadClientCampaignOptions();
  await loadQueue();


// FINAL step: refresh navbar after login + role + UI are ready
setTimeout(() => {
  window.dispatchEvent(new Event("abm:nav:refresh"));
}, 0);

  }

  async function logout() {
    await sb.auth.signOut();
    location.reload();
  }

  // =========================
  // Queue
  // =========================
  async function loadQueue() {
    setDetailStatus("");

    const view = $("viewSelect").value;
    const statuses = mapViewToStatuses(view);
    const viewName = mapViewToWorkbenchView(view);


const clientId = $("clientSelect")?.value || "";
const campaignId = $("campaignSelect")?.value || "";

let q = sb
  .from(viewName)
  .select(`
    ingest_job_id,
    row_number,
    first_name,
    last_name,
    email,
    company,
    title,
    enrichment_status,
    enriched_by,
    client_id,
    campaign_id,
    client_name,
    campaign_name
  `);

if (viewName === "v_workbench_queue") {
  q = q.in("enrichment_status", statuses);
}


if (clientId) q = q.eq("client_id", clientId);
if (campaignId) q = q.eq("campaign_id", campaignId);

const { data, error } = await q
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
// If we are using the done/rejected view, filter to match the dropdown exactly
if (viewName === "v_workbench_queue_done") {
  if (view === "done") {
    queueRows = queueRows.filter(r => (r.enrichment_status || "").toLowerCase() === "done");
  } else if (view === "rejected") {
    queueRows = queueRows.filter(r => (r.enrichment_status || "").toLowerCase() === "rejected");
  }
}
    renderQueue();
  }

  function renderQueue() {
    const body = $("queueBody");
    if (!body) return;

    const search = ($("searchInput").value || "").trim().toLowerCase();

    const rows = (queueRows || []).filter(r => {
      if (!search) return true;
      const hay = [
        r.first_name, r.last_name, r.email, r.company, r.title, r.enrichment_status
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });

    if ($("queueCount")) $("queueCount").textContent = `Showing ${rows.length} row(s).`;

    body.innerHTML = rows.map(r => {
      const key = leadKey(r);
      const selected = selectedKey === key ? "selected-row" : "";
      const owner = (!r.enriched_by) ? "-" : (r.enriched_by === window.ABM.me?.id ? "me" : "•");

      return `
        <tr class="${selected}" data-key="${key}">
          <td><span class="detailPill">${r.enrichment_status || "-"}</span></td>
          <td>${r.first_name || ""}</td>
          <td>${r.last_name || ""}</td>
          <td><strong>${r.email || ""}</strong></td>
          <td>
            <div style="font-weight:900; color:#22233D;">${r.company || ""}</div>
            <div class="muted">${(r.ingest_job_id || "").slice(0,8)}… • row ${r.row_number}</div>
          </td>
          <td>${r.title || ""}</td>
          <td>${owner}</td>
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

  // =========================
  // Lead detail
  // =========================
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
    showEmptyState(false);


    try {
      const lead = await fetchLead(ingest_job_id, row_number);
      currentLead = lead;
      selectedKey = leadKey(lead);

      $("detailStatusPill").textContent = lead.enrichment_status || "unknown";

      $("ctxName").textContent = `${lead.first_name || ""} ${lead.last_name || ""}`.trim();
      $("ctxEmail").textContent = lead.email || "";
      $("ctxCompany").textContent = lead.company || "";
      $("ctxTitle").textContent = lead.title || "";
      $("ctxOwner").textContent = (lead.enriched_by === window.ABM.me?.id) ? "me" : (lead.enriched_by ? "•" : "-");

      $("ingestJobId").value = lead.ingest_job_id;
      $("rowNumber").value = lead.row_number;

      // Set country first
      $("phoneCountry").value = lead.phone_country_iso2 || "";

      // Set fields from DB
      $("phoneDirect").value = lead.phone_direct || "";
      $("phoneMobile").value = lead.phone_mobile || "";
      $("enrichmentNotes").value = lead.enrichment_notes || "";

      // If a country is selected, ensure dial code is present (but don't overwrite real numbers)
      const iso2 = lead.phone_country_iso2 || "";
      const dial = DIAL_BY_ISO2[iso2];
      if (dial) {
        if (!($("phoneDirect").value || "").trim()) applyDialCodeToInput($("phoneDirect"), dial);
        if (!($("phoneMobile").value || "").trim()) applyDialCodeToInput($("phoneMobile"), dial);
      }

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

  function requireCurrentLead() {
    if (!currentLead) {
      setDetailStatus("Select a lead first.");
      return false;
    }
    return true;
  }

  // =========================
  // Actions
  // =========================
  async function claimLead(ingest_job_id, row_number) {
    setDetailStatus("Claiming lead…");

    try {
      const { error } = await sb
        .from("stg_leads")
        .update({
          enrichment_status: "in_progress",
          enriched_by: window.ABM.me.id,
          enriched_at: new Date().toISOString(),
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

  async function saveLead() {
    if (!requireCurrentLead()) return;
    setDetailStatus("Saving…");

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    const payload = {
      phone_country_iso2: $("phoneCountry").value || null,
      phone_direct: ($("phoneDirect").value || "").trim() || null,
      phone_mobile: ($("phoneMobile").value || "").trim() || null,
      enrichment_notes: ($("enrichmentNotes").value || "").trim() || null,
      enriched_at: new Date().toISOString(),
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
          enrichment_status: "pending",
          enriched_by: null,
          enriched_at: null,
        })
        .eq("ingest_job_id", ingest_job_id)
        .eq("row_number", row_number);

      if (error) throw error;

      currentLead = null;
      selectedKey = null;

      await loadQueue();
      clearDetail();
      setDetailStatus("Released.");
      showEmptyState(true);
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
        .update({
          enrichment_status: "done",
          enriched_at: new Date().toISOString(),
        })
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
      const existing = ($("enrichmentNotes").value || "").trim();
      const prefix = reason ? `[REJECTED] ${reason}` : "[REJECTED]";
      const notes = existing ? `${prefix}\n\n${existing}` : prefix;

      const { error } = await sb
        .from("stg_leads")
        .update({
          enrichment_status: "rejected",
          enrichment_notes: notes,
          enriched_at: new Date().toISOString(),
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
    showEmptyState(true);
    $("detailStatusPill").textContent = "No lead selected";
    
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

  // =========================
  // Outcomes
  // =========================
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
      // Don’t fail the whole page if outcomes fail
      console.warn("Outcome load failed:", e?.message || e);
    }
  }

  async function saveOutcome() {
    if (!requireCurrentLead()) return;

    const ingest_job_id = $("ingestJobId").value;
    const row_number = parseInt($("rowNumber").value, 10);

    const outcome_type = $("outcomeType").value || null;
    const outcome_notes = ($("outcomeNotes").value || "").trim() || null;

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
        decided_by: window.ABM.me?.id || null,
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
