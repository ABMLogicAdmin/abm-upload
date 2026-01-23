/* nav.js — shared navbar for ABM Upload pages
   Rule:
   - nav.js NEVER creates a Supabase client.
   - It ONLY reuses window.ABM.sb created by app-shell.js
*/

(function () {
  const siteNav = document.getElementById("siteNav");
  if (!siteNav) return;

  function clearNav() {
    siteNav.innerHTML = "";
  }

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
    return currentPath().endsWith(String(href || "").toLowerCase());
  }

  function getPageMeta() {
    return {
      title: document.body?.dataset?.pageTitle || "ABM Logic",
      badge: document.body?.dataset?.pageBadge || "",
      help:  document.body?.dataset?.pageHelp  || ""
    };
  }

  const PAGES = [
    { label: "Home", href: "/abm-upload/index.html" },
    { label: "Admin Setup", href: "/abm-upload/admin-setup.html", role: "admin" },
    { label: "Contact Workbench", href: "/abm-upload/contact-workbench.html" },
    { label: "Supplier Leads Upload", href: "/abm-upload/supplier-leads-upload.html", role: "admin" },
    { label: "Lead Workbench", href: "/abm-upload/workbench.html" },
    { label: "Lead Delivery", href: "/abm-upload/admin-export.html", role: "admin" }
  ];

  function getSbOrNull() {
    return (window.ABM && window.ABM.sb) ? window.ABM.sb : null;
  }

  async function getUserAndRole(sb) {
    const { data, error } = await sb.auth.getSession();
    if (error) return { session: null, user: null, role: null };

    const session = data?.session;
    if (!session?.user) return { session: null, user: null, role: null };

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

  function renderNav({ email, role, sb }) {
    const { title, badge, help } = getPageMeta();

    const allowedTabs = PAGES.filter(p => !p.role || role === p.role);

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

    document.getElementById("navLogoutBtn").onclick = async () => {
      try {
        await sb.auth.signOut();
      } catch (e) {
        console.warn("Logout error:", e);
      }

      window.ABM_USER_EMAIL = "";
      window.ABM_ROLE = "";

      clearNav();
      location.reload();
    };
  }

  async function init() {
    const sb = getSbOrNull();
    if (!sb) {
      // app-shell.js not loaded or failed
      clearNav();
      return;
    }

    const { session, user, role } = await getUserAndRole(sb);
    if (!session || !user) {
      clearNav();
      return;
    }

    renderNav({ email: user.email, role, sb });
  }

  // Wait for app-shell to signal ready (and also try immediately)
  window.addEventListener("abm:shell:ready", () => {
    init().catch(clearNav);
  });

  // React to auth changes (after sb exists)
  function hookAuthListener() {
    const sb = getSbOrNull();
    if (!sb) return;
    sb.auth.onAuthStateChange(() => {
      init().catch(clearNav);
    });
  }

  // Manual refresh hook
  window.addEventListener("abm:nav:refresh", () => {
    init().catch(clearNav);
  });

  // Try now, and hook auth listener if possible
  init().catch(clearNav);
  hookAuthListener();
})();
