const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (id, keep) => { document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden')); $(id).classList.remove('hidden'); if (!keep) scrollTo(0, 0); };
const session = {
  get() { try { return JSON.parse(localStorage.getItem('lbdn_session')); } catch (e) { return null; } },
  set(v) { localStorage.setItem('lbdn_session', JSON.stringify(v)); },
  clear() { localStorage.removeItem('lbdn_session'); }
};
let cfg = null;
$('#splashLogo').src = CONFIG.LOGO_URL;
$('#logo').src = CONFIG.LOGO_URL;

async function api(payload) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  return res.json();
}
function setMsg(el, text, ok) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); }
/* Hero slideshow: exterior first, then interior shots. Missing files are skipped. */
const SLIDES = CONFIG.HERO_IMAGES || ['images/lr4.jpg', 'images/lr4-interior-1.jpg', 'images/lr4-interior-2.jpg', 'images/lr4-interior-3.jpg'];
function initSlides() {
  const box = $('#slides');
  SLIDES.forEach((src, i) => {
    const im = new Image();
    im.alt = i ? 'Inside the 2012 Land Rover LR4' : '2012 Land Rover LR4';
    im.onerror = () => {
      if (i === 0 && CONFIG.HERO_FALLBACK && im.src !== CONFIG.HERO_FALLBACK) im.src = CONFIG.HERO_FALLBACK;
      else im.remove();
    };
    im.src = src;
    box.appendChild(im);
  });
  let n = 0;
  const tick = () => { const s = [...box.children]; s.forEach((el, k) => el.classList.toggle('on', k === n % s.length)); };
  tick();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { n++; tick(); }, 6000);
}
function useImage(img) {
  const list = [SLIDES[1], SLIDES[0], CONFIG.HERO_FALLBACK].filter(Boolean);
  let i = 0;
  img.onerror = () => { if (++i < list.length) img.src = list[i]; else img.remove(); };
  img.src = list[0];
}

/* ---------- Header buttons ---------- */
function setNav(on) {
  ['#logoutBtn', '#dashBtn'].forEach((q) => $(q).classList.toggle('hidden', !on));
  ['#loginNav', '#registerNav'].forEach((q) => $(q).classList.toggle('hidden', on));
}
function openJoin(tab) {
  show('#viewWelcome');
  document.querySelector('[data-tab=' + tab + ']').click();
  $('#join').scrollIntoView({ behavior: 'smooth' });
}
$('#loginNav').addEventListener('click', () => openJoin('login'));
$('#registerNav').addEventListener('click', () => openJoin('register'));
$('#dashBtn').addEventListener('click', () => enter());

/* ---------- Welcome ---------- */
async function loadConfig() {
  initSlides(); useImage($('#panelImg'));
  cfg = await api({ action: 'config' });
  if (!cfg.ok) { $('#closeNotice').textContent = 'Could not load award details. Check your API_URL in config.js.'; return; }
  document.title = cfg.awardName;
  $('#heroSub').textContent = 'Register, earn points every day, and climb the leaderboard.';
  $('#noteText').textContent = cfg.note;
  $('#criteriaList').innerHTML = cfg.criteria.map((c) => `
    <div class="crit">
      <div class="crit-head"><span>${esc(c.name)}</span><span class="w">${c.weight}%</span></div>
      <div class="bar-track"><div style="width:${Math.min(100, c.weight * 4)}%"></div></div>
      <p>${esc(c.description)}</p>
      <p><strong>How to earn it:</strong> ${esc(c.howTo)}</p>
    </div>`).join('');
  if (!cfg.registrationOpen) {
    $('#closeNotice').textContent = 'Registration is closed.';
    $('#registerForm button[type=submit]').disabled = true;
  } else if (cfg.closeDate) {
    const days = Math.ceil((new Date(cfg.closeDate + 'T23:59:59') - new Date()) / 864e5);
    $('#closeNotice').textContent = days > 0 ? `Registration closes in ${days} day${days === 1 ? '' : 's'} (${cfg.closeDate}).` : 'Registration closes today.';
  }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  const reg = t.dataset.tab === 'register';
  $('#registerForm').classList.toggle('hidden', !reg);
  $('#loginForm').classList.toggle('hidden', reg);
}));

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; setMsg($('#registerMsg'), 'Registering...', true);
  const r = await api({ action: 'register', ...Object.fromEntries(new FormData(e.target)) });
  btn.disabled = false;
  if (r.ok) { e.target.reset(); setMsg($('#registerMsg'), '', true); document.querySelector('[data-tab=login]').click(); setMsg($('#loginMsg'), 'You’re registered. Log in to see your score.', true); showWhatsApp(); }
  else setMsg($('#registerMsg'), r.error, false);
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target)); f.admin = !!f.admin;
  setMsg($('#loginMsg'), 'Logging in...', true);
  const r = await api({ action: 'login', ...f });
  if (!r.ok) return setMsg($('#loginMsg'), r.error, false);
  session.set(r); enter();
});

