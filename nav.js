// nav.js — shared navigation for all GitHub Pages
(() => {
  // Simple helper
  const $ = (id) => document.getElementById(id);

  // Detect which page we are on (for active nav styling)
  function currentPage() {
    const path = (location.pathname || "").toLowerCase();
    if (path.endsWith("/workbench.html")) return "workbench";
    if (path.endsWith("/admin.html")) return "admin";
    return "upload"; // index.html or anything else
  }

  // Build a nav link with active state
  function link(href, label, key) {
    const isActive = currentPage() === key;
    const activeAttrs = isActive
      ? 'aria-current="page" style="border-color:rgba(48,173,247,.55); background:rgba(48,173,247,.10);"'
      : "";
    return `<a href="${href}" ${activeAttrs}>${label}</a>`;
  }

  // Main render function
  async function render() {
    const host = $("siteNav");
    if (!host) return;

    // ---------- 1. Render NAV + PAGE HEADER ----------
    host.innerHTML = `
      <div class="nav">
        <a class="nav-brand" href="./index.html" aria-label="ABM Logic Home">
          <img
            class="nav-logo"
            src="https://abmlogic.com/abm-logic-email-logo.png"
            alt="ABM Logic"
          >
        </a>

        ${link("./index.html", "Upload", "upload")}
        ${link("./workbench.html", "Workbench", "workbench")}
        ${link("./admin.html", "Admin", "admin")}

        <span class="spacer"></span>

        <button id="navLogoutBtn" style="display:none;">Logout</button>
      </div>

      <div class="pageHeader">
        <div class="pageHeaderTop">
          <h1 class="pageTitle">
            ${document.body.dataset.pageTitle || ""}
          </h1>

          ${
            document.body.dataset.pageBadge
              ? `<span class="pageBadge">${document.body.dataset.pageBadge}</span>`
              : ""
          }
        </div>

        ${
          document.body.dataset.pageHelp
            ? `<div class="pageHelp">${document.body.dataset.pageHelp}</div>`
            : ""
        }

        <div class="pageIdentity" id="pageIdentity" style="display:none;"></div>
      </div>
    `;

    // ---------- 2. Populate USER ROLE + EMAIL ----------
    // Workbench sets: window.ABM.me and window.ABM.currentRole
    const identEl = $("pageIdentity");
    if (identEl) {
      // Wait briefly for login to finish (important for beginners)
      for (let i = 0; i < 30; i++) {
        if (window.ABM?.me?.email) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      if (window.ABM?.me?.email) {
        const role = window.ABM.currentRole || "user";
        const email = window.ABM.me.email;
        identEl.textContent = `${role}, ${email}`;
        identEl.style.display = "block";
      } else {
        identEl.style.display = "none";
      }
    }

    // ---------- 3. Logout button (only if auth exists) ----------
    const btn = $("navLogoutBtn");
    const sb = window.ABM?.sb;

    if (btn && sb) {
      btn.style.display = "inline-flex";
      btn.addEventListener("click", async () => {
        try {
          await sb.auth.signOut();
        } catch {}
        location.href = "./index.html";
      });
    }
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
