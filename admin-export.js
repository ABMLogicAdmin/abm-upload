// admin-export.js (full rewrite)
(() => {
  const $ = (id) => document.getElementById(id);

  const UI = {
    box: () => $("adminDeliveryExport"),
    deliveryId: () => $("deliveryIdInput"),
    btnGenerate: () => $("btnGenerateDeliveryCsv"),
    status: () => $("deliveryExportStatus"),
    resultWrap: () => $("deliveryExportResult"),
    signedLink: () => $("deliverySignedUrl"),
    btnCopy: () => $("btnCopySignedUrl"),
  };

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

  async function waitForRole(maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (window.ABM?.currentRole) return window.ABM.currentRole;
      await new Promise((r) => setTimeout(r, 100));
    }
    return window.ABM?.currentRole || null;
  }

async function initAdminBox() {
  const box = UI.box();
  if (!box) return;

  // On admin.html we already hard-gate admins in showApp().
  // So the export UI should not hide itself here.
  box.style.display = "block";
}

  async function getFreshAccessToken() {
    if (!window.ABM?.sb) throw new Error("Supabase client not initialised (window.ABM.sb).");

    // Force refresh so we don’t get “Invalid JWT” from stale sessions.
    // If refresh fails, we'll fall back to current session check.
    try {
      await window.ABM.sb.auth.refreshSession();
    } catch {
      // ignore: we’ll still try getSession()
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
    try { json = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok) {
      const msg = json ? JSON.stringify(json, null, 2) : text;
      throw new Error(`HTTP ${res.status}\n${msg}`);
    }

    if (!json?.ok || !json?.signed_url) {
      throw new Error("Unexpected response:\n" + (json ? JSON.stringify(json, null, 2) : text));
    }

    return json.signed_url;
  }

  async function generateDeliveryCsv() {
    hideResult();
    setStatus("");

    const input = UI.deliveryId();
    const deliveryId = (input?.value || "").trim();

    if (!deliveryId) {
      setStatus("ERROR: Please paste a delivery_id first.");
      return;
    }

    setBusy(true);
    setStatus("Preparing session...");

    try {
      const accessToken = await getFreshAccessToken();

      const edgeUrl = `${window.ABM.SUPABASE_URL}/functions/v1/generate-delivery-csv`;
      setStatus("Calling Edge Function...\n" + edgeUrl);

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

  document.addEventListener("DOMContentLoaded", async () => {
    await initAdminBox();

    UI.btnGenerate()?.addEventListener("click", generateDeliveryCsv);
    UI.btnCopy()?.addEventListener("click", copySignedUrl);
  });
})();