$('#logoutBtn').addEventListener('click', () => { session.clear(); setNav(false); show('#viewWelcome'); });

/* ---------- Public leaderboard ---------- */
async function loadBoard() {
  show('#viewBoard');
  $('#podium').innerHTML = '';
  $('#publicTable').innerHTML = '<tr><td>Loading standings…</td></tr>';
  const r = await api({ action: 'publicBoard' });
  if (!r.ok) { $('#publicTable').innerHTML = '<tr><td>Could not load the leaderboard. Please try again.</td></tr>'; return; }
  const me = (session.get() || {}).id;
  $('#boardUpdated').textContent = r.lastUpdate || 'no updates yet';
  if (!r.board.length) { $('#publicTable').innerHTML = '<tr><td>No contestants yet. Be the first to register.</td></tr>'; return; }
  $('#podium').innerHTML = r.board.slice(0, 3).map((b) => `<div class="pod p${b.position}"><span class="pos">${b.position}</span><strong>${esc(b.name)}</strong><span>${b.cumulative} points</span></div>`).join('');
  const heads = r.criteria.map((c) => `<th>${esc(c.name)} (${c.weight}%)</th>`).join('');
  $('#publicTable').innerHTML = `<tr><th>Position</th><th>Name</th>${heads}<th>Cumulative score</th></tr>` +
    r.board.map((b) => `<tr><td>${b.position}</td><td>${esc(b.name)}</td>${b.detail.map((d) => `<td>${d.raw}</td>`).join('')}<td><strong>${b.cumulative}</strong></td></tr>`).join('');
}
$('#boardBtn').addEventListener('click', loadBoard);
$('#heroBoard').addEventListener('click', loadBoard);
$('#boardBack').addEventListener('click', () => (session.get() ? enter() : show('#viewWelcome')));

/* ---------- Contestant ---------- */
async function loadDashboard(s, refresh) {
  const r = await api({ action: 'myDashboard', id: s.id, token: s.token });
  if (!r.ok) { session.clear(); setNav(false); return show('#viewWelcome'); }
  $('#meName').textContent = s.name;
  $('#mePosition').textContent = '#' + r.me.position;
  $('#meOutOf').textContent = 'out of ' + r.board.length;
  $('#meScore').textContent = r.me.cumulative;
  $('#lastUpdate').textContent = r.lastUpdate || 'no updates yet';
  const pend = {};
  r.submissions.filter((x) => x.status === 'Pending').forEach((x) => { pend[x.key] = (pend[x.key] || 0) + x.value; });
  $('#breakdown').innerHTML = r.me.detail.map((d) => {
    const c = cfg.criteria.find((x) => x.key === d.key) || {};
    const pct = d.weight ? Math.min(100, (d.points / d.weight) * 100) : 0;
    return `<div class="crit"><div class="crit-head"><span>${esc(d.name)}</span><span class="w">${d.points} / ${d.weight}</span></div>
      <div class="bar-track"><div style="width:${pct}%"></div></div>
      <p>Approved total: ${d.raw}${pend[d.key] ? ` (+${pend[d.key]} awaiting approval)` : ''}. ${esc(c.howTo)}</p></div>`;
  }).join('');
  const heads = cfg.criteria.map((c) => `<th>${esc(c.name)} (${c.weight}%)</th>`).join('');
  $('#boardTable').innerHTML = `<tr><th>Name</th>${heads}<th>Cumulative score</th><th>Position</th></tr>` +
    r.board.map((b) => `<tr class="${b.id === s.id ? 'me' : ''}"><td>${esc(b.name)}</td>${b.detail.map((d) => `<td>${d.raw}</td>`).join('')}<td>${b.cumulative}</td><td>${b.position}</td></tr>`).join('');
  const nameOf = (k) => (cfg.criteria.find((c) => c.key === k) || {}).name || k;
  $('#historyList').innerHTML = r.history.length ? r.history.map((h) => `<li>${esc(h.date)}: +${esc(h.value)} ${esc(nameOf(h.key))}</li>`).join('') : '<li>No updates yet.</li>';
  mySubsData = r.submissions;
  $('#entryCriteria').innerHTML = cfg.criteria.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('');
  renderSubs();
  resetEntryForm();
  $('#waBanner').classList.toggle('hidden', !cfg.whatsappLink);
  $('#waBannerBtn').href = cfg.whatsappLink || '#';
  show('#viewDashboard', refresh);
}

