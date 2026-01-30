// home.js — protected Home page
(() => {
  let _inited = false;

  async function initOnce() {
    if (_inited) return;
    _inited = true;

    if (!window.ABM?.sb) {
      console.error("[Home] ABM shell missing.");
      return;
    }

    const sb = window.ABM.sb;

    const { data } = await sb.auth.getSession();
    if (!data?.session?.user) {
      window.location.href = "./login.html";
      return;
    }

    // Optional: expose user info globally
    window.ABM.me = data.session.user;
    window.ABM_USER_EMAIL = data.session.user.email || "";

    // Let nav render correctly
    window.dispatchEvent(new Event("abm:nav:refresh"));
  }

  window.addEventListener("abm:shell:ready", initOnce);
  document.addEventListener("DOMContentLoaded", initOnce);
})();
