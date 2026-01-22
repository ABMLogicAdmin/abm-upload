// nav.js — injects a consistent global navbar into #siteNav on every page
(function () {
  function getPageName() {
    const p = (location.pathname || "").toLowerCase();

    if (p.endsWith("/admin-home.html")) return "Admin Home";
    if (p.endsWith("/ops-home.html")) return "Ops Home";
    if (p.endsWith("/contact-workbench.html")) return "Contact Workbench";

    if (p.endsWith("/workbench.html")) return "Lead Workbench";
    if (p.endsWith("/admin-setup.html")) return "Admin Setup";
    if (p.endsWith("/admin-export.html")) return "Delivery";
    if (p.endsWith("/supplier-leads-upload.html")) return "Supplier Leads Upload";
    if (p.endsWith("/index.html") || p.endsWith("/")) return "ABM Upload";
    return "ABM Logic";
  }

  function getRoleRaw() {
    if (window.ABM_ROLE) return String(window.ABM_ROLE);

    const ls =
      localStorage.getItem("abm_role") ||
      localStorage.getItem("role") ||
      localStorage.getItem("user_role");

    if (ls) return String(ls);
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

  // Default OFF unless you explicitly enable it per-page
  function opsCanSeeLeadWorkbench() {
    return Boolean(window.ABM_OPS_LEADS === true);
  }

  function allowedTabsFor(rawRole) {
    const r = normalizeRole(rawRole);

    if (r === "admin") {
      return new Set([
        "admin_home",
        "supplier_upload",
        "admin_setup",
        "contact_workbench",
        "lead_workbench",
        "delivery",
      ]);
    }

    if (r === "ops") {
      const s = new Set(["ops_home", "contact_workbench"]);
      if (opsCanSeeLeadWorkbench()) s.add("lead_workbench");
      return s;
    }

    if (r === "uploader") return new Set(["supplier_upload"]);

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

  function defaultHomeForRole(rawRole) {
    const r = normalizeRole(rawRole);
    if (r === "admin") return "/abm-upload/admin-home.html";
    if (r === "ops") return "/abm-upload/ops-home.html";
    if (r === "uploader") return "/abm-upload/supplier-leads-upload.html";
    return "/abm-upload/index.html";
  }

  function buildNav() {
    const host = document.getElementById("siteNav");
    if (!host) return;

    const pageTitle = (window.ABM_PAGE && window.ABM_PAGE.title) || getPageName();
    const helpText = (window.ABM_PAGE && window.ABM_PAGE.help) || "";

    const rawRole = getRoleRaw();
    const badgeText = roleLabel(rawRole);
    const allowed = allowedTabsFor(rawRole);
    const homeHref = defaultHomeForRole(rawRole);

    const shell = document.createElement("div");
    shell.className = "navShell";

    const top = document.createElement("div");
    top.className = "navTop";

    const brand = document.createElement("a");
    brand.className = "nav-brand";
    brand.href = homeHref;
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

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "navLogoutBtn";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";

    top.appendChild(brand);
    top.appendChild(meta);
    top.appendChild(spacer);
    top.appendChild(logoutBtn);

    const bottom = document.createElement("div");
    bottom.className = "navBottom";

    // Order matters
     const tabs = [
      // Admin
      { id: "admin_home", label: "Home", href: "/abm-upload/admin-home.html", match: "/admin-home.html" },
      { id: "admin_setup", label: "Admin Setup", href: "/abm-upload/admin-setup.html", match: "/admin-setup.html" },
      { id: "contact_workbench", label: "Contact Workbench", href: "/abm-upload/contact-workbench.html", match: "/contact-workbench.html" },
      { id: "supplier_upload", label: "Supplier Leads Upload", href: "/abm-upload/supplier-leads-upload.html", match: "/supplier-leads-upload.html" },
      { id: "lead_workbench", label: "Lead Workbench", href: "/abm-upload/workbench.html", match: "/workbench.html" },
      { id: "delivery", label: "Lead Delivery", href: "/abm-upload/admin-export.html", match: "/admin-export.html" },
    
      // Ops
      { id: "ops_home", label: "Home", href: "/abm-upload/ops-home.html", match: "/ops-home.html" }
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

    logoutBtn.addEventListener("click", () => {
      const existing = document.getElementById("logoutBtn");
      if (existing) return existing.click();
      window.dispatchEvent(new CustomEvent("abm:logout"));
    });
  }

  document.addEventListener("DOMContentLoaded", buildNav);
  window.addEventListener("abm:nav:refresh", buildNav);
})();
