// admin-export.js
(() => {
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $("deliveryExportStatus");
    if (el) el.textContent = msg || "";
  }

  function showResult(url) {
    const wrap = $("deliveryExportResult");
    const a = $("deliverySignedUrl");
    if (!wrap || !a) return;

    a.href = url;
    a.textContent = "Open signed download link";
    wrap.style.display = "block";
  }

  function hideResult() {
    const wrap = $("deliveryExportResult");
    if (wrap) wrap.style.display = "none";
  }

  async function initAdminBox() {
    const box = $("adminDeliveryExport");
    if (!box) return;

    // Wait briefly for role to load
    for (let i = 0; i < 30; i++) {
      if (window.ABM?.currentRole) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Only show to admin
    box.style.display = window.ABM?.currentRole === "admin" ? "block" : "none";
  }

  async function generateDeliveryCsv() {
    hideResult();
    setStatus("");

    if (!window.ABM?.sb) {
      setStatus("ERROR: Supabase client not initialised (window.ABM.sb).");
      return;
    }

    const deliveryId = ($("deliveryIdInput")?.value || "").trim();
    if (!deliveryId) {
      setStatus("ERROR: Please paste a delivery_id first.");
      return;
    }

    // Get a REAL user JWT (access token)
    const { data, error: sessionError } = await window.ABM.sb.auth.getSession();
    if (sessionError) {
      setStatus("ERROR: Could not read session.\n" + sessionError.message);
      return;
    }

    const session = data?.session;
    const accessToken = session?.access_token;

    if (!accessToken) {
      setStatus("ERROR: No active session token.\nFix: log out and log back in.");
      return;
    }

    const EDGE_URL = `${window.ABM.SUPABASE_URL}/functions/v1/generate-delivery-csv`;
    setStatus("Calling Edge Function...\n" + EDGE_URL);

    try {
      const res = await fetch(EDGE_URL, {
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
      try {
        json = JSON.parse(text);
      } catch {
        // non-json response
      }

      if (!res.ok) {
        setStatus(
          `HTTP ${res.status}\n` + (json ? JSON.stringify(json, null, 2) : text)
        );
        return;
      }

      if (!json?.ok || !json?.signed_url) {
        setStatus(
          "Unexpected response:\n" + (json ? JSON.stringify(json, null, 2) : text)
        );
        return;
      }

      setStatus("SUCCESS");
      showResult(json.signed_url);
    } catch (e) {
      setStatus("ERROR (network/runtime):\n" + (e?.message || String(e)));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await initAdminBox();

    $("btnGenerateDeliveryCsv")?.addEventListener("click", generateDeliveryCsv);

    $("btnCopySignedUrl")?.addEventListener("click", async () => {
      const a = $("deliverySignedUrl");
      const url = a?.href || "";
      if (!url || url === "#") return;

      try {
        await navigator.clipboard.writeText(url);
        setStatus("Copied signed_url to clipboard.");
      } catch {
        setStatus("Could not copy automatically. Manually copy this URL:\n" + url);
      }
    });
  });
})();
