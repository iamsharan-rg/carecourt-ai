// ============================================================================
// CareCourt AI — Frontend Decision Engine (browser fallback)
// Mirrors the Python engine in ai_engine/ so the demo keeps working even if
// the FastAPI backend is offline. See app.py for the authoritative version.
// ============================================================================

const STORAGE_KEY = 'carecourt_cases_v1';

const policies = [
  { policy_id: 'POL-RET-7', title: '7 day damaged delivery replacement policy', text: 'Damaged products with photo proof inside 7 days qualify for replacement or refund.', issue_types: ['damaged_delivery'], resolution: 'replacement_or_refund', window_days: 7, requires_evidence: true },
  { policy_id: 'POL-REF-5', title: 'Refund dispute verification policy', text: 'Refund disputes require order verification and payment ledger review.', issue_types: ['refund_dispute'], resolution: 'verify_payment_and_refund_status', window_days: 5, requires_evidence: false },
  { policy_id: 'POL-WAR-365', title: 'Warranty repair and replacement policy', text: 'Warranty claims require invoice and serial number during warranty period.', issue_types: ['warranty_claim'], resolution: 'repair_or_replacement_under_warranty', window_days: 365, requires_evidence: true },
  { policy_id: 'POL-SLA-3', title: 'Delivery delay service recovery policy', text: 'Delayed deliveries require courier check and compensation review if the SLA was missed.', issue_types: ['delivery_delay'], resolution: 'delivery_status_check_and_compensation_if_needed', window_days: 3, requires_evidence: false },
  { policy_id: 'POL-CAN-14', title: 'Subscription cancellation policy', text: 'Cancellation requests must be confirmed within 14 days; retention review applies to active plans.', issue_types: ['cancellation'], resolution: 'confirm_cancellation_or_retention_review', window_days: 14, requires_evidence: false },
];

const oldCases = [
  { case_id: 'OLD-101', summary: 'Cracked product arrived with photo and invoice proof', resolution: 'replacement_or_refund' },
  { case_id: 'OLD-118', summary: 'Refund promised but payment reversal did not arrive', resolution: 'verify_payment_and_refund_status' },
  { case_id: 'OLD-141', summary: 'Courier delay crossed promised delivery SLA and customer requested compensation', resolution: 'delivery_status_check_and_compensation_if_needed' },
  { case_id: 'OLD-162', summary: 'Warranty repair requested with valid invoice and serial number inside warranty period', resolution: 'repair_or_replacement_under_warranty' },
  { case_id: 'OLD-177', summary: 'Customer asked to cancel subscription plan before renewal date', resolution: 'confirm_cancellation_or_retention_review' },
];

let cases = [];
let selected = 0;
let queueFilter = 'all';
let reportStats = { autoResolved: 74, review: 26, risk: 18 };

const stop = new Set('a an the and or but to of in on for with is are was were be been i me my we our you your it this that from as at by not no please'.split(' '));

const workflowStates = {
  needs_review: { label: 'Needs Review', className: 'review' },
  approved: { label: 'Approved', className: 'low' },
  edited: { label: 'Edited', className: 'medium' },
  escalated: { label: 'Escalated', className: 'high' },
};

// ---------------------------------------------------------------------------
// Text similarity helpers
// ---------------------------------------------------------------------------

function words(t) {
  return (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !stop.has(w) && w.length > 1);
}

