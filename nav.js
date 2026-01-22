/* nav.js — shared navbar for ABM Upload pages
   Rules:
   - If NOT logged in: nav is NOT rendered
   - If logged in: nav + Logout rendered
   - Logout = hard logout (nav removed immediately)
*/

(function () {
  const siteNav = document.getElementById("siteNav");
  if (!siteNav) return;

  /* =========================
     Supabase config (self-contained)
  ========================= */

  const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";

  if (!window.supabase) {
    siteNav.innerHTML = "";
    return;
  }

// Create or reuse ONE shared client (prevents GoTrue lock conflicts)
const SB_STORAGE_KEY = "abmlogic-auth";

const sb =
  window.ABM_SB ||
  (window.ABM && window.ABM.sb) ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: SB_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

// Store it in BOTH places for backwards compatibility
window.ABM_SB = sb;
window.ABM = window.ABM || {};
window.ABM.sb = sb;

  /* =========================
     Navigation config
  ========================= */

  const PAGES = [
    { label: "Home", href: "/abm-upload/index.html" },
    { label: "Admin Setup", href: "/abm-upload/admin-setup.html", role: "admin" },
    { label: "Contact Workbench", href: "/abm-upload/contact-workbench.html" },
    { label: "Supplier Leads Upload", href: "/abm-upload/supplier-leads-upload.html", role: "admin" },
    { label: "Lead Workbench", href: "/abm-upload/workbench.html" },
    { label: "Lead Delivery", href: "/abm-upload/admin-export.html", role: "admin" }
  ];

  /* =========================
     Helpers
  ========================= */

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function currentPath() {
    return (location.pathname || "").toLowerCase();
  }

  function isActive(href) {
    return currentPath().endsWith(href.toLowerCase());
  }

  function getPageMeta() {
    return {
      title: document.body?.dataset?.pageTitle || "ABM Logic",
      badge: document.body?.dataset?.pageBadge || "",
      help:  document.body?.dataset?.pageHelp  || ""
    };
  }

  function clearNav() {
    siteNav.innerHTML = "";
  }

  /* =========================
     Auth + role
  ========================= */

  async function getUserAndRole() {
    const { data } = await sb.auth.getSession();
    const session = data?.session;

    if (!session?.user) {
      return { session: null, user: null, role: null };
    }

    const user = session.user;
    let role = "user";

    const { data: roleRow } = await sb
      .from("app_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleRow?.role) role = String(roleRow.role).toLowerCase();

    window.ABM_USER_EMAIL = user.email;
    window.ABM_ROLE = role;

    return { session, user, role };
  }

  /* =========================
     Render nav
  ========================= */

  function renderNav({ email, role }) {
    const { title, badge, help } = getPageMeta();

    const allowedTabs = PAGES.filter(p => {
      if (!p.role) return true;
      return role === p.role;
    });

    const tabsHtml = allowedTabs.map(p => {
      const active = isActive(p.href);
      return `
        <a href="${p.href}"
           ${active ? 'style="border-color: rgba(48,173,247,.55); background: rgba(48,173,247,.12);"' : ""}>
          ${esc(p.label)}
        </a>
      `;
    }).join("");

    siteNav.innerHTML = `
      <div class="navShell">
        <div class="navTop">
          <a class="nav-brand" href="/abm-upload/index.html">
            <img class="nav-logo" src="/abm-upload/abm-logo.png" alt="ABM Logic" />
          </a>

          <div class="navMeta">
            <div class="navTitleRow">
              <h1 class="navTitle">${esc(title)}</h1>
              ${badge ? `<span class="navBadge">${esc(badge)}</span>` : ""}
            </div>
            <div class="navSubRow">
              ${help ? `<div class="navHelp">${esc(help)}</div>` : ""}
              ${email ? `<div class="navIdentity">${esc(email)}</div>` : ""}
            </div>
          </div>

          <div class="navSpacer"></div>
          <button id="navLogoutBtn" type="button">Logout</button>
        </div>

        <div class="navBottom">
          ${tabsHtml}
        </div>
      </div>
    `;

    // Logout handler
    document.getElementById("navLogoutBtn").onclick = async () => {
      try {
        await sb.auth.signOut();
      } catch (e) {
        console.warn("Logout error:", e);
      }

      // Hard clear
      window.ABM_USER_EMAIL = "";
      window.ABM_ROLE = "";

      clearNav();

      // Force clean state (login page shows)
      location.reload();
    };
  }

  /* =========================
     Init
  ========================= */

  async function init() {
    const { session, user, role } = await getUserAndRole();

    if (!session || !user) {
      clearNav();
      return;
    }

    renderNav({ email: user.email, role });
  }

  // React to auth changes
  sb.auth.onAuthStateChange(() => {
    init().catch(clearNav);
  });

  // Manual refresh hook (used elsewhere)
  window.addEventListener("abm:nav:refresh", () => {
    init().catch(clearNav);
  });

  init().catch(clearNav);
})();
