// Rode com: node --test prospect/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

test('acha e-mail comum e com "business inquiries"', () => {
  const { contacts } = C.extractContacts('Business inquiries: SteveBuilds@Gmail.com\nThanks for watching!');
  assert.deepEqual(contacts.emails, ['stevebuilds@gmail.com']);
});

test('desfaz e-mail escondido [at] (dot) e "at ... dot"', () => {
  const a = C.extractContacts('contato: canal [at] gmail [dot] com').contacts.emails;
  const b = C.extractContacts('email me: joe at outlook dot com please').contacts.emails;
  const c = C.extractContacts('mgmt (arroba) agencia.com.br').contacts.emails;
  assert.deepEqual(a, ['canal@gmail.com']);
  assert.deepEqual(b, ['joe@outlook.com']);
  assert.deepEqual(c, ['mgmt@agencia.com.br']);
});

test('não confunde imagens, domínios de redes e texto colado', () => {
  const { contacts } = C.extractContacts('logo@2x.png  me@twitter.com  biz@studio.comTwitter: @foo');
  assert.deepEqual(contacts.emails, ['biz@studio.com']);
});

test('redes sociais por link e por rótulo', () => {
  const text = [
    'Twitter: https://twitter.com/SteveBuilds',
    'X (Twitter): @steve_alt',
    'Insta: @steve.builds',
    'https://www.tiktok.com/@stevetok',
    'Live: https://twitch.tv/stevelive',
    'Join the Discord! https://discord.gg/AbC123',
    'Discord: steve.builds',
    'https://t.me/stevechannel',
    'https://wa.me/5511999998888',
    'Links: https://linktr.ee/steve  https://youtube.com/@steve  https://store.steve.com/',
  ].join('\n');
  const { contacts } = C.extractContacts(text);
  assert.deepEqual(contacts.twitter, ['SteveBuilds', 'steve_alt']);
  assert.deepEqual(contacts.instagram, ['steve.builds']);
  assert.deepEqual(contacts.tiktok, ['stevetok']);
  assert.deepEqual(contacts.twitch, ['stevelive']);
  assert.deepEqual(contacts.discord, ['https://discord.gg/AbC123', 'steve.builds']);
  assert.deepEqual(contacts.telegram, ['stevechannel']);
  assert.deepEqual(contacts.whatsapp, ['5511999998888']);
  assert.deepEqual(contacts.links, ['https://linktr.ee/steve', 'https://store.steve.com/']);
});

test('não pega falsos positivos comuns', () => {
  const text = [
    'Download at dropbox.com/s/abc and box.com/files',
    'Discord: https://discord.gg/xyz',
    'Discord: Join the community and have fun',
    'email: hi@x.com',
    'https://x.com/intent/follow?screen_name=abc',
    'https://instagram.com/p/Cxyz123',
  ].join('\n');
  const { contacts } = C.extractContacts(text);
  assert.deepEqual(contacts.twitter, []);
  assert.deepEqual(contacts.instagram, []);
  assert.deepEqual(contacts.discord, ['https://discord.gg/xyz']);
});

test('descrições de vídeos: só entra o que se repete ou bate com o nome', () => {
  const template = 'Business: crafty@gmail.com\nTwitter: https://x.com/CraftyMC\nDiscord: https://discord.gg/crafty';
  const out = C.collectContacts({
    channelText: 'I make Minecraft adventure maps!',
    videoTexts: [
      template + '\nCollab with https://twitter.com/OtherGuy',
      template + '\nSponsor: sales@sponsorco.com',
      template,
    ],
    names: ['Crafty MC', 'craftymc'],
  });
  assert.deepEqual(out.emails, ['crafty@gmail.com']);
  assert.deepEqual(out.twitter, ['CraftyMC']);
  assert.deepEqual(out.discord, ['https://discord.gg/crafty']);
});

test('e-mail de vídeo com contexto de negócio entra mesmo aparecendo 1 vez', () => {
  const out = C.collectContacts({
    channelText: '',
    videoTexts: ['For business inquiries: team@smpstudio.net', 'just a video', 'another one'],
    names: ['Some Channel'],
  });
  assert.deepEqual(out.emails, ['team@smpstudio.net']);
});

test('hasAny ignora links que não são de bio', () => {
  assert.equal(C.hasAny({ ...C.emptyContacts(), links: ['https://store.com'] }), false);
  assert.equal(C.hasAny({ ...C.emptyContacts(), links: ['https://linktr.ee/a'] }), true);
  assert.equal(C.hasAny({ ...C.emptyContacts(), twitter: ['a'] }), true);
});

test('personaliza (cliente) e variações', () => {
  const lead = { name: 'Steve', title: 'SteveBuilds | Minecraft', subs: 52300, handle: '@stevebuilds', url: 'https://youtube.com/@stevebuilds' };
  assert.equal(C.fill('Olá (cliente)! Vi o (canal).', lead), 'Olá Steve! Vi o SteveBuilds | Minecraft.');
  assert.equal(C.fill('Hi {cliente} [Cliente] {{ cliente }} (CLIENTE)', lead), 'Hi Steve Steve Steve Steve');
  assert.equal(C.fill('(inscritos) / (subs) / (handle)', lead), '52,3 mil / 52.3K / @stevebuilds');
  assert.equal(C.fill('Mantém (risos) e [Seu nome]', lead), 'Mantém (risos) e [Seu nome]');
});

test('limpa nome do canal', () => {
  assert.equal(C.cleanName('Grian | Hermitcraft'), 'Grian');
  assert.equal(C.cleanName('🔥 SteveBuilds 🔥'), 'SteveBuilds');
  assert.equal(C.cleanName('Mumbo Jumbo'), 'Mumbo Jumbo');
  assert.equal(C.cleanName('Artist - Topic'), 'Artist');
  assert.equal(C.cleanName('Crafty Official'), 'Crafty');
});

test('monta e-mail RFC 2822 em UTF-8', () => {
  const raw = C.buildRawEmail({ to: 'a@b.com', subject: 'Olá (ação)', body: 'Linha 1\nLinha ç' });
  const msg = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(msg, /^To: a@b\.com\r\n/);
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  const subj = msg.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1];
  assert.equal(Buffer.from(subj, 'base64').toString('utf8'), 'Olá (ação)');
  const body = msg.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Linha 1\r\nLinha ç');
});

test('impede injeção de cabeçalho no destinatário', () => {
  const raw = C.buildRawEmail({ to: 'a@b.com\r\nBcc: x@y.com', subject: 'oi', body: 'x' });
  const msg = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.doesNotMatch(msg, /\r\nBcc:/);
});

test('monta a busca com E / OU / exclusão', () => {
  assert.equal(C.buildQuery(['minecraft adventure', 'smp'], 'all'), 'minecraft adventure smp');
  assert.equal(C.buildQuery(['minecraft adventure', 'smp'], 'any'), '"minecraft adventure"|smp');
  assert.equal(C.buildQuery(['smp', '-roblox'], 'all'), 'smp -roblox');
  assert.deepEqual(C.splitTags('Minecraft Adventure, SMP;#hardcore'), ['Minecraft Adventure', 'SMP', 'hardcore']);
});

test('acha textos de exemplo esquecidos', () => {
  assert.deepEqual(C.leftovers('Abraço,\n[Seu nome]'), ['[Seu nome]']);
  assert.deepEqual(C.leftovers('tudo certo'), []);
});
