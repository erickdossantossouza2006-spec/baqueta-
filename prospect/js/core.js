/*
 * Prospecta — lógica pura (sem DOM): extração de contatos, personalização
 * de mensagens e montagem de e-mail. Funciona no navegador e no Node (testes).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProspectCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const KINDS = ['emails', 'twitter', 'discord', 'instagram', 'tiktok', 'twitch', 'telegram', 'whatsapp', 'links'];

  function emptyContacts() {
    const o = {};
    for (const k of KINDS) o[k] = [];
    return o;
  }

  // ---------- normalização de texto ----------

  // Desfaz e-mails "escondidos": nome [at] gmail [dot] com, nome (arroba) ..., nome @ gmail.com
  function deobfuscate(text) {
    return String(text || '')
      .replace(/＠/g, '@')
      .replace(/\s*[[({<]\s*(?:at|arroba)\s*[\])}>]\s*/gi, '@')
      .replace(/\s*[[({<]\s*(?:dot|ponto)\s*[\])}>]\s*/gi, '.')
      .replace(/\b([A-Za-z0-9._%+-]+)\s+(?:at|arroba)\s+([A-Za-z0-9-]+)\s+(?:dot|ponto)\s+([A-Za-z]{2,10})\b/gi, '$1@$2.$3')
      .replace(/(@[A-Za-z0-9-]+)\s+(?:dot|ponto)\s+([A-Za-z]{2,10})\b/gi, '$1.$2')
      .replace(/\b([A-Za-z0-9._%+-]+) @ ([A-Za-z0-9-]+\.[A-Za-z]{2,24})\b/g, '$1@$2');
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }

  // ---------- padrões ----------

  // "não precedido por caractere de domínio" — evita casar box.com, fox.com, foo@x.com...
  const NB = '(?<![A-Za-z0-9._%+@-])';
  const SEP = '\\s*[:\\-–—|»>=]*\\s*';

  const RX = {
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g,
    twitterUrl: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.|mobile\\.|m\\.)?(?:twitter|x)\\.com\\/(?:#!\\/)?@?([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])', 'gi'),
    twitterLabel: new RegExp('(?:^|[^A-Za-z0-9])(?:twitter|x)(?![A-Za-z0-9])\\s*(?:\\(\\s*(?:x|twitter)\\s*\\)|\\/\\s*(?:x|twitter))?' + SEP + '@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_]|\\.[A-Za-z]|@)', 'gi'),
    instagramUrl: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.|m\\.)?(?:instagram\\.com|instagr\\.am)\\/([A-Za-z0-9_.]{1,30})', 'gi'),
    instagramLabel: new RegExp('(?:^|[^A-Za-z0-9])(?:instagram|insta|ig)(?![A-Za-z0-9])' + SEP + '@([A-Za-z0-9_.]{1,30})', 'gi'),
    tiktokUrl: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.|m\\.)?tiktok\\.com\\/@([A-Za-z0-9_.]{2,24})', 'gi'),
    tiktokLabel: new RegExp('(?:^|[^A-Za-z0-9])tik\\s?tok(?![A-Za-z0-9])' + SEP + '@([A-Za-z0-9_.]{2,24})', 'gi'),
    twitchUrl: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.|m\\.)?twitch\\.tv\\/([A-Za-z0-9_]{3,25})', 'gi'),
    discordInvite: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.)?(discord\\.gg|discord(?:app)?\\.com\\/invite|dsc\\.gg)\\/([A-Za-z0-9-]{2,40})', 'gi'),
    // "Discord: usuario" (só quando o usuário fecha a linha, para não pegar frases)
    discordUser: /(?:^|[^A-Za-z0-9])discord(?:\s*(?:username|user|tag|id|name|nick|usu[aá]rio))?\s*[:\-–—|»>=]+\s*@?(?!https?\b|discord\b|www\b)([A-Za-z0-9_.]{2,32}(?:#\d{4})?)[ \t]*(?=$|[\r\n|,;•])/gim,
    telegramUrl: new RegExp(NB + '(?:https?:\\/\\/)?(?:www\\.)?(?:t\\.me|telegram\\.me)\\/([A-Za-z0-9_]{4,32})(?![A-Za-z0-9_])', 'gi'),
    whatsapp: new RegExp(NB + '(?:https?:\\/\\/)?(?:wa\\.me\\/|api\\.whatsapp\\.com\\/send\\/?\\?phone=)\\+?(\\d{8,15})', 'gi'),
    url: /https?:\/\/[^\s<>"'`()[\]{}]+/gi,
  };

  const EXCLUDE = {
    twitter: new Set(['intent', 'share', 'home', 'i', 'search', 'hashtag', 'messages', 'explore', 'settings', 'notifications', 'login', 'signup', 'tos', 'privacy', 'compose', 'account', 'about', 'download', 'gmail', 'hotmail', 'outlook', 'yahoo']),
    instagram: new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'direct', 'about', 'developer', 'legal', 'gmail', 'hotmail', 'outlook']),
    twitch: new Set(['videos', 'directory', 'p', 'downloads', 'jobs', 'settings', 'subscriptions', 'prime', 'subs', 'turbo', 'search']),
    telegram: new Set(['joinchat', 'share', 'addstickers', 'proxy', 'socks', 'iv']),
    tiktok: new Set([]),
  };

  const LINK_IN_BIO = /(^|\.)(linktr\.ee|beacons\.ai|beacons\.page|carrd\.co|bio\.link|solo\.to|lnk\.bio|linkin\.bio|campsite\.bio|allmylinks\.com|msha\.ke|hoo\.be|komi\.io|snipfeed\.co|stan\.store|linkfly\.to|taplink\.cc|bento\.me|link\.me|tap\.bio|about\.me|guns\.lol|e-z\.bio|linkr\.bio|flow\.page|linkpop\.com|lit\.link|withkoji\.com)$/i;
  const LINK_SKIP = /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|instagr\.am|tiktok\.com|discord\.gg|discord\.com|discordapp\.com|dsc\.gg|twitch\.tv|t\.me|telegram\.me|wa\.me|whatsapp\.com|google\.com|goo\.gl|ggpht\.com|ytimg\.com|amzn\.to|amazon\.[a-z.]+)$/i;
  const SOCIAL_EMAIL_DOMAIN = /(^|\.)(twitter\.com|x\.com|instagram\.com|youtube\.com|tiktok\.com|discord\.gg|discord\.com|twitch\.tv|t\.me|example\.com|email\.com|domain\.com|sentry\.io)$/i;
  const BIZ = /(business|contact|e-?mail|inquir|enquir|sponsorships|partnerships?|collab|booking|management|mgmt|press|work with|parceria|contato|neg[oó]cio|publicidade|trabalho|propost|comercial)/i;

  function scan(re, text, fn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      fn(m);
      if (m[0] === '') re.lastIndex++;
    }
  }

  function cleanEmail(raw) {
    let e = String(raw).replace(/^[._%+-]+/, '').replace(/[._-]+$/, '');
    e = e.replace(/(\.[a-z]{2,6})[A-Z][A-Za-z]*$/, '$1'); // "gmail.comTwitter" -> "gmail.com"
    e = e.toLowerCase();
    const at = e.indexOf('@');
    if (at < 1) return null;
    const local = e.slice(0, at);
    const domain = e.slice(at + 1);
    if (!domain.includes('.') || local.length > 64) return null;
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|mp4|mov|webm)$/.test(domain)) return null;
    if (SOCIAL_EMAIL_DOMAIN.test(domain)) return null;
    return e;
  }

  function cleanUrl(raw) {
    const u = String(raw).replace(/[.,;:!?…*_~]+$/, '');
    try {
      const p = new URL(u);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
  }

  function isLinkInBio(u) {
    return LINK_IN_BIO.test(hostOf(u));
  }

  function makeAdder(out) {
    return (kind, value) => {
      if (!value) return;
      const key = String(value).toLowerCase();
      if (!out[kind].some(v => String(v).toLowerCase() === key)) out[kind].push(value);
    };
  }

  // ---------- extração de um texto ----------

  function extractContacts(rawText) {
    const text = deobfuscate(rawText);
    const out = emptyContacts();
    const biz = {};
    const add = makeAdder(out);

    scan(RX.email, text, m => {
      const e = cleanEmail(m[0]);
      if (!e) return;
      add('emails', e);
      if (BIZ.test(text.slice(Math.max(0, m.index - 90), m.index))) biz[e] = true;
    });

    // remove e-mails para que "x@gmail.com" não vire @gmail no X etc.
    const t = text.replace(RX.email, s => ' '.repeat(s.length));
    const handle = (kind, re) => scan(re, t, m => {
      const h = m[1].replace(/\.+$/, '');
      if (h && !EXCLUDE[kind].has(h.toLowerCase())) add(kind, h);
    });

    handle('twitter', RX.twitterUrl);
    handle('twitter', RX.twitterLabel);
    handle('instagram', RX.instagramUrl);
    handle('instagram', RX.instagramLabel);
    handle('tiktok', RX.tiktokUrl);
    handle('tiktok', RX.tiktokLabel);
    handle('twitch', RX.twitchUrl);
    handle('telegram', RX.telegramUrl);

    scan(RX.discordInvite, t, m => {
      const host = m[1].toLowerCase();
      add('discord', host === 'dsc.gg' ? 'https://dsc.gg/' + m[2] : 'https://discord.gg/' + m[2]);
    });
    scan(RX.discordUser, t, m => {
      const u = m[1].replace(/\.+$/, '');
      if (u.length >= 2 && !/^(server|link|community|comunidade|servidor|join|entre)$/i.test(u)) add('discord', u);
    });
    scan(RX.whatsapp, t, m => add('whatsapp', m[1]));

    scan(RX.url, t, m => {
      const u = cleanUrl(m[0]);
      if (!u) return;
      const host = hostOf(u);
      if (!host || LINK_SKIP.test(host)) return;
      add('links', u);
    });

    return { contacts: out, biz };
  }

  function nameMatch(value, names) {
    const v = norm(value);
    if (v.length < 3) return false;
    return (names || []).some(n => {
      const k = norm(n);
      if (k.length < 3) return false;
      return v.includes(k) || k.includes(v);
    });
  }

  /*
   * Junta contatos da descrição do canal (confiável) com os das descrições
   * dos vídeos recentes. Nos vídeos aparecem links de colabs/patrocínios, então
   * só entra o que se repete em 2+ vídeos, o que bate com o nome do canal, ou
   * e-mails com "business/contato" do lado.
   */
  function collectContacts({ channelText = '', videoTexts = [], names = [] } = {}) {
    const out = emptyContacts();
    const add = makeAdder(out);
    const main = extractContacts(channelText).contacts;
    for (const k of KINDS) main[k].forEach(v => add(k, v));

    const vids = videoTexts.filter(Boolean).map(t => extractContacts(t));
    const threshold = vids.length <= 1 ? 1 : 2;
    const biz = new Set();
    vids.forEach(v => Object.keys(v.biz).forEach(e => biz.add(e)));

    for (const k of KINDS) {
      const counts = new Map();
      const first = new Map();
      vids.forEach(({ contacts }) => {
        const seen = new Set();
        contacts[k].forEach(v => {
          const key = String(v).toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          counts.set(key, (counts.get(key) || 0) + 1);
          if (!first.has(key)) first.set(key, v);
        });
      });
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [key, n] of ranked) {
        const v = first.get(key);
        let ok;
        if (k === 'links') ok = isLinkInBio(v);
        else if (k === 'emails') {
          const [local, domain] = v.split('@');
          ok = n >= threshold || biz.has(v) || nameMatch(local, names) || nameMatch(domain.split('.')[0], names);
        } else ok = n >= threshold || nameMatch(v, names);
        if (ok) add(k, v);
      }
    }
    // link-in-bio primeiro; limita a lista
    out.links = out.links.sort((a, b) => isLinkInBio(b) - isLinkInBio(a)).slice(0, 8);
    return out;
  }

  function mergeContacts(...lists) {
    const out = emptyContacts();
    const add = makeAdder(out);
    for (const c of lists) if (c) for (const k of KINDS) (c[k] || []).forEach(v => add(k, v));
    return out;
  }

  function hasAny(c) {
    if (!c) return false;
    return KINDS.some(k => (k === 'links' ? (c.links || []).some(isLinkInBio) : (c[k] || []).length > 0));
  }

  // ---------- nomes, números, modelos ----------

  function cleanName(title) {
    const orig = String(title || '').trim();
    let s = orig.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, ' ');
    s = s.split(/\s+[|\-–—•]\s+|\s*\|\s*/)[0];
    s = s.replace(/\s*-\s*topic$/i, '').replace(/\s+(official|oficial)$/i, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s || orig;
  }

  function formatCount(n, locale) {
    if (n == null || isNaN(n)) return '';
    try {
      return new Intl.NumberFormat(locale || 'pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n).replace(/[\u00a0\u202f]/g, ' ');
    } catch (_) {
      return String(n);
    }
  }

  const VAR_HELP = [
    ['(cliente)', 'nome do cliente (editável em cada lead)'],
    ['(canal)', 'nome do canal'],
    ['(inscritos)', 'nº de inscritos — ex.: 52 mil'],
    ['(subs)', 'inscritos em inglês — ex.: 52K'],
    ['(handle)', '@ do canal'],
    ['(link)', 'link do canal'],
  ];

  function fill(template, lead) {
    lead = lead || {};
    const name = String(lead.name || lead.title || '').trim();
    const title = String(lead.title || name).trim();
    const subsPt = lead.subs != null ? formatCount(lead.subs, 'pt-BR') : '';
    const subsEn = lead.subs != null ? formatCount(lead.subs, 'en-US') : '';
    const map = {
      cliente: name, client: name, nome: name, name: name,
      canal: title, channel: title,
      inscritos: subsPt, subs: subsEn, subscribers: subsEn,
      handle: lead.handle || '', link: lead.url || '',
    };
    return String(template || '').replace(/\{\{\s*([A-Za-zÀ-ÿ]+)\s*\}\}|[([{]\s*([A-Za-zÀ-ÿ]+)\s*[)\]}]/g, (m, a, b) => {
      const k = (a || b).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }

  // textos de exemplo que o usuário esqueceu de trocar: [Seu nome], [your service]...
  function leftovers(text) {
    return [...new Set(String(text || '').match(/\[[^\]\n]{2,80}\]/g) || [])];
  }

  const DEFAULT_TEMPLATES = {
    pt: {
      subject: 'Uma ideia para o (canal)',
      body: 'Olá, (cliente)!\n\nAcompanho o (canal) e curto muito o seu conteúdo. Eu trabalho com [seu serviço — ex.: edição de vídeo / thumbnails] para criadores de Minecraft e acho que posso ajudar o canal a crescer ainda mais.\n\nPosso te mandar alguns exemplos do meu trabalho?\n\nAbraço,\n[Seu nome]',
      dm: 'Oi, (cliente)! Curto muito o (canal). Trabalho com [seu serviço] para criadores de Minecraft — posso te mandar alguns exemplos? 🙂',
    },
    en: {
      subject: 'Quick idea for (canal)',
      body: 'Hey (cliente),\n\nI\'ve been watching (canal) and really enjoy your content. I do [your service — e.g. video editing / thumbnails] for Minecraft creators, and I think I could help the channel grow even more.\n\nWould you be open to seeing a few examples of my work?\n\nBest,\n[Your name]',
      dm: 'Hey (cliente)! Big fan of (canal). I do [your service] for Minecraft creators — mind if I send you a few examples? 🙂',
    },
  };

  // ---------- e-mail (Gmail API: RFC 2822 em base64url) ----------

  function b64utf8(s) {
    const bytes = new TextEncoder().encode(String(s));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function encodeHeader(s) {
    s = String(s || '').replace(/[\r\n]+/g, ' ');
    return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + b64utf8(s) + '?=';
  }

  function buildRawEmail({ to, subject, body }) {
    const cleanTo = String(to || '').replace(/[\r\n,;]+/g, '').trim();
    const encBody = b64utf8(String(body || '').replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n').trimEnd();
    const msg = [
      'To: ' + cleanTo,
      'Subject: ' + encodeHeader(subject),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      encBody,
    ].join('\r\n');
    return btoa(msg).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ---------- busca ----------

  function buildQuery(tags, mode) {
    const pos = [];
    const neg = [];
    for (const raw of tags || []) {
      const t = String(raw).trim();
      if (!t) continue;
      if (t.startsWith('-') && t.length > 1) neg.push('-' + (/\s/.test(t.slice(1).trim()) ? '"' + t.slice(1).trim() + '"' : t.slice(1).trim()));
      else pos.push(t);
    }
    let q = mode === 'any' ? pos.map(t => (/\s/.test(t) ? '"' + t + '"' : t)).join('|') : pos.join(' ');
    if (neg.length) q = (q + ' ' + neg.join(' ')).trim();
    return q;
  }

  function splitTags(text) {
    return String(text || '').split(/[,;\n#]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  }

  return {
    KINDS, emptyContacts, deobfuscate, extractContacts, collectContacts, mergeContacts, hasAny,
    isLinkInBio, nameMatch, cleanEmail, cleanName, formatCount, fill, leftovers, VAR_HELP,
    DEFAULT_TEMPLATES, buildRawEmail, b64utf8, buildQuery, splitTags,
  };
});
