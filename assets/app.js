// 발주서 도우미 — 화면 동작
// 저장·조회는 전부 /api/data 가 한다. 이 파일에는 키나 비밀번호 값이 없다.
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 파일로 바로 열었거나 주소 끝에 ?demo 가 있으면 체험 모드 (이 브라우저에만 저장)
  const DEMO = location.protocol === 'file:' || new URLSearchParams(location.search).has('demo');
  const STATUSES = ['발주함', '납품·처리 완료'];
  const KIND_LABEL = { '주문': '비품·장비 주문', 'A/S': 'A/S 요청' };
  const KIND_SLUG = { order: '주문', as: 'A/S' };
  const PW_KEY = 'po_admin_pw';

  const state = { orders: [], vendors: [], settings: {}, filter: { q: '', kind: '', status: '' } };

  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fmtDate = (s) => (s ? String(s).slice(0, 10).replace(/-/g, '.') : '');

  const session = {
    get() { try { return sessionStorage.getItem(PW_KEY) || ''; } catch { return ''; } },
    set(v) { try { sessionStorage.setItem(PW_KEY, v); } catch { /* 저장 안 되는 브라우저 */ } },
    clear() { try { sessionStorage.removeItem(PW_KEY); } catch { /* 무시 */ } },
  };

  // ---------- 서버와 주고받기 ----------
  async function api(method, type, { id, body, pw } = {}) {
    if (DEMO) return demoApi(method, type, id, body);
    const q = new URLSearchParams({ type });
    if (id) q.set('id', id);
    const r = await fetch('/api/data?' + q, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw ?? session.get() },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = {};
    try { j = await r.json(); } catch { /* 빈 응답 */ }
    if (r.status === 401) {
      const e = new Error(j.error || '비밀번호가 맞지 않아요.');
      e.status = 401;
      throw e;
    }
    if (!r.ok) throw new Error(j.error || '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.');
    return j;
  }

  // 체험 모드: 서버와 같은 모양으로 답한다
  function demoApi(method, type, id, body) {
    const KEY = 'po_demo_data';
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch { db = null; }
    db = db || { seq: 1, orders: [], vendors: [], settings: {} };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 무시 */ } };
    const now = new Date().toISOString();
    const table = type === 'orders' ? db.orders : db.vendors;
    const sortOrders = () => db.orders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '') || b.id - a.id);
    return new Promise((ok) => setTimeout(() => {
      if (method === 'GET') {
        sortOrders();
        db.vendors.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        return ok({ orders: db.orders, vendors: db.vendors, settings: db.settings });
      }
      if (type === 'settings') { db.settings = { ...body, id: 1, updated_at: now }; save(); return ok({ row: db.settings }); }
      if (method === 'POST') {
        const row = { status: type === 'orders' ? '발주함' : undefined, ...body, id: db.seq++, created_at: now };
        table.push(row); save(); return ok({ row });
      }
      const i = table.findIndex((r) => r.id === Number(id));
      if (method === 'PATCH') { table[i] = { ...table[i], ...body, updated_at: now }; save(); return ok({ row: table[i] }); }
      if (method === 'DELETE') {
        table.splice(i, 1);
        db.orders.forEach((o) => { if (o.vendor_id === Number(id)) o.vendor_id = null; });
        save(); return ok({ ok: true });
      }
      return ok({});
    }, 120));
  }

  async function loadAll() {
    const j = await api('GET', 'all');
    state.orders = j.orders || [];
    state.vendors = j.vendors || [];
    state.settings = j.settings || {};
  }

  // ---------- 알림 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }
  function fail(e) {
    if (e && e.status === 401) { lock('비밀번호가 바뀌었거나 맞지 않아요. 다시 넣어 주세요.'); return; }
    toast(e && e.message ? e.message : '문제가 생겼어요.');
  }

  // ---------- 잠금 ----------
  function lock(msg) {
    session.clear();
    $('#shell').hidden = true;
    $('#lock').hidden = false;
    const m = $('#lockMsg');
    m.textContent = msg || '';
    m.hidden = !msg;
    const pw = $('#lockPw');
    pw.value = '';
    pw.focus();
  }

  async function unlock() {
    $('#lock').hidden = true;
    $('#shell').hidden = false;
    $('#demoBar').hidden = !DEMO;
    $('#app').innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      await loadAll();
      render();
    } catch (e) { fail(e); $('#app').innerHTML = '<p class="error">불러오지 못했어요. 새로고침해 주세요.</p>'; }
  }

  $('#lockForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('#lockPw').value;
    const btn = $('#lockForm button');
    btn.disabled = true;
    try {
      await api('GET', 'ping', { pw });
      session.set(pw);
      await unlock();
    } catch (e) {
      lock(e.status === 401 ? '비밀번호가 맞지 않아요.' : e.message);
    } finally { btn.disabled = false; }
  });

  // ---------- 화면 고르기 ----------
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    return { name: parts[0] || 'list', id: parts[1], q: new URLSearchParams(qs || '') };
  }

  function render() {
    const r = route();
    $$('.nav a').forEach((a) => a.classList.toggle('on',
      a.dataset.nav === (['vendors', 'settings'].includes(r.name) ? r.name : 'list')));
    const app = $('#app');
    window.scrollTo(0, 0);
    if (r.name === 'new') return viewForm(app, null, r.q);
    if (r.name === 'edit') return viewForm(app, findOrder(r.id), r.q);
    if (r.name === 'view') return viewOrder(app, findOrder(r.id), r.q);
    if (r.name === 'vendors') return viewVendors(app);
    if (r.name === 'settings') return viewSettings(app);
    return viewList(app);
  }
  const findOrder = (id) => state.orders.find((o) => String(o.id) === String(id));
  const findVendor = (id) => state.vendors.find((v) => String(v.id) === String(id));

  window.addEventListener('hashchange', () => { if (!$('#shell').hidden) render(); });

  // ---------- 발주 목록 ----------
  function summary(o) {
    if (o.kind === 'A/S') return `${o.equipment || ''} · ${o.issue || ''}`;
    const items = o.items || [];
    if (!items.length) return '';
    const first = [items[0].name, items[0].qty].filter(Boolean).join(' ');
    return items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;
  }

  function statusBtn(o) {
    const done = o.status === STATUSES[1];
    return `<button class="status ${done ? 'done' : 'pending'}" data-status="${o.id}" title="눌러서 상태 바꾸기">${esc(o.status)}</button>`;
  }

  async function toggleStatus(id) {
    const o = findOrder(id);
    if (!o) return;
    const next = o.status === STATUSES[0] ? STATUSES[1] : STATUSES[0];
    try {
      const { row } = await api('PATCH', 'orders', { id, body: { status: next } });
      Object.assign(o, row || { status: next });
      toast(`'${next}'(으)로 바꿨어요`);
      render();
    } catch (e) { fail(e); }
  }

  function viewList(app) {
    const s = state.settings;
    const f = state.filter;
    const pending = state.orders.filter((o) => o.status === STATUSES[0]).length;
    const needSettings = !s.company;

    app.innerHTML = `
      ${needSettings ? `<div class="notice">처음이면 <a href="#/settings">설정</a>에서 우리 회사 정보를 먼저 넣어 주세요. 발주서마다 자동으로 채워져요.</div>` : ''}
      <div class="make">
        <a href="#/new?kind=order"><strong>＋ 비품·장비 주문서</strong><span>품목·규격·수량을 적어 주문해요</span></a>
        <a class="alt" href="#/new?kind=as"><strong>＋ A/S 요청서</strong><span>장비와 고장 내용을 적어 요청해요</span></a>
      </div>
      <div class="stats">
        <div class="stat"><b>${pending}</b><span>처리 기다리는 발주</span></div>
        <div class="stat"><b>${state.orders.length}</b><span>전체 발주</span></div>
      </div>
      <div class="filters">
        <input id="q" type="search" placeholder="업체·품목·장비로 찾기" value="${esc(f.q)}">
      </div>
      <div class="filters">
        <div class="chips" data-group="kind">
          ${[['', '전체'], ['주문', '주문'], ['A/S', 'A/S']].map(([v, l]) => `<button class="chip ${f.kind === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}
        </div>
        <div class="chips" data-group="status">
          ${[['', '모든 상태'], ...STATUSES.map((x) => [x, x])].map(([v, l]) => `<button class="chip ${f.status === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div id="list" class="list"></div>`;

    const drawList = () => {
      const q = f.q.trim().toLowerCase();
      const rows = state.orders.filter((o) => {
        if (f.kind && o.kind !== f.kind) return false;
        if (f.status && o.status !== f.status) return false;
        if (!q) return true;
        const hay = [o.vendor_name, o.equipment, o.issue, o.memo, ...(o.items || []).map((i) => `${i.name} ${i.spec}`)].join(' ').toLowerCase();
        return hay.includes(q);
      });
      $('#list').innerHTML = rows.length ? rows.map((o) => `
        <div class="item">
          <a class="item-main" href="#/view/${o.id}">
            <div class="item-top">
              <span>${fmtDate(o.order_date)}</span>
              <span class="badge ${o.kind === 'A/S' ? 'as' : ''}">${esc(o.kind)}</span>
              <span>No. ${o.id}</span>
            </div>
            <div class="item-title">${esc(o.vendor_name)}</div>
            <div class="item-sub">${esc(summary(o))}</div>
          </a>
          ${statusBtn(o)}
        </div>`).join('')
        : `<div class="empty">${state.orders.length ? '찾는 발주서가 없어요.' : '아직 만든 발주서가 없어요.<br>위의 버튼으로 첫 발주서를 만들어 보세요.'}</div>`;
    };
    drawList();

    $('#q').addEventListener('input', (e) => { f.q = e.target.value; drawList(); });
    $$('.chips', app).forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      f[g.dataset.group] = b.dataset.v;
      $$('.chip', g).forEach((c) => c.classList.toggle('on', c === b));
      drawList();
    }));
  }

  // 상태 버튼은 목록·미리보기 어디서든 이 한 곳에서 처리
  $('#app').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) toggleStatus(b.dataset.status);
  });

  // ---------- 발주서 작성·고치기 ----------
  function viewForm(app, order, q) {
    const editing = !!order;
    if (q.get('kind') === null && !editing && !q.get('from')) { location.hash = '#/'; return; }
    const from = q.get('from') ? findOrder(q.get('from')) : null;
    const base = order || from;
    const s = state.settings;
    const d = {
      kind: base ? base.kind : (KIND_SLUG[q.get('kind')] || '주문'),
      order_date: editing ? order.order_date : today(),
      vendor_id: base ? base.vendor_id : null,
      vendor_name: base ? base.vendor_name : '',
      manager: base ? base.manager : (s.manager || ''),
      phone: base ? base.phone : (s.phone || ''),
      address: base ? base.address : (s.address || ''),
      items: base && base.items && base.items.length ? base.items : [{ name: '', spec: '', qty: '' }],
      equipment: base ? base.equipment : '',
      issue: base ? base.issue : '',
      memo: base ? base.memo : '',
    };
    // 거래처 목록에 있는 업체면 선택, 없으면 직접 입력
    const known = d.vendor_id && findVendor(d.vendor_id);
    const vSel = known ? String(d.vendor_id) : (d.vendor_name ? 'new' : (state.vendors.length ? '' : 'new'));

    app.innerHTML = `
      <div class="page-head">
        <h1>${editing ? `발주서 고치기 <span class="muted small">No. ${order.id}</span>` : '발주서 만들기'}</h1>
        <a class="btn ghost" href="${editing ? `#/view/${order.id}` : '#/'}">취소</a>
      </div>
      <form id="f" class="card stack" novalidate>
        <div class="row">
          <div class="seg" role="group" aria-label="종류">
            <button type="button" data-kind="주문">비품·장비 주문</button>
            <button type="button" data-kind="A/S">A/S 요청</button>
          </div>
        </div>
        <div class="grid2">
          <label class="field"><span>발주일</span><input name="order_date" type="date" value="${esc(d.order_date)}" required></label>
          <label class="field"><span>받는 업체</span>
            <select name="vendor_sel">
              <option value="" ${vSel === '' ? 'selected' : ''} disabled>업체를 골라 주세요</option>
              ${state.vendors.map((v) => `<option value="${v.id}" ${vSel === String(v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
              <option value="new" ${vSel === 'new' ? 'selected' : ''}>＋ 직접 입력 (새 업체)</option>
            </select>
          </label>
        </div>
        <div id="newVendor" class="grid2">
          <label class="field"><span>업체 이름</span><input name="vendor_name" value="${esc(known ? '' : d.vendor_name)}" placeholder="예: ○○상사"></label>
          <label class="check" style="align-self:end;min-height:44px"><input type="checkbox" name="save_vendor" ${editing ? '' : 'checked'}> 거래처 목록에도 저장</label>
        </div>

        <div id="orderPart" class="stack">
          <h2>주문 품목</h2>
          <table class="items-table">
            <thead><tr><th>품목</th><th>규격</th><th class="qty">수량</th><th></th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
          <button type="button" class="btn sm" id="addRow">＋ 품목 추가</button>
        </div>

        <div id="asPart" class="stack">
          <label class="field"><span>장비명</span><input name="equipment" value="${esc(d.equipment)}" placeholder="예: 업소용 냉장고 (모델명)"></label>
          <label class="field"><span>고장 내용</span><textarea name="issue" placeholder="언제부터, 어떤 증상인지 적어 주세요">${esc(d.issue)}</textarea></label>
        </div>

        <div class="grid2">
          <label class="field"><span>담당자</span><input name="manager" value="${esc(d.manager)}"></label>
          <label class="field"><span>연락처</span><input name="phone" type="tel" value="${esc(d.phone)}"></label>
        </div>
        <label class="field"><span id="addrLabel">배송지</span><input name="address" value="${esc(d.address)}"></label>
        <label class="field"><span>요청사항 <em>(선택)</em></span><textarea name="memo" style="min-height:72px">${esc(d.memo)}</textarea></label>
        <p id="formMsg" class="error" role="alert" hidden></p>
        <div class="row end">
          <button class="btn primary" type="submit">${editing ? '고친 내용 저장' : '저장하고 미리보기'}</button>
        </div>
      </form>`;

    const f = $('#f');
    let kind = d.kind;

    const rowHtml = (it = {}) => `<tr>
      <td><input data-k="name" value="${esc(it.name)}" placeholder="품목" aria-label="품목"></td>
      <td><input data-k="spec" value="${esc(it.spec)}" placeholder="규격" aria-label="규격"></td>
      <td><input data-k="qty" class="qty" value="${esc(it.qty)}" placeholder="수량" aria-label="수량"></td>
      <td><button type="button" class="icon-btn" data-del title="이 줄 지우기" aria-label="이 줄 지우기">×</button></td>
    </tr>`;
    $('#rows').innerHTML = d.items.map(rowHtml).join('');
    $('#addRow').addEventListener('click', () => {
      $('#rows').insertAdjacentHTML('beforeend', rowHtml());
      $('#rows tr:last-child input').focus();
    });
    $('#rows').addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      const tr = e.target.closest('tr');
      if ($$('#rows tr').length > 1) tr.remove();
      else $$('input', tr).forEach((i) => { i.value = ''; });
    });

    const setKind = (k) => {
      kind = k;
      $$('.seg button', f).forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
      $('#orderPart').hidden = k !== '주문';
      $('#asPart').hidden = k !== 'A/S';
      $('#addrLabel').textContent = k === 'A/S' ? '방문 주소' : '배송지';
    };
    $$('.seg button', f).forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    setKind(kind);

    const syncVendor = () => { $('#newVendor').hidden = f.vendor_sel.value !== 'new'; };
    f.vendor_sel.addEventListener('change', syncVendor);
    syncVendor();

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = $('#formMsg');
      const say = (t) => { msg.textContent = t; msg.hidden = !t; };
      say('');
      const sel = f.vendor_sel.value;
      const isNew = sel === 'new';
      const vendorName = isNew ? f.vendor_name.value.trim() : (findVendor(sel) || {}).name;
      const items = $$('#rows tr').map((tr) => ({
        name: $('[data-k=name]', tr).value.trim(),
        spec: $('[data-k=spec]', tr).value.trim(),
        qty: $('[data-k=qty]', tr).value.trim(),
      })).filter((i) => i.name || i.spec || i.qty);

      if (!f.order_date.value) return say('발주일을 골라 주세요.');
      if (!vendorName) return say('받는 업체를 골라 주거나 이름을 적어 주세요.');
      if (kind === '주문' && !items.some((i) => i.name)) return say('품목을 하나 이상 적어 주세요.');
      if (kind === '주문' && items.some((i) => !i.name)) return say('품목 이름이 빈 줄이 있어요.');
      if (kind === 'A/S' && (!f.equipment.value.trim() || !f.issue.value.trim())) return say('장비명과 고장 내용을 적어 주세요.');

      const btn = $('button[type=submit]', f);
      btn.disabled = true;
      try {
        let vendorId = isNew ? null : Number(sel);
        if (isNew && f.save_vendor.checked) {
          const same = state.vendors.find((v) => v.name === vendorName);
          if (same) vendorId = same.id;
          else {
            const { row } = await api('POST', 'vendors', { body: { name: vendorName } });
            state.vendors.push(row);
            vendorId = row.id;
          }
        }
        const body = {
          kind,
          order_date: f.order_date.value,
          vendor_id: vendorId,
          vendor_name: vendorName,
          manager: f.manager.value.trim(),
          phone: f.phone.value.trim(),
          address: f.address.value.trim(),
          memo: f.memo.value.trim(),
          items: kind === '주문' ? items : [],
          equipment: kind === 'A/S' ? f.equipment.value.trim() : '',
          issue: kind === 'A/S' ? f.issue.value.trim() : '',
        };
        if (editing) {
          const { row } = await api('PATCH', 'orders', { id: order.id, body });
          Object.assign(order, row || body);
          toast('고친 내용을 저장했어요');
          location.hash = `#/view/${order.id}`;
        } else {
          const { row } = await api('POST', 'orders', { body });
          state.orders.unshift(row);
          toast('저장했어요');
          location.hash = `#/view/${row.id}`;
        }
      } catch (e) { fail(e); say(e.message); } finally { btn.disabled = false; }
    });
  }

  // ---------- 미리보기 (문서형 / 문자형) ----------
  function docHtml(o) {
    const s = state.settings;
    const v = findVendor(o.vendor_id) || {};
    const isAS = o.kind === 'A/S';
    const title = isAS ? 'A/S 요청서' : '발주서';
    const lines = (o.items || []).map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td class="c">${esc(it.qty)}</td></tr>`).join('');
    return `<div class="doc">
      <h1>${title}</h1>
      <div class="doc-no">No. ${o.id} · 발주일 ${fmtDate(o.order_date)}</div>
      <div class="parties">
        <div>
          <h3>받는 곳</h3>
          <table>
            <tr><th>업체명</th><td>${esc(o.vendor_name)} 귀하</td></tr>
            ${v.contact_person ? `<tr><th>담당자</th><td>${esc(v.contact_person)}</td></tr>` : ''}
            ${v.phone ? `<tr><th>연락처</th><td>${esc(v.phone)}</td></tr>` : ''}
          </table>
        </div>
        <div>
          <h3>보내는 곳</h3>
          <table>
            <tr><th>회사명</th><td>${esc(s.company || '')}</td></tr>
            <tr><th>담당자</th><td>${esc(o.manager)}</td></tr>
            <tr><th>연락처</th><td>${esc(o.phone)}</td></tr>
          </table>
        </div>
      </div>
      ${isAS ? `
        <table>
          <tr><th>장비명</th><td>${esc(o.equipment)}</td></tr>
          <tr><th>고장 내용</th><td class="pre">${esc(o.issue)}</td></tr>
          <tr><th>방문 주소</th><td>${esc(o.address)}</td></tr>
          ${o.memo ? `<tr><th>요청사항</th><td class="pre">${esc(o.memo)}</td></tr>` : ''}
        </table>
        <p class="closing">위와 같이 A/S를 요청합니다.</p>` : `
        <div class="section-title">주문 품목</div>
        <table class="lines">
          <thead><tr><th style="width:48px">No</th><th>품목</th><th>규격</th><th style="width:96px">수량</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <table style="margin-top:12px">
          <tr><th>배송지</th><td>${esc(o.address)}</td></tr>
          ${o.memo ? `<tr><th>요청사항</th><td class="pre">${esc(o.memo)}</td></tr>` : ''}
        </table>
        <p class="closing">위와 같이 발주합니다.</p>`}
    </div>`;
  }

  function textOut(o) {
    const s = state.settings;
    const isAS = o.kind === 'A/S';
    const from = [s.company, o.manager, o.phone].filter(Boolean).join(' / ');
    const out = [
      `[${isAS ? 'A/S 요청서' : '발주서'}] No. ${o.id}`,
      `발주일: ${fmtDate(o.order_date)}`,
      `받는 곳: ${o.vendor_name}`,
      `보내는 곳: ${from}`,
      '',
    ];
    if (isAS) {
      out.push(`■ 장비명: ${o.equipment}`, '■ 고장 내용:', o.issue, '', `■ 방문 주소: ${o.address}`);
    } else {
      out.push('■ 주문 품목');
      (o.items || []).forEach((it, i) => out.push(`${i + 1}. ${[it.name, it.spec, it.qty].filter(Boolean).join(' / ')}`));
      out.push('', `■ 배송지: ${o.address}`);
    }
    if (o.memo) out.push('', '■ 요청사항:', o.memo);
    out.push('', isAS ? '확인 후 방문 일정 알려 주시면 감사하겠습니다.' : '확인 부탁드립니다. 감사합니다.');
    return out.join('\n');
  }

  async function copyText(text, ta) {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했어요. 카톡·문자에 붙여넣으세요');
    } catch {
      ta.focus();
      ta.select();
      toast('글이 선택됐어요. 길게 눌러 복사해 주세요');
    }
  }

  function viewOrder(app, o, q) {
    if (!o) { app.innerHTML = '<div class="empty">발주서를 찾지 못했어요. <a href="#/">목록으로</a></div>'; return; }
    const v = findVendor(o.vendor_id) || {};
    let tab = q.get('tab') || (v.prefer === '문자' ? 'text' : 'doc');
    app.innerHTML = `
      <div class="page-head">
        <div>
          <a href="#/" class="small">← 발주 목록</a>
          <h1>${esc(o.vendor_name)} <span class="muted small">${esc(KIND_LABEL[o.kind] || o.kind)}</span></h1>
        </div>
        <div class="row">
          ${statusBtn(o)}
          <a class="btn sm" href="#/edit/${o.id}">고치기</a>
          <a class="btn sm" href="#/new?from=${o.id}">같은 내용으로 새로</a>
        </div>
      </div>
      ${v.prefer ? `<p class="muted small print-hide">이 업체는 <b>${v.prefer === '문자' ? '카톡·문자' : '문서(인쇄·PDF)'}</b>로 받기를 원해요.</p>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="doc" role="tab">문서형 (인쇄·PDF)</button>
        <button data-tab="text" role="tab">문자형 (카톡·문자)</button>
      </div>
      <div id="tabDoc">
        <div class="row end print-hide" style="margin-bottom:12px">
          <span class="muted small spacer">PDF로 저장하려면 인쇄 창에서 'PDF로 저장'을 고르세요.</span>
          <button class="btn primary" id="printBtn">인쇄 · PDF 저장</button>
        </div>
        <div class="paper-wrap">${docHtml(o)}</div>
      </div>
      <div id="tabText" class="stack">
        <textarea class="text-out" id="textOut" readonly>${esc(textOut(o))}</textarea>
        <div class="row end"><button class="btn primary" id="copyBtn">글 복사하기</button></div>
      </div>`;

    const setTab = (t) => {
      tab = t;
      $$('.tabs button', app).forEach((b) => {
        b.classList.toggle('on', b.dataset.tab === t);
        b.setAttribute('aria-selected', b.dataset.tab === t);
      });
      $('#tabDoc').hidden = t !== 'doc';
      $('#tabText').hidden = t !== 'text';
    };
    $$('.tabs button', app).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    setTab(tab);
    $('#printBtn').addEventListener('click', () => window.print());
    $('#copyBtn').addEventListener('click', () => copyText($('#textOut').value, $('#textOut')));
  }

  // ---------- 거래처 ----------
  function viewVendors(app) {
    const count = (id) => state.orders.filter((o) => o.vendor_id === id).length;
    app.innerHTML = `
      <div class="page-head"><h1>거래처</h1></div>
      <form id="vf" class="card stack" novalidate>
        <h2 id="vfTitle">새 거래처</h2>
        <div class="grid2">
          <label class="field"><span>업체 이름</span><input name="name" required placeholder="예: ○○상사"></label>
          <label class="field"><span>업체 담당자 <em>(선택)</em></span><input name="contact_person"></label>
          <label class="field"><span>연락처 <em>(선택)</em></span><input name="phone" type="tel"></label>
          <label class="field"><span>받는 방식</span>
            <select name="prefer">
              <option value="">정하지 않음</option>
              <option value="문서">문서 (인쇄·PDF)</option>
              <option value="문자">카톡·문자</option>
            </select>
          </label>
        </div>
        <label class="field"><span>메모 <em>(선택)</em></span><input name="memo" placeholder="예: 오전 주문은 당일 배송"></label>
        <p id="vfMsg" class="error" role="alert" hidden></p>
        <div class="row end">
          <button type="button" class="btn ghost" id="vfCancel" hidden>취소</button>
          <button class="btn primary" type="submit">저장</button>
        </div>
      </form>
      <div id="vlist" class="list" style="margin-top:16px">
        ${state.vendors.length ? state.vendors.map((v) => `
          <div class="item vendor">
            <div class="grow">
              <div class="item-title">${esc(v.name)} ${v.prefer ? `<span class="badge">${v.prefer === '문자' ? '카톡·문자' : '문서'}</span>` : ''}</div>
              <div class="item-sub">${esc([v.contact_person, v.phone].filter(Boolean).join(' · ') || '연락처 없음')}</div>
              ${v.memo ? `<div class="muted small">${esc(v.memo)}</div>` : ''}
              <div class="muted small">발주 ${count(v.id)}건</div>
            </div>
            <div class="row">
              <button class="btn sm" data-edit="${v.id}">고치기</button>
              <button class="btn sm danger" data-del="${v.id}">지우기</button>
            </div>
          </div>`).join('') : '<div class="empty">저장한 거래처가 없어요.</div>'}
      </div>`;

    const f = $('#vf');
    let editId = null;
    const reset = () => {
      editId = null;
      f.reset();
      $('#vfTitle').textContent = '새 거래처';
      $('#vfCancel').hidden = true;
    };
    $('#vfCancel').addEventListener('click', reset);

    $('#vlist').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (ed) {
        const v = findVendor(ed.dataset.edit);
        editId = v.id;
        ['name', 'contact_person', 'phone', 'prefer', 'memo'].forEach((k) => { f[k].value = v[k] || ''; });
        $('#vfTitle').textContent = `거래처 고치기 — ${v.name}`;
        $('#vfCancel').hidden = false;
        f.scrollIntoView({ behavior: 'smooth' });
        f.name.focus();
      }
      if (del) {
        const v = findVendor(del.dataset.del);
        if (!confirm(`'${v.name}'을(를) 거래처 목록에서 지울까요?\n이미 만든 발주서는 그대로 남아요.`)) return;
        try {
          await api('DELETE', 'vendors', { id: v.id });
          state.vendors = state.vendors.filter((x) => x.id !== v.id);
          state.orders.forEach((o) => { if (o.vendor_id === v.id) o.vendor_id = null; });
          toast('지웠어요');
          render();
        } catch (err) { fail(err); }
      }
    });

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = $('#vfMsg');
      const body = {
        name: f.name.value.trim(),
        contact_person: f.contact_person.value.trim(),
        phone: f.phone.value.trim(),
        prefer: f.prefer.value,
        memo: f.memo.value.trim(),
      };
      if (!body.name) { msg.textContent = '업체 이름을 적어 주세요.'; msg.hidden = false; return; }
      msg.hidden = true;
      try {
        if (editId) {
          const { row } = await api('PATCH', 'vendors', { id: editId, body });
          Object.assign(findVendor(editId), row || body);
        } else {
          const { row } = await api('POST', 'vendors', { body });
          state.vendors.push(row);
        }
        state.vendors.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        toast('저장했어요');
        render();
      } catch (err) { fail(err); msg.textContent = err.message; msg.hidden = false; }
    });
  }

  // ---------- 설정 ----------
  function viewSettings(app) {
    const s = state.settings;
    app.innerHTML = `
      <div class="page-head"><h1>설정</h1></div>
      <form id="sf" class="card stack" novalidate>
        <h2>우리 회사 정보</h2>
        <p class="muted small" style="margin-top:4px">여기 적은 내용이 새 발주서에 자동으로 채워져요. 발주서마다 고칠 수도 있어요.</p>
        <div class="grid2">
          <label class="field"><span>회사명</span><input name="company" value="${esc(s.company)}"></label>
          <label class="field"><span>담당자</span><input name="manager" value="${esc(s.manager)}"></label>
          <label class="field"><span>연락처</span><input name="phone" type="tel" value="${esc(s.phone)}"></label>
        </div>
        <label class="field"><span>기본 배송지</span><input name="address" value="${esc(s.address)}"></label>
        <div class="row end"><button class="btn primary" type="submit">저장</button></div>
      </form>
      <div class="row" style="margin-top:20px">
        <span class="spacer"></span>
        <button class="btn ghost" id="logout">${DEMO ? '체험 데이터 모두 비우기' : '잠그기 (로그아웃)'}</button>
      </div>`;

    const f = $('#sf');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = {
        company: f.company.value.trim(),
        manager: f.manager.value.trim(),
        phone: f.phone.value.trim(),
        address: f.address.value.trim(),
      };
      try {
        const { row } = await api('PUT', 'settings', { body });
        state.settings = row || body;
        toast('저장했어요');
      } catch (err) { fail(err); }
    });
    $('#logout').addEventListener('click', async () => {
      if (DEMO) {
        if (!confirm('체험으로 넣은 내용을 모두 비울까요?')) return;
        try { localStorage.removeItem('po_demo_data'); } catch { /* 무시 */ }
        await loadAll();
        location.hash = '#/';
        render();
        return;
      }
      lock();
    });
  }

  // ---------- 시작 ----------
  if (DEMO || session.get()) unlock();
  else lock();
})();
