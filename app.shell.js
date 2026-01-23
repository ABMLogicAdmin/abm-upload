/* =========================================================
   ABM Logic — App Shell
   Purpose:
   - Create ONE Supabase client for the entire frontend
   - Own auth/session lifecycle
   - Provide a shared global namespace (window.ABM)
   - Central place for versioning + environment config

   RULES:
   - Supabase client is created HERE and ONLY HERE
   - nav.js and all page JS must reuse window.ABM.sb
   - No page is allowed to call createClient()
========================================================= */

/* ===== App namespace ===== */
window.ABM = window.ABM || {};

/* ===== App metadata ===== */
window.ABM.app = {
  name: "ABM Logic Platform",
  version: "0.1.0",          // bump deliberately, not casually
  environment: "production"  // or "staging" later
};

/* ===== Supabase config (PUBLIC) ===== */
const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";

/* ===== Safety check ===== */
if (!window.supabase) {
  console.error("Supabase JS not loaded. app-shell.js must load AFTER supabase-js.");
}

/* ===== Single shared storage key ===== */
const SB_STORAGE_KEY = "abmlogic-auth";

/* ===== Create or reuse Supabase client ===== */
if (!window.ABM.sb) {
  window.ABM.sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        storageKey: SB_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );
}

/* ===== Convenience helpers ===== */
window.ABM.getSession = async function () {
  const { data, error } = await window.ABM.sb.auth.getSession();
  if (error) throw error;
  return data.session || null;
};

window.ABM.getUser = async function () {
  const session = await window.ABM.getSession();
  return session?.user || null;
};

/* ===== Debug (safe to remove later) ===== */
if (window.location.search.includes("debug=auth")) {
  window.ABM.getSession().then((s) => {
    console.log("[ABM] Session:", s);
    console.log("[ABM] App version:", window.ABM.app.version);
  });
}

/* =========================================================
   End App Shell
========================================================= */

