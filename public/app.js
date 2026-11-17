
const $ = s => document.querySelector(s);

let password = sessionStorage.getItem('bo_admin') || '';
let promotions = [];
let editing = null;
let masterQR;

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const date = s => new Date(s + 'T00:00:00').toLocaleDateString(
  undefined,
  { day: 'numeric', month: 'short', year: 'numeric' }
);

async function api(path, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    ...(password ? { 'x-admin-password': password } : {})
  };

  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));

  if (!r.ok) throw Error(data.error || 'Request failed');
  return data;
}

function show(section) {
  ['public-view', 'detail-view', 'admin-view'].forEach(id => {
    $('#' + id).classList.toggle('hidden', id !== section);
  });
  window.scrollTo(0, 0);
}

function fileUrl(id) {
  return '/api/file/' + encodeURIComponent(id);
}

// Automatically detect PDF or image.
function promotionType(p) {
  if (p.file_type === 'application/pdf') return 'pdf';

  const source = p.file_key || p.file_name || '';

  try {
    const path = new URL(source, location.origin).pathname.toLowerCase();
    if (path.endsWith('.pdf')) return 'pdf';
  } catch {}

  if (/\.pdf(?:$|[?#])/i.test(source)) return 'pdf';

  return 'image';
}

function promotionMedia(p, detail = false) {
  const url = fileUrl(p.id);

  if (promotionType(p) === 'pdf') {
    return detail
      ? `
        <iframe
          title="${esc(p.title)} PDF"
          src="${url}"
          style="width:100%;height:750px;border:0;border-radius:12px"
        ></iframe>
      `
      : `
        <div class="pdf-preview">
          <div style="font-size:52px">📄</div>
          <b>PDF PROMOTION</b>
          <p>View or download this promotion</p>
        </div>
      `;
  }

  return `
    <img
      src="${url}"
      alt="${esc(p.title)}"
      loading="lazy"
      onerror="this.alt='Unable to load poster image'"
    >
  `;
}

function renderPublic() {
  const list = promotions.filter(p => p.status === 'published');

  $('#count').textContent = list.length + ' offers';

  $('#public-list').innerHTML = list.length
    ? list.map(p => `
      <article class="card">
        ${promotionMedia(p)}
        <div class="card-body">
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.description)}</p>
          <div class="date">
            ${date(p.starts_at)} – ${date(p.ends_at)}
          </div>
          <a href="#promotion/${encodeURIComponent(p.id)}"
             data-detail="${esc(p.id)}">
            View promotion ↗
          </a>
        </div>
      </article>
    `).join('')
    : `
      <div class="empty">
        No promotions are available right now.<br>
        សូមអញ្ជើញត្រឡប់មកមើលម្ដងទៀត។
      </div>
    `;
}

async function loadPublic() {
  try {
    promotions = await api('/api/promotions');
    renderPublic();

    if (location.hash.startsWith('#promotion/')) {
      openDetail(decodeURIComponent(location.hash.split('/')[1]));
    }
  } catch (e) {
    $('#public-list').innerHTML = `
      <div class="empty">
        Unable to load promotions. Please refresh the page.
      </div>
    `;
  }
}

function openDetail(id) {
  const p = promotions.find(x => x.id === id);
  if (!p) return;

  show('detail-view');

  $('#detail-content').innerHTML = `
    <div class="detail">
      <span class="eyebrow">BABY OUTLET PROMOTION</span>
      <h1>${esc(p.title)}</h1>
      <p>${esc(p.description)}</p>
      <p class="muted">
        ${date(p.starts_at)} – ${date(p.ends_at)}
      </p>

      ${promotionMedia(p, true)}

      <p>
        <a class="primary"
           style="display:inline-block;text-decoration:none;margin-top:14px"
           href="${fileUrl(p.id)}"
           target="_blank"
           rel="noopener">
          Open / Download promotion
        </a>
      </p>
    </div>
  `;
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-detail]');

  if (a) {
    e.preventDefault();
    location.hash = 'promotion/' + encodeURIComponent(a.dataset.detail);
    openDetail(a.dataset.detail);
  }
});

$('#back').onclick = () => {
  location.hash = '';
  show('public-view');
};

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#promotion/')) {
    openDetail(decodeURIComponent(location.hash.split('/')[1]));
  } else {
    show('public-view');
  }
});

