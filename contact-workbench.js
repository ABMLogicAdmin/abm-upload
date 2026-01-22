/* ABM Logic — Contact Workbench (Slice B)
   Truth:
   - campaign_contacts = queue + raw snapshot + workflow state (claim/verify/reject live here)
   - campaign_contact_enrichment = verified/enriched overlay (editable fields live here)
   - events table = audit log
*/

const SUPABASE_URL = "https://mwfnbmkjetriunsddupr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Zm5ibWtqZXRyaXVuc2RkdXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzY0MDcsImV4cCI6MjA4MjA1MjQwN30._mPr3cn9Dse-oOB44AlFTDq8zjgUkIhCZG31gzeYmHU";

function getSupabaseClient() {
  if (window.ABM_SB) return window.ABM_SB;

  const SB_STORAGE_KEY = "abmlogic-auth";

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: SB_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  window.ABM_SB = client;            // shared
  window.ABM = window.ABM || {};
  window.ABM.sb = client;            // backwards compat
  return client;
}

const sb = getSupabaseClient();

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
let activeRow = null;
let activeDetail = null;

/* ======= UTIL ======= */
function setMsg(target, text, isError=false){
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

/* ======= AUTH ======= */
async function renderByAuth(){
  const { data } = await sb.auth.getSession();
  sessionUser = data.session?.user || null;

  if (!sessionUser){
    appView.style.display = "none";
    loginView.style.display = "block";
    setMsg(loginMsg, "Please sign in via Home.", false);

    // nav must not render if signed out (nav.js rule)
    if (window.ABM_NAV?.destroy) window.ABM_NAV.destroy();
    else document.getElementById("siteNav").innerHTML = "";

    return;
  }

  loginView.style.display = "none";
  appView.style.display = "block";

  if (window.ABM_NAV?.init) window.ABM_NAV.init();
  await loadQueue();
}

/* ======= QUEUE LOAD ======= */
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
  if (activeTab === "rejected") viewName = "v_contact_workbench_queue_rejected"; // may not exist yet

  const { data, error } = await sb.from(viewName).select("*").limit(200);

  if (error){
    if (activeTab === "rejected"){
      setMsg(appMsg, "Rejected view not available yet (DB not ready).", true);
      return;
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
    const subtitle = [row.email, row.company].filter(Boolean).join(" • ");

    const assigned = row.enrichment_assigned_to ? (isMine(row) ? "mine" : "assigned") : "unassigned";
    const st = (row.enrichment_status || activeTab || "").toLowerCase() || "unknown";

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

/* ======= DETAIL ======= */
function clearDetail(){
  activeRow = null;
  activeDetail = null;
  detailView.style.display = "none";
  detailEmpty.style.display = "block";
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
  detailSubtitle.textContent = [activeDetail.title, activeDetail.company, activeDetail.email].filter(Boolean).join(" • ") || "—";

  renderRaw(activeDetail);

  // overlay fields come from campaign_contact_enrichment (joined in view)
  ovLinkedin.value = activeDetail.linkedin_url || "";
  ovPhone.value = activeDetail.phone || "";
  ovNotes.value = activeDetail.notes || "";
  ovActivationReady.checked = !!activeDetail.activation_ready;
  ovCompleteness.value = activeDetail.completeness_score ?? "";

  const vf = activeDetail.verified_fields;
  ovVerifiedJson.value = vf && typeof vf === "object" ? JSON.stringify(vf, null, 2) : (vf || "");

  const st = (activeDetail.enrichment_status || "").toLowerCase();
  const readOnly = (st === "verified" || st === "rejected" || st === "enriched");

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

/* ======= WRITES ======= */
async function writeEvent(campaignContactId, eventType, payload){
  const { error } = await sb.from("campaign_contact_enrichment_events").insert([{
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

/* ======= ACTIONS ======= */
function getActiveId(){
  const id = activeDetail?.campaign_contact_id || activeRow?.campaign_contact_id;
  if (!id) throw new Error("No active campaign_contact_id selected.");
  return id;
}

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

    // This will fail if your CHECK constraint doesn't allow 'rejected' yet.
    await updateContactState(id, {
      enrichment_status: "rejected",
      enrichment_locked_at: new Date().toISOString()
    });

    await writeEvent(id, "rejected", { by: sessionUser.id, reason });

    // store reason in notes as well (optional but helpful)
    await upsertOverlay(id, { notes: `REJECTED: ${reason}` });

    setMsg(appMsg, "Rejected.");
    await loadQueue();
  }catch(e){
    setMsg(appMsg, e.message || String(e), true);
  }
}

/* ======= EVENTS ======= */
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

sb.auth.onAuthStateChange(renderByAuth);

/* ======= INIT ======= */
(async function init(){
  clearDetail();
  setActiveTab("pending");
  await renderByAuth();
})();
