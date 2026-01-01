// nav.js — injects a consistent global navbar into #siteNav on every page
(function () {
  function getPageName() {
    const p = (location.pathname || "").toLowerCase();
    if (p.endsWith("/workbench.html")) return "Workbench";
    if (p.endsWith("/admin.html")) return "Admin Setup";
    if (p.endsWith("/index.html") || p.endsWith("/")) return "CSV Upload";
    return "ABM Logic";
  }

  function getRole() {
    // Prefer an explicit value if your pages set it (recommended)
    if (window.ABM_ROLE) return String(window.ABM_ROLE);

    // Fallback to localStorage if you already store it there
    const ls =
      localStorage.getItem("abm_role") ||
      localStorage.getItem("role") ||
      localStorage.getItem("user_role");

    if (ls) return String(ls);

    // Final fallback
    return "user";
  }

  function roleLabel(role) {
    const r = String(role || "").toLowerCase();
    if (r.includes("admin")) return "ADMIN";
    if (r.includes("ops")) return "OPS";
    return r.toUpperCase() || "USER";
  }

  function setActiveTab(a, isActive) {
    if (isActive) {
      a.setAttribute("aria-current", "page");
      a.style.borderColor = "rgba(48,173,247,.55)";
      a.style.background = "rgba(48,173,247,.18)";
    } else {
      a.removeAttribute("aria-current");
      a.style.borderColor = "";
      a.style.background = "";
    }
  }

  function buildNav() {
    const host = document.getElementById("siteNav");
    if (!host) return;

    const pageTitle = (window.ABM_PAGE && window.ABM_PAGE.title) || getPageName();
    const helpText = (window.ABM_PAGE && window.ABM_PAGE.help) || "";

    const role = roleLabel(getRole());

    // Shell
    const shell = document.createElement("div");
    shell.className = "navShell";

    // Top row
    const top = document.createElement("div");
    top.className = "navTop";

    const brand = document.createElement("a");
    brand.className = "nav-brand";
    brand.href = "/abm-upload/index.html";
    brand.setAttribute("aria-label", "ABM Logic Home");

    const logo = document.createElement("img");
    logo.className = "nav-logo";
    logo.src = "/abm-upload/abm-logic-logo.png";
    logo.alt = "ABM Logic";
    brand.appendChild(logo);

    const meta = document.createElement("div");
    meta.className = "navMeta";

    const titleRow = document.createElement("div");
    titleRow.className = "navTitleRow";

    const h = document.createElement("h1");
    h.className = "navTitle";
    h.textContent = pageTitle;

    const badge = document.createElement("span");
    badge.className = "navBadge";
    badge.textContent = role;

    titleRow.appendChild(h);
    titleRow.appendChild(badge);

    const subRow = document.createElement("div");
    subRow.className = "navSubRow";

    if (helpText) {
      const help = document.createElement("div");
      help.className = "navHelp";
      help.textContent = helpText;
      subRow.appendChild(help);
    }

    // Optional: show current user email if page sets it
    if (window.ABM_USER_EMAIL) {
      const ident = document.createElement("div");
      ident.className = "navIdentity";
      ident.textContent = window.ABM_USER_EMAIL;
      subRow.appendChild(ident);
    }

    meta.appendChild(titleRow);
    meta.appendChild(subRow);

    const spacer = document.createElement("div");
    spacer.className = "navSpacer";

    // Logout button (always on far right)
    const logoutBtn = document.createElement("button");
    logoutBtn.id = "navLogoutBtn";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";

    top.appendChild(brand);
    top.appendChild(meta);
    top.appendChild(spacer);
    top.appendChild(logoutBtn);

    // Bottom row tabs
    const bottom = document.createElement("div");
    bottom.className = "navBottom";

    const tabs = [
      { label: "Upload", href: "/abm-upload/index.html", match: "/index.html" },
      { label: "Workbench", href: "/abm-upload/workbench.html", match: "/workbench.html" },
      { label: "Admin", href: "/abm-upload/admin.html", match: "/admin.html" },
    ];

    const path = (location.pathname || "").toLowerCase();

    tabs.forEach(t => {
      const a = document.createElement("a");
      a.href = t.href;
      a.textContent = t.label;
      setActiveTab(a, path.endsWith(t.match));
      bottom.appendChild(a);
    });

    shell.appendChild(top);
    shell.appendChild(bottom);

    host.innerHTML = "";
    host.appendChild(shell);

    // Wire logout:
    // If your existing pages already attach logout logic to #logoutBtn,
    // we forward-click it. Otherwise you can implement logout here.
    logoutBtn.addEventListener("click", () => {
      const existing = document.getElementById("logoutBtn");
      if (existing) return existing.click();
      // fallback: emit an event so your page scripts can listen
      window.dispatchEvent(new CustomEvent("abm:logout"));
    });
  }

  document.addEventListener("DOMContentLoaded", buildNav);
window.addEventListener("abm:nav:refresh", buildNav);

})();
