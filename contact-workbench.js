/* ABM Logic — Contact Workbench (Slice B)
   Truth:
   - campaign_contacts = queue + raw snapshot + workflow state (claim/verify/reject live here)
   - campaign_contact_enrichment = verified/enriched overlay (editable fields live here)
   - campaign_contact_enrichment_events = audit log
*/

/* =========================
   Supabase client (REUSE nav.js)
   ========================= */
const sb = window.ABM?.sb;

if (!sb) {
  // If this happens, nav.js did not load, or supabase-js CDN didn't load before nav.js.
  throw new Error(
    "Supabase client not found (window.ABM.sb). " +
    "Check script order: supabase-js CDN -> nav.js -> contact-workbench.js"
  );
}

/* ======= DOM ======= */
const el = (id) => document.getElementById(id);

const loginView = el("loginView");
const appView   = el("appView");
const loginMsg  = el("loginMsg");

const appMsg = el("appMsg");
const refreshBtn = el("refreshBtn");

const tabPending  = el("tabPending");
const tabMine     = el("tabMine");
const tabDone     = el("tabDone");
const tabRejected = el("tabRejected");

const queueList  = el("queueList");
const queueCount = el("queueCount");

const detailEmpty    = el("detailEmpty");
const detailView     = el("detailView");
const detailTitle    = el("detailTitle");
const detailSubtitle = el("detailSubtitle");
const rawBlock       = el("rawBlock");

const claimBtn   = el("claimBtn");
const releaseBtn = el("releaseBtn");
const saveBtn    = el("saveBtn");
const doneBtn    = el("doneBtn");
const rejectBtn  = el("rejectBtn");
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
let activeRow = null;    // selected row from queue view
let activeDetail = null; // selected row from detail view

/* ======= UTIL ======= */
function setMsg(target, text, isError=false){
  if (!target) return;
  target.textContent = text || "";
  target.style.color = isError ? "crimson" : "";
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
  return full || row.email || `Contact ${row.campaign_contact_id || ""}`;
}

function isMine(row){
  return !!(row.enrichment_assigned_to && sessionUser && row.enrichment_assigned_to === sessionUser.id);
}

function normalizeStatus(s){
  return String(s || "").toLowerCase().trim();
}

/* =========================
   AUTH (no local login form)
   ========================= */
async function renderByAuth(){
  const { data, error } = await sb.auth.getSession();
  if (error) {
    setMsg(appMsg, `Auth error: ${error.message}`, true);
    sessionUser = null;
  } else {
    sessionUser = data.session?.user || null;
  }

  if (!sessionUser){
    // signed out
    appView.style.display = "none";
    loginView.style.display = "block";
    setMsg(loginMsg, "You’re signed out. Use Home to login, then return here.");
    setMsg(appMsg, "");
    return;
  }

  // signed in
  loginView.style.display = "none";
  appView.style.display = "block";
  setMsg(appMsg, "");

  // nav.js already renders nav. No need to call init/destroy from here.
  await loadQueue();
}