$('#admin-open').onclick = () => {
  show('admin-view');

  if (password) {
    adminLoad();
  } else {
    $('#login-box').classList.remove('hidden');
    $('#admin-panel').classList.add('hidden');
  }
};

$('#login-form').onsubmit = async e => {
  e.preventDefault();

  const pw = $('#password').value;

  try {
    await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(async r => {
      if (!r.ok) throw Error('Incorrect password');
      return r.json();
    });

    password = pw;
    sessionStorage.setItem('bo_admin', pw);
    $('#login-error').textContent = '';
    await adminLoad();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

$('#logout').onclick = () => {
  password = '';
  sessionStorage.removeItem('bo_admin');
  $('#login-box').classList.remove('hidden');
  $('#admin-panel').classList.add('hidden');
  $('#logout').classList.add('hidden');
};

async function adminLoad() {
  try {
    const data = await api('/api/promotions?admin=1');
    promotions = data;

    $('#login-box').classList.add('hidden');
    $('#admin-panel').classList.remove('hidden');
    $('#logout').classList.remove('hidden');

    $('#stat-total').textContent = data.length;
    $('#stat-live').textContent =
      data.filter(x => x.status === 'published').length;
    $('#stat-draft').textContent =
      data.filter(x => x.status !== 'published').length;

    renderAdmin();
    makeMasterQR();
  } catch (e) {
    password = '';
    sessionStorage.removeItem('bo_admin');
    $('#login-box').classList.remove('hidden');
    $('#admin-panel').classList.add('hidden');
    $('#login-error').textContent = e.message;
  }
}

function renderAdmin() {
  $('#admin-list').innerHTML = promotions.length
    ? promotions.map(p => `
      <div class="admin-row">
        <div>
          <b>${esc(p.title)}</b>
          <small>
            ${esc(p.starts_at)} – ${esc(p.ends_at)}
            · ${p.status === 'published' ? 'Published' : 'Draft'}
            · ${promotionType(p).toUpperCase()}
          </small>
        </div>

        <div class="row-actions">
          <button class="outline" data-edit="${esc(p.id)}">Edit</button>
          <button class="outline" data-publish="${esc(p.id)}">
            ${p.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <button class="outline" data-qr="${esc(p.id)}">QR</button>
          <button class="outline" data-delete="${esc(p.id)}">Delete</button>
        </div>
      </div>
    `).join('')
    : '<p class="muted">No promotions yet. Add your first one above.</p>';

  $('#admin-list').querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => editPromo(b.dataset.edit);
  });

  $('#admin-list').querySelectorAll('[data-publish]').forEach(b => {
    b.onclick = () => togglePublish(b.dataset.publish);
  });

  $('#admin-list').querySelectorAll('[data-delete]').forEach(b => {
    b.onclick = () => deletePromo(b.dataset.delete);
  });

  $('#admin-list').querySelectorAll('[data-qr]').forEach(b => {
    b.onclick = () => individualQR(b.dataset.qr);
  });
}

function editPromo(id) {
  const p = promotions.find(x => x.id === id);
  if (!p) return;

  editing = id;

  const f = $('#promo-form');
  f.elements.title.value = p.title;
  f.elements.description.value = p.description || '';
  f.elements.starts_at.value = p.starts_at;
  f.elements.ends_at.value = p.ends_at;
  f.elements.image_url.value = p.file_key || '';

  $('#file-current').textContent =
    'Current poster: ' + (p.file_name || '');

  $('#form-heading').textContent = 'Edit promotion';
  $('#save-promo').textContent = 'Update promotion';
  $('#cancel-edit').classList.remove('hidden');

  window.scrollTo({
    top: $('#promo-form').getBoundingClientRect().top + scrollY - 30,
    behavior: 'smooth'
  });
}