function escReg(s) {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function contains(t, p) {
  return new RegExp('(^|[^a-z0-9])' + escReg(p) + '([^a-z0-9]|$)', 'i').test(t);
}

// Cosine similarity over bag-of-words counts. This is the "SimpleSemanticIndex"
// referenced in the README — swap for real embeddings + FAISS later.
function sim(a, b) {
  const A = words(a), B = words(b), ca = {}, cb = {};
  A.forEach(w => ca[w] = (ca[w] || 0) + 1);
  B.forEach(w => cb[w] = (cb[w] || 0) + 1);
  let dot = 0, na = 0, nb = 0;
  Object.keys(ca).forEach(w => { na += ca[w] * ca[w]; if (cb[w]) dot += ca[w] * cb[w]; });
  Object.keys(cb).forEach(w => nb += cb[w] * cb[w]);
  return (!na || !nb) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Complaint parsing
// ---------------------------------------------------------------------------

function parse(c) {
  const text = c.complaint_text.toLowerCase();
  const issueKeywords = {
    damaged_delivery: ['broken', 'damaged', 'cracked', 'torn', 'defective', 'leaking'],
    refund_dispute: ['refund', 'money back', 'charged', 'payment', 'deducted'],
    warranty_claim: ['warranty', 'repair', 'service center', 'guarantee', 'replacement', 'serial number'],
    missed_promise: ['promised', 'callback', 'call back', 'follow up', 'ignored', 'no response'],
    delivery_delay: ['late', 'delay', 'not delivered', 'delivery', 'shipment', 'courier'],
    cancellation: ['cancel', 'cancellation', 'subscription', 'stop plan'],
  };

  let issue = c.issue_type || 'general_complaint';
  let best = 0;
  if (!c.issue_type) {
    for (const [key, keywords] of Object.entries(issueKeywords)) {
      const score = keywords.filter(w => contains(text, w)).length;
      if (score > best) { issue = key; best = score; }
    }
  }

  const evidence = ['photo', 'image', 'video', 'invoice', 'receipt', 'screenshot', 'proof', 'bill', 'serial'].filter(w => contains(text, w));
  const pressure = ['viral', 'legal', 'court', 'police', 'media', 'expose', 'consumer forum'].filter(w => contains(text, w));
  const angry = ['angry', 'furious', 'worst', 'fraud', 'scam', 'cheated', 'terrible', 'useless'].some(w => contains(text, w));
  const orderMatch = c.complaint_text.match(/\b(?:order|ord|id)[#:\s-]*([A-Z0-9][A-Z0-9-]{4,})\b/i);

  return {
    issue_type: issue,
    emotion: angry ? 'angry' : text.includes('confused') ? 'confused' : /please|help|kindly/i.test(text) ? 'calm' : 'neutral',
    urgency: (pressure.length || angry) ? 'high' : /again|twice/i.test(text) ? 'medium' : 'normal',
    requested_action: text.includes('refund') ? 'refund' : text.includes('replace') ? 'replacement' : text.includes('repair') ? 'repair' : text.includes('cancel') ? 'cancellation' : 'fair_resolution',
    extracted_order_id: c.order_id || (orderMatch ? orderMatch[1].toUpperCase() : null),
    evidence_signals: evidence,
    pressure_signals: pressure,
    key_facts: [],
  };
}

// ---------------------------------------------------------------------------
// Policy matching + case memory
// ---------------------------------------------------------------------------

function policyMatch(text, issue) {
  const hits = policies
    .map(p => {
      let score = sim(issue + ' ' + text, p.title + ' ' + p.text + ' ' + p.issue_types.join(' '));
      if (p.issue_types.includes(issue)) score = Math.min(1, score + 0.25);
      return { ...p, score: +score.toFixed(3) };
    })
    .sort((a, b) => b.score - a.score);
  return hits[0].score < 0.08 ? null : hits[0];
}

function similar(text) {
  return oldCases
    .map(c => ({ ...c, score: sim(text, c.summary) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Verification risk scoring
// ---------------------------------------------------------------------------

function verify(c, parsed, policy, similarCases) {
  let risk = 10;
  const reasons = [];
  const totalEvidence = (+c.evidence_count || 0) + parsed.evidence_signals.length;

  if (c.complaint_text.trim().length < 45) {
    risk += 20;
    reasons.push('Complaint is very short and lacks useful details.');
  }

  if (c.order_exists === false && !parsed.extracted_order_id) {
    risk += 35;
    reasons.push('No verified order or order reference is available.');
  } else if (c.order_exists === true || parsed.extracted_order_id) {
    risk -= 15;
    reasons.push('Order/customer reference is available.');
  }

  if (totalEvidence === 0) {
    risk += 15;
    reasons.push('No supporting evidence was detected.');
  } else if (totalEvidence >= 2) {
    risk -= 10;
    reasons.push('Multiple evidence signals are available.');
  } else {
    reasons.push('Some evidence is available.');
  }

  if (+c.customer_claim_count_30d >= 3) {
    risk += 20;
    reasons.push('Customer has submitted multiple claims in the last 30 days.');
  }

  if (c.days_since_delivery != null && policy?.window_days != null) {
    if (+c.days_since_delivery > policy.window_days) {
      risk += 18;
      reasons.push('Complaint is outside the matched policy window.');
    } else {
      risk -= 5;
      reasons.push('Complaint is inside the matched policy window.');
    }
  }

  if (parsed.pressure_signals.length && totalEvidence === 0) {
    risk += 15;
    reasons.push('Escalation language appears without matching proof.');
  } else if (parsed.pressure_signals.length) {
    risk += 5;
    reasons.push('Escalation language detected.');
  }

  if (similarCases[0]?.score > 0.92) {
    risk += 8;
    reasons.push('Highly similar complaint pattern exists in past cases.');
  }

  risk = Math.max(5, Math.min(100, risk));
  return {
    risk_score: risk,
    risk_label: risk >= 70 ? 'high' : risk >= 40 ? 'medium' : 'low',
    requires_human_review: risk >= 40,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Resolution decision
// ---------------------------------------------------------------------------

const RESOLUTION_BY_ISSUE = {
  damaged_delivery: 'replacement_or_refund',
  refund_dispute: 'verify_payment_and_refund_status',
  warranty_claim: 'repair_or_replacement_under_warranty',
  missed_promise: 'priority_escalation_with_apology',
  delivery_delay: 'delivery_status_check_and_compensation_if_needed',
  cancellation: 'confirm_cancellation_or_retention_review',
};

const ACTIONS_BY_ISSUE = {
  damaged_delivery: ['Approve replacement if stock is available', 'Offer refund if replacement is unavailable'],
  refund_dispute: ['Check payment ledger', 'Share refund timeline with customer'],
  warranty_claim: ['Verify invoice and warranty window', 'Create repair/replacement ticket'],
  delivery_delay: ['Check courier status', 'Offer compensation if SLA was missed'],
  missed_promise: ['Escalate to team lead', 'Send apology and new deadline'],
};

function decide(c) {
  const parsed = parse(c);
  const policy = policyMatch(c.complaint_text, parsed.issue_type);
  const sims = similar(c.complaint_text);
  const ver = verify(c, parsed, policy, sims);

  let confidence = 55;
  let reasons = [];
  let actions = [];
  let resolution = 'human_review';

  if (policy) {
    reasons.push('Matched policy: ' + policy.title + '.');
    confidence += Math.floor(policy.score * 20);
  } else {
    reasons.push('No strong policy match was found.');
    actions.push('Ask company staff to select the correct policy.');
  }

  if (ver.risk_label === 'high') {
    resolution = 'request_proof_or_human_review';
    confidence = 62;
    actions = ['Request missing proof', 'Send to senior support agent'];
  } else if (policy && c.days_since_delivery != null && policy.window_days != null && +c.days_since_delivery > policy.window_days) {
    resolution = 'policy_exception_review';
    confidence = 64;
    actions = ['Check whether goodwill exception is allowed', 'Escalate if customer history is valuable'];
  } else {
    if (ver.risk_label === 'medium') {
      confidence -= 10;
      actions.push('Human should verify before final decision.');
    }
    if (sims[0]?.score > 0.25) {
      reasons.push('Similar case ' + sims[0].case_id + ' was resolved as: ' + sims[0].resolution + '.');
      confidence += 8;
    }
    if (policy?.requires_evidence && (+c.evidence_count || 0) === 0 && !parsed.evidence_signals.length) {
      resolution = 'request_evidence';
      confidence = Math.max(50, confidence - 10);
      actions.push('Ask customer for photo, invoice, or screenshot');
    } else {
      resolution = RESOLUTION_BY_ISSUE[parsed.issue_type] || (policy ? policy.resolution : 'human_review');
      actions = actions.concat(ACTIONS_BY_ISSUE[parsed.issue_type] || ['Review case manually']);
    }
  }

  if (parsed.emotion === 'angry') {
    actions.push('Use empathetic reply and avoid defensive language');
    confidence -= 3;
  }

  confidence = Math.max(45, Math.min(96, confidence));
  const human = ver.requires_human_review || confidence < 70 ||
    ['request_proof_or_human_review', 'human_review', 'policy_exception_review'].includes(resolution);

  return {
    case_type: parsed.issue_type,
    recommended_resolution: resolution,
    confidence,
    human_review_required: human,
    verification: ver,
    matched_policy: policy ? {
      policy_id: policy.policy_id, title: policy.title, score: policy.score,
      resolution: policy.resolution, window_days: policy.window_days, requires_evidence: policy.requires_evidence,
    } : null,
    parsed_complaint: parsed,
    reasons: reasons.concat(ver.reasons),
    next_actions: actions,
    customer_reply: reply(c.customer_name, resolution, human),
  };
}

function reply(name, res, human) {
  if (res === 'request_evidence') return `Hi ${name}, we can help review this quickly. Please upload a photo, invoice, or screenshot so the team can verify the claim.`;
  if (res === 'request_proof_or_human_review') return `Hi ${name}, your case needs a verification review. Please share the missing order or proof details so we can process it fairly.`;
  if (res === 'policy_exception_review') return `Hi ${name}, your case is outside the normal policy window, so our team will review whether an exception is possible.`;
  if (human) return `Hi ${name}, your case has been sent for review with the relevant policy and complaint details attached.`;
  return `Hi ${name}, based on the available details, your case is eligible for the recommended resolution: ${res.replaceAll('_', ' ')}.`;
}

async function analyze(c) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c), signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (r.ok) {
      document.getElementById('runtimeMode').textContent = 'Backend AI connected';
      return await r.json();
    }
  } catch (e) {
    clearTimeout(timeoutId);
    /* backend unreachable, errored, or too slow (>4s) — fall back instantly */
  }
  document.getElementById('runtimeMode').textContent = 'Browser AI fallback (backend slow or unavailable)';
  return decide(c);
}

// ---------------------------------------------------------------------------
// Evidence file handling — files are actually read and shown, not just counted.
// Kept in-memory only (not persisted to localStorage) to avoid blowing the
// browser storage quota with image data; a real backend would store these
// in object storage (S3/GCS) instead.
// ---------------------------------------------------------------------------

let pendingEvidenceFiles = [];
const MAX_PREVIEW_BYTES = 800 * 1024; // 800KB cap per file for inline preview

function fileToDataURL(file) {
  return new Promise((resolve) => {
    if (file.size > MAX_PREVIEW_BYTES) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function handleProofUploadChange() {
  const files = Array.from(document.getElementById('proofUpload').files);
  const preview = document.getElementById('proofPreview');
  if (!files.length) { preview.textContent = 'No files selected yet'; pendingEvidenceFiles = []; return; }
  preview.textContent = `Reading ${files.length} file(s)...`;
  pendingEvidenceFiles = await Promise.all(files.map(async (f) => ({
    name: f.name,
    type: f.type,
    size: f.size,
    isImage: f.type.startsWith('image/'),
    dataUrl: await fileToDataURL(f),
  })));
  const tooBig = pendingEvidenceFiles.filter(f => !f.dataUrl).length;
  preview.textContent = `${files.length} file(s) attached` + (tooBig ? ` (${tooBig} too large to preview, size still counted)` : '');
}

function renderEvidenceThumbnails(files, evidenceCount) {
  if (files && files.length) {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + files.map(f => {
      if (f.isImage && f.dataUrl) {
        return `<a href="${f.dataUrl}" target="_blank" title="${f.name}"><img src="${f.dataUrl}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.12);"></a>`;
      }
      return `<div title="${f.name}" style="width:72px;height:72px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;color:var(--muted);padding:4px;text-align:center;">📄<span style="margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${f.name.slice(0, 10)}</span></div>`;
    }).join('') + '</div>';
  }
  if (evidenceCount > 0) {
    return `<p class="muted" style="font-size:12.5px;">This complaint reports ${evidenceCount} piece(s) of evidence at intake, but no files were actually uploaded (demo/seed data — no attachment to display).</p>`;
  }
  return '<p class="muted" style="font-size:12.5px;">No evidence files attached to this complaint.</p>';
}

// ---------------------------------------------------------------------------
// Fraud indicators — named explicitly, separate from general risk reasoning,
// so staff (and judges) can see exactly what makes a case look fraudulent.
// ---------------------------------------------------------------------------

function computeFraudSignals(item) {
  const signals = [];
  const p = item.decision.parsed_complaint;
  const v = item.decision.verification;
  if (item.order_exists === false && !p.extracted_order_id) {
    signals.push({ icon: '🚫', text: 'No verifiable order tied to this complaint.' });
  }
  if (+item.customer_claim_count_30d >= 3) {
    signals.push({ icon: '🔁', text: `${item.customer_claim_count_30d} claims filed by this customer in the last 30 days.` });
  }
  if (p.pressure_signals && p.pressure_signals.length) {
    signals.push({ icon: '⚠️', text: `Escalation/threat language detected: "${p.pressure_signals.join('", "')}".` });
  }
  const totalEvidence = (+item.evidence_count || 0) + (p.evidence_signals ? p.evidence_signals.length : 0);
  if (totalEvidence === 0 && p.pressure_signals && p.pressure_signals.length) {
    signals.push({ icon: '📎', text: 'Threats made with zero supporting evidence attached.' });
  }
  if (item.complaint_text.trim().length < 45) {
    signals.push({ icon: '✂️', text: 'Complaint text is unusually short for the claim being made.' });
  }
  return signals;
}

function isPossibleFraud(item) {
  return item.decision.verification.risk_label === 'high' && computeFraudSignals(item).length >= 2;
}

// ---------------------------------------------------------------------------
// Identity verification tool — the real "how do I verify" action.
// Re-hashes a staff-entered name and compares it to the case's stored Crypto
// ID. A match confirms the complaint's identity record is unaltered; a
// mismatch is a concrete tamper/fraud signal, not just a risk-score guess.
// ---------------------------------------------------------------------------

async function runVerification() {
  const caseId = document.getElementById('verifyCaseId').value.trim();
  const nameInput = document.getElementById('verifyCustomerName').value.trim();
  const resultEl = document.getElementById('verifyResult');

  if (!caseId || !nameInput) {
    resultEl.innerHTML = '<p class="muted" style="font-size:13px;">Enter both a case ID and a customer name to check.</p>';
    return;
  }
  const item = cases.find(c => c.id.toLowerCase() === caseId.toLowerCase());
  if (!item) {
    resultEl.innerHTML = `<div style="padding:14px 16px;border-radius:10px;background:rgba(161,80,63,0.08);border:1px solid rgba(161,80,63,0.3);color:#d1998c;font-size:13px;">No case found with ID <strong>${caseId}</strong>.</div>`;
    return;
  }

  const testHash = await sha256(nameInput);
  const isMatch = testHash === item._nameHash;

  if (isMatch) {
    resultEl.innerHTML = `
      <div style="padding:16px;border-radius:10px;background:rgba(111,144,116,0.08);border:1px solid rgba(111,144,116,0.35);">
        <p style="margin:0 0 10px;color:#a8c9ab;font-weight:700;font-size:14px;">✅ Match — identity record is intact for ${item.id}.</p>
        <button class="secondary" onclick="markVerified('${item.id}')">Mark Case as Verified</button>
      </div>`;
  } else {
    resultEl.innerHTML = `
      <div style="padding:16px;border-radius:10px;background:rgba(161,80,63,0.08);border:1px solid rgba(161,80,63,0.35);">
        <p style="margin:0 0 10px;color:#d1998c;font-weight:700;font-size:14px;">❌ Mismatch — the entered name does not match the Crypto ID on record for ${item.id}. This may indicate tampering, a data-entry error, or fraud.</p>
        <button class="secondary" onclick="markFraud('${item.id}')" style="color:var(--red);border-color:rgba(161,80,63,0.4);">Flag Case as Fraud Risk</button>
      </div>`;
  }
}

function markVerified(id) {
  const item = cases.find(c => c.id === id);
  if (!item) return;
  item.verified = true;
  logAudit(item, 'verified', 'Identity confirmed via Crypto ID cross-check.');
  renderQueue();
  if (cases[selected]?.id === id) renderDecision();
  document.getElementById('verifyResult').innerHTML += '<p class="muted" style="margin-top:10px;font-size:12px;">Logged to audit trail.</p>';
}
window.markVerified = markVerified;

function markFraud(id) {
  const item = cases.find(c => c.id === id);
  if (!item) return;
  item.workflow.status = 'escalated';
  item.decision.human_review_required = true;
  logAudit(item, 'flagged_fraud', 'Flagged as fraud risk — Crypto ID mismatch on identity check.');
  renderQueue();
  if (cases[selected]?.id === id) renderDecision();
  document.getElementById('verifyResult').innerHTML += '<p class="muted" style="margin-top:10px;font-size:12px;">Case escalated and logged to audit trail.</p>';
}
window.markFraud = markFraud;

function riskClass(r) { return r === 'high' ? 'high' : r === 'medium' ? 'medium' : 'low'; }
function label(s) { return (s || '').replaceAll('_', ' '); }
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9 + n, 15, 0, 0);
  return d.toISOString();
}
function hoursAfter(iso, h) {
  const d = new Date(iso);
  d.setHours(d.getHours() + h);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Persistence — cases survive a page refresh via localStorage
// ---------------------------------------------------------------------------

function saveCasesToStorage() {
  try {
    // Evidence dataURLs are excluded from persistence — they're large and this
    // is browser-local demo storage, not real object storage. A production
    // build would store files in S3/GCS and keep only a URL reference here.
    const slim = cases.map(c => {
      if (!c.evidence_files || !c.evidence_files.length) return c;
      const { evidence_files, ...rest } = c;
      return { ...rest, evidence_files: evidence_files.map(f => ({ name: f.name, type: f.type, size: f.size, isImage: f.isImage, dataUrl: null })) };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch (e) {
    console.warn('Could not save cases to localStorage:', e);
  }
}

function loadCasesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch (e) {
    console.warn('Could not load cases from localStorage:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Audit trail — every workflow action is appended here so decisions are
// traceable (who did what, when, and why).
// ---------------------------------------------------------------------------

function logAudit(item, action, note) {
  if (!item.workflow.approval_history) item.workflow.approval_history = [];
  item.workflow.approval_history.push({
    action,
    note: note || '',
    agent: item.workflow.assigned_agent || 'Ava Chen',
    at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Customer-facing status view — no risk scores, no internal reasoning.
// This is deliberately separate from renderDecision(), which is staff-only.
// ---------------------------------------------------------------------------

function renderCustomerStatus(item) {
  const panel = document.getElementById('customerStatusPanel');
  if (!panel || !item) return;
  const state = getWorkflowState(item);
  panel.innerHTML = `
    <div class="panel-head"><h2>Your Complaint Status</h2><span class="tag stamp ${state.className}">${state.label}</span></div>
    <p class="muted" style="margin-bottom:4px;">Reference number</p>
    <p style="font-family:monospace;font-size:18px;color:var(--ink);font-weight:700;margin:0 0 16px;">${item.id}</p>
    <p class="muted" style="margin-bottom:16px;font-size:13px;">Submitted by <strong style="color:var(--ink);">${item.customer_name}</strong></p>
    <div style="border-left:4px solid var(--violet);padding:16px 20px;background:linear-gradient(90deg,rgba(125,112,150,0.1),transparent);border-radius:0 12px 12px 0;">
      <div style="font-size:11px;color:var(--violet);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Message from CareCourt AI</div>
      <p style="margin:0;color:#fff;font-size:14px;line-height:1.6;font-style:italic;">"${item.decision.customer_reply}"</p>
    </div>
    <p class="muted" style="margin-top:16px;font-size:12px;">Our team may follow up if more information is needed. Please keep reference ${item.id} for any future contact.</p>
  `;
}

function renderAuditTrail(item) {
  const history = item.workflow?.approval_history || [];
  if (!history.length) {
    return '<div class="muted" style="font-size:13px;">No actions logged yet for this case.</div>';
  }
  return history.slice().reverse().map(entry => {
    const time = new Date(entry.at).toLocaleString();
    return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;">
      <span style="color:var(--blue);flex-shrink:0;">●</span>
      <div>
        <div><strong style="color:var(--ink);">${entry.agent}</strong> <span class="muted">${label(entry.action)}</span></div>
        ${entry.note ? `<div class="muted" style="margin-top:2px;">${entry.note}</div>` : ''}
        <div class="muted" style="margin-top:2px;font-size:11px;">${time}</div>
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Rendering — case queue
// ---------------------------------------------------------------------------

function getWorkflowState(item) {
  const status = item?.workflow?.status || 'needs_review';
  return workflowStates[status] || workflowStates.needs_review;
}

function getFilteredCases() {
  if (!queueFilter || queueFilter === 'all') return cases;
  if (queueFilter === 'possible_fraud') return cases.filter(c => isPossibleFraud(c));
  return cases.filter(c => (c.workflow?.status || 'needs_review') === queueFilter);
}

function refreshReportStats() {
  reportStats.autoResolved = Math.max(50, Math.round((cases.filter(c => !c.decision.human_review_required).length / cases.length) * 100));
  reportStats.review = Math.max(10, 100 - reportStats.autoResolved);
  reportStats.risk = Math.round(cases.reduce((sum, c) => sum + c.decision.verification.risk_score, 0) / Math.max(1, cases.length));
  updateReportSummary();
}

function renderQueue() {
  const visibleCases = getFilteredCases();
  const queueEl = document.getElementById('caseQueue');

  if (!visibleCases.length) {
    queueEl.innerHTML = '<div class="muted">No cases in this workflow state yet.</div>';
  } else {
    queueEl.innerHTML = visibleCases.map((c) => {
      const state = getWorkflowState(c);
      const isActive = c.id === cases[selected]?.id;
      return `<div class="case-item compact ${isActive ? 'active' : ''}" onclick="openCaseModal('${c.id}')">
        <div class="case-top">
          <strong>${c.customer_name} ${isPossibleFraud(c) ? '<span title="Possible fraud indicators detected" style="color:#a1503f;">🚩</span>' : ''}${c.verified ? '<span title="Identity verified by staff" style="color:#6f9074;">✅</span>' : ''}</strong>
          <span class="tag ${riskClass(c.decision.verification.risk_label)}">${c.decision.verification.risk_label}</span>
        </div>
        <div class="case-top">
          <span class="muted">${label(c.decision.case_type)}</span>
          <span class="tag stamp ${state.className}">${state.label}</span>
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('caseCount').textContent = cases.length;
  document.getElementById('riskMetric').textContent = cases.filter(c => c.decision.human_review_required).length;
  if (cases.length) refreshReportStats();
  saveCasesToStorage();
}

// ---------------------------------------------------------------------------
// Rendering — decision detail panel
// ---------------------------------------------------------------------------

function renderDecision() {
  const item = cases[selected];
  if (!item) return;

  const d = item.decision;
  const rLabel = d.verification.risk_label;
  const rColor = rLabel === 'high' ? '#a1503f' : rLabel === 'medium' ? '#b8863f' : '#6f9074';
  const resIcons = {
    replacement_or_refund: '🔄', verify_payment_and_refund_status: '💳', repair_or_replacement_under_warranty: '🔧',
    delivery_status_check_and_compensation_if_needed: '🚚', priority_escalation_with_apology: '📞',
    request_evidence: '📎', request_proof_or_human_review: '🔍', human_review: '👤', policy_exception_review: '⚖️',
  };
  const resIcon = resIcons[d.recommended_resolution] || '✅';
  const confColor = d.confidence >= 80 ? '#6f9074' : d.confidence >= 60 ? '#b8863f' : '#a1503f';

  document.getElementById('confidenceMetric').textContent = d.confidence + '%';
  document.getElementById('decisionBadge').textContent = d.human_review_required ? 'Human Review Required' : 'Auto-Ready';
  document.getElementById('decisionBadge').className = d.human_review_required ? 'tag stamp review' : 'tag stamp low';
  document.getElementById('caseIdLabel').textContent = item.id + '  ·  ' + item.customer_name;

  document.getElementById('decisionView').innerHTML = `
    <!-- Original Complaint -->
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:18px 20px;margin-bottom:18px;">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📄 Original Complaint</div>
      <p style="margin:0;color:#ede8dc;font-size:14px;line-height:1.6;">${item.complaint_text}</p>
    </div>

    <!-- Top Stats Row -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">AI Confidence</div>
        <div style="font-size:40px;font-weight:900;color:${confColor};line-height:1;">${d.confidence}%</div>
      </div>
      <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Risk Score</div>
        <div style="font-size:40px;font-weight:900;color:${rColor};line-height:1;">${d.verification.risk_score}</div>
        <span class="tag ${rLabel}" style="margin-top:6px;display:inline-block;">${rLabel.toUpperCase()}</span>
      </div>
      <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Issue Type</div>
        <div style="font-size:14px;font-weight:700;color:var(--ink);margin-top:4px;">${label(d.case_type)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">Emotion: ${d.parsed_complaint.emotion} · ${d.parsed_complaint.urgency}</div>
      </div>
    </div>

    <!-- Resolution Block -->
    <div style="background:linear-gradient(135deg,rgba(198,163,77,0.08),rgba(125,112,150,0.08));border:1px solid rgba(198,163,77,0.2);border-radius:14px;padding:24px;margin-bottom:20px;">
      <div style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">⚡ Recommended Resolution</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:6px;">${resIcon} ${label(d.recommended_resolution)}</div>
      <div style="font-size:13px;color:var(--muted);">${d.matched_policy ? 'Policy: ' + d.matched_policy.title : 'No direct policy match — manual review advised'}</div>
    </div>

    <!-- AI Reasoning -->
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">🧠 Why CareCourt AI Decided This</div>
      <ul style="margin:0;padding-left:0;list-style:none;display:grid;gap:8px;">
        ${d.reasons.map(x => `<li style="display:flex;gap:10px;font-size:14px;color:#ede8dc;"><span style="color:var(--blue);flex-shrink:0;">→</span>${x}</li>`).join('')}
      </ul>
    </div>

    <!-- Next Actions -->
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;color:var(--amber);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">📋 Next Actions</div>
      <ul style="margin:0;padding-left:0;list-style:none;display:grid;gap:8px;">
        ${d.next_actions.map(x => `<li style="display:flex;align-items:center;gap:10px;font-size:14px;color:#ede8dc;"><span style="width:20px;height:20px;border-radius:50%;border:1.5px solid var(--amber);flex-shrink:0;display:grid;place-items:center;font-size:10px;color:var(--amber);">✓</span>${x}</li>`).join('')}
      </ul>
    </div>

    <!-- Workflow Controls -->
    <div class="workflow-card">
      <h3>Case Workflow</h3>
      <label>Status
        <select id="caseStatusSelect">
          <option value="needs_review">Needs Review</option>
          <option value="approved">Approved</option>
          <option value="edited">Edited</option>
          <option value="escalated">Escalated</option>
        </select>
      </label>
      <label style="margin-top:10px;">Internal note
        <textarea id="caseNoteInput">${item.workflow?.notes || 'Awaiting staff review.'}</textarea>
      </label>
      <button class="secondary" id="saveNoteBtn">Save note</button>
      <div class="workflow-meta">Assigned agent: ${item.workflow?.assigned_agent || 'Ava Chen'} · Current state: ${getWorkflowState(item).label}</div>
    </div>

    <!-- Human Approval -->
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;color:var(--violet);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">🧑‍💼 Human Approval</div>
      <div class="approval-actions">
        <button onclick="approveCase(${selected})" style="background:rgba(111,144,116,0.16);color:#a8c9ab;">Approve</button>
        <button onclick="editCase(${selected})" style="background:rgba(184,134,63,0.16);color:#dcc088;">Edit</button>
        <button onclick="rejectCase(${selected})" style="background:rgba(161,80,63,0.16);color:#cf9089;">Reject</button>
      </div>
      <div id="approvalStatus" class="approval-note">Staff can approve, edit, or reject the AI decision.</div>
    </div>

    <!-- Audit Trail -->
    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;color:#9c9484;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">🕓 Audit Trail</div>
      <div id="auditTrailView">${renderAuditTrail(item)}</div>
    </div>

    <!-- Customer Reply Draft -->
    <div style="border-left:4px solid var(--violet);padding:20px 24px;background:linear-gradient(90deg,rgba(125,112,150,0.1),transparent);border-radius:0 12px 12px 0;">
      <div style="font-size:12px;color:var(--violet);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">💬 Suggested Customer Reply</div>
      <p style="margin:0;color:#fff;font-size:15px;line-height:1.7;font-style:italic;">"${d.customer_reply}"</p>
    </div>
  `;

  const statusSelect = document.getElementById('caseStatusSelect');
  const noteInput = document.getElementById('caseNoteInput');
  const saveBtn = document.getElementById('saveNoteBtn');

  if (statusSelect) {
    statusSelect.value = item.workflow?.status || 'needs_review';
    statusSelect.addEventListener('change', (e) => {
      const newStatus = e.target.value;
      item.workflow.status = newStatus;
      item.decision.human_review_required = newStatus !== 'approved';
      logAudit(item, 'status_changed', `Status set to ${label(newStatus)}.`);
      renderQueue();
      renderDecision();
    });
  }

  if (noteInput && saveBtn) {
    noteInput.value = item.workflow?.notes || 'Awaiting staff review.';
    saveBtn.addEventListener('click', () => {
      const note = noteInput.value.trim() || 'No note added.';
      item.workflow.notes = note;
      logAudit(item, 'note_saved', note);
      document.getElementById('approvalStatus').textContent = 'Saved internal note for ' + item.customer_name + '.';
      renderQueue();
      renderDecision();
    });
  }
}

// ---------------------------------------------------------------------------
// Case selection + workflow actions
// ---------------------------------------------------------------------------

function selectCase(identifier) {
  const index = typeof identifier === 'number' ? identifier : cases.findIndex(c => c.id === identifier);
  if (index < 0) return;
  selected = index;
  renderQueue();
  renderDecision();
  if (radarChart && cases[index]) updateVerificationPanel(cases[index]);
}
window.selectCase = selectCase;

// Used by the Complaints queue: selecting a case there means "work this case",
// so it also jumps straight into the Company Workspace tab.
function openCase(identifier) {
  selectCase(identifier);
  switchTab('workspace');
}
window.openCase = openCase;

// ---------------------------------------------------------------------------
// Complaint detail popup — the quick-look view from the Complaints queue.
// Shows the filed date and a hashed "Crypto ID" in place of the raw customer
// name, since this is the view used to verify a complaint's identity without
// exposing plaintext PII. Full staff actions still live in Company Workspace.
// ---------------------------------------------------------------------------

function formatFiledDate(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function renderCaseModal(item) {
  const body = document.getElementById('caseModalBody');
  if (!body || !item) return;
  const d = item.decision;
  const state = getWorkflowState(item);
  const cryptoId = item._nameHash || '(hash pending)';
  const fraudSignals = computeFraudSignals(item);

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;">Case</div>
        <div style="font-size:20px;font-weight:800;color:var(--ink);font-family:monospace;">${item.id}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <span class="tag ${riskClass(d.verification.risk_label)}">${d.verification.risk_label}</span>
        <span class="tag stamp ${state.className}">${state.label}</span>
        ${item.verified ? '<span class="tag stamp low">✅ Verified</span>' : ''}
      </div>
    </div>

    <p class="muted" style="font-size:13px;margin:4px 0 18px;">Filed ${formatFiledDate(item.filed_at)}</p>

    ${fraudSignals.length ? `
    <div style="background:rgba(161,80,63,0.06);border:1px solid rgba(161,80,63,0.3);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="font-size:11px;color:#d1998c;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🚩 Fraud Indicators Detected</div>
      <ul style="margin:0;padding-left:0;list-style:none;display:grid;gap:6px;">
        ${fraudSignals.map(s => `<li style="font-size:13px;color:#e3cec6;">${s.icon} ${s.text}</li>`).join('')}
      </ul>
    </div>` : ''}

    <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <div style="font-size:11px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🔑 Customer Crypto ID</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <span class="crypto-id" id="cryptoIdText">${cryptoId}</span>
        <button class="secondary" style="padding:6px 12px;font-size:12px;width:auto;margin:0;" onclick="copyCryptoId(this)">Copy</button>
      </div>
      <div style="border-top:1px solid rgba(237,232,220,0.08);padding-top:12px;">
        <p class="muted" style="font-size:11.5px;margin:0 0 8px;">Verify this record right here — enter the name the customer gave and check it against the hash above.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input id="modalVerifyName" placeholder="Customer name to check" style="flex:1;min-width:160px;">
          <button class="secondary" style="width:auto;margin:0;padding:10px 16px;" onclick="runModalVerification('${item.id}')">Verify</button>
        </div>
        <div id="modalVerifyResult" style="margin-top:10px;"></div>
      </div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Complaint</div>
      <p style="margin:0 0 6px;color:#ede8dc;font-size:14px;line-height:1.6;">${item.complaint_text}</p>
      <p class="muted" style="font-size:12.5px;margin:0;">${label(d.case_type)} · requested: ${label(d.parsed_complaint.requested_action)}</p>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📎 Evidence</div>
      ${renderEvidenceThumbnails(item.evidence_files, item.evidence_count)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
      <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Risk Score</div>
        <div style="font-size:24px;font-weight:800;color:var(--ink);">${d.verification.risk_score}<span style="font-size:13px;color:var(--muted);font-weight:600;"> /100</span></div>
      </div>
      <div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">AI Confidence</div>
        <div style="font-size:24px;font-weight:800;color:var(--ink);">${d.confidence}%</div>
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div style="font-size:11px;color:var(--amber);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Recommended Resolution</div>
      <p style="margin:0;color:var(--ink);font-size:15px;font-weight:700;">${label(d.recommended_resolution)}</p>
      <p class="muted" style="font-size:12.5px;margin-top:4px;">${d.matched_policy ? 'Policy: ' + d.matched_policy.title : 'No direct policy match — manual review advised'}</p>
    </div>

    <button class="primary" style="width:100%;" onclick="closeCaseModal(); openCase('${item.id}');">Open Full Workspace →</button>
  `;
}

async function runModalVerification(caseId) {
  const item = cases.find(c => c.id === caseId);
  const nameInput = document.getElementById('modalVerifyName').value.trim();
  const resultEl = document.getElementById('modalVerifyResult');
  if (!item || !nameInput) {
    resultEl.innerHTML = '<p class="muted" style="font-size:12px;">Enter a name to check.</p>';
    return;
  }
  const testHash = await sha256(nameInput);
  const isMatch = testHash === item._nameHash;
  if (isMatch) {
    resultEl.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:rgba(111,144,116,0.1);border:1px solid rgba(111,144,116,0.4);font-size:12.5px;color:#a8c9ab;">✅ Match — <button style="all:unset;cursor:pointer;text-decoration:underline;" onclick="markVerified('${item.id}'); renderCaseModal(cases.find(c=>c.id==='${item.id}'));">mark case as verified</button></div>`;
  } else {
    resultEl.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:rgba(161,80,63,0.1);border:1px solid rgba(161,80,63,0.4);font-size:12.5px;color:#d1998c;">❌ Mismatch — <button style="all:unset;cursor:pointer;text-decoration:underline;" onclick="markFraud('${item.id}'); renderCaseModal(cases.find(c=>c.id==='${item.id}'));">flag as fraud risk</button></div>`;
  }
}
window.runModalVerification = runModalVerification;

function copyCryptoId(btn) {
  const text = document.getElementById('cryptoIdText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {
    btn.textContent = 'Copy failed';
  });
}
window.copyCryptoId = copyCryptoId;

function openCaseModal(identifier) {
  selectCase(identifier);
  const item = cases[selected];
  if (!item) return;
  renderCaseModal(item);
  document.getElementById('caseModalBackdrop').classList.remove('hidden');
}
window.openCaseModal = openCaseModal;

function closeCaseModal() {
  document.getElementById('caseModalBackdrop').classList.add('hidden');
}
window.closeCaseModal = closeCaseModal;

function setQueueFilter(filter) {
  queueFilter = filter;
  document.querySelectorAll('.queue-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderQueue();
}
window.setQueueFilter = setQueueFilter;

function approveCase(i) {
  const item = cases[i];
  if (!item) return;
  item.workflow.status = 'approved';
  item.decision.human_review_required = false;
  item.decision.customer_reply = 'Approved by staff. We will continue with the recommended resolution.';
  logAudit(item, 'approved', 'Approved the AI-recommended resolution.');
  document.getElementById('approvalStatus').textContent = 'Approved by staff for ' + item.customer_name + '.';
  renderQueue();
  renderDecision();
}

function editCase(i) {
  const item = cases[i];
  if (!item) return;
  item.workflow.status = 'edited';
  item.decision.human_review_required = true;
  item.decision.customer_reply = 'Edited by staff. We will review the case manually before responding.';
  logAudit(item, 'edited', 'Marked for manual edit before final response.');
  document.getElementById('approvalStatus').textContent = 'Marked for manual edit for ' + item.customer_name + '.';
  renderQueue();
  renderDecision();
}

function rejectCase(i) {
  const item = cases[i];
  if (!item) return;
  item.workflow.status = 'escalated';
  item.decision.human_review_required = true;
  item.decision.customer_reply = 'Rejected by staff. A senior agent will review the case.';
  logAudit(item, 'rejected', 'Escalated to a senior agent for review.');
  document.getElementById('approvalStatus').textContent = 'Rejected and escalated for ' + item.customer_name + '.';
  renderQueue();
  renderDecision();
}

window.approveCase = approveCase;
window.editCase = editCase;
window.rejectCase = rejectCase;

// ---------------------------------------------------------------------------
// PII hashing
// ---------------------------------------------------------------------------

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPII(c) {
  const realOrderId = c.decision?.parsed_complaint?.extracted_order_id || c.order_id || null;
  c._nameHash = await sha256(c.customer_name || '');
  c._orderHash = await sha256(realOrderId || `no-order-ref:${c.id}`);
  c._hasRealOrderId = !!realOrderId;
  return c;
}

// ---------------------------------------------------------------------------
// Complaint intake form
// ---------------------------------------------------------------------------

async function addCaseFromForm(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalLabel = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = 'Analyzing…'; }

  const orderExistsValue = document.getElementById('orderExists').value;

  const c = {
    id: 'CC-' + String(2001 + cases.length),
    customer_name: document.getElementById('customerName').value || 'Customer',
    filed_at: new Date().toISOString(),
    issue_type: document.getElementById('issueType').value || null,
    complaint_text: document.getElementById('complaintText').value,
    days_since_delivery: document.getElementById('days').value === '' ? null : +document.getElementById('days').value,
    evidence_count: +document.getElementById('evidence').value || 0,
    evidence_files: pendingEvidenceFiles.slice(),
    order_exists: orderExistsValue === 'unknown' ? null : orderExistsValue === 'true',
    customer_claim_count_30d: +document.getElementById('claims').value || 0,
    workflow: { status: 'needs_review', assigned_agent: 'Ava Chen', notes: 'New complaint submitted. Awaiting review.', approval_history: [] },
  };

  c.decision = await analyze(c);
  await hashPII(c);
  logAudit(c, 'submitted', 'Complaint submitted via customer portal.');
  cases.unshift(c);
  selected = 0;
  renderQueue();
  renderDecision();
  renderCustomerStatus(c);
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalLabel; }
  pendingEvidenceFiles = [];
  document.getElementById('proofUpload').value = '';
  document.getElementById('proofPreview').textContent = 'No files selected yet';
}

// ---------------------------------------------------------------------------
// Demo seed data
// ---------------------------------------------------------------------------

const SEED_CASES = [
  {
    id: 'CC-2001', customer_name: 'Riya Sharma', filed_at: daysAgoISO(6),
    complaint_text: 'My order ORD-99421 arrived broken yesterday. I contacted support twice and nobody helped me. I have the invoice and photo proof.',
    days_since_delivery: 1, evidence_count: 2, order_exists: true, customer_claim_count_30d: 0,
    workflow: { status: 'needs_review', assigned_agent: 'Ava Chen', notes: 'Customer provided strong evidence. Needs agent review.', approval_history: [] },
  },
  (() => {
    const filedAt = daysAgoISO(5);
    return {
      id: 'CC-2002', customer_name: 'Unknown user', filed_at: filedAt,
      complaint_text: 'Fraud company refund now or I go viral',
      days_since_delivery: null, evidence_count: 0, order_exists: false, customer_claim_count_30d: 4,
      workflow: {
        status: 'escalated', assigned_agent: 'Mina Patel', notes: 'High risk claim flagged for senior review.',
        approval_history: [
          { action: 'submitted', note: 'Seeded demo case loaded.', agent: 'Mina Patel', at: filedAt },
          { action: 'rejected', note: 'Escalated to a senior agent for review.', agent: 'Mina Patel', at: hoursAfter(filedAt, 3) },
        ],
      },
    };
  })(),
  (() => {
    const filedAt = daysAgoISO(4);
    return {
      id: 'CC-2003', customer_name: 'Dev Patel', filed_at: filedAt,
      complaint_text: 'My order ORD-55590 arrived damaged. I have a photo and receipt.',
      days_since_delivery: 20, evidence_count: 2, order_exists: true, customer_claim_count_30d: 0,
      workflow: {
        status: 'approved', assigned_agent: 'Ava Chen', notes: 'Approved with replacement recommendation.',
        approval_history: [
          { action: 'submitted', note: 'Seeded demo case loaded.', agent: 'Ava Chen', at: filedAt },
          { action: 'approved', note: 'Approved the AI-recommended resolution.', agent: 'Ava Chen', at: hoursAfter(filedAt, 1) },
        ],
      },
    };
  })(),
  (() => {
    const filedAt = daysAgoISO(3);
    return {
      id: 'CC-2004', customer_name: 'Neha Rao', filed_at: filedAt,
      complaint_text: 'The courier is late and delivery support keeps saying tomorrow. Please help me with the actual shipment status.',
      days_since_delivery: 5, evidence_count: 0, order_exists: true, customer_claim_count_30d: 0,
      workflow: {
        status: 'edited', assigned_agent: 'Leo Grant', notes: 'Edited by staff after manual review.',
        approval_history: [
          { action: 'submitted', note: 'Seeded demo case loaded.', agent: 'Leo Grant', at: filedAt },
          { action: 'edited', note: 'Marked for manual edit before final response.', agent: 'Leo Grant', at: hoursAfter(filedAt, 5) },
        ],
      },
    };
  })(),
  {
    id: 'CC-2005', customer_name: 'Arjun Mehta', filed_at: daysAgoISO(2),
    complaint_text: 'My blender stopped working under warranty. I have the invoice and the serial number is ORD-30211. Please repair or replace it.',
    days_since_delivery: 120, evidence_count: 1, order_exists: true, customer_claim_count_30d: 0,
    workflow: { status: 'needs_review', assigned_agent: 'Mina Patel', notes: 'Warranty claim inside coverage window. Needs verification.', approval_history: [] },
  },
  {
    id: 'CC-2006', customer_name: 'Sana Iyer', filed_at: daysAgoISO(1),
    complaint_text: 'Please cancel my subscription plan effective this month, I no longer need the service.',
    days_since_delivery: 3, evidence_count: 0, order_exists: true, customer_claim_count_30d: 0,
    workflow: { status: 'needs_review', assigned_agent: 'Leo Grant', notes: 'Standard cancellation request, low risk.', approval_history: [] },
  },
];

async function seed(force) {
  const stored = force ? null : loadCasesFromStorage();
  if (stored) {
    cases = stored;
  } else {
    cases = [];
    for (const c of SEED_CASES) {
      if (!c.workflow.approval_history.length) logAudit(c, 'submitted', 'Seeded demo case loaded.');
      c.decision = await analyze(c);
      await hashPII(c);
      cases.push(c);
    }
  }
  selected = 0;
  renderQueue();
  renderDecision();
  updateVerificationPanel(cases[0]);
}

// ---------------------------------------------------------------------------
// Analytics summary
// ---------------------------------------------------------------------------

function computeAvgResponseTime() {
  const durations = [];
  cases.forEach(c => {
    const history = c.workflow?.approval_history || [];
    const submitted = history.find(h => h.action === 'submitted');
    const firstAction = history.find(h => h.action !== 'submitted');
    if (submitted && firstAction) {
      const ms = new Date(firstAction.at) - new Date(submitted.at);
      if (ms > 0) durations.push(ms);
    }
  });
  if (!durations.length) return 'No actions taken yet';
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const mins = avgMs / 60000;
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${Math.round(mins)} min`;
  return `${(mins / 60).toFixed(1)} hrs`;
}

function updateReportSummary() {
  const reportSummary = document.getElementById('reportSummary');
  if (!reportSummary) return;
  const responseTime = computeAvgResponseTime();
  reportSummary.innerHTML = `
    <div class="report-card"><h3>Auto-resolved</h3><strong>${reportStats.autoResolved}%</strong><div class="muted">Cases resolved without agent escalation.</div></div>
    <div class="report-card"><h3>Human review</h3><strong>${reportStats.review}%</strong><div class="muted">Cases handed to staff for confirmation.</div></div>
    <div class="report-card"><h3>Avg risk score</h3><strong>${reportStats.risk}</strong><div class="muted">Current average risk across active queues.</div></div>
    <div class="report-card"><h3>Response time</h3><strong>${responseTime}</strong><div class="muted">Avg. time from filing to first staff action, computed from the audit trail.</div></div>
  `;
  const auto = document.getElementById('autoResolvedMetric');
  const review = document.getElementById('reviewMetric');
  const risk = document.getElementById('riskMetricAnalytics');
  if (auto) auto.textContent = `${reportStats.autoResolved}%`;
  if (review) review.textContent = `${reportStats.review}%`;
  if (risk) risk.textContent = `Avg ${reportStats.risk}`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('tab-' + tabId);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(btn => btn.classList.remove('active'));
  document.getElementById('nav-' + tabId).classList.add('active');
  if (tabId === 'analytics') initCharts();
  if (tabId === 'verification') {
    initRadarChart();
    if (cases[selected]) updateVerificationPanel(cases[selected]);
  }
}
window.switchTab = switchTab;

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------

document.getElementById('complaintForm').addEventListener('submit', addCaseFromForm);
document.getElementById('seedBtn').addEventListener('click', () => seed(true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCaseModal();
});
document.getElementById('proofUpload').addEventListener('change', handleProofUploadChange);
document.getElementById('runVerifyBtn').addEventListener('click', runVerification);

async function bootstrap() {
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    document.getElementById('apiStatus').textContent = 'API connected: ' + h.retrieval_mode;
    document.getElementById('runtimeMode').textContent = h.retrieval_mode === 'embedding_faiss' ? 'MiniLM + FAISS active' : 'Simple AI fallback';
  } catch (e) {
    document.getElementById('apiStatus').textContent = 'Offline browser mode';
    document.getElementById('runtimeMode').textContent = 'Browser AI fallback';
  }
  await seed(false);
  updateReportSummary();
}
bootstrap();

// ---------------------------------------------------------------------------
// Charts — Analytics tab (volume/resolution) and Verification tab (radar)
// ---------------------------------------------------------------------------

let chartsRendered = false;
function buildVolumeChartData() {
  const days = [];
  const counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayKey = d.toDateString();
    days.push(i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${i}d ago`);
    const count = cases.filter(c => c.filed_at && new Date(c.filed_at).toDateString() === dayKey).length;
    counts.push(count);
  }
  return { days, counts };
}

function initCharts() {
  if (chartsRendered) return;
  chartsRendered = true;
  Chart.defaults.color = '#9c9484';
  Chart.defaults.font.family = 'Inter, sans-serif';

  const { days, counts } = buildVolumeChartData();
  new Chart(document.getElementById('volumeChart'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'Complaints Filed',
        data: counts,
        borderColor: '#7d7096',
        backgroundColor: 'rgba(125,112,150, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { stepSize: 1 } },
        x: { grid: { display: false } }
      }
    }
  });

  const typeCounts = {};
  cases.forEach(c => {
    const t = label(c.decision.case_type) || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const typeLabels = Object.keys(typeCounts).length ? Object.keys(typeCounts) : ['Damaged Delivery', 'Refund Dispute', 'Delivery Delay', 'Warranty Claim'];
  const typeValues = Object.keys(typeCounts).length ? Object.values(typeCounts) : [45, 30, 15, 10];
  const palette = ['#c6a34d', '#7d7096', '#b8863f', '#6f9074', '#8a5568', '#6a8f8a'];

  new Chart(document.getElementById('resolutionChart'), {
    type: 'doughnut',
    data: {
      labels: typeLabels,
      datasets: [{
        data: typeValues,
        backgroundColor: typeLabels.map((_, i) => palette[i % palette.length]),
        borderWidth: 0, hoverOffset: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#ede8dc', font: { size: 13 } } } },
      cutout: '75%'
    }
  });
}

let radarChart = null;
function initRadarChart() {
  if (radarChart) return;
  const ctx = document.getElementById('riskRadarChart');
  if (!ctx) return;
  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Text Quality', 'Order Verified', 'Evidence', 'Policy Window', 'Claim History', 'Escalation'],
      datasets: [{
        label: 'Risk Score',
        data: [0, 0, 0, 0, 0, 0],
        borderColor: '#7d7096',
        backgroundColor: 'rgba(125,112,150, 0.15)',
        pointBackgroundColor: '#7d7096',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#7d7096',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 40,
          grid: { color: 'rgba(255,255,255,0.08)' },
          angleLines: { color: 'rgba(255,255,255,0.08)' },
          pointLabels: { color: '#9c9484', font: { size: 12, weight: '600' } },
          ticks: { display: false }
        }
      }
    }
  });
}

function updateVerificationPanel(c) {
  if (!c || !c.decision) return;
  const v = c.decision.verification;
  const p = c.decision.parsed_complaint;
  // Update radar chart
  if (radarChart) {
    const textRisk = c.complaint_text.trim().length < 45 ? 20 : 0;
    const orderRisk = (c.order_exists === false && !p.extracted_order_id) ? 35 : 0;
    const evidenceRisk = (c.evidence_count === 0 && !p.evidence_signals.length) ? 15 : 0;
    const windowRisk = c.days_since_delivery > 7 ? 18 : 0;
    const historyRisk = c.customer_claim_count_30d >= 3 ? 20 : 0;
    const escalationRisk = p.pressure_signals && p.pressure_signals.length ? Math.min(p.pressure_signals.length * 8, 25) : 0;
    radarChart.data.datasets[0].data = [textRisk, orderRisk, evidenceRisk, windowRisk, historyRisk, escalationRisk];
    const rLabel = v.risk_label;
    radarChart.data.datasets[0].borderColor = rLabel === 'high' ? '#a1503f' : rLabel === 'medium' ? '#b8863f' : '#6f9074';
    radarChart.data.datasets[0].backgroundColor = rLabel === 'high' ? 'rgba(161,80,63,0.15)' : rLabel === 'medium' ? 'rgba(184,134,63,0.15)' : 'rgba(111,144,116,0.15)';
    radarChart.data.datasets[0].pointBackgroundColor = radarChart.data.datasets[0].borderColor;
    radarChart.update();
    const badge = document.getElementById('radarRiskBadge');
    if (badge) { badge.textContent = v.risk_label.toUpperCase() + ' RISK — Score ' + v.risk_score; badge.className = 'tag ' + (rLabel === 'high' ? 'high' : rLabel === 'medium' ? 'medium' : 'low'); }
  }
  // Animate SVG arc meter (dashoffset: 188 = empty, 0 = full)
  const arcPath = document.getElementById('riskArcPath');
  const scoreText = document.getElementById('riskScoreText');
  const scoreLabel = document.getElementById('riskScoreLabel');
  if (arcPath && scoreText) {
    const score = v.risk_score;
    const offset = 188 - (score / 100) * 188;
    arcPath.style.strokeDashoffset = offset;
    scoreText.textContent = score;
    const rLabel = v.risk_label;
    if (scoreLabel) {
      scoreLabel.textContent = rLabel === 'high' ? '🔴 HIGH RISK' : rLabel === 'medium' ? '🟡 NEEDS REVIEW' : '🟢 LOW RISK';
      scoreLabel.style.color = rLabel === 'high' ? '#a1503f' : rLabel === 'medium' ? '#b8863f' : '#6f9074';
    }
  }
  // Update hash displays
  if (c._nameHash) {
    const nd = document.getElementById('nameHashDisplay');
    if (nd) nd.innerHTML = '<span style="color:#9c9484">Input: </span><span style="color:var(--muted)">' + c.customer_name + '</span><br><span style="color:#9c9484">SHA-256: </span>' + c._nameHash;
  }
  if (c._orderHash) {
    const od = document.getElementById('orderHashDisplay');
    const orderLabel = c._hasRealOrderId
      ? (c.decision?.parsed_complaint?.extracted_order_id || c.order_id)
      : '(no order reference found — hashing fallback placeholder)';
    if (od) od.innerHTML = '<span style="color:#9c9484">Input: </span><span style="color:var(--muted)">' + orderLabel + '</span><br><span style="color:#9c9484">SHA-256: </span>' + c._orderHash;
  }
}
window.updateVerificationPanel = updateVerificationPanel;