/* ---------- Admin ---------- */
let adminBoard = [];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const critRow = (c = {}) => `<tr>
  <td><input class="k" value="${esc(c.key)}" ${c.key ? 'readonly' : ''} placeholder="auto"></td>
  <td><input class="n" value="${esc(c.name)}" placeholder="Name"></td>
  <td><input class="w" type="number" value="${c.weight ?? ''}" placeholder="%"></td>
  <td><input class="d" value="${esc(c.description)}" placeholder="What is counted"></td>
  <td><input class="h" value="${esc(c.howTo)}" placeholder="How to earn it"></td>
  <td><button type="button" class="btn ghost rm">Remove</button></td></tr>`;
const critHead = '<tr><th>Key</th><th>Name</th><th>Weight %</th><th>Description</th><th>How to earn it</th><th></th></tr>';
function sumWeights() { $('#weightTotal').textContent = [...document.querySelectorAll('#critTable .w')].reduce((a, i) => a + (Number(i.value) || 0), 0); }

$('#critTable').addEventListener('input', sumWeights);
$('#critTable').addEventListener('click', (e) => { if (e.target.classList.contains('rm')) { e.target.closest('tr').remove(); sumWeights(); } });
$('#addCrit').addEventListener('click', () => { $('#critTable').insertAdjacentHTML('beforeend', critRow()); });

$('#saveCrit').addEventListener('click', async () => {
  const criteria = [...document.querySelectorAll('#critTable tr')].slice(1).map((tr) => {
    const name = tr.querySelector('.n').value.trim();
    return { key: tr.querySelector('.k').value || slug(name), name, weight: tr.querySelector('.w').value, description: tr.querySelector('.d').value, howTo: tr.querySelector('.h').value };
  }).filter((c) => c.name);
  const r = await api({ action: 'saveCriteria', token: session.get().token, criteria });
  setMsg($('#critMsg'), r.ok ? 'Criteria saved. The public page now shows them.' : r.error, r.ok);
  if (r.ok) { cfg = await api({ action: 'config' }); loadAdmin(session.get(), true); }
});

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api({ action: 'saveSettings', token: session.get().token, settings: Object.fromEntries(new FormData(e.target)) });
  setMsg($('#settingsMsg'), r.ok ? 'Settings saved.' : r.error, r.ok);
  if (r.ok) cfg = await api({ action: 'config' });
});

$('#scoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api({ action: 'addScore', token: session.get().token, ...Object.fromEntries(new FormData(e.target)) });
  setMsg($('#scoreMsg'), r.ok ? 'Score added.' : r.error, r.ok);
  if (r.ok) { e.target.value.value = ''; loadAdmin(session.get(), true); }
});

