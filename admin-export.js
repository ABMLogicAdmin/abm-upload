// admin-export.js (full rewrite) — Delivery Export UX
(() => {
  const $ = (id) => document.getElementById(id);

const UI = {
  box: () => $("adminDeliveryExport"),

  // Delivery Log (Slice 6.5)
  ddLogClient: () => $("ddLogClient"),
  ddLogCampaign: () => $("ddLogCampaign"),
  btnRefreshLog: () => $("btnRefreshDeliveryLog"),
  logStatus: () => $("deliveryLogStatus"),
  logTbody: () => $("deliveryLogTbody"),

  ddClient: () => $("ddExportClient"),
  ddCampaign: () => $("ddExportCampaign"),
  ddDelivery: () => $("ddExportDelivery"),
  btnCreateBatch: () => $("btnCreateDeliveryBatch"),
  createBatchStatus: () => $("createBatchStatus"),


  btnGenerate: () => $("btnGenerateDeliveryCsv"),
  status: () => $("deliveryExportStatus"),
  resultWrap: () => $("deliveryExportResult"),
  signedLink: () => $("deliverySignedUrl"),
  btnCopy: () => $("btnCopySignedUrl"),
};

  // -----------------------------
  // State + caches
  // -----------------------------
  const state = {
    // Export selectors
    clientId: "",
    campaignId: "",
    deliveryId: "",

    // Delivery Log selectors (Slice 6.5) — independent of export
    logClientId: "",
    logCampaignId: "",
  };

  const cache = {
    clients: [],
    campaigns: [],     // export campaigns (filtered per export client)
    deliveries: [],    // export deliveries (filtered per export client+campaign)

    logCampaigns: [],  // log campaigns (filtered per log client) — keep separate
  };

  // -----------------------------
  // Status + result helpers
  // -----------------------------
  function setStatus(msg) {
    const el = UI.status();
    if (el) el.textContent = msg || "";
  }

  function setCreateBatchStatus(msg) {
    const el = UI.createBatchStatus();
    if (el) el.textContent = msg || "";
  }

  function hideResult() {
    const wrap = UI.resultWrap();
    if (wrap) wrap.style.display = "none";
  }

  function showResult(url) {
    const wrap = UI.resultWrap();
    const a = UI.signedLink();
    if (!wrap || !a) return;
    a.href = url;
    a.textContent = "Open signed download link";
    wrap.style.display = "block";
  }

function setBusy(isBusy) {
  const genBtn = UI.btnGenerate();
  const createBtn = UI.btnCreateBatch();

  if (genBtn) {
    genBtn.disabled = !!isBusy;
    genBtn.style.opacity = isBusy ? "0.7" : "1";
    genBtn.style.cursor = isBusy ? "not-allowed" : "pointer";
  }

  if (createBtn) {
    createBtn.disabled = !!isBusy;
    createBtn.style.opacity = isBusy ? "0.7" : "1";
    createBtn.style.cursor = isBusy ? "not-allowed" : "pointer";
  }
}
  
  // -----------------------------
  // Delivery Log helpers (Slice 6.5)
  // -----------------------------
  function setLogStatus(msg) {
    const el = UI.logStatus();
    if (el) el.textContent = msg || "";
  }

  function fmtDate(ts) {
    try { return ts ? new Date(ts).toLocaleString() : ""; } catch { return ts || ""; }
  }

  function shortId(id) {
    const s = String(id || "");
    if (s.length <= 16) return s;
    return s.slice(0, 8) + "…" + s.slice(-6);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  // -----------------------------
  // Dropdown (same look/feel as Admin Setup)
  // -----------------------------
  function closeAllDropdowns(exceptEl = null) {
    for (const id of ["ddExportClient", "ddExportCampaign", "ddExportDelivery", "ddLogClient", "ddLogCampaign"]) {
      const el = $(id);
      if (!el) continue;
      if (exceptEl && el === exceptEl) continue;
      el.classList.remove("open");
    }
  }

  function makeDropdown(containerEl, opts) {
    // opts: { placeholder, disabled, items:[{value,label,meta?}], onChange(value,item) }
    if (!containerEl) return;

    const placeholder = opts.placeholder || "Select…";
    const disabled = !!opts.disabled;
    const items = opts.items || [];

    containerEl.innerHTML = "";
    containerEl.classList.remove("open");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.disabled = disabled;

    const currentLabel = opts.currentLabel || placeholder;
    btn.innerHTML = `<span>${currentLabel}</span><span class="dd-caret">▾</span>`;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const isOpen = containerEl.classList.contains("open");
      closeAllDropdowns(containerEl);
      containerEl.classList.toggle("open", !isOpen);
      const search = containerEl.querySelector(".dd-search");
      if (search) {
        search.value = "";
        search.focus();
        renderList("");
      }
    });

    const menu = document.createElement("div");
    menu.className = "dd-menu";

    const search = document.createElement("input");
    search.className = "dd-search";
    search.placeholder = "Type to filter…";
    search.addEventListener("input", () => renderList(search.value || ""));
    menu.appendChild(search);

    const list = document.createElement("div");
    list.className = "dd-list";
    menu.appendChild(list);

    containerEl.appendChild(btn);
    containerEl.appendChild(menu);

    function renderList(query) {
      const q = (query || "").toLowerCase().trim();
      list.innerHTML = "";

      const filtered = items.filter((it) =>
        !q || (it.label || "").toLowerCase().includes(q)
      );

      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "dd-meta";
        empty.style.padding = "10px";
        empty.textContent = "No matches.";
        list.appendChild(empty);
        return;
      }

      for (const it of filtered) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dd-item";
        b.textContent = it.label;

        b.addEventListener("click", () => {
          containerEl.classList.remove("open");
          if (opts.onChange) opts.onChange(it.value, it);
        });

        if (it.meta) {
          const meta = document.createElement("div");
          meta.className = "dd-meta";
          meta.textContent = it.meta;
          b.appendChild(meta);
        }

        list.appendChild(b);
      }
    }

    // Initial list render
    renderList("");
  }

  // -----------------------------
  // Supabase helpers
  // -----------------------------
  async function getFreshAccessToken() {
    if (!window.ABM?.sb) throw new Error("Supabase client not initialised (window.ABM.sb).");

    try {
      await window.ABM.sb.auth.refreshSession();
    } catch {
      // ignore
    }

    const { data, error } = await window.ABM.sb.auth.getSession();
    if (error) throw new Error("Could not read session: " + error.message);

    const token = data?.session?.access_token;
    if (!token) throw new Error("No active session token. Log out and log back in.");
    return token;
  }

  async function callGenerateDeliveryCsv(deliveryId, accessToken) {
    const url = `${window.ABM.SUPABASE_URL}/functions/v1/generate-delivery-csv`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.ABM.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ delivery_id: deliveryId }),
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!res.ok) {
      const msg = json ? JSON.stringify(json, null, 2) : text;
      throw new Error(`HTTP ${res.status}\n${msg}`);
    }

    if (!json?.ok || !json?.signed_url) {
      throw new Error("Unexpected response:\n" + (json ? JSON.stringify(json, null, 2) : text));
    }

    return json.signed_url;
  }

    // Counts how many leads have already been delivered for a given export_type
  async function countAlreadyDelivered(clientId, campaignId, exportType) {
    const { count, error } = await window.ABM.sb
      .from("delivery_items")
      .select("lead_id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("campaign_id", campaignId)
      .eq("export_type", exportType);

    if (error) throw error;
    return count || 0;
  }
  
  // -----------------------------
  // Data loads
  // -----------------------------
  async function loadClients() {
    setStatus("");
    const { data, error } = await window.ABM.sb
      .from("clients")
      .select("client_id, name")
      .order("name", { ascending: true });

    if (error) throw new Error("ERROR loading clients:\n" + error.message);
    cache.clients = data || [];
  }

  async function loadCampaigns(clientId) {
    const { data, error } = await window.ABM.sb
      .from("campaigns")
      .select("campaign_id, name")
      .eq("client_id", clientId)
      .order("name", { ascending: true });

    if (error) throw new Error("ERROR loading campaigns:\n" + error.message);
    cache.campaigns = data || [];
  }

  async function loadDeliveries(clientId, campaignId) {
    const { data, error } = await window.ABM.sb
      .from("v_delivery_batches_for_export")
      .select("delivery_id, created_at, status, lead_count")
      .eq("client_id", clientId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false });

    if (error) throw new Error("ERROR loading delivery batches:\n" + error.message);
    cache.deliveries = data || [];
  }
    // Delivery Log campaigns (kept separate from export campaigns)
  async function loadLogCampaigns(clientId) {
    const { data, error } = await window.ABM.sb
      .from("campaigns")
      .select("campaign_id, name")
      .eq("client_id", clientId)
      .order("name", { ascending: true });

    if (error) throw new Error("ERROR loading log campaigns:\n" + error.message);
    cache.logCampaigns = data || [];
  }


  // -----------------------------
  // Render dropdowns
  // -----------------------------
  function renderClientDD() {
    const items = cache.clients.map((r) => ({
      value: r.client_id,
      label: r.name,
    }));

    const current = cache.clients.find(c => c.client_id === state.clientId);
    makeDropdown(UI.ddClient(), {
      placeholder: "Select client…",
      disabled: false,
      items,
      currentLabel: current ? current.name : "Select client…",
      onChange: async (value) => {
        hideResult();
        setStatus("");
        setCreateBatchStatus("");

        state.clientId = value || "";
        state.campaignId = "";
        state.deliveryId = "";
        cache.campaigns = [];
        cache.deliveries = [];

        renderClientDD();
        renderCampaignDD(true); // disabled while loading
        renderDeliveryDD(true);

        if (!state.clientId) {
          setStatus("Select a client to load campaigns.");
          renderCampaignDD(false);
          renderDeliveryDD(false);
          return;
        }

        try {
          setStatus("Loading campaigns…");
          await loadCampaigns(state.clientId);
          setStatus("");
        } catch (e) {
          setStatus("ERROR:\n" + (e?.message || String(e)));
        }

        renderCampaignDD(false);
        renderDeliveryDD(true);
      },
    });
  }

  function renderCampaignDD(disabledWhileLoading = false) {
    const items = cache.campaigns.map((r) => ({
      value: r.campaign_id,
      label: r.name,
    }));

    const current = cache.campaigns.find(c => c.campaign_id === state.campaignId);

    makeDropdown(UI.ddCampaign(), {
      placeholder: "Select campaign…",
      disabled: disabledWhileLoading || !state.clientId,
      items,
      currentLabel: current ? current.name : "Select campaign…",
      onChange: async (value) => {
        hideResult();
        setStatus("");

        state.campaignId = value || "";
        state.deliveryId = "";
        cache.deliveries = [];

        renderCampaignDD();
        renderDeliveryDD(true); // disabled while loading

        if (!state.campaignId) {
          setStatus("Select a campaign to load delivery batches.");
          renderDeliveryDD(false);
          return;
        }

        try {
          setStatus("Loading delivery batches…");
          await loadDeliveries(state.clientId, state.campaignId);
          setStatus("");
        } catch (e) {
          setStatus("ERROR:\n" + (e?.message || String(e)));
        }

        renderDeliveryDD(false);
      },
    });
  }

  function renderDeliveryDD(disabledWhileLoading = false) {
    const items = cache.deliveries.map((r) => {
      const dt = r.created_at ? new Date(r.created_at) : null;
      const dateLabel = dt ? dt.toLocaleString() : "Unknown date";
      const meta = `${dateLabel} • ${r.status || "unknown"} • ${r.lead_count ?? 0} leads`;
      return {
        value: r.delivery_id,
        label: `Batch ${String(r.delivery_id).slice(0, 8)}…`,
        meta,
      };
    });
    

    const current = cache.deliveries.find(d => d.delivery_id === state.deliveryId);

    makeDropdown(UI.ddDelivery(), {
      placeholder: "Select delivery batch…",
      disabled: disabledWhileLoading || !state.clientId || !state.campaignId,
      items,
      currentLabel: current ? `Batch ${String(current.delivery_id).slice(0, 8)}…` : "Select delivery batch…",
      onChange: (value) => {
        hideResult();
        setStatus("");
        state.deliveryId = value || "";
        renderDeliveryDD(false);
      },
    });
  }
  // -----------------------------
  // Render Delivery Log dropdowns (Slice 6.5)
  // -----------------------------
  function renderLogClientDD() {
    const items = (cache.clients || []).map((r) => ({
      value: r.client_id,
      label: r.name,
    }));

    const itemsWithAll = [{ value: "", label: "All clients" }, ...items];

    const current = (cache.clients || []).find(c => c.client_id === state.logClientId);

    makeDropdown(UI.ddLogClient(), {
      placeholder: "All clients",
      disabled: false,
      items: itemsWithAll,
      currentLabel: current ? current.name : "All clients",
      onChange: async (value) => {
        setLogStatus("");

        state.logClientId = value || "";
        state.logCampaignId = "";
        cache.logCampaigns = [];

        renderLogClientDD();
        renderLogCampaignDD(true);

        if (!state.logClientId) {
          renderLogCampaignDD(false);
          return;
        }

        try {
          setLogStatus("Loading campaigns…");
          await loadLogCampaigns(state.logClientId);
          setLogStatus("");
        } catch (e) {
          setLogStatus("ERROR:\n" + (e?.message || String(e)));
        }

        renderLogCampaignDD(false);
      },
    });
  }

  function renderLogCampaignDD(disabledWhileLoading = false) {
    const items = (cache.logCampaigns || []).map((r) => ({
      value: r.campaign_id,
      label: r.name,
    }));

    const itemsWithAll = [{ value: "", label: "All campaigns" }, ...items];

    const current = (cache.logCampaigns || []).find(c => c.campaign_id === state.logCampaignId);

    makeDropdown(UI.ddLogCampaign(), {
      placeholder: "All campaigns",
      disabled: disabledWhileLoading || !state.logClientId,
      items: itemsWithAll,
      currentLabel: current ? current.name : "All campaigns",
      onChange: (value) => {
        setLogStatus("");
        state.logCampaignId = value || "";
        renderLogCampaignDD(false);
      },
    });
  }

  // -----------------------------
  // Actions
  // -----------------------------
  async function createDeliveryBatch() {
      setCreateBatchStatus("");
  
      const clientId = (state.clientId || "").trim();
      const campaignId = (state.campaignId || "").trim();
  
    if (!clientId) {
      setCreateBatchStatus("ERROR: Please select a client.");
      return;
    }
  
    if (!campaignId) {
      setCreateBatchStatus("ERROR: Please select a campaign.");
      return;
    }
  
    setBusy(true);
    setCreateBatchStatus("Creating delivery batch…");
  
    try {
      const { data, error } = await window.ABM.sb.rpc(
        "create_delivery_batch_v2",
        {
          p_client_id: clientId,
          p_campaign_id: campaignId,
          p_export_type: "initial",
        }
      );

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

     if (!row || !row.delivery_id) {
      // Distinguish "nothing done" vs "already delivered"
      try {
        const already = await countAlreadyDelivered(clientId, campaignId, "initial");

        if (already > 0) {
          setCreateBatchStatus(
            `Nothing new to deliver. ${already} lead(s) were already delivered for export type "initial".`
          );
        } else {
          setCreateBatchStatus("No eligible leads to deliver for this campaign.");
        }
      } catch (e) {
        // Fallback (don’t block the user if the count lookup fails)
        setCreateBatchStatus("No eligible leads to deliver for this campaign.");
      }
      return;
    }

    setCreateBatchStatus(
      `SUCCESS: Delivery created (${row.lead_count} lead(s)).`
    );

    await loadDeliveries(clientId, campaignId);
    state.deliveryId = row.delivery_id;
    renderDeliveryDD(false);
  } catch (e) {
    setCreateBatchStatus("ERROR: " + (e?.message || String(e)));
  } finally {
    setBusy(false);
  }
}
  
  async function generateDeliveryCsv() {
    hideResult();
    setStatus("");

    const deliveryId = (state.deliveryId || "").trim();
    if (!deliveryId) {
      setStatus("ERROR: Please select a delivery batch first.");
      return;
    }

    setBusy(true);
    setStatus("Preparing session…");

    try {
      const accessToken = await getFreshAccessToken();

      const edgeUrl = `${window.ABM.SUPABASE_URL}/functions/v1/generate-delivery-csv`;
      setStatus("Calling Edge Function…\n" + edgeUrl);

      const signedUrl = await callGenerateDeliveryCsv(deliveryId, accessToken);

      setStatus("SUCCESS");
      showResult(signedUrl);
    } catch (e) {
      setStatus("ERROR:\n" + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function copySignedUrl() {
    const a = UI.signedLink();
    const url = a?.href || "";
    if (!url || url === "#") return;

    try {
      await navigator.clipboard.writeText(url);
      setStatus("Copied signed URL to clipboard.");
    } catch {
      setStatus("Could not copy automatically. Manually copy this URL:\n" + url);
    }
  }
  
  // -----------------------------
  // Delivery Log: load + render table (Slice 6.5)
  // -----------------------------
  async function loadDeliveryLog() {
    const tbody = UI.logTbody();
    if (!tbody) return;

    const clientId = (state.logClientId || "").trim();
    const campaignId = (state.logCampaignId || "").trim();

    setLogStatus("Loading…");
    tbody.innerHTML = `<tr><td colspan="6" style="padding:12px 8px; opacity:0.7;">Loading…</td></tr>`;

    try {
      let q = window.ABM.sb
        .from("v_delivery_log_v1")
        .select("delivery_id, client_id, client_name, campaign_id, campaign_name, created_by_email, created_at, row_count")
        .order("created_at", { ascending: false })
        .limit(50);

      if (clientId) q = q.eq("client_id", clientId);
      if (campaignId) q = q.eq("campaign_id", campaignId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:12px 8px; opacity:0.7;">No deliveries found.</td></tr>`;
        setLogStatus("Showing 0 result(s).");
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const client = escapeHtml(r.client_name || "—");
        const camp = escapeHtml(r.campaign_name || "—");
        const who = escapeHtml(r.created_by_email || "—");
        const created = escapeHtml(fmtDate(r.created_at));
        const count = (r.row_count ?? 0);
        const didShort = escapeHtml(shortId(r.delivery_id));
        const didFull = escapeHtml(r.delivery_id);

        return `
          <tr style="border-top:1px solid rgba(34,35,61,.12);">
            <td style="padding:10px 8px;">${client}</td>
            <td style="padding:10px 8px;">${camp}</td>
            <td style="padding:10px 8px;">${who}</td>
            <td style="padding:10px 8px;">${created}</td>
            <td style="padding:10px 8px; text-align:right;">${count}</td>
            <td style="padding:10px 8px;" title="${didFull}">${didShort}</td>
          </tr>
        `;
      }).join("");

      setLogStatus(`Showing ${rows.length} result(s).`);
    } catch (e) {
      setLogStatus("ERROR:\n" + (e?.message || String(e)));
      tbody.innerHTML = `<tr><td colspan="6" style="padding:12px 8px; color:#b00020;">Failed to load delivery log.</td></tr>`;
    }
  }


  // -----------------------------
  // Init
  // -----------------------------
  async function init() {

    // Render empty disabled dropdowns immediately (nice UX)
    cache.clients = [];
    cache.campaigns = [];
    cache.deliveries = [];

    renderClientDD();
    renderCampaignDD(false);
    renderDeliveryDD(false);

    try {
      setStatus("Loading clients…");
      await loadClients();
      setStatus("");
    } catch (e) {
      setStatus("ERROR:\n" + (e?.message || String(e)));
    }

    renderClientDD();
    renderCampaignDD(false);
    renderDeliveryDD(false);

  // --- Delivery Log (Slice 6.5) ---
    renderLogClientDD();
    renderLogCampaignDD(false);

    UI.btnRefreshLog()?.addEventListener("click", loadDeliveryLog);
    UI.btnCreateBatch()?.addEventListener("click", createDeliveryBatch);

    // Auto-load latest results on page open (professional default)
    await loadDeliveryLog();

    UI.btnGenerate()?.addEventListener("click", generateDeliveryCsv);
    UI.btnCopy()?.addEventListener("click", copySignedUrl);

  }
   
    let _exportInited = false;
    
    function initOnce() {
      if (_exportInited) return;
      _exportInited = true;
    
      // Hard guard: export bootstrap MUST have created the supabase client
      if (!window.ABM?.sb) {
        console.error("ABM.sb missing. Export bootstrap did not run or user not logged in.");
        setStatus("ERROR: Export page is not initialised (missing session). Refresh and log in again.");
        return;
      }
    
      init();
    }
    
    // Preferred: wait for export bootstrap (admin-export.html) to say "ready"
    window.addEventListener("abm:export:ready", initOnce);
    
    // Fallback: if someone loads this file without the bootstrap event,
    // try once after DOM is ready (won't double-run because initOnce guards)
    document.addEventListener("DOMContentLoaded", initOnce);
 })();

