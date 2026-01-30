// login.js — dedicated login page (uses window.ABM.sb; does NOT create client)
(() => {
  const $ = (id) => document.getElementById(id);

  let _inited = false;

  function setStatus(msg) {
    const el = $("loginStatus");
    if (el) el.textContent = msg || "";
  }

  function getNextUrl() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    // only allow same-site relative paths (basic safety)
    if (!next) return null;
    if (next.startsWith("http://") || next.startsWith("https://")) return null;
    if (!next.startsWith("/")) return null;
    return next;
  }

  function goNextOrHome() {
    const next = getNextUrl();
    window.location.href = next || "./home.html";
  }

  async function initOnce() {
    if (_inited) return;
    _inited = true;

    if (!window.ABM?.sb) {
      console.error("[Login] ABM shell missing. window.ABM.sb not found.");
      document.body.innerHTML = `
        <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px;">
          <div>
            <h2 style="margin:0 0 8px;">App Shell not loaded</h2>
            <div>app.shell.js failed to initialise.</div>
          </div>
        </div>`;
      return;
    }

    const sb = window.ABM.sb;

    // If already signed in, go to ?next= if present, else Home
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      goNextOrHome();
      return;
    }

    $("loginBtn")?.addEventListener("click", async () => {
      setStatus("Signing in…");

      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";

      if (!email || !password) {
        setStatus("Enter email and password.");
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus(error.message);
        return;
      }

      setStatus("Signed in. Redirecting…");
      goNextOrHome();
    });

    // Allow Enter key to submit
    ["email", "password"].forEach((id) => {
      $(id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("loginBtn")?.click();
      });
    });
  }

  window.addEventListener("abm:shell:ready", initOnce);
  document.addEventListener("DOMContentLoaded", initOnce);
})();