$('#exportBtn').addEventListener('click', () => {
  const head = ['Position', 'Name', 'Email', ...adminBoard[0].detail.map((d) => d.name), 'Cumulative'];
  const lines = adminBoard.map((b) => [b.position, `"${b.name}"`, b.email, ...b.detail.map((d) => d.points), b.cumulative].join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
  a.download = 'car-award-report.csv'; a.click();
});

async function loadAdmin(s, refresh) {
  const r = await api({ action: 'adminData', token: s.token });
  if (!r.ok) { session.clear(); setNav(false); return show('#viewWelcome'); }
  adminBoard = r.board;
  $('#scoreContestant').innerHTML = r.contestants.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#scoreCriteria').innerHTML = r.config.criteria.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('');
  $('#critTable').innerHTML = critHead + r.config.criteria.map(critRow).join('');
  sumWeights();
  reviewData = r.submissions || [];
  renderReview();
  Object.entries(r.config.settings).forEach(([k, v]) => { const el = $('#settingsForm [name=' + k + ']'); if (el) el.value = v; });
  const heads = r.config.criteria.map((c) => `<th>${esc(c.name)} (${c.weight}%)</th>`).join('');
  $('#adminTable').innerHTML = `<tr><th>Position</th><th>Name</th>${heads}<th>Cumulative score</th></tr>` +
    r.board.map((b) => `<tr><td>${b.position}</td><td>${esc(b.name)}</td>${b.detail.map((d) => `<td>${d.raw} (${d.points})</td>`).join('')}<td><strong>${b.cumulative}</strong></td></tr>`).join('');
  show('#viewAdmin', refresh);
}

/* ---------- WhatsApp prompt ---------- */
function showWhatsApp() {
  if (!cfg || !cfg.whatsappLink) return;
  $('#waJoin').href = cfg.whatsappLink;
  $('#waModal').classList.remove('hidden');
  $('#waJoin').focus();
}
const closeWa = () => $('#waModal').classList.add('hidden');
$('#waSkip').addEventListener('click', closeWa);
$('#waJoin').addEventListener('click', closeWa);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWa(); });

/* ---------- Member entries (need admin approval) ---------- */
let mySubsData = [], reviewData = [], keepProof = [];
const nameOfKey = (k) => (cfg.criteria.find((c) => c.key === k) || {}).name || k;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function resetEntryForm() {
  const f = $('#entryForm');
  f.reset(); f.entryId.value = ''; f.date.value = today();
  keepProof = []; renderKeep();
  $('#entryBtn').textContent = 'Submit for approval';
  $('#entryCancel').classList.add('hidden');
}
function renderSubs() {
  $('#mySubs').innerHTML = '<tr><th>Date</th><th>Criterion</th><th>Amount</th><th>Status</th><th>Notes</th><th>Proof</th><th></th></tr>' +
    (mySubsData.length ? mySubsData.map((s) => `<tr><td>${esc(s.date)}</td><td>${esc(nameOfKey(s.key))}</td><td>${s.value}</td>
      <td><span class="badge ${s.status.toLowerCase()}">${s.status}</span></td>
      <td>${esc(s.note)}${s.adminNote ? ` <em>Admin: ${esc(s.adminNote)}</em>` : ''}</td>
      <td>${proofLinks(s.proof)}</td>
      <td>${s.status === 'Approved' ? '' : `<button type="button" class="btn ghost sm" data-edit="${esc(s.id)}">Edit</button><button type="button" class="btn ghost sm" data-del="${esc(s.id)}">Delete</button>`}</td></tr>`).join('')
      : '<tr><td colspan="7">Nothing submitted yet.</td></tr>');
}
$('#entryCancel').addEventListener('click', () => { resetEntryForm(); setMsg($('#entryMsg'), '', true); });
$('#entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = session.get(), f = Object.fromEntries(new FormData(e.target)), editing = !!f.entryId;
  const files = [...$('#proofFiles').files];
  const bad = checkFiles(files);
  if (bad) return setMsg($('#entryMsg'), bad, false);
  const btn = $('#entryBtn');
  btn.disabled = true;
  try {
    setMsg($('#entryMsg'), 'Saving your entry…', true);
    const payload = { action: editing ? 'editEntry' : 'submitEntry', id: s.id, token: s.token, ...f };
    if (editing) payload.keepIds = keepProof.map((x) => x.id);
    const r = await api(payload);
    if (!r.ok) return setMsg($('#entryMsg'), r.error, false);
    const entryId = editing ? f.entryId : r.id;
    let failed = 0, why = '';
    for (let i = 0; i < files.length; i++) {
      setMsg($('#entryMsg'), `Uploading file ${i + 1} of ${files.length}…`, true);
      try {
        const u = await prepareFile(files[i]);
        const up = await api({ action: 'uploadProof', id: s.id, token: s.token, entryId, name: u.name, data: u.data });
        if (!up.ok) { failed++; why = up.error; }
      } catch (x) { failed++; why = 'The upload did not finish.'; }
    }
    setMsg($('#entryMsg'), failed ? `Entry saved, but ${failed} file${failed > 1 ? 's' : ''} did not upload: ${why} Edit the entry to try again.` : (editing ? 'Changes saved. Waiting for admin approval.' : 'Submitted. Waiting for admin approval.'), !failed);
    loadDashboard(s, true);
  } catch (x) {
    setMsg($('#entryMsg'), 'Something went wrong. Check your connection and try again.', false);
  } finally { btn.disabled = false; }
});
$('#mySubs').addEventListener('click', async (e) => {
  if (e.target.dataset.proof) return openProof(e.target.dataset.proof, $('#entryMsg'), false);
  const s = session.get(), ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) {
    const x = mySubsData.find((q) => q.id === ed), f = $('#entryForm');
    f.entryId.value = x.id; f.criteriaKey.value = x.key; f.value.value = x.value; f.date.value = x.date; f.note.value = x.note;
    keepProof = (x.proof || []).slice(); renderKeep();
    $('#entryBtn').textContent = 'Save changes';
    $('#entryCancel').classList.remove('hidden');
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (del && confirm('Delete this entry?')) {
    const r = await api({ action: 'deleteEntry', id: s.id, token: s.token, entryId: del });
    setMsg($('#entryMsg'), r.ok ? 'Entry deleted.' : r.error, r.ok);
    if (r.ok) loadDashboard(s, true);
  }
});

