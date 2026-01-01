// nav.js — shared navigation for all GitHub Pages
(() => {
  const $ = (id) => document.getElementById(id);

  function currentPage() {
    const path = (location.pathname || "").toLowerCase();
    // Works even if repo is in a subfolder on GitHub Pages
    if (path.endsWith("/workbench.html")) return "workbench";
    if (path.endsWith("/admin.html")) return "admin";
    return "upload"; // index.html or anything else
  }

  function link(href, label, key) {
    const active = currentPage() === key ? 'aria-current="page" style="border-color:rgba(48,173,247,.55); background:rgba(48,173,247,.10);"' : "";
    return `<a href="${href}" ${active}>${label}</a>`;
  }

  async function render() {
    const host = $("siteNav");
    if (!host) return;

    host.innerHTML = `
      <div class="nav">
        <a class="nav-brand" href="./index.html" aria-label="ABM Logic Home">
          <img class="nav-logo" src="https://abmlogic.com/abm-logic-email-logo.png" alt="ABM Logic">
        </a>
    
        ${link("./index.html", "Upload", "upload")}
        ${link("./workbench.html", "Workbench", "workbench")}
        ${link("./admin.html", "Admin", "admin")}
        <span class="spacer"></span>
        <button id="navLogoutBtn" style="display:none;">Logout</button>
      </div>
    
      <div class="pageHeader">
        <div class="pageHeaderTop">
          <h1 class="pageTitle">${document.body.dataset.pageTitle || ""}</h1>
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

      // Populate role + email (Workbench sets window.ABM.me/currentRole after login)
      // We wait briefly to avoid timing issues.
      const identEl = $("pageIdentity");
      if (identEl) {
        for (let i = 0; i < 30; i++) {
          if (window.ABM?.me?.email) break;
          await new Promise(r => setTimeout(r, 100));
        }
      
        if (window.ABM?.me?.email) {
          const role = window.ABM.currentRole || "user";
          const email = window.ABM.me.email || "";
          identEl.textContent = `${role}, ${email}`;
          identEl.style.display = "block";
        } else {
          identEl.style.display = "none";
        }
      }

    // Optional: if Supabase client exists, show a real logout button
    // (This will work on pages that already load supabase-js + create window.ABM.sb)
    setTimeout(() => {
      const btn = $("navLogoutBtn");
      if (!btn) return;

      const sb = window.ABM?.sb;
      if (!sb) return; // page doesn't have auth, keep it hidden

      btn.style.display = "inline-flex";
      btn.addEventListener("click", async () => {
        try { await sb.auth.signOut(); } catch {}
        location.href = "./index.html";
      });
    }, 0);
  }

  // Run after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
