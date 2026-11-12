/* Prospecta — interface, busca na API do YouTube, leads e envio. */
(() => {
  'use strict';
  const C = window.ProspectCore;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------------------------------------------------------------- armazenamento
  const NS = 'prospecta.';
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (_) { toast('Não deu para salvar no aparelho (memória cheia?)'); }
    },
    del(k) { try { localStorage.removeItem(NS + k); } catch (_) { /* ignore */ } },
  };

  const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
  const DAILY_QUOTA = 10000;
  const STATUS = { new: 'Novo', contacted: 'Contatado', replied: 'Respondeu', won: 'Fechou', dropped: 'Descartado' };
  const KIND_LABEL = { emails: 'E-mail', twitter: 'X', discord: 'Discord', instagram: 'Instagram', tiktok: 'TikTok', twitch: 'Twitch', telegram: 'Telegram', whatsapp: 'WhatsApp', links: 'Link' };
  const PRIORITY = ['emails', 'twitter', 'discord', 'instagram', 'whatsapp', 'telegram', 'tiktok', 'twitch', 'links'];
  const SUB_STEPS = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];

  const DEFAULT_SETTINGS = { apiKey: '', sendMode: 'mailto', clientId: '', delaySec: 10, pages: 2 };
  const DEFAULT_SEARCH = {
    tags: [], mode: 'all', min: 1000, max: 1000000, type: 'video', since: '', lang: '', region: '', order: 'relevance',
    deep: true, onlyContact: true, hideKnown: true, includeHidden: false,
  };

  let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
  let search = { ...DEFAULT_SEARCH, ...store.get('search', {}) };
  let tpl = { ...C.DEFAULT_TEMPLATES.pt, ...store.get('tpl', {}) };
  let leads = store.get('leads', {});
  let session = store.get('session', null);
  let gmail = store.get('gmail', null);
  let recent = store.get('recent', []);

  const ui = {
    tab: 'search', leadFilter: 'all', leadQuery: '', onlyEmail: false, selecting: false, selected: new Set(),
    leadLimit: 60, busy: false, lastField: null,
  };

  let saveTimer = 0;
  let dirty = false;
  function flushLeads() {
    clearTimeout(saveTimer);
    dirty = false;
    store.set('leads', leads);
  }
  function saveLeads(now) {
    dirty = true;
    clearTimeout(saveTimer);
    if (now) flushLeads();
    else saveTimer = setTimeout(flushLeads, 250);
    updateBadge();
  }
  addEventListener('pagehide', () => { if (dirty) flushLeads(); });
  // outra aba/janela do app alterou os leads: recarrega para não sobrescrever
  addEventListener('storage', e => {
    if (e.key !== NS + 'leads' || dirty) return;
    leads = store.get('leads', {});
    refreshLists();
  });

  // ---------------------------------------------------------------- utilidades de DOM
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v; // só para ícones SVG fixos deste arquivo
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }

  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const icon = name => h('span', { html: ICON[name], style: 'display:contents' });

  // ---------------------------------------------------------------- aviso (toast)
  let toastTimer = 0;
  function toast(msg, opts = {}) {
    const el = $('#toast');
    el.replaceChildren(h('span', null, msg));
    if (opts.action) {
      el.append(h('button', { type: 'button', onclick: () => { el.hidden = true; opts.onAction(); } }, opts.action));
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, opts.ms || (opts.action ? 6000 : 3200));
  }

  // ---------------------------------------------------------------- folha (sheet)
  let sheetOnClose = null;
  function openSheet(title, body, onClose) {
    $('#sheetTitle').textContent = title;
    const b = $('#sheetBody');
    b.replaceChildren(...[].concat(body));
    b.scrollTop = 0;
    const wasOpen = !$('#sheet').hidden;
    $('#sheet').hidden = false;
    document.body.classList.add('sheet-open');
    sheetOnClose = onClose || null;
    if (!wasOpen) history.pushState({ sheet: 1 }, '');
  }
  function closeSheet(fromPop) {
    if ($('#sheet').hidden) return;
    $('#sheet').hidden = true;
    document.body.classList.remove('sheet-open');
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) cb();
    if (!fromPop && history.state && history.state.sheet) history.back();
  }
  addEventListener('popstate', () => { if (!$('#sheet').hidden) closeSheet(true); });
  $$('#sheet [data-close]').forEach(el => el.addEventListener('click', () => closeSheet()));
  addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ---------------------------------------------------------------- abrir links / copiar
  function openExternal(url) {
    if (typeof window.__prospectaOpen === 'function') return window.__prospectaOpen(url);
    if (/^https?:/i.test(url)) {
      const a = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
      document.body.append(a);
      a.click();
      a.remove();
    } else {
      location.href = url;
    }
  }

  function copyText(text) {
    let ok = false;
    try {
      const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      ta.remove();
    } catch (_) { /* ignore */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      ok = true;
    }
    return ok;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------------------------------------------------------------- cota
  function ptDate() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  function quota() {
    const q = store.get('quota', null);
    return q && q.date === ptDate() ? q : { date: ptDate(), used: 0 };
  }
  function addQuota(n) {
    const q = quota();
    q.used += n;
    store.set('quota', q);
    renderQuota();
  }
  function renderQuota() {
    const used = quota().used;
    const pct = Math.min(100, (used / DAILY_QUOTA) * 100);
    $('#quotaFill').style.width = pct + '%';
    $('#quotaText').textContent = used.toLocaleString('pt-BR') + ' / 10.000';
    $('#quotaPill').classList.toggle('warn', pct >= 70 && pct < 95);
    $('#quotaPill').classList.toggle('full', pct >= 95);
  }
  $('#quotaPill').addEventListener('click', () => {
    const left = Math.max(0, DAILY_QUOTA - quota().used);
    toast(`Cota do YouTube hoje: sobram ~${left.toLocaleString('pt-BR')} unidades (≈ ${Math.floor(left / 105)} páginas de busca). Renova ~5h (Brasília).`, { ms: 6000 });
  });

  // ---------------------------------------------------------------- API do YouTube
  class ApiError extends Error {
    constructor(msg, fatal) { super(msg); this.fatal = fatal; }
  }

  async function yt(endpoint, params, cost) {
    const url = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
    for (const [k, v] of Object.entries({ ...params, key: settings.apiKey.trim() })) {
      if (v !== '' && v != null) url.searchParams.set(k, v);
    }
    let res;
    try {
      res = await fetch(url, { referrerPolicy: 'strict-origin-when-cross-origin' });
    } catch (_) {
      throw new ApiError('Sem conexão com o YouTube. Confira sua internet.', true);
    }
    addQuota(cost);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw ytError(data, res.status);
    return data;
  }

  function ytError(data, status) {
    const err = (data && data.error) || {};
    const reason = [((err.errors || [])[0] || {}).reason, ...((err.details || []).map(d => d.reason))].filter(Boolean).join(' ');
    const msg = err.message || '';
    const all = reason + ' ' + msg;
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(all)) {
      store.set('quota', { date: ptDate(), used: Math.max(quota().used, DAILY_QUOTA) });
      renderQuota();
      return new ApiError('A cota diária da API do YouTube acabou. Ela renova à meia-noite no horário do Pacífico (≈ 5h em Brasília).', true);
    }
    if (/keyInvalid|API_KEY_INVALID|API key not valid|badRequest.*key/i.test(all)) return new ApiError('Chave da API inválida. Confira em Ajustes.', true);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(all)) return new ApiError('A “YouTube Data API v3” não está ativada no seu projeto do Google Cloud. Ative e tente de novo em 1–2 min.', true);
    if (/ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED|referer|referrer/i.test(all)) return new ApiError('A chave tem restrição de site que bloqueia este endereço. Adicione ' + location.origin + '/* nas restrições da chave.', true);
    if (/playlistNotFound|channelNotFound/i.test(all) || status === 404) return new ApiError('Não encontrado', false);
    return new ApiError(`Erro do YouTube (${status})${msg ? ': ' + msg : ''}`, status === 400 || status === 403);
  }

  async function pool(items, n, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    });
    await Promise.all(workers);
  }

  function channelUrl(lead) {
    return lead.handle ? 'https://www.youtube.com/' + lead.handle : 'https://www.youtube.com/channel/' + lead.id;
  }

  function inRange(ch, p) {
    const s = ch.statistics || {};
    if (s.hiddenSubscriberCount) return !!p.includeHidden;
    const subs = Number(s.subscriberCount || 0);
    return subs >= (p.min || 0) && (!p.max || subs <= p.max);
  }

  function upsertLead(ch, contacts, q) {
    const sn = ch.snippet || {};
    const st = ch.statistics || {};
    const th = sn.thumbnails || {};
    const base = {
      id: ch.id,
      title: sn.title || '(sem nome)',
      handle: sn.customUrl ? (sn.customUrl.startsWith('@') ? sn.customUrl : '@' + sn.customUrl) : '',
      thumb: (th.default || th.medium || {}).url || '',
      subs: st.hiddenSubscriberCount ? null : Number(st.subscriberCount || 0),
      videos: Number(st.videoCount || 0),
      views: Number(st.viewCount || 0),
      country: sn.country || '',
      desc: String(sn.description || '').slice(0, 3000),
      auto: contacts,
      updatedAt: Date.now(),
    };
    const old = leads[ch.id];
    leads[ch.id] = old
      ? { ...old, ...base }
      : { ...base, name: C.cleanName(base.title), status: 'new', manual: C.emptyContacts(), notes: '', foundAt: Date.now(), query: q, history: [] };
    return leads[ch.id];
  }

  const contactsOf = lead => C.mergeContacts(lead.manual, lead.auto);

  function sinceDate(days) {
    return new Date(Date.now() - Number(days) * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  }

  // ---------------------------------------------------------------- BUSCA
  function readSearchForm() {
    const pending = $('#tagInput').value.trim();
    if (pending) { addTags(pending); $('#tagInput').value = ''; }
    const val = (sel, custom) => (sel.value === 'custom' ? Number(custom.value || 0) : Number(sel.value));
    search.min = val($('#minSubs'), $('#minCustom'));
    search.max = val($('#maxSubs'), $('#maxCustom'));
    if (search.max && search.min > search.max) [search.min, search.max] = [search.max, search.min];
    search.type = $('#fType').value;
    search.since = $('#fSince').value;
    search.lang = $('#fLang').value;
    search.region = $('#fRegion').value;
    search.order = $('#fOrder').value;
    search.deep = $('#fDeep').checked;
    search.onlyContact = $('#fOnlyContact').checked;
    search.hideKnown = $('#fHideKnown').checked;
    search.includeHidden = $('#fHidden').checked;
    store.set('search', search);
  }

  function setStatus(text, kind) {
    const el = $('#searchStatus');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'status' + (kind === 'err' ? ' err' : '');
    el.replaceChildren(kind === 'busy' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : '', h('span', null, text));
  }

  async function runSearch(more) {
    if (ui.busy) return;
    if (!settings.apiKey.trim()) {
      toast('Cole sua chave da API do YouTube primeiro');
      renderKeyCard();
      $('#keyQuick').focus();
      return;
    }
    readSearchForm();
    if (!more) {
      if (!search.tags.length) { toast('Digite pelo menos uma tag'); $('#tagInput').focus(); return; }
      const q = C.buildQuery(search.tags, search.mode);
      session = { q, tags: search.tags.slice(), params: { ...search }, ids: [], token: null, seen: [], stats: { videos: 0, channels: 0, inRange: 0, withContact: 0, known: 0 }, at: Date.now(), done: false };
      rememberRecent();
    } else if (!session || !session.token) {
      return;
    }

    ui.busy = true;
    $('#searchBtn').disabled = true;
    $('#moreBtn').disabled = true;
    const p = session.params;
    const seen = new Set(session.seen);
    const st = session.stats;
    let added = 0;
    let pages = 0;
    try {
      while (pages < Number(settings.pages || 2) && added < 15) {
        setStatus(`Buscando no YouTube… (página ${pages + 1})`, 'busy');
        const params = {
          part: 'snippet', q: session.q, type: p.type, maxResults: 50, order: p.type === 'channel' && p.order === 'date' ? 'relevance' : p.order,
          pageToken: session.token || '', relevanceLanguage: p.lang, regionCode: p.region,
        };
        if (p.type === 'video' && p.since) params.publishedAfter = sinceDate(p.since);
        const res = await yt('search', params, 100);
        pages++;
        session.token = res.nextPageToken || null;
        const items = res.items || [];
        st.videos += items.length;
        const ids = [...new Set(items.map(i => (i.snippet && i.snippet.channelId) || (i.id && i.id.channelId)).filter(Boolean))].filter(id => !seen.has(id));
        ids.forEach(id => seen.add(id));
        st.channels += ids.length;
        let cand = ids;
        if (p.hideKnown) {
          const known = cand.filter(id => leads[id]);
          st.known += known.length;
          cand = cand.filter(id => !leads[id]);
        }
        if (cand.length) {
          setStatus(`Analisando ${cand.length} canais…`, 'busy');
          const chRes = await yt('channels', { part: 'snippet,statistics,contentDetails', id: cand.join(','), maxResults: 50 }, 1);
          const chans = (chRes.items || []).filter(ch => inRange(ch, p));
          st.inRange += chans.length;
          let done = 0;
          await pool(chans, 6, async ch => {
            let videoTexts = [];
            const uploads = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
            if (p.deep && uploads) {
              try {
                const pl = await yt('playlistItems', { part: 'snippet', playlistId: uploads, maxResults: 6 }, 1);
                videoTexts = (pl.items || []).map(it => (it.snippet && it.snippet.description) || '');
              } catch (e) {
                if (e.fatal) throw e;
              }
            }
            done++;
            setStatus(`Procurando contatos… ${done}/${chans.length}`, 'busy');
            const sn = ch.snippet || {};
            const contacts = C.collectContacts({
              channelText: sn.description || '', videoTexts, names: [sn.title, String(sn.customUrl || '').replace(/^@/, '')],
            });
            const has = C.hasAny(contacts);
            if (has) st.withContact++;
            if (p.onlyContact && !has) return;
            upsertLead(ch, contacts, session.q);
            if (!session.ids.includes(ch.id)) { session.ids.push(ch.id); added++; }
          });
          saveLeads();
          session.seen = [...seen];
          store.set('session', session);
          renderResults();
        }
        if (!session.token) break;
      }
      session.done = !session.token;
      setStatus(added ? '' : (session.token ? 'Nenhum canal novo nesta leva. Toque em “Buscar mais”.' : 'Não achei mais canais para essa busca. Tente outras tags ou amplie a faixa de inscritos.'));
    } catch (e) {
      setStatus(e.message || String(e), 'err');
    } finally {
      session.seen = [...seen];
      store.set('session', session);
      saveLeads(true);
      ui.busy = false;
      $('#searchBtn').disabled = false;
      $('#moreBtn').disabled = false;
      renderResults();
    }
  }

  function rememberRecent() {
    const key = JSON.stringify([search.tags.map(t => t.toLowerCase()), search.mode]);
    recent = [{ tags: search.tags.slice(), mode: search.mode }, ...recent.filter(r => JSON.stringify([r.tags.map(t => t.toLowerCase()), r.mode]) !== key)].slice(0, 8);
    store.set('recent', recent);
    renderRecent();
  }

  // ---------------------------------------------------------------- tags
  function addTags(text) {
    for (const t of C.splitTags(text)) {
      if (!search.tags.some(x => x.toLowerCase() === t.toLowerCase())) search.tags.push(t);
    }
    store.set('search', search);
    renderTags();
  }
  function renderTags() {
    $('#tagInput').placeholder = search.tags.length ? 'adicionar outra tag…' : 'minecraft adventure, smp';
    $('#tagChips').replaceChildren(...search.tags.map((t, i) =>
      h('span', { class: 'tag' + (t.startsWith('-') ? ' neg' : '') },
        t,
        h('button', {
          type: 'button', 'aria-label': 'Remover ' + t,
          onclick: e => { e.stopPropagation(); search.tags.splice(i, 1); store.set('search', search); renderTags(); },
          html: ICON.x,
        }))));
  }
  function renderRecent() {
    const box = $('#recent');
    box.hidden = !recent.length;
    box.replaceChildren(...recent.map(r => h('button', {
      type: 'button', class: 'chip',
      onclick: () => { search.tags = r.tags.slice(); search.mode = r.mode; store.set('search', search); renderTags(); renderMode(); },
    }, r.tags.join(r.mode === 'any' ? ' | ' : ' + '))));
  }
  function renderMode() {
    $$('#matchMode button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === search.mode)));
  }

  $('#tagBox').addEventListener('click', () => $('#tagInput').focus());
  $('#tagInput').addEventListener('keydown', e => {
    const input = e.target;
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      if (input.value.trim()) {
        e.preventDefault();
        addTags(input.value);
        input.value = '';
      } else if (e.key !== 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !input.value && search.tags.length) {
      search.tags.pop();
      store.set('search', search);
      renderTags();
    }
  });
  $('#tagInput').addEventListener('input', e => {
    // teclados de celular às vezes não mandam keydown para a vírgula
    if (/[,;\n]/.test(e.target.value)) {
      const parts = e.target.value.split(/[,;\n]/);
      const rest = parts.pop();
      addTags(parts.join(','));
      e.target.value = rest.trimStart();
    }
  });
  $('#tagInput').addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (/[,;\n]/.test(text)) { e.preventDefault(); addTags(text); }
  });
  $('#tagInput').addEventListener('blur', e => { if (e.target.value.trim()) { addTags(e.target.value); e.target.value = ''; } });
  $('#matchMode').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    search.mode = b.dataset.v;
    store.set('search', search);
    renderMode();
  });

  function subsLabel(n) {
    if (n >= 1000000) return (n / 1000000).toLocaleString('pt-BR') + (n === 1000000 ? ' milhão' : ' milhões');
    if (n >= 1000) return (n / 1000).toLocaleString('pt-BR') + ' mil';
    return String(n);
  }
  function fillSubSelects() {
    const mk = (sel, first, value, custom) => {
      const opts = [first, ...SUB_STEPS.map(n => [String(n), subsLabel(n)]), ['custom', 'Outro valor…']];
      sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
      const isPreset = value === 0 || SUB_STEPS.includes(value);
      sel.value = isPreset ? String(value) : 'custom';
      custom.hidden = isPreset;
      if (!isPreset) custom.value = value;
    };
    mk($('#minSubs'), ['0', 'Qualquer'], search.min, $('#minCustom'));
    mk($('#maxSubs'), ['0', 'Sem limite'], search.max, $('#maxCustom'));
  }
  [['#minSubs', '#minCustom'], ['#maxSubs', '#maxCustom']].forEach(([s, c]) => {
    $(s).addEventListener('change', () => {
      $(c).hidden = $(s).value !== 'custom';
      if (!$(c).hidden) $(c).focus();
      readSearchForm();
    });
    $(c).addEventListener('change', readSearchForm);
  });
  ['#fType', '#fSince', '#fLang', '#fRegion', '#fOrder', '#fDeep', '#fOnlyContact', '#fHideKnown', '#fHidden'].forEach(s => $(s).addEventListener('change', readSearchForm));

  function fillSearchForm() {
    fillSubSelects();
    $('#fType').value = search.type;
    $('#fSince').value = search.since;
    $('#fLang').value = search.lang;
    $('#fRegion').value = search.region;
    $('#fOrder').value = search.order;
    $('#fDeep').checked = search.deep;
    $('#fOnlyContact').checked = search.onlyContact;
    $('#fHideKnown').checked = search.hideKnown;
    $('#fHidden').checked = search.includeHidden;
    renderTags();
    renderMode();
    renderRecent();
  }

  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); $('#tagInput').blur(); runSearch(false); });
  $('#moreBtn').addEventListener('click', () => runSearch(true));

  function renderKeyCard() {
    $('#keyCard').hidden = !!settings.apiKey.trim();
  }
  $('#keyQuickSave').addEventListener('click', () => {
    const v = $('#keyQuick').value.trim();
    if (!v) return toast('Cole a chave primeiro');
    settings.apiKey = v;
    store.set('settings', settings);
    $('#sKey').value = v;
    renderKeyCard();
    toast('Chave salva ✓');
  });

  // ---------------------------------------------------------------- cartões de lead
  function sortForOutreach(list) {
    const score = l => {
      const c = contactsOf(l);
      return (c.emails.length ? 2 : C.hasAny(c) ? 1 : 0);
    };
    return list.sort((a, b) => score(b) - score(a) || (b.subs || 0) - (a.subs || 0));
  }

  function contactLabel(kind, v) {
    if (kind === 'emails') return v;
    if (kind === 'discord') return /^https?:/.test(v) ? 'Servidor' : v;
    if (kind === 'whatsapp') return '+' + v;
    if (kind === 'links') return v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    return '@' + v;
  }

  function bestContact(c) {
    for (const k of PRIORITY) {
      const list = k === 'links' ? c.links.filter(C.isLinkInBio) : c[k];
      if (list.length) return [k, list[0]];
    }
    return null;
  }

  const ACTION_LABEL = {
    emails: 'Enviar e-mail', twitter: 'DM no X', discord: 'Discord', instagram: 'DM no Instagram', whatsapp: 'WhatsApp',
    telegram: 'Telegram', tiktok: 'TikTok', twitch: 'Twitch', links: 'Abrir link',
  };

  function leadCard(lead) {
    const c = contactsOf(lead);
    const chips = [];
    for (const k of PRIORITY) {
      const list = k === 'links' ? c.links.filter(C.isLinkInBio) : c[k];
      for (const v of list.slice(0, k === 'emails' ? 2 : 1)) {
        chips.push(h('button', {
          type: 'button', class: 'cchip k-' + k, title: KIND_LABEL[k] + ': ' + contactLabel(k, v),
          onclick: e => { e.stopPropagation(); contactVia(lead, k, v); },
        }, h('span', null, k === 'emails' ? v : KIND_LABEL[k] + ' ' + contactLabel(k, v))));
      }
    }
    if (!chips.length) chips.push(h('span', { class: 'cchip none' }, h('span', null, 'Sem contato público — veja o “Sobre”')));
    const best = bestContact(c);
    const meta = [
      lead.subs != null ? C.formatCount(lead.subs) + ' inscritos' : 'inscritos ocultos',
      lead.videos ? lead.videos.toLocaleString('pt-BR') + ' vídeos' : '',
      lead.handle,
    ].filter(Boolean).join(' · ');

    const selectable = ui.selecting && ui.tab === 'leads';
    const pick = selectable && h('input', {
      type: 'checkbox', class: 'pick', checked: ui.selected.has(lead.id), 'aria-label': 'Selecionar ' + lead.title,
      onchange: e => { e.target.checked ? ui.selected.add(lead.id) : ui.selected.delete(lead.id); renderBulk(); },
    });
    const details = () => { if (!selectable) openLead(lead.id); };
    const card = h('article', {
      class: 'card lead' + (selectable ? ' selectable' : ''), 'data-id': lead.id,
      onclick: selectable ? e => { if (e.target === pick || e.target.closest('button')) return; pick.checked = !pick.checked; pick.dispatchEvent(new Event('change')); } : null,
    },
      pick,
      h('img', { class: 'avatar', src: lead.thumb || 'icons/icon-192.png', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: 48, height: 48, onclick: details }),
      h('div', { class: 'lead-main' },
        h('div', { class: 'lead-top' },
          h('h3', { class: 'lead-title', onclick: details }, lead.title),
          h('span', { class: 'pill ' + lead.status }, STATUS[lead.status] || lead.status)),
        h('div', { class: 'meta' }, meta),
        h('div', { class: 'contacts' }, chips),
        h('div', { class: 'actions' },
          best
            ? h('button', { type: 'button', class: 'btn primary sm', onclick: () => contactVia(lead, best[0], best[1]) }, icon('send'), h('span', null, ACTION_LABEL[best[0]]))
            : h('button', { type: 'button', class: 'btn primary sm', onclick: () => openExternal(channelUrl(lead) + '/about') }, icon('open'), h('span', null, 'Ver “Sobre”')),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openLead(lead.id) }, 'Detalhes'))));
    return card;
  }

  function renderResults() {
    const box = $('#results');
    const head = $('#resultsHead');
    if (!session) { box.replaceChildren(); head.hidden = true; $('#moreBtn').hidden = true; return; }
    const list = sortForOutreach(session.ids.map(id => leads[id]).filter(Boolean));
    const st = session.stats;
    const withEmail = list.filter(l => contactsOf(l).emails.length);
    head.hidden = false;
    const p = session.params;
    const range = `${p.min ? subsLabel(p.min) : '0'} – ${p.max ? subsLabel(p.max) : 'sem limite'}`;
    head.replaceChildren(
      h('div', { class: 'q' }, `${list.length} youtuber${list.length === 1 ? '' : 's'} · “${session.tags.join(p.mode === 'any' ? ' | ' : ' + ')}”`),
      h('div', { class: 'stats' }, `${st.channels} canais analisados · ${st.inRange} na faixa (${range}) · ${withEmail.length} com e-mail${st.known ? ` · ${st.known} já nos seus leads` : ''}`),
      withEmail.length > 1 ? h('button', { type: 'button', class: 'btn ghost', onclick: () => startEmailQueue(withEmail.map(l => l.id)) }, icon('send'), `Enviar e-mail para os ${withEmail.length}`) : '',
    );
    box.replaceChildren(...(list.length ? list.map(leadCard) : [h('div', { class: 'empty' }, ui.busy ? '' : h('b', null, 'Nada por aqui ainda'), ui.busy ? '' : 'Os youtubers encontrados aparecem aqui.')]));
    $('#moreBtn').hidden = !session.token;
  }

  // ---------------------------------------------------------------- LEADS
  function leadMatches(l, q) {
    if (!q) return true;
    const c = contactsOf(l);
    const hay = [l.title, l.name, l.handle, l.notes, l.query, ...C.KINDS.flatMap(k => c[k])].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
  }

  function filteredLeads() {
    return Object.values(leads)
      .filter(l => ui.leadFilter === 'all' || l.status === ui.leadFilter)
      .filter(l => !ui.onlyEmail || contactsOf(l).emails.length)
      .filter(l => leadMatches(l, ui.leadQuery))
      .sort((a, b) => (b.contactedAt || b.foundAt || 0) - (a.contactedAt || a.foundAt || 0));
  }

  function renderStatusFilter() {
    const all = Object.values(leads);
    const count = s => all.filter(l => l.status === s).length;
    const items = [['all', 'Todos', all.length], ...Object.entries(STATUS).map(([k, v]) => [k, v, count(k)])];
    $('#statusFilter').replaceChildren(...items.map(([k, label, n]) => h('button', {
      type: 'button', class: 'chip', role: 'tab', 'aria-selected': String(ui.leadFilter === k),
      onclick: () => { ui.leadFilter = k; ui.leadLimit = 60; renderLeads(); },
    }, label, h('span', { class: 'n' }, n))));
  }

  function renderLeads() {
    renderStatusFilter();
    const list = filteredLeads();
    const shown = list.slice(0, ui.leadLimit);
    const total = Object.keys(leads).length;
    $('#leadList').replaceChildren(...(shown.length ? shown.map(leadCard) : [h('div', { class: 'empty' },
      h('b', null, total ? 'Nenhum lead com esse filtro' : 'Nenhum lead ainda'),
      total ? 'Mude o filtro ou a busca.' : 'Faça uma busca: todo youtuber encontrado fica salvo aqui.')]));
    $('#leadMore').hidden = list.length <= ui.leadLimit;
    $('#selectBtn').textContent = ui.selecting ? 'Cancelar' : 'Selecionar';
    if (!ui.selected.size) $('#bulkAll').textContent = 'Todos';
    renderBulk();
  }

  function renderBulk() {
    const on = ui.selecting && ui.tab === 'leads';
    $('#bulkBar').hidden = !on;
    document.body.classList.toggle('has-bulk', on);
    $('#bulkCount').textContent = ui.selected.size ? `Enviar e-mail (${ui.selected.size})` : 'Selecione os leads';
    $('#bulkSend').disabled = !ui.selected.size;
    $('#bulkStatus').disabled = !ui.selected.size;
  }

  function updateBadge() {
    const n = Object.values(leads).filter(l => l.status === 'new' && contactsOf(l).emails.length).length;
    const b = $('#leadBadge');
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : n;
  }

  $('#leadSearch').addEventListener('input', e => { ui.leadQuery = e.target.value.trim(); ui.leadLimit = 60; renderLeads(); });
  $('#onlyEmail').addEventListener('change', e => { ui.onlyEmail = e.target.checked; renderLeads(); });
  $('#leadMore').addEventListener('click', () => { ui.leadLimit += 60; renderLeads(); });
  $('#selectBtn').addEventListener('click', () => {
    ui.selecting = !ui.selecting;
    ui.selected.clear();
    renderLeads();
  });
  $('#bulkAll').addEventListener('click', () => {
    const ids = filteredLeads().map(l => l.id);
    const allOn = ids.length && ids.every(id => ui.selected.has(id));
    ids.forEach(id => (allOn ? ui.selected.delete(id) : ui.selected.add(id)));
    renderLeads();
    $('#bulkAll').textContent = allOn ? 'Todos' : 'Nenhum';
  });
  $('#bulkSend').addEventListener('click', () => startEmailQueue([...ui.selected]));
  $('#bulkStatus').addEventListener('click', () => {
    openSheet('Mudar status de ' + ui.selected.size, h('div', { class: 'menu-list' },
      ...Object.entries(STATUS).map(([k, v]) => h('button', {
        type: 'button', class: 'btn ghost', onclick: () => {
          ui.selected.forEach(id => { if (leads[id]) leads[id].status = k; });
          saveLeads(true); closeSheet(); renderLeads(); toast('Status atualizado');
        },
      }, v)),
      h('button', {
        type: 'button', class: 'btn danger', onclick: () => {
          if (!confirm(`Excluir ${ui.selected.size} lead(s)?`)) return;
          ui.selected.forEach(id => delete leads[id]);
          ui.selected.clear(); saveLeads(true); closeSheet(); renderLeads(); toast('Excluídos');
        },
      }, icon('trash'), 'Excluir selecionados')));
  });
  $('#leadsMenuBtn').addEventListener('click', () => {
    const list = filteredLeads();
    openSheet('Exportar', h('div', { class: 'menu-list' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { exportCsv(list); closeSheet(); } }, `Planilha CSV — ${list.length} lead(s) do filtro atual`),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { exportCsv(Object.values(leads)); closeSheet(); } }, `Planilha CSV — todos (${Object.keys(leads).length})`),
      h('button', {
        type: 'button', class: 'btn ghost', onclick: () => {
          const emails = [...new Set(list.flatMap(l => contactsOf(l).emails.slice(0, 1)))];
          if (!emails.length) return toast('Nenhum e-mail nesse filtro');
          copyText(emails.join(', '));
          toast(`${emails.length} e-mail(s) copiados`);
          closeSheet();
        },
      }, 'Copiar e-mails do filtro atual'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { backup(); closeSheet(); } }, 'Backup completo (JSON)')));
  });

  // ---------------------------------------------------------------- detalhe do lead
  function openLead(id) {
    const lead = leads[id];
    if (!lead) return;
    const pv = h('div');
    const renderPreview = () => {
      const m = personalize(lead);
      pv.replaceChildren(
        h('div', { class: 'pv-label' }, 'Assunto'), h('div', { class: 'pv-subject' }, m.subject),
        h('div', { class: 'pv-label' }, 'E-mail'), h('div', { class: 'pv-body' }, m.body),
        h('div', { class: 'pv-label' }, 'DM'), h('div', { class: 'pv-dm' }, m.dm));
    };
    renderPreview();

    const contactsBox = h('div');
    const renderContacts = () => {
      const c = contactsOf(lead);
      const rows = [];
      for (const k of PRIORITY) {
        for (const v of c[k]) {
          const manual = (lead.manual[k] || []).some(x => String(x).toLowerCase() === String(v).toLowerCase());
          rows.push(h('div', { class: 'crow' },
            h('span', { class: 'kind k-' + k }, KIND_LABEL[k]),
            h('span', { class: 'val' }, contactLabel(k, v)),
            h('span', { class: 'btns' },
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copiar', onclick: () => { copyText(k === 'emails' || k === 'links' || /^https?:/.test(v) ? v : contactLabel(k, v)); toast('Copiado'); }, html: ICON.copy }),
              manual && h('button', {
                type: 'button', class: 'icon-btn', 'aria-label': 'Remover', html: ICON.trash,
                onclick: () => { lead.manual[k] = lead.manual[k].filter(x => String(x).toLowerCase() !== String(v).toLowerCase()); saveLeads(); renderContacts(); },
              }),
              h('button', { type: 'button', class: 'btn primary sm', onclick: () => contactVia(lead, k, v) }, k === 'emails' ? 'Enviar' : k === 'links' ? 'Abrir' : 'DM'))));
        }
      }
      if (!rows.length) {
        rows.push(h('p', { class: 'hint', style: 'margin:0' },
          'Não achei contato público na descrição. No “Sobre” do canal costuma ter o botão “Ver endereço de e-mail” (pede login no YouTube). Pegue lá e adicione abaixo.'));
      }
      const kindSel = h('select', { 'aria-label': 'Tipo de contato' }, ...['emails', 'twitter', 'discord', 'instagram', 'tiktok', 'twitch', 'telegram', 'whatsapp', 'links'].map(k => h('option', { value: k }, KIND_LABEL[k])));
      const valIn = h('input', { type: 'text', placeholder: 'contato', autocapitalize: 'off', spellcheck: 'false' });
      contactsBox.replaceChildren(...rows, h('div', { class: 'add-contact' }, kindSel, valIn,
        h('button', {
          type: 'button', class: 'btn ghost sm', onclick: () => {
            const v = normalizeManual(kindSel.value, valIn.value);
            if (!v) return toast('Valor inválido para ' + KIND_LABEL[kindSel.value]);
            lead.manual[kindSel.value] = [...(lead.manual[kindSel.value] || []), v];
            saveLeads();
            renderContacts();
            toast('Contato adicionado');
          },
        }, 'Adicionar')));
    };
    renderContacts();

    const statusBox = h('div', { class: 'statuses' });
    const renderStatus = () => statusBox.replaceChildren(...Object.entries(STATUS).map(([k, v]) => h('button', {
      type: 'button', class: 'chip', 'aria-selected': String(lead.status === k),
      onclick: () => { lead.status = k; saveLeads(); renderStatus(); refreshLists(); },
    }, v)));
    renderStatus();

    const nameIn = h('input', { type: 'text', value: lead.name || '', autocomplete: 'off' });
    nameIn.addEventListener('input', () => { lead.name = nameIn.value; saveLeads(); renderPreview(); });
    const notes = h('textarea', { rows: 3, placeholder: 'Ex.: respondeu pedindo preço…' });
    notes.value = lead.notes || '';
    notes.addEventListener('input', () => { lead.notes = notes.value; saveLeads(); });

    const stats = [
      lead.subs != null ? C.formatCount(lead.subs) + ' inscritos' : 'inscritos ocultos',
      lead.videos ? lead.videos.toLocaleString('pt-BR') + ' vídeos' : '',
      lead.views ? C.formatCount(lead.views) + ' views' : '',
      lead.country || '',
    ].filter(Boolean).join(' · ');

    openSheet(lead.title, [
      h('div', { class: 'ld-head' },
        h('img', { class: 'avatar', src: lead.thumb || 'icons/icon-192.png', alt: '', referrerpolicy: 'no-referrer', width: 64, height: 64 }),
        h('div', null, h('div', { class: 'ld-stats' }, stats), lead.handle ? h('div', { class: 'ld-stats' }, lead.handle) : '')),
      h('div', { class: 'ld-links' },
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openExternal(channelUrl(lead)) }, icon('open'), 'Abrir canal'),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => openExternal(channelUrl(lead) + '/about') }, icon('open'), 'Ver “Sobre”')),
      h('div', { class: 'block' }, h('h3', null, 'Nome usado em (cliente)'), nameIn),
      h('div', { class: 'block' }, h('h3', null, 'Contatos'), contactsBox),
      h('div', { class: 'block' }, h('h3', null, 'Status'), statusBox),
      h('div', { class: 'block' }, h('h3', null, 'Mensagem personalizada'), pv),
      h('div', { class: 'block' }, h('h3', null, 'Notas'), notes),
      lead.history && lead.history.length ? h('div', { class: 'block' }, h('h3', null, 'Histórico'),
        h('ul', { class: 'hist' }, ...lead.history.slice().reverse().map(x => h('li', null, `${new Date(x.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — ${x.via}${x.to ? ' (' + x.to + ')' : ''}`)))) : '',
      lead.desc ? h('div', { class: 'block' }, h('details', null, h('summary', null, 'Descrição do canal'), h('div', { class: 'desc' }, lead.desc))) : '',
      h('div', { class: 'sheet-actions' },
        h('button', {
          type: 'button', class: 'btn danger', onclick: () => {
            if (!confirm('Excluir este lead?')) return;
            delete leads[lead.id];
            saveLeads(true); closeSheet(); refreshLists();
          },
        }, icon('trash'), 'Excluir lead')),
    ], refreshLists);
  }

  function normalizeManual(kind, raw) {
    let v = String(raw || '').trim();
    if (!v) return null;
    if (kind === 'emails') {
      const e = C.cleanEmail((v.match(/[^\s<>]+@[^\s<>]+/) || [''])[0]);
      return e && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) ? e : null;
    }
    if (kind === 'links' || (kind === 'discord' && /discord|dsc\.gg|^https?:/i.test(v))) {
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      try { new URL(v); return v; } catch (_) { return null; }
    }
    if (kind === 'whatsapp') { v = v.replace(/\D/g, ''); return v.length >= 8 ? v : null; }
    const fromUrl = v.match(/(?:twitter|x|instagram|tiktok|twitch|t)\.(?:com|tv|me)\/@?([A-Za-z0-9_.]+)/i);
    if (fromUrl) v = fromUrl[1];
    v = v.replace(/^@/, '');
    return /^[A-Za-z0-9_.#]{2,40}$/.test(v) ? v : null;
  }

  function refreshLists() {
    if (ui.tab === 'leads') renderLeads();
    if (ui.tab === 'search') renderResults();
    updateBadge();
  }

  // ---------------------------------------------------------------- personalização e envio
  function personalize(lead) {
    const v = { name: lead.name || C.cleanName(lead.title), title: lead.title, subs: lead.subs, handle: lead.handle, url: channelUrl(lead) };
    return { subject: C.fill(tpl.subject, v), body: C.fill(tpl.body, v), dm: C.fill(tpl.dm, v) };
  }

  let leftoversOk = false;
  function checkLeftovers(text) {
    if (leftoversOk) return true;
    const left = C.leftovers(text);
    if (!left.length) return true;
    const ok = confirm(`Sua mensagem ainda tem texto de exemplo: ${left.join(', ')}\n\nEnviar mesmo assim? (Troque na aba Mensagem.)`);
    if (ok) leftoversOk = true;
    return ok;
  }

  function markContacted(lead, via, to, undo) {
    const prev = { status: lead.status, contactedAt: lead.contactedAt, history: (lead.history || []).slice() };
    if (lead.status === 'new') lead.status = 'contacted';
    lead.contactedAt = Date.now();
    lead.history = [...(lead.history || []), { at: Date.now(), via, to }];
    saveLeads(true);
    refreshLists();
    if (undo) {
      toast(undo, {
        action: 'Desfazer', onAction: () => { Object.assign(lead, prev); saveLeads(true); refreshLists(); },
      });
    }
  }

  const enc = encodeURIComponent;
  const encTo = to => String(to).replace(/%/g, '%25').replace(/[?&#]/g, '');

  function emailUrl(to, m) {
    switch (settings.sendMode) {
      case 'gmailapp': return `googlegmail:///co?to=${encTo(to)}&subject=${enc(m.subject)}&body=${enc(m.body)}`;
      case 'gmailweb': return `https://mail.google.com/mail/?view=cm&fs=1&to=${encTo(to)}&su=${enc(m.subject)}&body=${enc(m.body)}`;
      default: return `mailto:${encTo(to)}?subject=${enc(m.subject)}&body=${enc(m.body.replace(/\r?\n/g, '\r\n'))}`;
    }
  }

  function sendEmail(lead, to) {
    to = to || contactsOf(lead).emails[0];
    if (!to) return toast('Esse canal não tem e-mail');
    const m = personalize(lead);
    if (!checkLeftovers(m.subject + '\n' + m.body)) return;
    if (settings.sendMode === 'gmailapi') return composeGmail(lead, to, m);
    openExternal(emailUrl(to, m));
    markContacted(lead, 'E-mail', to, `E-mail aberto para ${lead.name || lead.title} · marcado como contatado`);
  }

  function contactVia(lead, kind, value) {
    if (kind === 'emails') return sendEmail(lead, value);
    const m = personalize(lead);
    if (!checkLeftovers(m.dm)) return;
    const who = lead.name || lead.title;
    switch (kind) {
      case 'whatsapp':
        openExternal(`https://wa.me/${value}?text=${enc(m.dm)}`);
        return markContacted(lead, 'WhatsApp', '+' + value, `WhatsApp aberto com a mensagem para ${who}`);
      case 'instagram':
        copyText(m.dm);
        openExternal(`https://ig.me/m/${value}`);
        return markContacted(lead, 'Instagram', '@' + value, 'Mensagem copiada — é só colar na DM do Instagram');
      case 'twitter':
        copyText(m.dm);
        openExternal(`https://x.com/${value}`);
        return markContacted(lead, 'X (Twitter)', '@' + value, 'Mensagem copiada — toque em “Mensagem” no perfil e cole');
      case 'telegram':
        copyText(m.dm);
        openExternal(`https://t.me/${value}`);
        return markContacted(lead, 'Telegram', '@' + value, 'Mensagem copiada — cole no chat do Telegram');
      case 'tiktok':
        copyText(m.dm);
        openExternal(`https://www.tiktok.com/@${value}`);
        return markContacted(lead, 'TikTok', '@' + value, 'Mensagem copiada — cole na DM do TikTok');
      case 'twitch':
        copyText(m.dm);
        openExternal(`https://www.twitch.tv/${value}`);
        return markContacted(lead, 'Twitch', '@' + value, 'Mensagem copiada — cole no sussurro da Twitch');
      case 'links':
        copyText(m.dm);
        openExternal(value);
        return toast('Mensagem copiada — procure o contato na página');
      case 'discord':
        if (/^https?:/.test(value)) {
          copyText(m.dm);
          openExternal(value);
          return markContacted(lead, 'Discord (servidor)', value, 'Mensagem copiada — entre no servidor e mande DM para o dono');
        }
        return discordSheet(lead, value, m.dm);
      default:
        return null;
    }
  }

  function discordSheet(lead, user, dm) {
    openSheet('Discord — ' + user, [
      h('p', { class: 'hint', style: 'margin-top:0' }, 'O Discord não deixa abrir uma DM direto pelo link. Adicione o usuário como amigo e cole a mensagem:'),
      h('div', { class: 'block' }, h('div', { class: 'pv-dm', style: 'white-space:pre-wrap' }, dm)),
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { copyText(user); toast('Usuário copiado: ' + user); } }, icon('copy'), 'Copiar usuário'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { copyText(dm); toast('Mensagem copiada'); } }, icon('copy'), 'Copiar mensagem'),
        h('button', {
          type: 'button', class: 'btn primary', onclick: () => {
            copyText(dm);
            openExternal('https://discord.com/channels/@me');
            markContacted(lead, 'Discord', user, 'Mensagem copiada — adicione ' + user + ' e cole');
            closeSheet();
          },
        }, icon('open'), 'Copiar mensagem e abrir Discord')),
    ]);
  }

  // ---------------------------------------------------------------- Gmail (envio automático)
  function gmailReady() { return !!(gmail && gmail.token && gmail.exp > Date.now() + 30000); }
  function redirectUri() { return new URL('./', location.href).href; }

  function gmailConnect() {
    const id = (settings.clientId || '').trim();
    if (!id) { toast('Cole o ID do cliente OAuth em Ajustes'); go('settings'); $('#gmailBox').scrollIntoView({ block: 'center' }); return; }
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    store.set('oauth', { state, tab: ui.tab });
    const p = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: GMAIL_SCOPE,
      include_granted_scopes: 'true', state, prompt: 'select_account',
    });
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
  }

  function handleOAuthReturn() {
    const hash = location.hash || '';
    if (!/access_token=|error=/.test(hash)) return null;
    const p = new URLSearchParams(hash.slice(1));
    const saved = store.get('oauth', {});
    store.del('oauth');
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('error')) { setTimeout(() => toast('Gmail não conectado: ' + p.get('error')), 300); return saved.tab; }
    if (!saved.state || p.get('state') !== saved.state) { setTimeout(() => toast('Falha de segurança ao conectar. Tente de novo.'), 300); return saved.tab; }
    gmail = { token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in') || 3600) - 60) * 1000 };
    store.set('gmail', gmail);
    setTimeout(() => toast('Gmail conectado ✓ — vale por 1 hora'), 300);
    return saved.tab || 'search';
  }

  function needGmail(after) {
    openSheet('Conectar o Gmail', [
      h('p', { style: 'margin-top:0' }, settings.clientId
        ? 'O login do Gmail expira a cada 1 hora por segurança. Conecte de novo para enviar.'
        : 'Para enviar automaticamente, configure o envio pelo Gmail em Ajustes (uma vez só).'),
      h('div', { class: 'sheet-actions' },
        settings.clientId
          ? h('button', { type: 'button', class: 'btn primary', onclick: gmailConnect }, 'Conectar Gmail')
          : h('button', { type: 'button', class: 'btn primary', onclick: () => { closeSheet(); go('settings'); $('#guide-gmail').open = true; } }, 'Abrir Ajustes'),
        after ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { closeSheet(); after(); } }, 'Usar o app de e-mail desta vez') : ''),
    ]);
  }

  async function gmailSend(to, subject, body) {
    if (!gmailReady()) { const e = new Error('Login do Gmail expirou'); e.auth = true; throw e; }
    let res;
    try {
      res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + gmail.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: C.buildRawEmail({ to, subject, body }) }),
      });
    } catch (_) {
      throw new Error('Sem conexão com o Gmail');
    }
    if (res.status === 401) {
      gmail = null; store.del('gmail'); renderGmailStatus();
      const e = new Error('Login do Gmail expirou'); e.auth = true; throw e;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const msg = (d.error && d.error.message) || String(res.status);
      const e = new Error('Gmail: ' + msg);
      if (res.status === 403 && /insufficient|scope|not enabled|has not been used/i.test(msg)) e.auth = /insufficient|scope/i.test(msg);
      throw e;
    }
  }

  function composeGmail(lead, to, m) {
    if (!gmailReady()) {
      return needGmail(() => { openExternal(`mailto:${encTo(to)}?subject=${enc(m.subject)}&body=${enc(m.body)}`); markContacted(lead, 'E-mail', to, 'E-mail aberto no app · marcado como contatado'); });
    }
    const subj = h('input', { type: 'text', value: m.subject });
    const body = h('textarea', { rows: 10 });
    body.value = m.body;
    const btn = h('button', { type: 'button', class: 'btn primary big' }, icon('send'), 'Enviar agora');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.lastChild.textContent = 'Enviando…';
      try {
        await gmailSend(to, subj.value, body.value);
        closeSheet();
        markContacted(lead, 'E-mail (Gmail)', to, null);
        toast('E-mail enviado para ' + to + ' ✓');
      } catch (e) {
        btn.disabled = false;
        btn.lastChild.textContent = 'Enviar agora';
        if (e.auth) needGmail(); else toast(e.message, { ms: 6000 });
      }
    });
    openSheet('E-mail para ' + (lead.name || lead.title), [
      h('div', { class: 'block', style: 'margin-top:0' },
        h('h3', null, 'Para'), h('div', null, to),
        h('label', { class: 'label' }, 'Assunto'), subj,
        h('label', { class: 'label' }, 'Mensagem (pode ajustar só para este)'), body),
      btn,
    ]);
  }

  // fila de envio em massa
  let queue = null;
  function startEmailQueue(ids) {
    const list = ids.map(id => leads[id]).filter(l => l && contactsOf(l).emails.length);
    if (!list.length) return toast('Nenhum dos selecionados tem e-mail');
    const first = personalize(list[0]);
    if (!checkLeftovers(first.subject + '\n' + first.body)) return;
    if (settings.sendMode === 'gmailapi') {
      if (!gmailReady()) return needGmail(() => { queue = { list, i: 0 }; renderManualQueue(); });
      return autoQueueIntro(list);
    }
    queue = { list, i: 0 };
    renderManualQueue();
  }

  function renderManualQueue() {
    const { list, i } = queue;
    if (i >= list.length) {
      openSheet('Fila concluída', [
        h('p', { style: 'margin-top:0' }, `Pronto! ${list.length} e-mail(s) abertos. Todos foram marcados como “Contatado”.`),
        h('button', { type: 'button', class: 'btn primary big', onclick: () => closeSheet() }, 'Fechar'),
      ]);
      return;
    }
    const lead = list[i];
    const to = contactsOf(lead).emails[0];
    const m = personalize(lead);
    openSheet(`E-mail ${i + 1} de ${list.length}`, [
      h('div', { class: 'queue-prog' }, h('span', { style: `width:${(i / list.length) * 100}%` })),
      h('div', { class: 'block', style: 'margin-top:0' },
        h('div', { class: 'ld-head' },
          h('img', { class: 'avatar', src: lead.thumb || 'icons/icon-192.png', alt: '', referrerpolicy: 'no-referrer', width: 48, height: 48, style: 'width:48px;height:48px' }),
          h('div', null, h('b', null, lead.name || lead.title), h('div', { class: 'ld-stats' }, to))),
        h('div', { class: 'preview', style: 'padding:12px 0 0' },
          h('div', { class: 'pv-label' }, 'Assunto'), h('div', { class: 'pv-subject' }, m.subject),
          h('div', { class: 'pv-label' }, 'E-mail'), h('div', { class: 'pv-body', style: 'max-height:200px;overflow:auto' }, m.body))),
      h('div', { class: 'sheet-actions' },
        h('button', {
          type: 'button', class: 'btn primary big', onclick: () => {
            openExternal(emailUrl(to, m));
            markContacted(lead, 'E-mail', to, null);
            queue.i++;
            renderManualQueue();
          },
        }, icon('send'), 'Abrir e-mail pronto'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { queue.i++; renderManualQueue(); } }, 'Pular este')),
      h('p', { class: 'hint' }, 'Envie no app de e-mail e volte aqui — o próximo já vai estar esperando.'),
    ]);
  }

  function autoQueueIntro(list) {
    const m = personalize(list[0]);
    openSheet(`Enviar ${list.length} e-mail(s)`, [
      h('p', { style: 'margin-top:0' }, `Vou enviar pelo Gmail, um a cada ${settings.delaySec} s, trocando (cliente) pelo nome de cada um. Deixe o app aberto durante o envio.`),
      h('div', { class: 'block preview' },
        h('div', { class: 'pv-label' }, 'Exemplo — ' + (list[0].name || list[0].title)),
        h('div', { class: 'pv-subject' }, m.subject),
        h('div', { class: 'pv-body', style: 'max-height:180px;overflow:auto;margin-top:6px' }, m.body)),
      h('button', { type: 'button', class: 'btn primary big', onclick: () => runAutoQueue(list) }, icon('send'), `Começar envio (${list.length})`),
    ]);
  }

  async function runAutoQueue(list) {
    let cancelled = false;
    let lock = null;
    try { lock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (_) { /* ignore */ }
    const prog = h('span', { style: 'width:0' });
    const label = h('div', { class: 'ld-stats' }, 'Começando…');
    const log = h('ul', { class: 'qlog' });
    const stop = h('button', { type: 'button', class: 'btn ghost wide', onclick: () => { cancelled = true; stop.disabled = true; stop.textContent = 'Parando…'; } }, 'Parar envio');
    openSheet('Enviando…', [h('div', { class: 'queue-prog' }, prog), label, log, stop], () => { cancelled = true; });
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < list.length && !cancelled; i++) {
      const lead = list[i];
      const to = contactsOf(lead).emails[0];
      label.textContent = `Enviando ${i + 1} de ${list.length}: ${lead.name || lead.title}`;
      const m = personalize(lead);
      try {
        await gmailSend(to, m.subject, m.body);
        sent++;
        markContacted(lead, 'E-mail (Gmail)', to, null);
        log.prepend(h('li', { class: 'ok' }, '✓ ' + (lead.name || lead.title) + ' — ' + to));
      } catch (e) {
        failed++;
        log.prepend(h('li', { class: 'bad' }, '✗ ' + (lead.name || lead.title) + ' — ' + e.message));
        if (e.auth) { label.textContent = 'O login do Gmail expirou. Conecte de novo e continue com os que faltam.'; break; }
      }
      prog.style.width = ((i + 1) / list.length) * 100 + '%';
      if (i < list.length - 1 && !cancelled) {
        for (let s = Number(settings.delaySec || 10); s > 0 && !cancelled; s--) {
          label.textContent = `${sent} enviado(s). Próximo em ${s} s…`;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    if (lock) lock.release().catch(() => {});
    if (!$('#sheet').hidden) {
      $('#sheetTitle').textContent = cancelled ? 'Envio parado' : 'Envio concluído';
      if (!/expirou/.test(label.textContent)) label.textContent = `${sent} enviado(s)${failed ? `, ${failed} com erro` : ''}.`;
      stop.disabled = false;
      stop.textContent = 'Fechar';
      stop.onclick = () => closeSheet();
    }
    toast(`${sent} e-mail(s) enviados${failed ? ` · ${failed} com erro` : ''}`);
  }

  // ---------------------------------------------------------------- MENSAGEM
  function renderTemplateView() {
    $('#tSubject').value = tpl.subject;
    $('#tBody').value = tpl.body;
    $('#tDm').value = tpl.dm;
    autoGrow($('#tBody'));
    autoGrow($('#tDm'));
    renderTplPreview();
  }
  function renderTplPreview() {
    const sample = Object.values(leads).find(l => contactsOf(l).emails.length) || Object.values(leads)[0] ||
      { id: 'x', title: 'SteveCraft | Minecraft SMP', name: 'Steve', subs: 52300, handle: '@stevecraft' };
    const m = personalize(sample);
    $('#tplPreview').replaceChildren(
      h('div', { class: 'pv-label' }, 'Exemplo com: ' + sample.title),
      h('div', { class: 'pv-label' }, 'Assunto'), h('div', { class: 'pv-subject' }, m.subject),
      h('div', { class: 'pv-label' }, 'E-mail'), h('div', { class: 'pv-body' }, m.body),
      h('div', { class: 'pv-label' }, 'DM'), h('div', { class: 'pv-dm' }, m.dm));
    const left = C.leftovers(tpl.subject + '\n' + tpl.body + '\n' + tpl.dm);
    const hasVar = /[([{]\s*(cliente|nome|client|name)\s*[)\]}]/i.test(tpl.subject + tpl.body);
    const warn = $('#tplWarn');
    const msgs = [];
    if (left.length) msgs.push('Troque os textos de exemplo entre colchetes: ' + left.join(', '));
    if (!hasVar) msgs.push('Dica: coloque (cliente) no texto para personalizar com o nome de cada youtuber.');
    warn.hidden = !msgs.length;
    warn.replaceChildren(...msgs.map(t => h('div', null, t)));
  }
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 560) + 'px';
  }
  [['#tSubject', 'subject'], ['#tBody', 'body'], ['#tDm', 'dm']].forEach(([s, k]) => {
    const el = $(s);
    el.addEventListener('input', () => {
      tpl[k] = el.value;
      store.set('tpl', tpl);
      leftoversOk = false;
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      renderTplPreview();
    });
    el.addEventListener('focus', () => { ui.lastField = el; });
  });
  $('#varChips').replaceChildren(...C.VAR_HELP.map(([v, desc]) => h('button', {
    type: 'button', class: 'chip', title: desc,
    onmousedown: e => e.preventDefault(),
    onclick: () => {
      const el = ui.lastField || $('#tBody');
      const s = el.selectionStart != null ? el.selectionStart : el.value.length;
      const e2 = el.selectionEnd != null ? el.selectionEnd : el.value.length;
      el.value = el.value.slice(0, s) + v + el.value.slice(e2);
      el.focus();
      el.setSelectionRange(s + v.length, s + v.length);
      el.dispatchEvent(new Event('input'));
    },
  }, v)));
  $$('[data-reset]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Substituir sua mensagem pelo modelo padrão?')) return;
    tpl = { ...C.DEFAULT_TEMPLATES[b.dataset.reset] };
    store.set('tpl', tpl);
    renderTemplateView();
  }));

  // ---------------------------------------------------------------- AJUSTES
  function renderSettings() {
    $('#sKey').value = settings.apiKey;
    $('#sClientId').value = settings.clientId;
    $('#sDelay').value = String(settings.delaySec);
    $('#sPages').value = String(settings.pages);
    $$('#sMode input').forEach(r => { r.checked = r.value === settings.sendMode; });
    $('#gmailBox').hidden = settings.sendMode !== 'gmailapi';
    $$('code[data-copy]').forEach(c => {
      const v = { origin: location.origin, 'origin-wild': location.origin + '/*', redirect: redirectUri() }[c.dataset.copy];
      c.textContent = v;
    });
    renderGmailStatus();
  }
  function renderGmailStatus() {
    const ok = gmailReady();
    const mins = ok ? Math.round((gmail.exp - Date.now()) / 60000) : 0;
    $('#gmailStatus').replaceChildren(h('span', { class: 'dot' + (ok ? ' on' : '') }), ok ? `Conectado (expira em ${mins} min)` : 'Não conectado');
    $('#gmailDisconnect').hidden = !ok;
    $('#gmailConnect').textContent = ok ? 'Reconectar' : 'Conectar Gmail';
  }
  $('#sKeyShow').addEventListener('click', () => {
    const i = $('#sKey');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#sKeyShow').textContent = i.type === 'password' ? 'Ver' : 'Ocultar';
  });
  $('#sKeySave').addEventListener('click', () => {
    settings.apiKey = $('#sKey').value.trim();
    store.set('settings', settings);
    renderKeyCard();
    toast(settings.apiKey ? 'Chave salva ✓' : 'Chave removida');
  });
  $('#sKeyTest').addEventListener('click', async () => {
    settings.apiKey = $('#sKey').value.trim();
    store.set('settings', settings);
    renderKeyCard();
    const out = $('#sKeyStatus');
    if (!settings.apiKey) { out.textContent = 'Cole a chave primeiro.'; return; }
    out.textContent = 'Testando…';
    try {
      await yt('channels', { part: 'id', id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' }, 1);
      out.textContent = '✓ Funcionando! Já pode buscar.';
    } catch (e) {
      out.textContent = '✗ ' + e.message;
    }
  });
  $('#sMode').addEventListener('change', e => {
    settings.sendMode = e.target.value;
    store.set('settings', settings);
    $('#gmailBox').hidden = settings.sendMode !== 'gmailapi';
  });
  $('#sClientId').addEventListener('change', e => { settings.clientId = e.target.value.trim(); store.set('settings', settings); });
  $('#sDelay').addEventListener('change', e => { settings.delaySec = Number(e.target.value); store.set('settings', settings); });
  $('#sPages').addEventListener('change', e => { settings.pages = Number(e.target.value); store.set('settings', settings); });
  $('#gmailConnect').addEventListener('click', () => { settings.clientId = $('#sClientId').value.trim(); store.set('settings', settings); gmailConnect(); });
  $('#gmailDisconnect').addEventListener('click', () => {
    if (gmail && gmail.token) fetch('https://oauth2.googleapis.com/revoke?token=' + enc(gmail.token), { method: 'POST' }).catch(() => {});
    gmail = null;
    store.del('gmail');
    renderGmailStatus();
    toast('Gmail desconectado');
  });
  $$('code[data-copy]').forEach(c => c.addEventListener('click', () => { copyText(c.textContent); toast('Copiado'); }));
  $('#sExportCsv').addEventListener('click', () => exportCsv(Object.values(leads)));
  $('#sBackup').addEventListener('click', backup);
  $('#sRestore').addEventListener('click', () => $('#sRestoreFile').click());
  $('#sRestoreFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.app !== 'prospecta' || typeof data.leads !== 'object') throw new Error();
      let n = 0;
      for (const [id, l] of Object.entries(data.leads)) {
        if (!l || typeof l !== 'object' || !/^UC[\w-]{10,}$/.test(id)) continue;
        if (!leads[id] || (l.updatedAt || 0) >= (leads[id].updatedAt || 0)) { leads[id] = { ...l, id, manual: l.manual || C.emptyContacts(), auto: l.auto || C.emptyContacts(), history: l.history || [] }; n++; }
      }
      if (data.tpl && confirm('O backup tem uma mensagem padrão. Usar a do backup?')) { tpl = { ...tpl, ...data.tpl }; store.set('tpl', tpl); }
      if (data.clientId && !settings.clientId) { settings.clientId = data.clientId; store.set('settings', settings); }
      saveLeads(true);
      renderSettings();
      toast(`${n} lead(s) restaurados`);
    } catch (_) {
      toast('Arquivo de backup inválido');
    }
  });
  $('#sWipe').addEventListener('click', () => {
    const n = Object.keys(leads).length;
    if (!n) return toast('Não há leads');
    if (!confirm(`Apagar ${n} lead(s) deste aparelho? Não dá para desfazer (faça um backup antes).`)) return;
    leads = {};
    session = null;
    store.del('session');
    saveLeads(true);
    renderResults();
    toast('Leads apagados');
  });

  function backup() {
    const data = { app: 'prospecta', version: 1, exportedAt: new Date().toISOString(), leads, tpl, search, recent, clientId: settings.clientId };
    download(`prospecta-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  }

  function exportCsv(list) {
    if (!list.length) return toast('Nenhum lead para exportar');
    const cols = ['Canal', 'Nome (cliente)', 'Handle', 'Link', 'Inscritos', 'Vídeos', 'País', 'E-mails', 'X/Twitter', 'Discord', 'Instagram', 'TikTok', 'Twitch', 'Telegram', 'WhatsApp', 'Outros links', 'Status', 'Contatado em', 'Via', 'Busca', 'Notas'];
    const esc = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas no Excel/Sheets
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = list.map(l => {
      const c = contactsOf(l);
      const last = (l.history || []).slice(-1)[0];
      return [
        l.title, l.name, l.handle, channelUrl(l), l.subs == null ? '' : l.subs, l.videos || '', l.country || '',
        c.emails.join(' '), c.twitter.map(x => '@' + x).join(' '), c.discord.join(' '), c.instagram.map(x => '@' + x).join(' '),
        c.tiktok.map(x => '@' + x).join(' '), c.twitch.join(' '), c.telegram.join(' '), c.whatsapp.join(' '), c.links.join(' '),
        STATUS[l.status] || l.status, l.contactedAt ? new Date(l.contactedAt).toLocaleString('pt-BR') : '', last ? last.via : '', l.query || '', l.notes || '',
      ].map(esc).join(',');
    });
    download(`prospecta-leads-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [cols.join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------------------------------------------------------------- navegação
  function go(tab) {
    ui.tab = tab;
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
    $$('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    if (tab !== 'leads') { ui.selecting = false; ui.selected.clear(); }
    if (tab === 'search') { renderKeyCard(); renderResults(); }
    if (tab === 'leads') renderLeads();
    if (tab === 'message') renderTemplateView();
    if (tab === 'settings') renderSettings();
    renderBulk();
    store.set('tab', tab);
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  $$('[data-go]').forEach(b => b.addEventListener('click', () => {
    go(b.dataset.go);
    if (b.dataset.open) { const d = $('#' + b.dataset.open); d.open = true; setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); }
  }));

  // ---------------------------------------------------------------- início
  const returnTab = handleOAuthReturn();
  fillSearchForm();
  renderQuota();
  updateBadge();
  go(returnTab || store.get('tab', 'search'));
})();
