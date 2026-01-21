// nav.js — injects a consistent global navbar into #siteNav on every page
(function () {
  /* =========================
     Page + Role Helpers
  ========================= */

  function getPageName() {
    const p = (location.pathname || "").toLowerCase();
    if (p.endsWith("/workbench.html")) return "Workbench";
    if (p.endsWith("/admin-setup.html")) return "Admin Setup";
    if (p.endsWith("/admin-export.html")) return "Delivery";
    if (p.endsWith("/index.html") || p.endsWith("/")) return "CSV Upload";
    return "ABM Logic";
  }

  function getRoleRaw() {
    // Prefer explicit global (recommended)
    if (window.ABM_ROLE) return String(window.ABM_ROLE);

    // Fallback to localStorage if stored there by page scripts
    const ls =
      localStorage.getItem("abm_role") ||
      localStorage.getItem("role") ||
      localStorage.getItem("user_role");

    if (ls) return String(ls);

    // Final fallback
    return "user";
  }

  function normalizeRole(raw) {
    const r = String(raw || "").toLowerCase();
    if (r.includes("admin")) return "admin";
    if (r.includes("ops")) return "ops";
    if (r.includes("upload")) return "uploader";
    return "user";
  }

  function roleLabel(raw) {
    const r = normalizeRole(raw);
    if (r === "admin") return "ADMIN";
    if (r === "ops") return "OPS";
    if (r === "uploader") return "UPLOADER";
    return "USER";
  }

  function allowedTabsFor(rawRole) {
    const r = normalizeRole(rawRole);
    if (r === "admin") return new Set(["upload", "workbench", "admin_setup", "delivery"]);
    if (r === "ops") return new Set(["workbench"]);
    if (r === "uploader") return new Set(["upload"]);
    // safest default: show no tabs
    return new Set([]);
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

  /* =========================
     Nav Builder
  ========================= */

  function buildNav() {
    const host = document.getElementById("siteNav");
    if (!host) return;

    const pageTitle = (window.ABM_PAGE && window.ABM_PAGE.title) || getPageName();
    const helpText = (window.ABM_PAGE && window.ABM_PAGE.help) || "";

    const rawRole = getRoleRaw();
    const badgeText = roleLabel(rawRole);
    const allowed = allowedTabsFor(rawRole);

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
    badge.textContent = badgeText;

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
      { id: "upload", label: "Upload", href: "/abm-upload/index.html", match: "/index.html" },
      { id: "workbench", label: "Workbench", href: "/abm-upload/workbench.html", match: "/workbench.html" },
      { id: "admin_setup", label: "Admin Setup", href: "/abm-upload/admin-setup.html", match: "/admin-setup.html" },
      { id: "delivery", label: "Delivery", href: "/abm-upload/admin-export.html", match: "/admin-export.html" }
    ];

    const path = (location.pathname || "").toLowerCase();

    tabs.forEach((t) => {
      if (!allowed.has(t.id)) return;

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
    // we forward-click it. Otherwise emit an event.
    logoutBtn.addEventListener("click", () => {
      const existing = document.getElementById("logoutBtn");
      if (existing) return existing.click();
      window.dispatchEvent(new CustomEvent("abm:logout"));
    });
  }

  document.addEventListener("DOMContentLoaded", buildNav);
  window.addEventListener("abm:nav:refresh", buildNav);
})();
