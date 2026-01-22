/* nav.js — shared navbar for ABM Upload pages
   Rule:
   - If NOT logged in: DO NOT render nav at all.
   - If logged in: render nav + Logout.
*/

(function () {
  const siteNav = document.getElementById("siteNav");
  if (!siteNav) return;

  // ---- Config ----
  // Prefer globals set by each page (supplier upload sets ABM_SUPABASE_ANON_KEY).
  // Fallbacks are optional but safe.
  const SUPABASE_URL =
    window.ABM_SUPABASE_URL ||
    "https://mwfnbmkjetriunsddupr.supabase.co";

  const SUPABASE_ANON_KEY =
    window.ABM_SUPABASE_ANON_KEY ||
    window.ABM_SUPABASE_ANON ||
    "";

  // If we don't have a key, do nothing (avoid rendering broken nav)
  if (!window.supabase || !SUPABASE_ANON_KEY) {
    siteNav.innerHTML = "";
    return;
  }

  // Create or reuse client
  const sb =
    (window.ABM && window.ABM.sb) ||
    window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  window.ABM = window.ABM || {};
  window.ABM.sb = sb;

  // Pages + routing
  const PAGES = [
    { label: "Home", href: "/abm-upload/index.html" },
    { label: "Admin Setup", href: "/abm-upload/admin-setup.html", role: "admin" },
    { label: "Contact Workbench", href: "/abm-upload/contact-workbench.html" },
    { label: "Supplier Leads Upload", href: "/abm-upload/supplier-leads-upload.html", role: "admin" },
    { label: "Lead Workbench", href: "/abm-upload/workbench.html" },
    { label: "Lead Delivery", href: "/abm-upload/admin-export.html", role: "admin" }
  ];

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
    const p = currentPath();
    return p.endsWith(href.toLowerCase());
  }

  function getPageMeta() {
    const title = document.body?.dataset?.pageTitle || "ABM Logic";
    const badge = document.body?.dataset?.pageBadge || "";
    const help  = document.body?.dataset?.pageHelp  || "";
    return { title, badge, help };
  }

  function clearNav() {
    siteNav.innerHTML = "";
  }

  async function getUserAndRole() {
    const { data: sess } = await sb.auth.getSession();
    const session = sess?.session;

    if (!session?.user) return { session: null, user: null, role: null };

    const user = session.user;

    // Default role if app_users lookup fails
    let role = "user";

    const { data: roleRow, error: roleErr } = await sb
      .from("app_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleErr && roleRow?.role) role = String(roleRow.role).toLowerCase();

    // cache on window for other pages
    window.ABM_USER_EMAIL = user.email;
    window.ABM_ROLE = role;

    return { session, user, role };
  }

  function renderNav({ email, role }) {
    const { title, badge, help } = getPageMeta();

    // Filter tabs by role (admin-only tabs hidden for ops)
    const allowed = PAGES.filter(p => {
      if (!p.role) return true;
      return String(role || "").toLowerCase() === p.role;
    });

    const tabsHtml = allowed.map(p => {
      const active = isActive(p.href);
      const style = active
        ? 'style="border-color: rgba(48,173,247,.55); background: rgba(48,173,247,.12);"'
        : "";
      return `<a href="${p.href}" ${style}>${esc(p.label)}</a>`;
    }).join("");

    siteNav.innerHTML = `
      <div class="navShell">
        <div class="navTop">
          <a class="nav-brand" href="/abm-upload/index.html" aria-label="ABM Logic Home">
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

    // Hook logout
    const btn = document.getElementById("navLogoutBtn");
    if (btn) {
      btn.addEventListener("click", async () => {
        try {
          await sb.auth.signOut();
        } catch (e) {
          console.warn("Logout error:", e);
        }

        // Hard clear any cached identity
        window.ABM_USER_EMAIL = "";
        window.ABM_ROLE = "";

        // Remove nav immediately
        clearNav();

        // Reload page so the login form is shown cleanly
        location.reload();
      });
    }
  }

  async function init() {
    // If not logged in -> no nav, period.
    const { session, user, role } = await getUserAndRole();
    if (!session || !user) {
      clearNav();
      return;
    }
    renderNav({ email: user.email, role });
  }

  // If auth changes (sign in/out), re-run nav logic
  sb.auth.onAuthStateChange(() => {
    init().catch(() => clearNav());
  });

  // Some pages trigger this after they fetch role (your pattern)
  window.addEventListener("abm:nav:refresh", () => {
    init().catch(() => clearNav());
  });

  // Start
  init().catch(() => clearNav());
})();
