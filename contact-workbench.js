/* ABM Logic — Contact Workbench (Slice B)
   Rules:
   - Never update campaign_contacts (raw). Read only via views.
   - All writes go to campaign_contact_enrichment (overlay) + campaign_contact_enrichment_events (audit).
   - Uses Supabase JS v2 with anon key (RLS must permit ops/admin appropriately).
*/

/* ======= CONFIG (match your other pages) ======= */
const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ======= DOM ======= */
const el = (id) => document.getElementById(id);

const loginView = el("loginView");
const appView   = el("appView");

const loginEmail = el("loginEmail");
const loginPassword = el("loginPassword");
const loginBtn = el("loginBtn");
const loginMsg = el("loginMsg");

const appMsg = el("appMsg");
const refreshBtn = el("refreshBtn");

const tabPending = el("tabPending");
const tabMine = el("tabMine");
const tabDone = el("tabDone");
const tabRejected = el("tabRejected");

const queueList = el("queueList");
const queueCount = el("queueCount");

const detailEmpty = el("detailEmpty");
const detailView = el("detailView");
const detailTitle = el("detailTitle");
const detailSubtitle = el("detailSubtitle");
const rawBlock = el("rawBlock");

const claimBtn = el("claimBtn");
const releaseBtn = el("releaseBtn");
const saveBtn = el("saveBtn");
const doneBtn = el("doneBtn");
const rejectBtn = el("rejectBtn");
const rejectReason = el("rejectReason");

const ovLinkedin = el("ovLinkedin");
const ovPhone = el("ovPhone");
const ovNotes = el("ovNotes");
const ovActivationReady = el("ovActivationReady");
const ovCompleteness = el("ovCompleteness");
const ovVerifiedJson = el("ovVerifiedJson");

/* ======= STATE ======= */
let sessionUser = null;
let activeTab = "pending";
let activeRow = null; // queue row object
let activeDetail = null; // detail object (from v_contact_workbench_detail)

/* ======= UTIL ======= */
function setMsg(target, text, isError=false){
  target.textContent = text || "";
  target.style.color = isError ? "crimson" : "";
}

