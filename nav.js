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

  function render() {
    const host = $("siteNav");
    if (!host) return;

    host.innerHTML = `
      <div class="nav">
        ${link("./index.html", "Upload", "upload")}
        ${link("./workbench.html", "Workbench", "workbench")}
        ${link("./admin.html", "Admin", "admin")}
        <span class="spacer"></span>
        <button id="navLogoutBtn" style="display:none;">Logout</button>
      </div>
    `;

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
