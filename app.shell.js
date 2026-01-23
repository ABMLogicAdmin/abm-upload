/* app.shell.js — ABM Upload front-end shell (shared)
   Purpose:
   - ONE config for Supabase URL + anon key (no drift)
   - ONE shared Supabase client (prevents GoTrue lock conflicts)
   - Shared helpers: session, role, auth gating, Edge Function fetch

   Rules:
   - Never create multiple supabase clients per page
   - Pages should use: const sb = window.ABM_SB;
*/

(function () {
  // -----------------------------
  // Config (single source of truth)
  // -----------------------------
  const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";

  // Keep consistent across ALL pages to avoid session split / lock conflicts
  const SB_STORAGE_KEY = "abmlogic-auth";

  // Optional: set this once per deploy to kill cache issues cleanly
  // If you set window.ABM_APP_VERSION in HTML, we’ll use it.
  const APP_VERSION = window.ABM_APP_VERSION || "DEV";

  // Create namespace
  window.ABM = window.ABM || {};

  // Store config in one place
  window.ABM.config = window.ABM.config || {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    storageKey: SB_STORAGE_KEY,
    version: APP_VERSION
  };

  // -----------------------------
  // Guard: Supabase library present
  // -----------------------------
  if (!window.supabase) {
    console.error("[ABM] Supabase JS library not found. Check the CDN script tag.");
    window.ABM.sb = null;
    window.ABM_SB = null;
    return;
  }

  // -----------------------------
  // ONE shared Supabase client
  // -----------------------------
  const existing =
    window.ABM_SB ||
    window.ABM.sb ||
    (window.ABM && window.ABM.sb);

  const sb =
    existing ||
    window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: SB_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

  // Backwards compatibility + single source
  window.ABM.sb = sb;
  window.ABM_SB = sb;

  // -----------------------------
  // Helpers
  // -----------------------------
  async function getSessionSafe() {
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    } catch (e) {
      console.warn("[ABM] getSession failed:", e?.message || e);
      return null;
    }
  }

  async function getUserSafe() {
    const sess = await getSessionSafe();
    return sess?.user || null;
  }

  async function getRoleSafe() {
    const user = await getUserSafe();
    if (!user) return null;

    // default role if app_users table is missing / blocked
    let role = "user";

    try {
      const { data, error } = await sb
        .from("app_users")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!error && data?.role) role = String(data.role).toLowerCase();
    } catch (e) {
      // do nothing; keep default role
    }

    window.ABM_ROLE = role;
    window.ABM_USER_EMAIL = user.email || "";
    return role;
  }

  function hardClearAuthUI() {
    // nav.js expects this behaviour: remove nav immediately
    const nav = document.getElementById("siteNav");
    if (nav) nav.innerHTML = "";
  }

  // Simple auth gate for pages that require login
  async function requireAuth({ redirectTo = "/abm-upload/index.html" } = {}) {
    const user = await getUserSafe();
    if (user) return user;
    hardClearAuthUI();
    // Don’t auto-redirect if you prefer a signed-out view.
    // If you want auto-redirect, uncomment:
    // window.location.href = redirectTo;
    return null;
  }

  // Consistent way to call Edge Functions with JWT + apikey
  async function callEdgeFunction(fnName, bodyObj) {
    const sess = await getSessionSafe();
    const jwt = sess?.access_token;

    const url = `${SUPABASE_URL}/functions/v1/${fnName}`;
    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY
    };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj || {})
    });

    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  }

  // Expose helpers
  window.ABM.getSessionSafe = getSessionSafe;
  window.ABM.getUserSafe = getUserSafe;
  window.ABM.getRoleSafe = getRoleSafe;
  window.ABM.requireAuth = requireAuth;
  window.ABM.callEdgeFunction = callEdgeFunction;

  // -----------------------------
  // Announce readiness
  // -----------------------------
  window.dispatchEvent(new CustomEvent("abm:shell:ready", { detail: { version: APP_VERSION } }));

  // Re-emit on auth changes (pages can listen)
  sb.auth.onAuthStateChange(() => {
    window.dispatchEvent(new CustomEvent("abm:auth:changed"));
  });
})();
