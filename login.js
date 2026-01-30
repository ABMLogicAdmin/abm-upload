// login.js — dedicated login page (uses window.ABM.sb; does NOT create client)
(() => {
  const $ = (id) => document.getElementById(id);

  let _inited = false;

  function setStatus(msg) {
    const el = $("loginStatus");
    if (el) el.textContent = msg || "";
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

    // If already signed in, go straight to Home
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      window.location.href = "./home.html";
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
      window.location.href = "./home.html";
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