function clearForm() {
  editing = null;
  $('#promo-form').reset();
  $('#file-current').textContent = '';
  $('#form-heading').textContent = 'Add a promotion';
  $('#save-promo').textContent = 'Save draft';
  $('#cancel-edit').classList.add('hidden');
}

$('#cancel-edit').onclick = clearForm;

$('#promo-form').onsubmit = async e => {
  e.preventDefault();

  const f = e.currentTarget;
  const fd = new FormData(f);
  const imageUrl = String(fd.get('image_url') || '').trim();

  if (fd.get('ends_at') < fd.get('starts_at')) {
    return $('#form-error').textContent =
      'End date must be on or after start date.';
  }

  if (!imageUrl) {
    return $('#form-error').textContent =
      'Please enter a poster image or PDF URL.';
  }

  let parsed;

  try {
    parsed = new URL(imageUrl);
  } catch {
    return $('#form-error').textContent =
      'Please enter a valid URL.';
  }

  if (parsed.protocol !== 'https:') {
    return $('#form-error').textContent =
      'Please enter a valid HTTPS URL.';
  }

  const path = parsed.pathname.toLowerCase();
  const supported = /\.(jpg|jpeg|png|pdf)$/.test(path);

  if (!supported) {
    return $('#form-error').textContent =
      'Only direct JPG, JPEG, PNG or PDF URLs are supported. The URL must end with the file extension.';
  }

  try {
    await api(
      editing
        ? '/api/admin/promotions/' + encodeURIComponent(editing)
        : '/api/admin/promotions',
      {
        method: editing ? 'PUT' : 'POST',
        body: fd
      }
    );

    clearForm();
    $('#form-error').textContent = '';

    await adminLoad();

    alert('Promotion saved as draft. Publish it when ready.');
  } catch (err) {
    $('#form-error').textContent = err.message;
  }
};

async function togglePublish(id) {
  const p = promotions.find(x => x.id === id);
  if (!p) return;

  const action =
    p.status === 'published' ? 'unpublish' : 'publish';

  try {
    await api(
      '/api/admin/promotions/' + encodeURIComponent(id) + '/' + action,
      { method: 'POST' }
    );
    await adminLoad();
  } catch (e) {
    alert(e.message);
  }
}

async function deletePromo(id) {
  if (!confirm('Delete this promotion?')) return;

  try {
    await api('/api/admin/promotions/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
    await adminLoad();
  } catch (e) {
    alert(e.message);
  }
}

function qrNode(container, url) {
  container.innerHTML = '';

  if (!window.QRCode) {
    container.textContent =
      'QR library unavailable. Check internet connection.';
    return;
  }

  new QRCode(container, {
    text: url,
    width: 180,
    height: 180,
    colorDark: '#201b19',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function makeMasterQR() {
  qrNode($('#master-qr'), location.origin + '/#promotions');
}

function individualQR(id) {
  const u = location.origin + '/#promotion/' + encodeURIComponent(id);
  const w = window.open('', '_blank', 'width=360,height=460');

  if (!w) {
    alert('Allow pop-ups to display the QR code.');
    return;
  }

  w.document.write(`
    <title>Promotion QR</title>
    <body style="font:16px sans-serif;text-align:center;padding:25px">
      <h3>Baby Outlet Promotion</h3>
      <div id="q" style="display:flex;justify-content:center"></div>
      <p>Scan to view this promotion</p>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
      <script>
        new QRCode(document.getElementById('q'), {
          text: ${JSON.stringify(u)},
          width: 240,
          height: 240
        });
      <\/script>
    </body>
  `);
}

$('#refresh').onclick = adminLoad;

$('#download-master').onclick = () => {
  const c = $('#master-qr').querySelector('canvas');
  const im = $('#master-qr').querySelector('img');
  const src = c ? c.toDataURL('image/png') : im?.src;

  if (!src) return;

  const a = document.createElement('a');
  a.href = src;
  a.download = 'baby-outlet-master-qr.png';
  a.click();
};

loadPublic();

if (location.hash === '#promotions') {
  show('public-view');
}
