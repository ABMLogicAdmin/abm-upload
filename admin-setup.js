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
      const c1 = $("ddClient");
      if (c1 && !c1.contains(e.target)) c1.classList.remove("open");
    
      const c2 = $("ddCampaign");
      if (c2 && !c2.contains(e.target)) c2.classList.remove("open");
    });


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
      $("adminStatus").textContent = msg || "";
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
      showApp();
    }

    async function logout() {
      try { await window.ABM.sb.auth.signOut(); } catch (e) { console.warn("Logout error:", e); }
      location.href = "/abm-upload/admin-setup.html";
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
      .then(async (r) => { if (r.data.session) showApp(); })
      .catch(()=>{});