/* ---------- Receipts and screenshots ---------- */
const MAX_BYTES = 10 * 1024 * 1024, MAX_FILES = 3;
const proofLinks = (list) => (list || []).map((p) => `<button type="button" class="link" data-proof="${esc(p.id)}">${esc(p.name)}</button>`).join('<br>');
function renderKeep() {
  $('#proofKeep').innerHTML = keepProof.map((p) => `<span class="chip">${esc(p.name)}<button type="button" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join('');
}
$('#proofKeep').addEventListener('click', (e) => {
  const id = e.target.dataset.rm;
  if (id) { keepProof = keepProof.filter((p) => p.id !== id); renderKeep(); }
});
function checkFiles(files) {
  if (keepProof.length + files.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files per entry.`;
  for (const f of files) {
    if (f.size >= MAX_BYTES) return `“${f.name}” is ${(f.size / 1048576).toFixed(1)} MB. Each file must be under 10 MB.`;
    const okType = /^(image\/(png|jpeg|webp|heic|heif)|application\/pdf)$/.test(f.type) || /\.(png|jpe?g|webp|heic|heif|pdf)$/i.test(f.name);
    if (!okType) return `“${f.name}” is not a supported file. Use a photo, screenshot or PDF.`;
  }
  return '';
}
$('#proofFiles').addEventListener('change', (e) => {
  const bad = checkFiles([...e.target.files]);
  if (bad) e.target.value = '';
  setMsg($('#entryMsg'), bad, !bad);
});
const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
/* Large photos are shrunk in the browser first, so uploads stay quick */
async function prepareFile(file) {
  let blob = file, name = file.name;
  if (/^image\/(png|jpeg|webp)$/.test(file.type) && file.size > 1.5 * 1048576) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const small = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (small && small.size < file.size) { blob = small; name = name.replace(/\.\w+$/, '') + '.jpg'; }
    } catch (x) { /* keep the original file */ }
  }
  return { name, data: await toBase64(blob) };
}
async function openProof(fileId, msgEl, asAdmin) {
  const s = session.get();
  const w = window.open('', '_blank');
  if (w) w.document.write('Loading…');
  const r = await api(asAdmin ? { action: 'getProof', token: s.token, fileId } : { action: 'getProof', id: s.id, token: s.token, fileId });
  if (!r.ok) { if (w) w.close(); return setMsg(msgEl, r.error, false); }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: r.mime }));
  if (w) w.location = url; else location.href = url;
}