/* =========================
   QUEUE
   ========================= */
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

  // Your views (expected)
  let viewName = "v_contact_workbench_queue";
  if (activeTab === "mine") viewName = "v_contact_workbench_queue_mine";
  if (activeTab === "done") viewName = "v_contact_workbench_queue_done";
  if (activeTab === "rejected") viewName = "v_contact_workbench_queue_rejected"; // may not exist

  const { data, error } = await sb
    .from(viewName)
    .select("*")
    .limit(200);

  if (error){
    // if rejected view doesn't exist, show a clean message
    if (activeTab === "rejected"){
      setMsg(appMsg, "Rejected queue view not available yet (DB view missing).", true);
      queueList.innerHTML = `<div class="muted tiny">Rejected view not available yet.</div>`;
      return;
    }
    setMsg(appMsg, `Queue load failed: ${error.message}`, true);
    queueList.innerHTML = `<div class="muted tiny">Queue load failed.</div>`;
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
    const subtitle = [row.email, row.company].filter(Boolean).join(" • ");

    const assigned = row.enrichment_assigned_to
      ? (isMine(row) ? "mine" : "assigned")
      : "unassigned";

    const st = normalizeStatus(row.enrichment_status || activeTab) || "unknown";

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
      </div>
    `;

    item.addEventListener("click", async () => {
      document.querySelectorAll(".queue-item").forEach(x => x.classList.remove("active"));
      item.classList.add("active");
      activeRow = row;
      await loadDetail(row.campaign_contact_id);
    });

    queueList.appendChild(item);
  });

  setMsg(appMsg, "");
}

/* =========================
   DETAIL
   ========================= */
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

  claimBtn.disabled = true;
  releaseBtn.disabled = true;
  saveBtn.disabled = true;
  doneBtn.disabled = true;
  rejectBtn.disabled = true;
}

async function loadDetail(campaignContactId){
  if (!campaignContactId){
    setMsg(appMsg, "Missing campaign_contact_id. Fix queue view to include it.", true);
    return;
  }

  setMsg(appMsg, "Loading detail…");

  const { data, error } = await sb
    .from("v_contact_workbench_detail")
    .select("*")
    .eq("campaign_contact_id", campaignContactId)
    .maybeSingle();

  if (error){
    setMsg(appMsg, `Detail load failed: ${error.message}`, true);
    return;
  }

  activeDetail = data;
  if (!activeDetail){
    setMsg(appMsg, "No detail row returned. Check v_contact_workbench_detail.", true);
    return;
  }

  detailTitle.textContent = pickDisplayName(activeDetail);
  detailSubtitle.textContent =
    [activeDetail.title, activeDetail.company, activeDetail.email]
      .filter(Boolean)
      .join(" • ") || "—";

  renderRaw(activeDetail);

  // overlay fields (joined from campaign_contact_enrichment)
  ovLinkedin.value = activeDetail.linkedin_url || "";
  ovPhone.value = activeDetail.phone || "";
  ovNotes.value = activeDetail.notes || "";
  ovActivationReady.checked = !!activeDetail.activation_ready;
  ovCompleteness.value = activeDetail.completeness_score ?? "";

  const vf = activeDetail.verified_fields;
  ovVerifiedJson.value = vf && typeof vf === "object"
    ? JSON.stringify(vf, null, 2)
    : (vf || "");

  // Read-only logic
  const st = normalizeStatus(activeDetail.enrichment_status);
  const readOnly = (st === "verified" || st === "rejected");

  detailEmpty.style.display = "none";
  detailView.style.display = "block";

  claimBtn.disabled = readOnly || !!activeDetail.enrichment_assigned_to;
  releaseBtn.disabled = readOnly || !isMine(activeDetail);
  saveBtn.disabled = readOnly || !isMine(activeDetail);
  doneBtn.disabled = readOnly || !isMine(activeDetail);
  rejectBtn.disabled = readOnly || !isMine(activeDetail);

  setMsg(appMsg, "");
}

function renderRaw(obj){
  const candidates = [
    ["Email", obj.email],
    ["First name", obj.first_name],
    ["Last name", obj.last_name],
    ["Title", obj.title],
    ["Company", obj.company],
    ["Domain", obj.domain],
    ["Department", obj.department],
    ["Seniority", obj.seniority],
    ["Country", obj.country],
    ["Industry", obj.industry],
    ["Source system", obj.source_system],
    ["Batch ID", obj.batch_id],
    ["Campaign Contact ID", obj.campaign_contact_id],
    ["Suppressed", obj.suppressed],
    ["Suppressed reason", obj.suppressed_reason],
    ["Created at", obj.created_at],
  ];

  rawBlock.innerHTML = "";
  candidates.forEach(([k,v]) => {
    if (v === undefined) return;
    const div = document.createElement("div");
    div.className = "kv";
    div.innerHTML = `
      <div class="k">${escapeHtml(k)}</div>
      <div class="v">${escapeHtml(safeText(v))}</div>
    `;
    rawBlock.appendChild(div);
  });
}

/* =========================
   WRITES
   ========================= */
async function writeEvent(campaignContactId, eventType, payload){
  const { error } = await sb
    .from("campaign_contact_enrichment_events")
    .insert([{
      campaign_contact_id: campaignContactId,
      event_type: eventType,
      event_payload: payload ?? null
    }]);

  if (error) throw error;
}

async function updateContactState(campaignContactId, patch){
  const { error } = await sb
    .from("campaign_contacts")
    .update(patch)
    .eq("campaign_contact_id", campaignContactId);

  if (error) throw error;
}

async function upsertOverlay(campaignContactId, patch){
  const row = {
    campaign_contact_id: campaignContactId,
    linkedin_url: patch.linkedin_url ?? null,
    phone: patch.phone ?? null,
    company_size: patch.company_size ?? null,
    notes: patch.notes ?? null,
    verified_fields: patch.verified_fields ?? null,
    completeness_score: patch.completeness_score ?? null,
    activation_ready: patch.activation_ready ?? null,
    enriched_by: sessionUser.id,
    enriched_at: new Date().toISOString(),
  };

  const { error } = await sb
    .from("campaign_contact_enrichment")
    .upsert(row, { onConflict: "campaign_contact_id" });

  if (error) throw error;
}

function getActiveId(){
  const id = activeDetail?.campaign_contact_id || activeRow?.campaign_contact_id;
  if (!id) throw new Error("No active campaign_contact_id selected.");
  return id;
}

/* =========================
   ACTIONS
   ========================= */
async function handleClaim(){
  try{
    setMsg(appMsg, "Claiming…");
    const id = getActiveId();

    await updateContactState(id, {
      enrichment_assigned_to: sessionUser.id,
      enrichment_assigned_at: new Date().toISOString(),
      enrichment_status: "in_progress"
    });

    await writeEvent(id, "assigned", { by: sessionUser.id });

    setMsg(appMsg, "Claimed.");
    await loadQueue();
    await loadDetail(id);
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleRelease(){
  try{
    setMsg(appMsg, "Releasing…");
    const id = getActiveId();

    await updateContactState(id, {
      enrichment_assigned_to: null,
      enrichment_status: "pending"
    });

    await writeEvent(id, "unassigned", { by: sessionUser.id });

    setMsg(appMsg, "Released.");
    await loadQueue();
    clearDetail();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleSave(){
  try{
    setMsg(appMsg, "Saving overlay…");
    const id = getActiveId();

    const vf = parseJsonOrNull(ovVerifiedJson.value);

    const completeness = ovCompleteness.value === "" ? null : Number(ovCompleteness.value);
    if (completeness !== null && (Number.isNaN(completeness) || completeness < 0 || completeness > 100)){
      throw new Error("Completeness Score must be 0–100.");
    }

    await upsertOverlay(id, {
      linkedin_url: ovLinkedin.value.trim() || null,
      phone: ovPhone.value.trim() || null,
      notes: ovNotes.value.trim() || null,
      verified_fields: vf,
      completeness_score: completeness,
      activation_ready: !!ovActivationReady.checked
    });

    await writeEvent(id, "saved", { by: sessionUser.id });

    setMsg(appMsg, "Saved.");
    await loadDetail(id);
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleDone(){
  try{
    setMsg(appMsg, "Marking verified…");
    const id = getActiveId();

    await updateContactState(id, {
      enrichment_status: "verified",
      enrichment_locked_at: new Date().toISOString()
    });

    await writeEvent(id, "verified", { by: sessionUser.id });

    setMsg(appMsg, "Verified.");
    await loadQueue();
    clearDetail();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

async function handleReject(){
  try{
    const reason = (rejectReason.value || "").trim();
    if (!reason) throw new Error("Reject reason is required.");

    setMsg(appMsg, "Rejecting…");
    const id = getActiveId();

    await updateContactState(id, {
      enrichment_status: "rejected",
      enrichment_locked_at: new Date().toISOString()
    });

    await writeEvent(id, "rejected", { by: sessionUser.id, reason });

    // Optional: store reason in overlay notes too
    await upsertOverlay(id, { notes: `REJECTED: ${reason}` });

    setMsg(appMsg, "Rejected.");
    await loadQueue();
    clearDetail();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

/* =========================
   EVENTS
   ========================= */
refreshBtn.addEventListener("click", loadQueue);

tabPending.addEventListener("click", async () => { setActiveTab("pending"); await loadQueue(); });
tabMine.addEventListener("click", async () => { setActiveTab("mine"); await loadQueue(); });
tabDone.addEventListener("click", async () => { setActiveTab("done"); await loadQueue(); });
tabRejected.addEventListener("click", async () => { setActiveTab("rejected"); await loadQueue(); });

claimBtn.addEventListener("click", handleClaim);
releaseBtn.addEventListener("click", handleRelease);
saveBtn.addEventListener("click", handleSave);
doneBtn.addEventListener("click", handleDone);
rejectBtn.addEventListener("click", handleReject);

// Keep UI in sync with global auth changes
sb.auth.onAuthStateChange(() => {
  renderByAuth().catch((e) => setMsg(appMsg, e.message || String(e), true));
});

/* =========================
   INIT
   ========================= */
(async function init(){
  try{
    clearDetail();
    setActiveTab("pending");
    await renderByAuth();
  }catch(e){
    console.error(e);
    // If something goes wrong, show login view instead of blank
    appView.style.display = "none";
    loginView.style.display = "block";
    setMsg(loginMsg, e.message || String(e), true);
  }
})();
