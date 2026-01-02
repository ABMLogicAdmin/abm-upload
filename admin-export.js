// admin-export.js (full rewrite) — Delivery Export UX
(() => {
  const $ = (id) => document.getElementById(id);

  const UI = {
    box: () => $("adminDeliveryExport"),

    ddClient: () => $("ddExportClient"),
    ddCampaign: () => $("ddExportCampaign"),
    ddDelivery: () => $("ddExportDelivery"),

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
    clientId: "",
    campaignId: "",
    deliveryId: "",
  };

  const cache = {
    clients: [],
    campaigns: [],   // filtered per client load
    deliveries: [],  // filtered per client+campaign load
  };

  // -----------------------------
  // Status + result helpers
  // -----------------------------
  function setStatus(msg) {
    const el = UI.status();
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
    const btn = UI.btnGenerate();
    if (!btn) return;
    btn.disabled = !!isBusy;
    btn.style.opacity = isBusy ? "0.7" : "1";
    btn.style.cursor = isBusy ? "not-allowed" : "pointer";
  }

  // -----------------------------
  // Dropdown (same look/feel as Admin Setup)
  // -----------------------------
  function closeAllDropdowns(exceptEl = null) {
    for (const id of ["ddExportClient", "ddExportCampaign", "ddExportDelivery"]) {
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

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => closeAllDropdowns(null));

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
  // Actions
  // -----------------------------
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
  // Init
  // -----------------------------
  async function init() {
    // admin.html already gates admin users; keep this visible
    const box = UI.box();
    if (box) box.style.display = "block";

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

    UI.btnGenerate()?.addEventListener("click", generateDeliveryCsv);
    UI.btnCopy()?.addEventListener("click", copySignedUrl);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