/* ---------- Admin approvals ---------- */
function renderReview() {
  const pending = reviewData.filter((s) => s.status === 'Pending').length;
  $('#pendingCount').textContent = pending + ' pending';
  $('#pendingCount').classList.toggle('hidden', !pending);
  $('#reviewTable').innerHTML = '<tr><th>Date</th><th>Member</th><th>Criterion</th><th>Amount</th><th>Note</th><th>Proof</th><th>Status</th><th>Admin note</th><th></th></tr>' +
    (reviewData.length ? reviewData.map((s) => `<tr data-id="${esc(s.id)}">
      <td>${esc(s.date)}</td><td>${esc(s.name)}</td><td>${esc(nameOfKey(s.key))}</td>
      <td><input class="rv" type="number" step="any" min="0" value="${s.value}"></td>
      <td>${esc(s.note)}</td><td>${proofLinks(s.proof)}</td><td><span class="badge ${s.status.toLowerCase()}">${s.status}</span></td>
      <td><input class="rn" value="${esc(s.adminNote)}" placeholder="Optional"></td>
      <td>${s.status === 'Pending' ? '<button type="button" class="btn sm" data-d="Approved">Approve</button><button type="button" class="btn ghost sm" data-d="Rejected">Reject</button>' : '<button type="button" class="btn ghost sm" data-d="Pending">Reopen</button>'}</td></tr>`).join('')
      : '<tr><td colspan="9">No entries yet.</td></tr>');
}
$('#reviewTable').addEventListener('click', async (e) => {
  if (e.target.dataset.proof) return openProof(e.target.dataset.proof, $('#reviewMsg'), true);
  const d = e.target.dataset.d;
  if (!d) return;
  const tr = e.target.closest('tr');
  const r = await api({ action: 'reviewEntry', token: session.get().token, entryId: tr.dataset.id, decision: d, value: tr.querySelector('.rv').value, adminNote: tr.querySelector('.rn').value });
  setMsg($('#reviewMsg'), r.ok ? 'Saved.' : r.error, r.ok);
  if (r.ok) loadAdmin(session.get(), true);
});

/* ---------- PDF export (matches the LBDN sample layout) ---------- */
const PDF_TITLE = CONFIG.PDF_TITLE || 'THE LIVING BY DESIGN NATION CAR AWARD DASHBOARD';
const PDF_SUBTITLE = CONFIG.PDF_SUBTITLE || 'CONTESTANTS INCLUDES ALL LBD WORKFORCE';
function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      res({ data: c.toDataURL('image/png'), w: im.naturalWidth, h: im.naturalHeight });
    };
    im.onerror = () => res(null);
    im.src = src;
  });
}
$('#pdfBtn').addEventListener('click', async () => {
  if (!window.jspdf) return setMsg($('#reviewMsg'), 'The PDF tools did not load. Check your internet connection and try again.', false);
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const logo = await loadImg(CONFIG.LOGO_URL);
  const W = doc.internal.pageSize.getWidth();
  const clean = (t) => String(t).replace(/[’‘]/g, "'").toUpperCase();
  const head = [['NAME', ...cfg.criteria.map((c) => clean(c.name) + '\n(' + c.weight + '%)'), 'CUMULATIVE\nSCORE', 'POSITION']];
  const PER = 8;
  const now = new Date();
  const dateText = 'DATE: ' + now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  const dateStamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  for (let i = 0; i < Math.max(adminBoard.length, 1); i += PER) {
    if (i) doc.addPage();
    if (logo) doc.addImage(logo.data, 'PNG', 50, 98, (32 * logo.w) / logo.h, 32);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(dateText, W - 50, 118, { align: 'right' });
    doc.setFont('courier', 'bold'); doc.setFontSize(20);
    doc.text(PDF_TITLE, W / 2, 181, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(PDF_SUBTITLE, W / 2, 224, { align: 'center' });
    doc.autoTable({
      startY: 258, head,
      body: adminBoard.slice(i, i + PER).map((b) => [b.name, ...b.detail.map((d) => d.raw), b.cumulative, b.position]),
      margin: { left: 50, right: 50 }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], lineWidth: 0.75, textColor: [0, 0, 0], minCellHeight: 26.5, cellPadding: 3 },
      headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], minCellHeight: 41 },
      columnStyles: { 0: { cellWidth: 90 } }
    });
  }
  doc.save('LBDN-Car-Award-Dashboard-' + dateStamp + '.pdf');
});

/* ---------- Boot ---------- */
function enter() {
  const s = session.get();
  if (!s) { setNav(false); return show('#viewWelcome'); }
  setNav(true);
  return s.role === 'admin' ? loadAdmin(s) : loadDashboard(s);
}
function hideSplash() {
  const sp = $('#splash');
  sp.classList.add('done');
  setTimeout(() => sp.remove(), 600);
}
(async () => {
  const minWait = new Promise((r) => setTimeout(r, 900));
  try { await loadConfig(); await enter(); }
  catch (err) { $('#closeNotice').textContent = 'Could not reach the server. Please refresh the page.'; }
  await minWait;
  hideSplash();
})();