function safeText(v){
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function parseJsonOrNull(txt){
  const t = (txt || "").trim();
  if (!t) return null;
  try { return JSON.parse(t); }
  catch { throw new Error("Verified Fields must be valid JSON."); }
}

function pickDisplayName(row){
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || row.full_name || row.email || `Contact ${row.campaign_contact_id || row.id || ""}`.trim();
}

function isMine(row){
  // Many implementations store assigned_to as UUID of auth user
  return !!(row.assigned_to && sessionUser && row.assigned_to === sessionUser.id);
}

function statusPill(status){
  const s = (status || "").toLowerCase();
  if (!s) return "unknown";
  return s;
}

/* ======= AUTH + NAV ======= */
async function getSession(){
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

async function renderByAuth(){
  const sess = await getSession();
  sessionUser = sess?.user || null;

  if (!sessionUser){
    appView.style.display = "none";
    loginView.style.display = "block";
    setMsg(loginMsg, "");
    setMsg(appMsg, "");
    // nav.js rule: do not render nav when not logged in
    if (window.ABM_NAV && typeof window.ABM_NAV.destroy === "function") {
      window.ABM_NAV.destroy();
    } else {
      // hard fallback
      const nav = document.getElementById("siteNav");
      if (nav) nav.innerHTML = "";
    }
    return;
  }

  loginView.style.display = "none";
  appView.style.display = "block";
  setMsg(appMsg, "");

  // nav.js should render when logged in; if it needs init, call it
  if (window.ABM_NAV && typeof window.ABM_NAV.init === "function") {
    window.ABM_NAV.init();
  }

  await loadQueue(); // initial
}

/* ======= DATA LOAD ======= */
function setActiveTab(tab){
  activeTab = tab;
  [tabPending, tabMine, tabDone, tabRejected].forEach(b => b.classList.remove("active"));
  if (tab === "pending") tabPending.classList.add("active");
  if (tab === "mine") tabMine.classList.add("active");
  if (tab === "done") tabDone.classList.add("active");
  if (tab === "rejected") tabRejected.classList.add("active");
}

async function loadQueue(){
  if (!sessionUser) return;

  setMsg(appMsg, "Loading…");
  queueList.innerHTML = "";
  queueCount.textContent = "0";
  clearDetail();

  let viewName = "v_contact_workbench_queue";
  if (activeTab === "mine") viewName = "v_contact_workbench_queue_mine";
  if (activeTab === "done") viewName = "v_contact_workbench_queue_done";
  if (activeTab === "rejected") {
    // If you don’t actually have rejected view yet, we’ll fall back gracefully
    viewName = "v_contact_workbench_queue_rejected";
  }

  // We don’t know exact column names in your views.
  // So we select * and rely on common-sense fields existing.
  const { data, error } = await sb
    .from(viewName)
    .select("*")
    .limit(200);

  if (error){
    // rejected view might not exist; fallback to done read-only
    if (activeTab === "rejected"){
      setMsg(appMsg, "Rejected view not available. Showing Done instead.", true);
      activeTab = "done";
      setActiveTab("done");
      return loadQueue();
    }
    setMsg(appMsg, `Queue load failed: ${error.message}`, true);
    return;
  }

  const rows = data || [];
  queueCount.textContent = String(rows.length);

  if (!rows.length){
    queueList.innerHTML = `<div class="muted tiny">No rows in this queue.</div>`;
    setMsg(appMsg, "");
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "queue-item";

    const display = pickDisplayName(row);
    const company = row.company_name || row.company || row.account_name || row.domain || "";
    const subtitle = [row.email, company].filter(Boolean).join(" • ");

    const assigned = row.assigned_to ? (isMine(row) ? "mine" : "assigned") : "unassigned";
    const st = statusPill(row.status || activeTab);

    item.innerHTML = `
      <div class="queue-top">
        <div>
          <div class="queue-name">${escapeHtml(display)}</div>
          <div class="queue-sub">${escapeHtml(subtitle || "—")}</div>
        </div>
        <span class="pill">${escapeHtml(st)}</span>
      </div>
      <div class="queue-meta">
        <span class="pill subtle">${escapeHtml(assigned)}</span>
        ${row.completeness_score !== undefined && row.completeness_score !== null ? `<span class="pill subtle">score ${escapeHtml(row.completeness_score)}</span>` : ``}
        ${row.activation_ready !== undefined && row.activation_ready !== null ? `<span class="pill subtle">ready ${escapeHtml(String(row.activation_ready))}</span>` : ``}
      </div>
    `;

    item.addEventListener("click", async () => {
      document.querySelectorAll(".queue-item").forEach(x => x.classList.remove("active"));
      item.classList.add("active");
      activeRow = row;
      await loadDetail(row);
    });

    queueList.appendChild(item);
  });

  setMsg(appMsg, "");
}

function clearDetail(){
  activeRow = null;
  activeDetail = null;
  detailView.style.display = "none";
  detailEmpty.style.display = "block";
  detailTitle.textContent = "—";
  detailSubtitle.textContent = "—";
  rawBlock.innerHTML = "";
  ovLinkedin.value = "";
  ovPhone.value = "";
  ovNotes.value = "";
  ovActivationReady.checked = false;
  ovCompleteness.value = "";
  ovVerifiedJson.value = "";
  rejectReason.value = "";

  // Default buttons
  claimBtn.disabled = true;
  releaseBtn.disabled = true;
  saveBtn.disabled = true;
  doneBtn.disabled = true;
  rejectBtn.disabled = true;
}

async function loadDetail(row){
  if (!row) return;

  setMsg(appMsg, "Loading detail…");

  // We need a stable identifier. Prefer campaign_contact_id, otherwise id.
  const contactId = row.campaign_contact_id || row.id;
  if (!contactId){
    setMsg(appMsg, "Row has no campaign_contact_id/id. Fix the view to expose it.", true);
    return;
  }

  // Fetch detail from v_contact_workbench_detail
  // Expectation: this view returns 1 row per campaign_contact_id with raw + overlay fields joined.
  const { data, error } = await sb
    .from("v_contact_workbench_detail")
    .select("*")
    .eq("campaign_contact_id", contactId)
    .maybeSingle();

  if (error){
    setMsg(appMsg, `Detail load failed: ${error.message}`, true);
    return;
  }

  activeDetail = data || row; // fallback to row if detail returns null
  const display = pickDisplayName(activeDetail);
  const company = activeDetail.company_name || activeDetail.company || activeDetail.account_name || activeDetail.domain || "—";
  const title = activeDetail.title || activeDetail.job_title || "";
  const email = activeDetail.email || "";

  detailTitle.textContent = display;
  detailSubtitle.textContent = [title, company, email].filter(Boolean).join(" • ") || "—";

  renderRaw(activeDetail);

  // Populate overlay fields (try common names)
  ovLinkedin.value = activeDetail.linkedin_url || activeDetail.linkedin || "";
  ovPhone.value = activeDetail.phone || activeDetail.phone_number || "";
  ovNotes.value = activeDetail.ops_notes || activeDetail.notes || "";
  ovActivationReady.checked = !!(activeDetail.activation_ready);
  ovCompleteness.value = (activeDetail.completeness_score ?? activeDetail.overlay_completeness_score ?? "");

  const vf = activeDetail.verified_fields || activeDetail.verified_fields_json || activeDetail.verified || null;
  if (vf && typeof vf === "object") ovVerifiedJson.value = JSON.stringify(vf, null, 2);
  else if (typeof vf === "string") ovVerifiedJson.value = vf;
  else ovVerifiedJson.value = "";

  // Button rules:
  // - Pending: can claim (if unassigned), can save only after claim (enforced in backend ideally)
  // - Mine: can save/done/reject/release
  // - Done/Rejected: read-only (no writes)
  const st = (activeDetail.status || row.status || activeTab || "").toLowerCase();
  const readOnly = (st === "done" || st === "rejected" || activeTab === "done" || activeTab === "rejected");

  detailEmpty.style.display = "none";
  detailView.style.display = "block";

  claimBtn.disabled = readOnly || !!activeDetail.assigned_to; // if already assigned, claim disabled
  releaseBtn.disabled = readOnly || !isMine(activeDetail);
  saveBtn.disabled = readOnly || !isMine(activeDetail);
  doneBtn.disabled = readOnly || !isMine(activeDetail);
  rejectBtn.disabled = readOnly || !isMine(activeDetail);

  setMsg(appMsg, "");
}

function renderRaw(obj){
  // We render a curated list first, then (optionally) a couple extra if present.
  const candidates = [
    ["First name", obj.first_name],
    ["Last name", obj.last_name],
    ["Full name", obj.full_name],
    ["Email", obj.email],
    ["Title", obj.title || obj.job_title],
    ["Company", obj.company_name || obj.company || obj.account_name],
    ["Domain", obj.domain],
    ["Country", obj.country],
    ["Region", obj.region],
    ["City", obj.city],
    ["Source", obj.source],
    ["Campaign", obj.campaign_name],
    ["Ingested at", obj.ingested_at || obj.created_at],
    ["Raw contact ID", obj.campaign_contact_id || obj.id],
  ];

  rawBlock.innerHTML = "";
  candidates.forEach(([k,v]) => {
    if (v === undefined) return; // hide truly unknown fields
    const div = document.createElement("div");
    div.className = "kv";
    div.innerHTML = `
      <div class="k">${escapeHtml(k)}</div>
      <div class="v">${escapeHtml(safeText(v))}</div>
    `;
    rawBlock.appendChild(div);
  });
}

/* ======= WRITES (overlay + events) ======= */
async function writeEvent(campaignContactId, eventType, payload){
  // Best-effort audit; if it fails, we still want to know and stop pretending it worked
  const { error } = await sb.from("campaign_contact_enrichment_events").insert([{
    campaign_contact_id: campaignContactId,
    event_type: eventType,
    event_payload: payload ?? null
  }]);
  if (error) throw error;
}

async function upsertOverlay(campaignContactId, patch){
  // Assumption: campaign_contact_enrichment has a unique key on campaign_contact_id
  // Adjust column names here if your schema differs.
  const row = {
    campaign_contact_id: campaignContactId,
    linkedin_url: patch.linkedin_url ?? null,
    phone: patch.phone ?? null,
    ops_notes: patch.ops_notes ?? null,
    verified_fields: patch.verified_fields ?? null,
    completeness_score: patch.completeness_score ?? null,
    activation_ready: patch.activation_ready ?? null,
    status: patch.status ?? null,
    assigned_to: patch.assigned_to ?? undefined, // undefined = don't touch
    rejected_reason: patch.rejected_reason ?? null,
    updated_at: new Date().toISOString(),
  };

  // Remove undefined fields (so we don't overwrite accidentally)
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

  const { data, error } = await sb
    .from("campaign_contact_enrichment")
    .upsert(row, { onConflict: "campaign_contact_id" })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

function getActiveContactId(){
  const id = activeDetail?.campaign_contact_id || activeRow?.campaign_contact_id || activeDetail?.id || activeRow?.id;
  if (!id) throw new Error("No active campaign_contact_id/id.");
  return id;
}

/* ======= ACTION HANDLERS ======= */
async function handleClaim(){
  try{
    setMsg(appMsg, "Claiming…");
    const id = getActiveContactId();

    // Claim = set assigned_to + status in overlay table (not raw)
    await upsertOverlay(id, { assigned_to: sessionUser.id, status: "in_progress" });
    await writeEvent(id, "claim", { by: sessionUser.id });

    setMsg(appMsg, "Claimed.");
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleRelease(){
  try{
    setMsg(appMsg, "Releasing…");
    const id = getActiveContactId();
    await upsertOverlay(id, { assigned_to: null, status: "pending" });
    await writeEvent(id, "release", { by: sessionUser.id });

    setMsg(appMsg, "Released.");
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleSave(){
  try{
    setMsg(appMsg, "Saving overlay…");
    const id = getActiveContactId();

    const vf = parseJsonOrNull(ovVerifiedJson.value);

    const completeness = ovCompleteness.value === "" ? null : Number(ovCompleteness.value);
    if (completeness !== null && (Number.isNaN(completeness) || completeness < 0 || completeness > 100)){
      throw new Error("Completeness Score must be a number between 0 and 100.");
    }

    await upsertOverlay(id, {
      linkedin_url: ovLinkedin.value.trim() || null,
      phone: ovPhone.value.trim() || null,
      ops_notes: ovNotes.value.trim() || null,
      verified_fields: vf,
      completeness_score: completeness,
      activation_ready: !!ovActivationReady.checked
      // status unchanged on save
    });

    await writeEvent(id, "save_overlay", {
      by: sessionUser.id,
      fields: ["linkedin_url","phone","ops_notes","verified_fields","completeness_score","activation_ready"]
    });

    setMsg(appMsg, "Saved.");
    // Reload detail to reflect actual stored values
    await loadDetail({ campaign_contact_id: id });
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleDone(){
  try{
    setMsg(appMsg, "Marking done…");
    const id = getActiveContactId();

    await upsertOverlay(id, { status: "done" });
    await writeEvent(id, "mark_done", { by: sessionUser.id });

    setMsg(appMsg, "Done.");
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleReject(){
  try{
    const reason = (rejectReason.value || "").trim();
    if (!reason) throw new Error("Reject reason is required.");

    setMsg(appMsg, "Rejecting…");
    const id = getActiveContactId();

    await upsertOverlay(id, { status: "rejected", rejected_reason: reason });
    await writeEvent(id, "reject", { by: sessionUser.id, reason });

    setMsg(appMsg, "Rejected.");
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

/* ======= EVENTS ======= */
loginBtn.addEventListener("click", async () => {
  try{
    setMsg(loginMsg, "Logging in…");
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setMsg(loginMsg, "");
    await renderByAuth();
  }catch(e){
    setMsg(loginMsg, e.message || String(e), true);
  }
});

refreshBtn.addEventListener("click", async () => {
  await loadQueue();
});

tabPending.addEventListener("click", async () => { setActiveTab("pending"); await loadQueue(); });
tabMine.addEventListener("click", async () => { setActiveTab("mine"); await loadQueue(); });
tabDone.addEventListener("click", async () => { setActiveTab("done"); await loadQueue(); });
tabRejected.addEventListener("click", async () => { setActiveTab("rejected"); await loadQueue(); });

claimBtn.addEventListener("click", handleClaim);
releaseBtn.addEventListener("click", handleRelease);
saveBtn.addEventListener("click", handleSave);
doneBtn.addEventListener("click", handleDone);
rejectBtn.addEventListener("click", handleReject);

// React to auth changes (hard logout rule handled by nav.js; we still re-render)
sb.auth.onAuthStateChange(async () => {
  await renderByAuth();
});

/* ======= INIT ======= */
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

(async function init(){
  clearDetail();
  setActiveTab("pending");
  await renderByAuth();
})();
