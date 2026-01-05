 // ===== CONFIG =====
    // Keep anon public key here (safe to be public). Security comes from RLS + auth.
    window.ABM_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";
    const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
    // ==================

    if (!window.supabase) {
      alert("Supabase SDK failed to load (cdn.jsdelivr). Check network / extensions.");
      throw new Error("Supabase SDK not loaded");
    }

    const sb = window.supabase.createClient(SUPABASE_URL, window.ABM_SUPABASE_ANON_KEY);

    window.ABM = window.ABM || {};
    window.ABM.sb = sb;
    window.ABM.SUPABASE_URL = SUPABASE_URL;
    window.ABM.SUPABASE_ANON_KEY = window.ABM_SUPABASE_ANON_KEY;

    const $ = (id) => document.getElementById(id);

    const state = {
    client: { value: "", label: "Select client...", items: [] },
    campaign: { value: "", label: "Select campaign...", items: [] }
  };
  window.state = state;
  
  const cache = { clients: [], campaigns: [] };
  window.cache = cache;

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const ids = ["ddClient", "ddCampaign", "ms_primary_departments", "ms_primary_seniorities","ms_secondary_departments","ms_secondary_seniorities","ms_countries"];
  for (const id of ids) {
    const el = $(id);
    if (el && !el.contains(e.target)) el.classList.remove("open");
  }
});

const BRIEF_OPTIONS = {
  primary_departments: [
    "Marketing","Sales","RevOps","IT","Security","Finance","HR","Operations","Product"
  ],
  primary_seniorities: [
    "C-Level","VP","Director","Head","Manager","Individual Contributor","Senior Manager"
  ],
  countries: [
    "United States","Canada","Mexico",
    "United Kingdom","Ireland","France","Germany","Netherlands","Belgium","Luxembourg",
    "Switzerland","Austria","Italy","Spain","Portugal",
    "Sweden","Norway","Denmark","Finland","Iceland",
    "Poland","Czech Republic","Slovakia","Hungary",
    "Romania","Bulgaria","Greece","Croatia","Slovenia",
    "Estonia","Latvia","Lithuania",
    "Ukraine",
    "Israel","United Arab Emirates","Saudi Arabia","Qatar","Kuwait","Bahrain","Oman",
    "Turkey",
    "South Africa","Nigeria","Kenya","Egypt","Morocco",
    "India","Pakistan","Bangladesh","Sri Lanka",
    "China","Hong Kong","Taiwan",
    "Japan","South Korea",
    "Singapore","Malaysia","Thailand","Vietnam","Indonesia","Philippines",
    "Australia","New Zealand",
    "Brazil","Argentina","Chile","Colombia","Peru","Ecuador",
    "Uruguay","Paraguay",
    "Panama","Costa Rica","Guatemala"
  ]
};

