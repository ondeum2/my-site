// 발주서 도우미 — 화면 동작
// 저장·조회는 전부 /api/balju 가 한다. 이 파일에는 키나 비밀번호 값이 없다.
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
  const MAX_FARMS = 5;

  const state = { orders: [], vendors: [], settings: { farms: [] }, filter: { q: '', kind: '', status: '' } };

  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fmtDate = (s) => (s ? String(s).slice(0, 10).replace(/-/g, '.') : '');
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

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
    const r = await fetch('/api/balju?' + q, {
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
    return new Promise((ok) => setTimeout(() => {
      if (method === 'GET') {
        db.orders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '') || b.id - a.id);
        db.vendors.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        return ok({ orders: db.orders, vendors: db.vendors, settings: db.settings });
      }
      if (type === 'settings') { db.settings = { ...body, id: 1, updated_at: now }; save(); return ok({ row: db.settings }); }
      if (method === 'POST') {
        const row = { ...(type === 'orders' ? { status: '발주함' } : { catalog: [], prepaid: false }), ...body, id: db.seq++, created_at: now };
        table.push(row); save(); return ok({ row });
      }
      const i = table.findIndex((r) => r.id === Number(id));
      if (method === 'PATCH') { table[i] = { ...table[i], ...body, updated_at: now }; save(); return ok({ row: table[i] }); }
      if (method === 'DELETE') {
        table.splice(i, 1);
        if (type === 'vendors') db.orders.forEach((o) => { if (o.vendor_id === Number(id)) o.vendor_id = null; });
        save(); return ok({ ok: true });
      }
      return ok({});
    }, 120));
  }

  // 예전 설정(회사 하나)도 '회사 정보 5곳' 모양으로 맞춘다
  function normalizeSettings(s) {
    s = s || {};
    let farms = Array.isArray(s.farms) ? s.farms.filter((x) => x && x.name) : [];
    if (!farms.length && s.company) farms = [{ name: s.company, manager: s.manager || '', phone: s.phone || '', address: s.address || '' }];
    return { ...s, farms };
  }

  async function loadAll() {
    const j = await api('GET', 'all');
    state.orders = j.orders || [];
    state.vendors = (j.vendors || []).map((v) => ({ catalog: [], prepaid: false, ...v, catalog: Array.isArray(v.catalog) ? v.catalog : [] }));
    state.settings = normalizeSettings(j.settings);
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

  // 선입업체 메모: 노란 별 + 빨간 굵은 글씨
  function vendorMemo(v) {
    if (!v) return '';
    if (v.prepaid) return `<span class="prepaid"><span class="star" aria-hidden="true">★</span>${esc(v.memo || '선입업체')}</span>`;
    return v.memo ? `<span class="muted">${esc(v.memo)}</span>` : '';
  }

  // ---------- 발주 목록 ----------
  function summary(o) {
    if (o.kind === 'A/S') return `${o.equipment || ''} · ${o.issue || ''}`;
    const items = o.items || [];
    if (!items.length) return '';
    const first = [items[0].name, items[0].spec, items[0].qty].filter(Boolean).join(' ');
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

  async function deleteOrder(id) {
    const o = findOrder(id);
    if (!o) return false;
    if (!confirm(`이 발주서를 지울까요?

${fmtDate(o.order_date)} · ${o.vendor_name} · ${summary(o)}

지우면 되돌릴 수 없어요.`)) return false;
    try {
      await api('DELETE', 'orders', { id: o.id });
      state.orders = state.orders.filter((x) => x.id !== o.id);
      toast('발주서를 지웠어요');
      return true;
    } catch (e) { fail(e); return false; }
  }

  function viewList(app) {
    const f = state.filter;
    const pending = state.orders.filter((o) => o.status === STATUSES[0]).length;
    const needSettings = !state.settings.farms.length;

    app.innerHTML = `
      ${needSettings ? `<div class="notice">처음이면 <a href="#/settings">설정</a>에서 우리 회사(농장) 정보를 먼저 넣어 주세요. 발주서마다 자동으로 채워져요.</div>` : ''}
      <div class="hero">
        <p class="eyebrow">Purchase Order</p>
        <h1>오늘 보낼 발주서를 만드세요</h1>
      </div>
      <div class="make">
        <a href="#/new?kind=order"><strong>비품·장비 주문서</strong><span>품목·규격·수량을 적어 주문해요</span><i aria-hidden="true">→</i></a>
        <a class="alt" href="#/new?kind=as"><strong>A/S 요청서</strong><span>장비와 고장 내용을 적어 요청해요</span><i aria-hidden="true">→</i></a>
      </div>
      <div class="stats">
        <div class="stat"><b>${pending}</b><span>처리 기다리는 발주</span></div>
        <div class="stat"><b>${state.orders.length}</b><span>전체 발주</span></div>
      </div>
      <div class="filters">
        <input id="q" type="search" placeholder="업체·농장·품목·장비로 찾기" value="${esc(f.q)}">
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
        const hay = [o.vendor_name, o.farm_name, o.equipment, o.issue, o.memo, ...(o.items || []).map((i) => `${i.name} ${i.spec}`)].join(' ').toLowerCase();
        return hay.includes(q);
      });
      $('#list').innerHTML = rows.length ? rows.map((o) => `
        <div class="item">
          <a class="item-main" href="#/view/${o.id}">
            <div class="item-top">
              <span>${fmtDate(o.order_date)}</span>
              <span class="badge ${o.kind === 'A/S' ? 'as' : ''}">${esc(o.kind)}</span>
              ${o.farm_name ? `<span>${esc(o.farm_name)}</span>` : ''}
              <span>No. ${o.id}</span>
            </div>
            <div class="item-title">${esc(o.vendor_name)}</div>
            <div class="item-sub">${esc(summary(o))}</div>
          </a>
          <div class="item-actions">
            ${statusBtn(o)}
            <button class="btn sm ghost danger" data-odel="${o.id}" title="이 발주서 지우기">지우기</button>
          </div>
        </div>`).join('')
        : `<div class="empty">${state.orders.length ? '찾는 발주서가 없어요.' : '아직 만든 발주서가 없어요.<br>위의 버튼으로 첫 발주서를 만들어 보세요.'}</div>`;
    };
    drawList();
    $('#list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-odel]');
      if (b && await deleteOrder(b.dataset.odel)) render();
    });

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
    const farms = state.settings.farms;
    const firstFarm = farms[0] || {};
    const d = {
      kind: base ? base.kind : (KIND_SLUG[q.get('kind')] || '주문'),
      order_date: editing ? order.order_date : today(),
      vendor_id: base ? base.vendor_id : null,
      vendor_name: base ? base.vendor_name : '',
      farm_name: base ? (base.farm_name || '') : (firstFarm.name || ''),
      manager: base ? base.manager : (firstFarm.manager || ''),
      phone: base ? base.phone : (firstFarm.phone || ''),
      address: base ? base.address : (firstFarm.address || ''),
      items: base && base.items ? base.items.map((i) => ({ ...i })) : [],
      equipment: base ? base.equipment : '',
      issue: base ? base.issue : '',
      memo: base ? base.memo : '',
    };
    // 거래처 목록에 있는 업체면 선택, 없으면 직접 입력
    const known = d.vendor_id && findVendor(d.vendor_id);
    const vSel = known ? String(d.vendor_id) : (d.vendor_name ? 'new' : (state.vendors.length ? '' : 'new'));
    // 등록된 농장이면 선택, 아니면 직접 입력
    const farmIdx = farms.findIndex((x) => x.name === d.farm_name);
    const fSel = farmIdx >= 0 ? String(farmIdx) : (d.farm_name || !farms.length ? 'new' : '0');

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
              ${state.vendors.map((v) => `<option value="${v.id}" ${vSel === String(v.id) ? 'selected' : ''}>${v.prepaid ? '★ ' : ''}${esc(v.name)}</option>`).join('')}
              <option value="new" ${vSel === 'new' ? 'selected' : ''}>＋ 직접 입력 (새 업체)</option>
            </select>
          </label>
        </div>
        <p id="vendorNote" class="vendor-note" hidden></p>
        <div id="newVendor" class="grid2">
          <label class="field"><span>업체 이름</span><input name="vendor_name" value="${esc(known ? '' : d.vendor_name)}" placeholder="예: ○○상사"></label>
          <label class="check" style="align-self:end;min-height:44px"><input type="checkbox" name="save_vendor" ${editing ? '' : 'checked'}> 거래처 목록에도 저장</label>
        </div>

        <div id="orderPart" class="stack">
          <h2>주문 품목</h2>
          <div class="entry" id="entry">
            <div class="combo"><input data-e="name" placeholder="품목" aria-label="품목" autocomplete="off"><ul class="combo-list" data-for="name" hidden></ul></div>
            <div class="combo"><input data-e="spec" placeholder="규격" aria-label="규격" autocomplete="off"><ul class="combo-list" data-for="spec" hidden></ul></div>
            <input data-e="qty" placeholder="수량" aria-label="수량" autocomplete="off">
            <button type="button" class="btn" id="addItem">추가</button>
          </div>
          <p class="muted small hint">한 줄 쓰고 <kbd>Enter</kbd>를 누르면 아래에 쌓여요. 품목은 그대로 남으니 규격·수량만 바꿔 다시 <kbd>Enter</kbd>.</p>
          <table class="items-table">
            <thead><tr><th class="no">No</th><th>품목</th><th>규격</th><th class="qty">수량</th><th></th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
          <p id="noItems" class="empty small">아직 담긴 품목이 없어요.</p>
        </div>

        <div id="asPart" class="stack">
          <label class="field"><span>장비명</span><input name="equipment" value="${esc(d.equipment)}" placeholder="예: 업소용 냉장고 (모델명)"></label>
          <label class="field"><span>고장 내용</span><textarea name="issue" placeholder="언제부터, 어떤 증상인지 적어 주세요">${esc(d.issue)}</textarea></label>
        </div>

        <div class="divider"></div>
        <label class="field"><span>농장명</span>
          <select name="farm_sel">
            ${farms.map((x, i) => `<option value="${i}" ${fSel === String(i) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            <option value="new" ${fSel === 'new' ? 'selected' : ''}>＋ 직접 입력</option>
          </select>
        </label>
        <label class="field" id="farmNameWrap"><span>농장명 직접 입력</span><input name="farm_name" value="${esc(farmIdx >= 0 ? '' : d.farm_name)}"></label>
        <label class="field"><span id="addrLabel">배송지</span><input name="address" value="${esc(d.address)}"></label>
        <div class="grid2">
          <label class="field"><span>담당자</span><input name="manager" value="${esc(d.manager)}"></label>
          <label class="field"><span>연락처</span><input name="phone" type="tel" value="${esc(d.phone)}"></label>
        </div>
        <label class="field"><span>요청사항 <em>(선택)</em></span><textarea name="memo" style="min-height:72px">${esc(d.memo)}</textarea></label>
        <p id="formMsg" class="error" role="alert" hidden></p>
        <div class="row end">
          <button class="btn primary" type="submit">${editing ? '고친 내용 저장' : '저장하고 미리보기'}</button>
        </div>
      </form>`;

    const f = $('#f');
    let kind = d.kind;
    const items = d.items;
    const entry = (k) => $(`#entry [data-e=${k}]`);

    // --- 받는 업체 ---
    const curVendor = () => (f.vendor_sel.value && f.vendor_sel.value !== 'new' ? findVendor(f.vendor_sel.value) : null);
    // 콤보박스 목록: 고른 업체의 카탈로그 (업체를 안 골랐으면 모든 업체 카탈로그)
    const catalog = () => {
      const v = curVendor();
      return v ? v.catalog : state.vendors.flatMap((x) => x.catalog || []);
    };
    // 콤보박스: 칸을 누르면 고른 업체의 품목(또는 그 품목의 규격) 목록이 펼쳐진다
    const options = (k) => {
      const cat = catalog();
      const n = entry('name').value.trim();
      if (k === 'name') {
        const q = n.toLowerCase();
        const names = uniq(cat.map((c) => c.name));
        const hit = names.filter((x) => x.toLowerCase().includes(q));
        return hit.length ? hit : names;
      }
      const specs = uniq(cat.filter((c) => !n || c.name === n).map((c) => c.spec));
      const q = entry('spec').value.trim().toLowerCase();
      const hit = specs.filter((x) => x.toLowerCase().includes(q));
      return hit.length ? hit : specs;
    };
    const openCombo = (k) => {
      const ul = $(`.combo-list[data-for=${k}]`, f);
      const list = options(k);
      if (!list.length) { ul.hidden = true; return; }
      ul.innerHTML = list.map((x) => `<li data-v="${esc(x)}">${esc(x)}</li>`).join('');
      ul.hidden = false;
    };
    const closeCombos = () => $$('.combo-list', f).forEach((ul) => { ul.hidden = true; });
    ['name', 'spec'].forEach((k) => {
      entry(k).addEventListener('focus', () => openCombo(k));
      entry(k).addEventListener('click', () => openCombo(k));
      entry(k).addEventListener('input', () => openCombo(k));
      entry(k).addEventListener('blur', () => setTimeout(() => { $(`.combo-list[data-for=${k}]`, f).hidden = true; }, 150));
    });
    $$('.combo-list', f).forEach((ul) => ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      const k = ul.dataset.for;
      entry(k).value = li.dataset.v;
      ul.hidden = true;
      // 품목을 고르면 규격으로, 규격을 고르면 수량으로
      const next = k === 'name' ? 'spec' : 'qty';
      if (k === 'name') entry('spec').value = '';
      entry(next).focus();
      if (k === 'name') openCombo('spec');
    }));
    const syncVendor = () => {
      $('#newVendor').hidden = f.vendor_sel.value !== 'new';
      const v = curVendor();
      const note = $('#vendorNote');
      note.innerHTML = vendorMemo(v);
      note.hidden = !note.innerHTML;
      closeCombos();
    };
    f.vendor_sel.addEventListener('change', syncVendor);

    // --- 주문 품목 쌓기 ---
    const drawItems = () => {
      $('#rows').innerHTML = items.map((it, i) => `<tr data-i="${i}">
        <td class="no">${i + 1}</td>
        <td><input data-k="name" value="${esc(it.name)}" aria-label="품목"></td>
        <td><input data-k="spec" value="${esc(it.spec)}" aria-label="규격"></td>
        <td><input data-k="qty" class="qty" value="${esc(it.qty)}" aria-label="수량"></td>
        <td><button type="button" class="icon-btn" data-del title="이 줄 지우기" aria-label="이 줄 지우기">×</button></td>
      </tr>`).join('');
      $('#noItems').hidden = items.length > 0;
    };
    let lastItemName = '';
    // fromSubmit: 저장 버튼으로 불렸을 때는 방금 쌓고 남겨 둔 품목 이름만 있으면 다시 담지 않는다
    const addEntry = (fromSubmit) => {
      const it = { name: entry('name').value.trim(), spec: entry('spec').value.trim(), qty: entry('qty').value.trim() };
      if (!it.name && !it.spec && !it.qty) return false;
      if (fromSubmit === true && !it.spec && !it.qty && it.name === lastItemName) return false;
      if (!it.name) { entry('name').focus(); toast('품목을 적어 주세요'); return false; }
      items.push(it);
      lastItemName = it.name;
      drawItems();
      // 품목은 남겨 두고 규격·수량만 비운다
      entry('spec').value = '';
      entry('qty').value = '';
      entry('spec').focus();
      closeCombos();
      return true;
    };
    $('#addItem').addEventListener('click', () => addEntry());
    $('#rows').addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (tr && e.target.dataset.k) items[Number(tr.dataset.i)][e.target.dataset.k] = e.target.value;
    });
    $('#rows').addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      items.splice(Number(e.target.closest('tr').dataset.i), 1);
      drawItems();
    });
    // Enter: 입력 줄에서는 쌓기, 다른 칸에서는 실수로 저장되지 않게 막기
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (e.target.closest('#entry')) addEntry();
    });

    // --- 종류 ---
    const setKind = (k) => {
      kind = k;
      $$('.seg button', f).forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
      $('#orderPart').hidden = k !== '주문';
      $('#asPart').hidden = k !== 'A/S';
      $('#addrLabel').textContent = k === 'A/S' ? '방문 주소' : '배송지';
    };
    $$('.seg button', f).forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));

    // --- 농장명: 고르면 배송지·담당자·연락처 자동 채움 ---
    const syncFarm = (fill) => {
      const v = f.farm_sel.value;
      $('#farmNameWrap').hidden = v !== 'new';
      if (fill && v !== 'new') {
        const x = farms[Number(v)];
        f.address.value = x.address || '';
        f.manager.value = x.manager || '';
        f.phone.value = x.phone || '';
      }
    };
    f.farm_sel.addEventListener('change', () => syncFarm(true));

    setKind(kind);
    syncVendor();
    syncFarm(false);
    drawItems();

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = $('#formMsg');
      const say = (t) => { msg.textContent = t; msg.hidden = !t; };
      say('');
      if (kind === '주문') addEntry(true); // 입력 줄에 남은 내용도 담기
      const sel = f.vendor_sel.value;
      const isNew = sel === 'new';
      const vendorName = isNew ? f.vendor_name.value.trim() : (findVendor(sel) || {}).name;
      const farmName = f.farm_sel.value === 'new' ? f.farm_name.value.trim() : (farms[Number(f.farm_sel.value)] || {}).name;
      const list = items.map((i) => ({ name: (i.name || '').trim(), spec: (i.spec || '').trim(), qty: (i.qty || '').trim() }))
        .filter((i) => i.name || i.spec || i.qty);

      if (!f.order_date.value) return say('발주일을 골라 주세요.');
      if (!vendorName) return say('받는 업체를 골라 주거나 이름을 적어 주세요.');
      if (kind === '주문' && !list.length) return say('품목을 하나 이상 담아 주세요.');
      if (kind === '주문' && list.some((i) => !i.name)) return say('품목 이름이 빈 줄이 있어요.');
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
            state.vendors.push({ catalog: [], ...row });
            vendorId = row.id;
          }
        }
        const body = {
          kind,
          order_date: f.order_date.value,
          vendor_id: vendorId,
          vendor_name: vendorName,
          farm_name: farmName || '',
          manager: f.manager.value.trim(),
          phone: f.phone.value.trim(),
          address: f.address.value.trim(),
          memo: f.memo.value.trim(),
          items: kind === '주문' ? list : [],
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
    const v = findVendor(o.vendor_id) || {};
    const isAS = o.kind === 'A/S';
    const title = isAS ? 'A/S 요청서' : '발주서';
    const lines = (o.items || []).map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td class="c">${esc(it.qty)}</td></tr>`).join('');
    return `<div class="doc">
      <div class="doc-head">
        <div>
          <p class="doc-eyebrow">${isAS ? 'AFTER-SALES SERVICE REQUEST' : 'PURCHASE ORDER'}</p>
          <h1>${title}</h1>
        </div>
        <dl class="doc-meta">
          <div><dt>No.</dt><dd>${o.id}</dd></div>
          <div><dt>발주일</dt><dd>${fmtDate(o.order_date)}</dd></div>
        </dl>
      </div>
      <div class="parties">
        <div class="party">
          <h3>받는 곳</h3>
          <p class="party-name">${esc(o.vendor_name)} <small>귀하</small></p>
          ${v.contact_person ? `<p>담당 ${esc(v.contact_person)}</p>` : ''}
          ${v.phone ? `<p>${esc(v.phone)}</p>` : ''}
        </div>
        <div class="party">
          <h3>보내는 곳</h3>
          <p class="party-name">${esc(o.farm_name || '')}</p>
          ${o.manager ? `<p>담당 ${esc(o.manager)}</p>` : ''}
          ${o.phone ? `<p>${esc(o.phone)}</p>` : ''}
        </div>
      </div>
      ${isAS ? `
        <div class="section-title">요청 내용</div>
        <table class="kv">
          <tr><th>장비명</th><td>${esc(o.equipment)}</td></tr>
          <tr><th>고장 내용</th><td class="pre">${esc(o.issue)}</td></tr>
        </table>` : `
        <div class="section-title">주문 품목</div>
        <table class="lines">
          <thead><tr><th style="width:52px">No</th><th>품목</th><th>규격</th><th style="width:100px">수량</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>`}
      <div class="section-title">${isAS ? '방문지' : '배송지'}</div>
      <table class="kv">
        <tr><th>주소</th><td>${esc(o.address)}</td></tr>
        <tr><th>농장명</th><td>${esc(o.farm_name || '')}</td></tr>
        <tr><th>담당자</th><td>${esc(o.manager)}</td></tr>
        <tr><th>연락처</th><td>${esc(o.phone)}</td></tr>
      </table>
      ${o.memo ? `<div class="section-title">요청사항</div><div class="memo-box pre">${esc(o.memo)}</div>` : ''}
      <p class="closing">위와 같이 ${isAS ? 'A/S를 요청' : '발주'}합니다.</p>
      <p class="sign">${esc(o.farm_name || '')}</p>
    </div>`;
  }

  function textOut(o) {
    const isAS = o.kind === 'A/S';
    const out = [
      `발주일: ${fmtDate(o.order_date)}`,
      `받는 곳: ${o.vendor_name}`,
      '',
    ];
    if (isAS) {
      out.push(`■ 장비명: ${o.equipment}`, '■ 고장 내용', o.issue);
    } else {
      out.push('■ 주문품목 / 규격 / 수량');
      (o.items || []).forEach((it, i) => out.push(`${i + 1}. ${it.name} / ${it.spec || '-'} / ${it.qty || '-'}`));
    }
    out.push(
      '',
      `■ ${isAS ? '방문지' : '배송지'}`,
      `주소: ${o.address || ''}`,
      `농장명: ${o.farm_name || ''}`,
      `담당자: ${o.manager || ''}`,
      `연락처: ${o.phone || ''}`,
    );
    if (o.memo) out.push('', '■ 요청사항', o.memo);
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
          <a href="#/" class="small back">← 발주 목록</a>
          <h1>${esc(o.vendor_name)} <span class="muted small">${esc(KIND_LABEL[o.kind] || o.kind)}</span></h1>
        </div>
        <div class="row">
          ${statusBtn(o)}
          <a class="btn sm" href="#/edit/${o.id}">고치기</a>
          <a class="btn sm" href="#/new?from=${o.id}">같은 내용으로 새로</a>
          <button class="btn sm danger" id="delOrder">지우기</button>
        </div>
      </div>
      ${v.prefer || v.prepaid ? `<p class="small print-hide view-note">${v.prefer ? `이 업체는 <b>${v.prefer === '문자' ? '카톡·문자' : '문서(인쇄·PDF)'}</b>로 받기를 원해요. ` : ''}${vendorMemo(v)}</p>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="doc" role="tab">문서형 (인쇄·PDF)</button>
        <button data-tab="text" role="tab">문자형 (카톡·문자)</button>
      </div>
      <div id="tabDoc">
        <div class="row end print-hide" style="margin-bottom:14px">
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
    $('#delOrder').addEventListener('click', async () => { if (await deleteOrder(o.id)) location.hash = '#/'; });
    $('#copyBtn').addEventListener('click', () => copyText($('#textOut').value, $('#textOut')));
  }

  // ---------- 거래처 ----------
  // 붙여넣은 여러 줄을 품목·규격으로 나눈다 (탭, 쉼표, / 로 구분)
  function parseCatalog(text) {
    return text.split(/\r?\n/).map((line) => {
      const parts = line.split(/\t|,|\//).map((s) => s.trim());
      return { name: parts[0] || '', spec: parts.slice(1).filter(Boolean).join(' ') };
    }).filter((x) => x.name);
  }

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
        <label class="check prepaid-check"><input type="checkbox" name="prepaid"> <span><span class="star">★</span> 선입업체</span> <em class="muted small">(체크하면 메모 앞에 노란 별, 빨간 굵은 글씨로 보여요)</em></label>
        <label class="field"><span>메모 <em>(선택)</em></span><input name="memo" placeholder="예: 선입금 후 출고 / 오전 주문은 당일 배송"></label>

        <div class="catalog">
          <h3>취급 품목 <em class="muted small">카탈로그를 보고 품목·규격을 등록하면 주문할 때 골라 쓸 수 있어요</em></h3>
          <div class="entry entry-2" id="centry">
            <input data-c="name" placeholder="품목" aria-label="품목" list="dlCatName" autocomplete="off">
            <input data-c="spec" placeholder="규격" aria-label="규격" autocomplete="off">
            <button type="button" class="btn" id="cAdd">추가</button>
          </div>
          <datalist id="dlCatName"></datalist>
          <p class="muted small hint">한 줄 쓰고 <kbd>Enter</kbd>를 누르면 아래에 쌓이고 <b>바로 저장돼요</b>. 같은 품목은 그대로 남아요. <span id="saveState" class="save-state"></span></p>
          <details class="bulk">
            <summary>여러 줄 한꺼번에 붙여넣기</summary>
            <textarea id="bulk" placeholder="한 줄에 하나씩: 품목, 규격&#10;예) 비닐, 0.05mm×1.8m&#10;엑셀에서 두 칸을 복사해 붙여넣어도 돼요"></textarea>
            <div class="row end"><button type="button" class="btn sm" id="bulkAdd">목록에 넣기</button></div>
          </details>
          <table class="items-table cat-table">
            <thead><tr><th class="no">No</th><th>품목</th><th>규격</th><th></th></tr></thead>
            <tbody id="crows"></tbody>
          </table>
          <p id="noCat" class="empty small">등록한 품목이 없어요.</p>
        </div>

        <p id="vfMsg" class="error" role="alert" hidden></p>
        <div class="row end">
          <button type="button" class="btn ghost" id="vfCancel" hidden>취소</button>
          <button class="btn primary" type="submit">거래처 저장</button>
        </div>
      </form>
      <div id="vlist" class="list" style="margin-top:18px"></div>`;

    const drawList = () => { $('#vlist').innerHTML = state.vendors.length ? state.vendors.map((v) => `
          <div class="item vendor">
            <div class="grow">
              <div class="item-title">${v.prepaid ? '<span class="star">★</span> ' : ''}${esc(v.name)} ${v.prefer ? `<span class="badge">${v.prefer === '문자' ? '카톡·문자' : '문서'}</span>` : ''}</div>
              <div class="item-sub">${esc([v.contact_person, v.phone].filter(Boolean).join(' · ') || '연락처 없음')}</div>
              ${v.memo || v.prepaid ? `<div class="small">${vendorMemo(v)}</div>` : ''}
              <div class="muted small">취급 품목 ${(v.catalog || []).length}개 · 발주 ${count(v.id)}건</div>
              ${(v.catalog || []).length ? `<div class="cat-preview">${v.catalog.slice(0, 6).map((c) => `<span>${esc(c.name)}${c.spec ? ` <small>${esc(c.spec)}</small>` : ''}</span>`).join('')}${v.catalog.length > 6 ? `<span class="muted">외 ${v.catalog.length - 6}개</span>` : ''}</div>` : ''}
            </div>
            <div class="row">
              <button class="btn sm" data-edit="${v.id}">고치기</button>
              <button class="btn sm danger" data-del="${v.id}">지우기</button>
            </div>
          </div>`).join('') : '<div class="empty">저장한 거래처가 없어요.</div>'; };
    drawList();

    const f = $('#vf');
    let editId = null;
    let cat = [];
    const cin = (k) => $(`#centry [data-c=${k}]`);

    const drawCat = () => {
      $('#crows').innerHTML = cat.map((c, i) => `<tr data-i="${i}">
        <td class="no">${i + 1}</td>
        <td><input data-k="name" value="${esc(c.name)}" aria-label="품목"></td>
        <td><input data-k="spec" value="${esc(c.spec)}" aria-label="규격"></td>
        <td><button type="button" class="icon-btn" data-cdel title="이 줄 지우기" aria-label="이 줄 지우기">×</button></td>
      </tr>`).join('');
      $('#noCat').hidden = cat.length > 0;
      $('#dlCatName').innerHTML = uniq(cat.map((c) => c.name)).map((n) => `<option value="${esc(n)}"></option>`).join('');
    };
    const formBody = () => ({
      name: f.name.value.trim(),
      contact_person: f.contact_person.value.trim(),
      phone: f.phone.value.trim(),
      prefer: f.prefer.value,
      prepaid: f.prepaid.checked,
      memo: f.memo.value.trim(),
      catalog: cat.map((c) => ({ name: (c.name || '').trim(), spec: (c.spec || '').trim() })).filter((c) => c.name),
    });
    let saving = Promise.resolve();
    // 서버에 저장. 업체 이름이 없으면 저장하지 않고 알려 준다
    const saveVendor = (auto) => {
      saving = saving.then(async () => {
        const msg = $('#vfMsg');
        const body = formBody();
        if (!body.name) {
          msg.textContent = auto ? '업체 이름을 먼저 적어 주세요. 이름이 있어야 품목이 저장돼요.' : '업체 이름을 적어 주세요.';
          msg.hidden = false;
          return false;
        }
        msg.hidden = true;
        try {
          if (editId) {
            const { row } = await api('PATCH', 'vendors', { id: editId, body });
            Object.assign(findVendor(editId), row || body);
          } else {
            const { row } = await api('POST', 'vendors', { body });
            state.vendors.push({ catalog: [], ...row });
            editId = row.id;
            $('#vfTitle').textContent = `거래처 고치기 — ${row.name}`;
            $('#vfCancel').hidden = false;
          }
          state.vendors.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
          drawList();
          $('#saveState').textContent = `취급 품목 ${body.catalog.length}개 저장됨`;
          return true;
        } catch (err) { fail(err); msg.textContent = err.message; msg.hidden = false; return false; }
      });
      return saving;
    };
    let lastCatName = '';
    const addCat = (fromSubmit) => {
      const c = { name: cin('name').value.trim(), spec: cin('spec').value.trim() };
      if (!c.name && !c.spec) return;
      if (fromSubmit === true && !c.spec && c.name === lastCatName) return;
      if (!c.name) { cin('name').focus(); toast('품목을 적어 주세요'); return; }
      if (cat.some((x) => x.name === c.name && x.spec === c.spec)) { toast('이미 있는 품목·규격이에요'); return; }
      cat.push(c);
      lastCatName = c.name;
      drawCat();
      cin('spec').value = '';
      cin('spec').focus();
      if (fromSubmit !== true) saveVendor(true);
    };
    $('#cAdd').addEventListener('click', () => addCat());
    $('#bulkAdd').addEventListener('click', () => {
      const add = parseCatalog($('#bulk').value).filter((c) => !cat.some((x) => x.name === c.name && x.spec === c.spec));
      cat.push(...add);
      drawCat();
      $('#bulk').value = '';
      toast(`${add.length}개를 넣었어요`);
      if (add.length) saveVendor(true);
    });
    $('#crows').addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (tr && e.target.dataset.k) cat[Number(tr.dataset.i)][e.target.dataset.k] = e.target.value;
    });
    $('#crows').addEventListener('click', (e) => {
      if (!e.target.closest('[data-cdel]')) return;
      cat.splice(Number(e.target.closest('tr').dataset.i), 1);
      drawCat();
      saveVendor(true);
    });
    // 줄에서 고친 품목·규격은 칸을 벗어날 때 저장
    $('#crows').addEventListener('change', () => saveVendor(true));
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if (e.target.closest('#centry')) addCat();
    });

    const reset = () => {
      editId = null;
      cat = [];
      f.reset();
      drawCat();
      $('#saveState').textContent = '';
      $('#vfTitle').textContent = '새 거래처';
      $('#vfCancel').hidden = true;
    };
    $('#vfCancel').addEventListener('click', reset);
    drawCat();

    $('#vlist').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (ed) {
        const v = findVendor(ed.dataset.edit);
        editId = v.id;
        ['name', 'contact_person', 'phone', 'prefer', 'memo'].forEach((k) => { f[k].value = v[k] || ''; });
        f.prepaid.checked = !!v.prepaid;
        cat = (v.catalog || []).map((c) => ({ ...c }));
        drawCat();
        $('#saveState').textContent = `취급 품목 ${cat.length}개 저장됨`;
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
      addCat(true); // 입력 줄에 남은 품목도 담기
      if (await saveVendor(false)) { toast('저장했어요'); render(); }
    });
  }

  // ---------- 설정 ----------
  function viewSettings(app) {
    const farms = state.settings.farms;
    const slot = (x, i) => `
      <fieldset class="farm">
        <legend>회사 ${i + 1}${i === 0 ? ' <em>(기본으로 채워져요)</em>' : ''}</legend>
        <div class="grid2">
          <label class="field"><span>농장명</span><input data-f="name" value="${esc(x.name)}"></label>
          <label class="field"><span>담당자</span><input data-f="manager" value="${esc(x.manager)}"></label>
          <label class="field"><span>연락처</span><input data-f="phone" type="tel" value="${esc(x.phone)}"></label>
          <label class="field"><span>배송지</span><input data-f="address" value="${esc(x.address)}"></label>
        </div>
      </fieldset>`;
    const slots = Array.from({ length: MAX_FARMS }, (_, i) => farms[i] || {});
    app.innerHTML = `
      <div class="page-head"><h1>설정</h1></div>
      <form id="sf" class="card stack" novalidate>
        <h2>우리 회사(농장) 정보 <em class="muted small">최대 ${MAX_FARMS}곳</em></h2>
        <p class="muted small" style="margin-top:4px">발주서에서 농장명을 고르면 배송지·담당자·연락처가 자동으로 채워져요. 쓰지 않는 칸은 비워 두세요.</p>
        ${slots.map(slot).join('')}
        <div class="row end"><button class="btn primary" type="submit">저장</button></div>
      </form>
      <div class="row" style="margin-top:20px">
        <span class="spacer"></span>
        <button class="btn ghost" id="logout">${DEMO ? '체험 데이터 모두 비우기' : '잠그기 (로그아웃)'}</button>
      </div>`;

    const f = $('#sf');
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const list = $$('fieldset.farm', f).map((fs) => {
        const g = (k) => $(`[data-f=${k}]`, fs).value.trim();
        return { name: g('name'), manager: g('manager'), phone: g('phone'), address: g('address') };
      });
      if (list.some((x) => !x.name && (x.manager || x.phone || x.address))) { toast('농장명이 빈 칸이 있어요'); return; }
      try {
        const { row } = await api('PUT', 'settings', { body: { farms: list.filter((x) => x.name) } });
        state.settings = normalizeSettings(row || { farms: list.filter((x) => x.name) });
        toast('저장했어요');
        render();
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

  // ---------- 새 버전 확인 ----------
  // 창을 다시 볼 때 새 버전이 올라와 있으면 새로고침한다 (작성 중인 화면에서는 하지 않음)
  const VERSION = '6';
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || DEMO || ['new', 'edit'].includes(route().name)) return;
    try {
      const html = await (await fetch('/balju/?_=' + Date.now(), { cache: 'no-store' })).text();
      const m = html.match(/app\.js\?v=(\w+)/);
      if (m && m[1] !== VERSION) location.reload();
    } catch { /* 오프라인 등 */ }
  });

  // ---------- 시작 ----------
  if (DEMO || session.get()) unlock();
  else lock();
})();