// =========================
// Multi-select (pill buttons)
// =========================
function renderMultiSelect(containerId, options = [], initialValues = []) {
  const el = document.getElementById(containerId);
  if (!el) return;

  let selected = new Set(initialValues || []);

  // Methods used by saveBrief/loadBrief
  el.getValues = () => Array.from(selected);
  el.setValues = (vals) => {
    selected = new Set(vals || []);
    paint();
  };

  function paint() {
    el.innerHTML = "";

    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt;

      if (selected.has(opt)) btn.classList.add("active");

      btn.addEventListener("click", () => {
        if (selected.has(opt)) selected.delete(opt);
        else selected.add(opt);
        paint();
      });

      el.appendChild(btn);
    }
  }

  paint();
}


    async function isAdmin() {
      const { data: userRes, error: userErr } = await sb.auth.getUser();
      if (userErr || !userRes?.user) return false;

      const { data, error } = await sb
        .from("app_users")
        .select("role")
        .eq("user_id", userRes.user.id)
        .single();

      if (error) {
        console.error("Admin check failed:", error);
        return false;
      }
      return data?.role === "admin";
    }

    function renderDropdown(containerId, key, placeholder) {
      const container = $(containerId);
      container.innerHTML = "";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dd-btn";
      btn.innerHTML = `<span>${state[key].label || placeholder}</span><span class="dd-caret">▾</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.toggle("open");
        const search = container.querySelector(".dd-search");
        if (search) {
          search.value = "";
          search.focus();
          filterMenu(containerId, key, "", placeholder);
        }
      });

      const menu = document.createElement("div");
      menu.className = "dd-menu";

      const search = document.createElement("input");
      search.className = "dd-search";
      search.placeholder = "Type to filter…";
      search.addEventListener("input", () => filterMenu(containerId, key, search.value, placeholder));
      menu.appendChild(search);

      const list = document.createElement("div");
      list.className = "dd-list";
      menu.appendChild(list);

      container.appendChild(btn);
      container.appendChild(menu);

      filterMenu(containerId, key, "", placeholder);
    }

    function filterMenu(containerId, key, query, placeholder) {
      const container = $(containerId);
      const list = container.querySelector(".dd-list");
      if (!list) return;

      const q = (query || "").toLowerCase().trim();
      list.innerHTML = "";

      const items = (state[key].items || []).filter(it =>
        !q || (it.label || "").toLowerCase().includes(q)
      );

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "dd-meta";
        empty.style.padding = "10px";
        empty.textContent = "No matches.";
        list.appendChild(empty);
        return;
      }

      for (const it of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dd-item";
        b.textContent = it.label;

        b.addEventListener("click", async () => {
        state[key].value = it.value;
        state[key].label = it.label;
        container.classList.remove("open");
        renderDropdown(containerId, key, placeholder);
      
        // If a client is selected, load campaigns for that client
        if (key === "client") {
          setAdminStatus("Loading campaigns…");
          try {
            await loadCampaignsForClient(it.value);
            setAdminStatus("");
           
            syncSnippetPanel();
          } catch (e) {
            setAdminStatus(String(e?.message || e));
          }
        }
      
        // If a campaign is selected, refresh snippet panel
       if (key === "campaign") {
         syncSnippetPanel();
         loadBrief();
         setActiveTab("brief"); // makes the result visible immediately
       }

      });

        list.appendChild(b);
      }
    }
    
  function snippetTemplate({ clientId, campaignId, sourceSite, formId, touchStage }) {
  const endpoint = "https://mwfnbmkjetriunsddupr.supabase.co/functions/v1/first-party-form";

  return `<form class="abm-lead-form" style="max-width:420px;">
  <label>Email<br />
    <input name="email" type="email" required style="width:100%;padding:10px;margin:6px 0;" />
  </label>
  <label>First name<br />
    <input name="first_name" type="text" required style="width:100%;padding:10px;margin:6px 0;" />
  </label>
  <label>Last name<br />
    <input name="last_name" type="text" required style="width:100%;padding:10px;margin:6px 0;" />
  </label>
  <label>Company<br />
    <input name="company" type="text" required style="width:100%;padding:10px;margin:6px 0;" />
  </label>
  <label>Title (optional)<br />
    <input name="title" type="text" style="width:100%;padding:10px;margin:6px 0;" />
  </label>

  <input type="hidden" name="client_id" value="${clientId}" />
  <input type="hidden" name="campaign_id" value="${campaignId}" />
  <input type="hidden" name="source_site" value="${sourceSite}" />
  <input type="hidden" name="form_id" value="${formId}" />
  <input type="hidden" name="touch_stage" value="${touchStage}" />

  <div style="display:none;">
    <label>Website <input name="website" type="text" /></label>
  </div>

  <button type="submit" style="padding:10px 14px;margin-top:10px;">Submit</button>
  <p class="abm-form-msg" style="margin-top:10px;"></p>
</form>

<script>
(function(){
  const ENDPOINT = "${endpoint}";
  function setMsg(form, text, ok){
    const el = form.querySelector(".abm-form-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok ? "green" : "crimson";
  }
  document.addEventListener("submit", async function(e){
    const form = e.target;
    if (!form.classList.contains("abm-lead-form")) return;
    e.preventDefault();
    setMsg(form, "Submitting...", true);
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(data)
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        setMsg(form, "Thanks — we’ve received your details.", true);
        form.reset();
      } else {
        setMsg(form, "Submission failed. Please try again.", false);
        console.error("Form error:", out);
      }
    } catch (err) {
      setMsg(form, "Network error. Please try again.", false);
      console.error(err);
    }
  });
})();
<\/script>`;
}

function currentTouchModel() {
  const campaignId = state.campaign.value;
  const c = (cache.campaigns || []).find(x => x.campaign_id === campaignId);
  return c?.touch_model || "single";
}

function syncSnippetPanel() {
  const clientId = state.client.value || "";
  const campaignId = state.campaign.value || "";
  const touchModel = currentTouchModel();

  const snClient = $("snClientId");
  const snCamp = $("snCampaignId");
  const snTM = $("snTouchModel");

  if (snClient) snClient.value = clientId;
  if (snCamp) snCamp.value = campaignId;
  if (snTM) snTM.value = touchModel;

  const wrap2 = $("snTouch2Wrap");
  if (wrap2) wrap2.style.display = (touchModel === "double") ? "block" : "none";
}

async function copyFieldToClipboard(textareaId, statusId) {
  const el = $(textareaId);
  if (!el || !el.value) return;
  await navigator.clipboard.writeText(el.value);
  const st = $(statusId);
  if (st) st.textContent = "Copied to clipboard.";
}

function setAdminStatus(msg) {
  const el = $("adminStatus");
  if (el) el.textContent = msg || "";
}

function setActiveTab(tabKey) {
  document.querySelectorAll(".tabBtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabKey);
  });

  document.querySelectorAll(".tabPanel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === tabKey);
  });
}

function wireTabs() {
  document.querySelectorAll(".tabBtn").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
}

function lines(id){
  const v = document.getElementById(id)?.value || "";
  return v.split("\n").map(s => s.trim()).filter(Boolean);
}

function fill(id, arr){
  const el = document.getElementById(id);
  if (el) el.value = (arr || []).join("\n");
}

function setBriefStatus(msg){
  const el = document.getElementById("briefStatus");
  if (el) el.textContent = msg || "";

  // ALSO show it in the global status (so you see it on any tab)
  setAdminStatus(msg || "");
}

async function saveBrief(status = "draft"){
  const campaignId = state.campaign.value;
  if (!campaignId) {
    setBriefStatus("Select a campaign first.");
    return;
  }

  const qc_brief = {
    schema_version: "qc_brief.v1",
    personas: {
      primary: {
        titles: lines("brief_primary_titles"),
        departments: document.getElementById("ms_primary_departments")?.getValues() || [],
        seniorities: document.getElementById("ms_primary_seniorities")?.getValues() || []
      },
     
secondary: {
  titles: lines("brief_secondary_titles"),
  departments: document.getElementById("ms_secondary_departments")?.getValues() || [],
  seniorities: document.getElementById("ms_secondary_seniorities")?.getValues() || []
}

     
    },
  targeting: {
  accounts: lines("brief_target_accounts"),
  countries: document.getElementById("ms_countries")?.getValues() || [],
  industries: lines("brief_industries"),
},
    notes: document.getElementById("brief_notes")?.value || ""
  };

  setBriefStatus(status === "active" ? "Activating…" : "Saving draft…");

  // If activating, archive any existing active for this campaign first
  if (status === "active") {
    const { error: archErr } = await sb
      .from("campaign_qc_briefs")
      .update({ status: "archived" })
      .eq("campaign_id", campaignId)
      .eq("status", "active");

    if (archErr) {
      setBriefStatus(`❌ Failed to archive existing active: ${archErr.message}`);
      return;
    }
  }

  // Insert a new version row (this matches your table design: id PK + versioning)
  const { error } = await sb
    .from("campaign_qc_briefs")
    .insert({
      campaign_id: campaignId,
      status,
      qc_brief
    });

  if (error) {
    setBriefStatus(`❌ ${error.message}`);
    return;
  }

  setBriefStatus(`✅ ${status === "active" ? "Activated" : "Draft saved"}`);
}

async function loadBrief(){
  const campaignId = state.campaign.value;
  if (!campaignId) return;

  setBriefStatus("Loading…");

  const { data, error } = await sb
    .from("campaign_qc_briefs")
    .select("qc_brief")
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    setBriefStatus("No brief yet.");
    return;
  }

  const b = data.qc_brief || {};

  fill("brief_primary_titles", b?.personas?.primary?.titles);
  
 document.getElementById("ms_primary_departments")?.setValues(
  b?.personas?.primary?.departments || []
);
 
  document.getElementById("ms_primary_seniorities")?.setValues(
   b?.personas?.primary?.seniorities || []
 );

fill("brief_secondary_titles", b?.personas?.secondary?.titles);

document.getElementById("ms_secondary_departments")?.setValues(
  b?.personas?.secondary?.departments || []
);

document.getElementById("ms_secondary_seniorities")?.setValues(
  b?.personas?.secondary?.seniorities || []
);

  fill("brief_target_accounts", b?.targeting?.accounts);

 document.getElementById("ms_countries")?.setValues(
  b?.targeting?.countries || []
);
 
  fill("brief_industries", b?.targeting?.industries);

  document.getElementById("brief_notes").value = b?.notes || "";

  setBriefStatus("Loaded.");
}

    async function login() {
      $("loginStatus").textContent = "Signing in…";

      const { error } = await sb.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });

      if (error) {
        $("loginStatus").textContent = error.message;
        return;
      }

     $("loginStatus").textContent = "";
     await showApp();
     

    }

    async function logout() {
      try { await window.ABM.sb.auth.signOut(); } catch (e) { console.warn("Logout error:", e); }
      location.href = "/abm-upload/admin-setup.html";
    }

function normalizeDomain(input) {
  let s = (input || "").trim().toLowerCase();
  if (!s) return "";

  // Strip quotes
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

  // If it's a URL, parse hostname
  try {
    if (s.includes("://")) {
      const u = new URL(s);
      s = u.hostname || "";
    } else {
      // Might be domain/path -> try parsing as URL
      const u = new URL("https://" + s);
      s = u.hostname || "";
    }
  } catch {
    // If parsing fails, keep s and continue cleanup
  }

  s = s.replace(/^www\./, "");
  s = s.replace(/\.$/, ""); // trailing dot

  // Basic sanity: must contain at least one dot and only valid chars
  if (!s.includes(".")) return "";
  if (s.length > 253) return "";
  if (!/^[a-z0-9.-]+$/.test(s)) return "";

  // Prevent obvious junk like consecutive dots
  if (s.includes("..")) return "";

  return s;
}

function parseCsvToCells(text) {
  // Minimal MVP: split on lines and commas.
  // (If you later need quoted commas, we can upgrade.)
  return (text || "")
    .split(/\r?\n/)
    .flatMap(line => line.split(","))
    .map(x => x.trim())
    .filter(Boolean);
}

function showAccountsValidation(text) {
  const box = document.getElementById("accountsValidationBox");
  const out = document.getElementById("accountsValidationOut");
  if (!box || !out) return;

  out.textContent = text || "";
  box.style.display = text ? "block" : "none";
}

async function importAccountsCsv() {
  const fileEl = document.getElementById("brief_accounts_csv");
  const ta = document.getElementById("brief_target_accounts");
  if (!fileEl || !ta) return;

  const f = fileEl.files && fileEl.files[0];
  if (!f) {
    setBriefStatus("Select a CSV file first.");
    return;
  }

  setBriefStatus("Importing CSV…");
  showAccountsValidation("");

  const text = await f.text();
  const cells = parseCsvToCells(text);

  const seen = new Set();
  const domains = [];

  for (const cell of cells) {
    const d = normalizeDomain(cell);
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }

  if (!domains.length) {
    setBriefStatus("No valid domains found in CSV.");
    return;
  }

  ta.value = domains.join("\n");
  setBriefStatus(`✅ Imported ${domains.length} domain(s). Now click Validate Accounts.`);
}

function validateAccountsFromTextarea() {
  const ta = document.getElementById("brief_target_accounts");
  if (!ta) return;

  const rawLines = (ta.value || "").split("\n").map(s => s.trim()).filter(Boolean);

  const personalDomains = new Set([
    "gmail.com", "googlemail.com",
    "outlook.com", "hotmail.com", "live.com",
    "yahoo.com", "icloud.com", "me.com",
    "aol.com", "proton.me", "protonmail.com"
  ]);

  const normalized = [];
  const seen = new Set();

  const invalid = [];
  const duplicates = [];
  const personal = [];
  const subdomains = [];

  for (const line of rawLines) {
    const d = normalizeDomain(line);

    if (!d) {
      invalid.push(line);
      continue;
    }

    // Flag if user pasted a subdomain (we accept, but warn)
    // e.g. "uk.company.com" still works, but ABM lists are usually root domains.
    if (d.split(".").length > 2 && !d.endsWith(".co.uk") && !d.endsWith(".com.au")) {
      // This heuristic isn't perfect; it's a warning only.
      subdomains.push(d);
    }

    if (personalDomains.has(d)) personal.push(d);

    if (seen.has(d)) {
      duplicates.push(d);
      continue;
    }

    seen.add(d);
    normalized.push(d);
  }

  // Rewrite textarea with clean, deduped domains (so saved brief is clean)
  ta.value = normalized.join("\n");

  const linesOut = [];
  linesOut.push(`Total input lines: ${rawLines.length}`);
  linesOut.push(`Valid unique domains saved: ${normalized.length}`);
  linesOut.push("");

  if (invalid.length) {
    linesOut.push(`INVALID (${invalid.length})`);
    linesOut.push(invalid.slice(0, 50).map(x => `- ${x}`).join("\n"));
    if (invalid.length > 50) linesOut.push(`- ...and ${invalid.length - 50} more`);
    linesOut.push("");
  }

  if (duplicates.length) {
    linesOut.push(`DUPLICATES REMOVED (${duplicates.length})`);
    linesOut.push([...new Set(duplicates)].slice(0, 50).map(x => `- ${x}`).join("\n"));
    linesOut.push("");
  }

  if (personal.length) {
    linesOut.push(`PERSONAL EMAIL DOMAINS FOUND (${personal.length}) — usually wrong for account lists`);
    linesOut.push([...new Set(personal)].map(x => `- ${x}`).join("\n"));
    linesOut.push("");
  }

  if (subdomains.length) {
    linesOut.push(`SUBDOMAINS WARNING (${subdomains.length}) — check if you meant the root domain`);
    linesOut.push([...new Set(subdomains)].slice(0, 50).map(x => `- ${x}`).join("\n"));
    linesOut.push("");
  }

  if (!invalid.length && !duplicates.length && !personal.length && !subdomains.length) {
    linesOut.push("✅ No issues detected.");
  }

  showAccountsValidation(linesOut.join("\n"));
  setBriefStatus("✅ Accounts validated (textarea normalized).");
}

// =========================
// Multi-select dropdown (search + checkboxes + chips)
// =========================
function renderMultiSelectDropdown(containerId, options = [], initialValues = [], placeholder = "Select…") {
  const el = document.getElementById(containerId);
  if (!el) return;

  let selected = new Set(initialValues || []);
  let query = "";

  // expose same API as before so saveBrief/loadBrief still work
  el.getValues = () => Array.from(selected);
  el.setValues = (vals) => {
    selected = new Set(vals || []);
    draw();
  };

  function draw() {
    el.innerHTML = "";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msdd-btn";

    const valueWrap = document.createElement("div");
    valueWrap.className = "msdd-value";

    if (selected.size === 0) {
      const ph = document.createElement("span");
      ph.className = "msdd-placeholder";
      ph.textContent = placeholder;
      valueWrap.appendChild(ph);
    } else {
      for (const v of Array.from(selected).sort()) {
        const chip = document.createElement("span");
        chip.className = "msdd-chip";
        chip.innerHTML = `<span>${v}</span>`;

        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          selected.delete(v);
          draw();
        });

        chip.appendChild(x);
        valueWrap.appendChild(chip);
      }
    }

    const caret = document.createElement("span");
    caret.className = "dd-caret";
    caret.textContent = "▾";

    btn.appendChild(valueWrap);
    btn.appendChild(caret);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.toggle("open");
      const s = el.querySelector(".msdd-search");
      if (s) s.focus();
    });

    const menu = document.createElement("div");
    menu.className = "msdd-menu";

    const search = document.createElement("input");
    search.className = "msdd-search";
    search.placeholder = "Type to filter…";
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value || "";
      renderList(list);
    });
    menu.appendChild(search);

    const list = document.createElement("div");
    menu.appendChild(list);

    function renderList(listEl) {
      listEl.innerHTML = "";
      const q = (query || "").toLowerCase().trim();

      const filtered = (options || []).filter(opt => !q || String(opt).toLowerCase().includes(q));

      if (!filtered.length) {
        const none = document.createElement("div");
        none.className = "dd-meta";
        none.style.padding = "10px";
        none.textContent = "No matches.";
        listEl.appendChild(none);
        return;
      }

      for (const opt of filtered) {
        const row = document.createElement("div");
        row.className = "msdd-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(opt);

        const label = document.createElement("div");
        label.textContent = opt;

        row.appendChild(cb);
        row.appendChild(label);

        row.addEventListener("click", (e) => {
          // allow clicking the whole row
          if (selected.has(opt)) selected.delete(opt);
          else selected.add(opt);

          draw();
          el.classList.add("open"); // keep menu open for multi-select
        });

        listEl.appendChild(row);
      }
    }

    renderList(list);

    el.appendChild(btn);
    el.appendChild(menu);

    // keep menu open state
    if (el.classList.contains("open")) {
      // re-open after re-render
      setTimeout(() => el.classList.add("open"), 0);
    }
  }

  draw();
}

    async function showApp() {
      // Get user + set navbar identity
      const { data: userRes } = await sb.auth.getUser();
      const user = userRes?.user;

      if (user?.email) window.ABM_USER_EMAIL = user.email;
      window.ABM_ROLE = "admin"; // this page is admin-only
      window.dispatchEvent(new Event("abm:nav:refresh"));

      // HARD ADMIN GATE
      const admin = await isAdmin();

      if (!admin) {
        document.body.innerHTML = `
          <div style="max-width:600px;margin:80px auto;text-align:center;font-family:Poppins,Arial,sans-serif;">
            <h2>Access denied</h2>
            <p>You do not have permission to view this page.</p>
            <p style="color:#6b7280;font-size:13px;">(Your app_users.role is not admin.)</p>
          </div>
        `;
        return;
      }

        const loginCard = $("loginCard");
        const grid = $("adminGrid");
        const appCard = $("appCard");
        
        if (loginCard) loginCard.style.display = "none";
        if (grid) grid.style.display = "grid";
        if (appCard) appCard.style.display = "block";
     
        wireTabs();
        setActiveTab("setup");
     
// Init Campaign Brief dropdown multi-selects
renderMultiSelectDropdown(
  "ms_primary_departments",
  BRIEF_OPTIONS.primary_departments,
  [],
  "Select departments…"
);

renderMultiSelectDropdown(
  "ms_primary_seniorities",
  BRIEF_OPTIONS.primary_seniorities,
  [],
  "Select seniorities…"
);

renderMultiSelectDropdown(
  "ms_countries",
  BRIEF_OPTIONS.countries,
  [],
  "Select countries…"
);
     
renderMultiSelectDropdown(
  "ms_secondary_departments",
  BRIEF_OPTIONS.primary_departments,
  [],
  "Select departments…"
);

renderMultiSelectDropdown(
  "ms_secondary_seniorities",
  BRIEF_OPTIONS.primary_seniorities,
  [],
  "Select seniorities…"
);

setAdminStatus("Loading clients…");

      try {
        await loadClients();

        state.client.label = "Select client…";
        state.client.value = "";
        state.client.items = (cache.clients || []).map(r => ({ value: r.client_id, label: r.name }));
        renderDropdown("ddClient", "client", "Select client…");
        renderDropdown("ddCampaign", "campaign", "Select campaign…");

        setAdminStatus("");


       
        // Wire buttons
        $("createClientBtn").onclick = createClient;
        $("createCampaignBtn").onclick = createCampaign;
        $("createSourceBtn").onclick = createSource;
        $("btnSaveBrief").onclick = () => saveBrief("draft");
        $("btnActivateBrief").onclick = () => saveBrief("active");

       const importBtn = document.getElementById("btnImportAccountsCsv");
       if (importBtn) importBtn.onclick = importAccountsCsv;

       const validateBtn = document.getElementById("btnValidateAccounts");
       if (validateBtn) validateBtn.onclick = validateAccountsFromTextarea;


    // =========================
    // Landing Page Snippet Generator
    // =========================
        $("btnGenSnippets").onclick = () => {
          const clientId = state.client.value;
          const campaignId = state.campaign.value;
        
          if (!clientId) return setAdminStatus("Select a Client first.");
          if (!campaignId) return setAdminStatus("Select a Campaign first.");
        
          const touchModel = currentTouchModel();
          const sourceSite = $("snSourceSite")?.value?.trim();
          const base = $("snBaseName")?.value?.trim() || "download";
        
          if (!sourceSite) return setAdminStatus("Enter Source site (e.g. martechlogic.com).");
        
          // Touch 1 snippet
          const formId1 = (touchModel === "double") ? `touch1_${base}` : `main_${base}`;
          $("snTouch1").value = snippetTemplate({
            clientId,
            campaignId,
            sourceSite,
            formId: formId1,
            touchStage: "touch1"
          });
          $("snStatus1").textContent = "Touch 1 snippet generated.";
        
          // Touch 2 snippet (only if double)
          if (touchModel === "double") {
            const formId2 = `touch2_${base}`;
            $("snTouch2").value = snippetTemplate({
              clientId,
              campaignId,
              sourceSite,
              formId: formId2,
              touchStage: "touch2"
            });
            $("snStatus2").textContent = "Touch 2 snippet generated.";
            $("snTouch2Wrap").style.display = "block";
          } else {
            $("snTouch2").value = "";
            $("snStatus2").textContent = "";
            $("snTouch2Wrap").style.display = "none";
          }
        
          setAdminStatus("✅ Snippet(s) generated. Copy and paste into WordPress Custom HTML blocks.");
        };
        
        $("btnCopySn1").onclick = () => copyFieldToClipboard("snTouch1", "snStatus1");
        $("btnCopySn2").onclick = () => copyFieldToClipboard("snTouch2", "snStatus2");
        
        // Keep the panel in sync on first load
        syncSnippetPanel();


      } catch (e) {
        setAdminStatus(String(e?.message || e));
      }
    }

    async function loadClients() {
      const { data: clients, error } = await sb
        .from("clients")
        .select("client_id, name")
        .order("name");

      if (error) throw new Error(`Failed to load clients: ${error.message}`);
      cache.clients = clients || [];
    }

    async function refreshClientsAfterChange() {
      await loadClients();
      state.client.items = (cache.clients || []).map(r => ({ value: r.client_id, label: r.name }));

      const stillExists = cache.clients.some(c => c.client_id === state.client.value);
      if (!stillExists) {
        state.client.value = "";
        state.client.label = "Select client…";
      }
      renderDropdown("ddClient", "client", "Select client…");
      
    }
    
    async function loadCampaignsForClient(clientId) {
      if (!clientId) {
        cache.campaigns = [];
        state.campaign.items = [];
        state.campaign.value = "";
        state.campaign.label = "Select campaign…";
        renderDropdown("ddCampaign", "campaign", "Select campaign…");
        return;
      }
    
    const { data: campaigns, error } = await sb
      .from("campaigns")
      .select("campaign_id,name,touch_model")
      .eq("client_id", clientId)
      .order("name");
    
      if (error) throw new Error(`Failed to load campaigns: ${error.message}`);
    
      cache.campaigns = campaigns || [];
    
      state.campaign.items = cache.campaigns.map(c => ({
        value: c.campaign_id,
        label: c.name,
        touch_model: c.touch_model || "single",
      }));

      state.campaign.value = "";
      state.campaign.label = "Select campaign…";
      renderDropdown("ddCampaign", "campaign", "Select campaign…");
    }
    
    async function createClient() {
      setAdminStatus("Creating client…");

      const name = $("newClientName").value.trim();
      const status = $("newClientStatus").value;

      if (!name) return setAdminStatus("Client name is required.");

      const { error } = await sb.from("clients").insert({ name, status });
      if (error) return setAdminStatus(`❌ Client create failed: ${error.message}`);

      $("newClientName").value = "";
      setAdminStatus("✅ Client created. Refreshing clients…");
      await refreshClientsAfterChange();
      setAdminStatus("✅ Done.");
    }

    async function createCampaign() {
      setAdminStatus("Creating campaign…");

      const name = $("newCampaignName").value.trim();
      const type = $("newCampaignType").value.trim() || null;
      const status = $("newCampaignStatus").value;

      const overrideClientId = $("newCampaignClientId").value.trim();
      const client_id = overrideClientId || state.client.value;

      if (!client_id) return setAdminStatus("Select a Client above OR paste a Client ID in the override field.");
      if (!name) return setAdminStatus("Campaign name is required.");

     const touch_model = $("newCampaignTouchModel").value || "single";

     const payload = { client_id, name, status, touch_model };
     if (type) payload.type = type;


      const { error } = await sb.from("campaigns").insert(payload);
      if (error) return setAdminStatus(`❌ Campaign create failed: ${error.message}`);

      $("newCampaignName").value = "";
      $("newCampaignType").value = "";
      $("newCampaignClientId").value = "";
    
      await loadCampaignsForClient(client_id);
      syncSnippetPanel();

      setAdminStatus("✅ Campaign created. Campaign list refreshed.");
    }

    async function createSource() {
      setAdminStatus("Creating source…");

      const source_name = $("newSourceName").value.trim();
      const source_system = $("newSourceSystem").value;
      const source_channel = $("newSourceChannel").value;

      if (!source_name) return setAdminStatus("Source name is required.");

      const { error } = await sb.from("sources").insert({
        source_name,
        source_system,
        source_channel
      });

      if (error) return setAdminStatus(`❌ Source create failed: ${error.message}`);

      $("newSourceName").value = "";
      setAdminStatus("✅ Source created.");
    }

    document.addEventListener("DOMContentLoaded", () => {
      const btn = document.getElementById("logoutBtn");
      if (btn) btn.addEventListener("click", logout);

     const loginBtn = $("loginBtn");
     if (loginBtn) loginBtn.onclick = login;
    });

 // Auto-show app if already logged in
 sb.auth.getSession()
  .then(async (r) => { if (r.data.session) await showApp(); })
  .catch(()=>{});
