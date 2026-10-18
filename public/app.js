/* Near Social: social network for NEAR traders. Plain JS, no build step. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ icons
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    trades: '<path d="M7 7h13l-4-4"/><path d="M17 17H4l4 4"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    reply: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z"/>',
    repost: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.2-9.4A4.9 4.9 0 0 1 12 6.3a4.9 4.9 0 0 1 9.2 4.3C19.5 15.4 12 20 12 20z"/>',
    tip: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.3-.5-2.8-1.4M12 6v1.8M12 16.2V18"/>',
    share: '<path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    copytrade: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"/><path d="m12 15 2 2 4-4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortAcc = (a) => (!a ? '' : a.length > 22 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
  const nameOf = (u) => (u && u.name) || shortAcc(u && u.wallet);
  const usd = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const signedUsd = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + usd(v));
  const compactUsd = (v) => (v == null ? '—' : '$' + Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v));
  const amount = (v) => (v == null ? '—' : v >= 1000 ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v) : Number(Number(v).toPrecision(4)).toString());
  // Tiny prices: $0.0₈41 means 8 zeros after the decimal point, then 41.
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(v) {
    if (v == null || !(v > 0)) return '—';
    if (v >= 0.01) return usd(v, v >= 1 ? 2 : 4);
    const zeros = Math.floor(-Math.log10(v));
    if (zeros < 4) return '$' + v.toFixed(zeros + 3).replace(/0+$/, '');
    const digits = Math.round(v * 10 ** (zeros + 3)).toString().slice(0, 3).replace(/0+$/, '');
    return `$0.0${String(zeros).split('').map((d) => SUB[d]).join('')}${digits}`;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const txUrl = (h) => `https://nearblocks.io/txns/${encodeURIComponent(h)}`;
  const accountUrl = (a) => `https://nearblocks.io/address/${encodeURIComponent(a)}`;
  const tokenUrl = (c) => (c === 'near' ? 'https://nearblocks.io' : `https://nearblocks.io/token/${encodeURIComponent(c)}`);
  const tokenLink = (c) => (c === 'near' ? tokenUrl(c) : `#/t/${encodeURIComponent(c)}`);
  const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  const isAccount = (s) => typeof s === 'string' && s.length >= 2 && s.length <= 64 && ACCOUNT_RE.test(s);

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return `${Math.floor(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function avatar(u, size = '') {
    const h = hash((u && u.wallet) || '?');
    const a = 130 + (h % 120);
    const b = (a + 50 + ((h >> 9) % 90)) % 360;
    const letter = esc((nameOf(u) || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0) || 'N');
    return `<span class="avatar ${size}" style="background:linear-gradient(140deg,hsl(${a} 72% 46%),hsl(${b} 70% 38%))" aria-hidden="true">${letter}</span>`;
  }
  function coverStyle(acc) {
    const h = hash(acc || '');
    const a = 140 + (h % 60);
    return `background:radial-gradient(120% 140% at 0% 0%,hsl(${a} 80% 40%),transparent 60%),radial-gradient(120% 140% at 100% 100%,hsl(${(a + 120 + (h >> 8) % 80) % 360} 70% 35%),transparent 60%),#0b1f16`;
  }
  // Token icon: only images (data URI or https) reach here; the server filters them.
  function tokenIcon(t, size = '') {
    const sym = (t.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || '?';
    if (t.mint === 'near' || t.symbol === 'NEAR') return `<img class="token-icon ${size}" src="/logo.svg" alt="">`;
    if (t.icon && /^(data:image\/|https:\/\/)/.test(t.icon)) return `<img class="token-icon ${size}" src="${esc(t.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    return `<span class="token-icon ${size}">${esc(sym)}</span>`;
  }
  const tokenName = (t) => (t.symbol ? `$${t.symbol}` : shortAcc(t.mint));

  function richText(text) {
    let out = esc(text);
    out = out.replace(/https:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${url.replace(/^https:\/\//, '')}</a>`);
    out = out.replace(/(^|\s)@([a-z0-9_-]+(\.[a-z0-9_-]+)*\.(near|tg))\b/g, '$1<a href="#/u/$2">@$2</a>');
    out = out.replace(/(^|\s)\$([A-Za-z][A-Za-z0-9]{1,14})\b/g, '$1<span class="ticker">$$$2</span>');
    return out;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'app', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, ...data };
  }

  const state = { me: null, config: { appName: 'Near Social', minTipNear: 0.01 } };
  const empty = (iconName, text) => `<div class="empty">${icon(iconName)}${text}</div>`;
  const spinner = '<div class="loading"><span class="spinner"></span></div>';

  // ------------------------------------------------------------------ NEAR wallets
  let kitPromise = null;
  function walletKit() {
    if (!kitPromise) {
      kitPromise = new Promise((resolve, reject) => {
        if (window.NearWallet) return resolve();
        const s = document.createElement('script');
        s.src = '/vendor/near-wallet.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load NEAR wallets'));
        document.head.appendChild(s);
      }).then(() => window.NearWallet.setup('mainnet')).catch((err) => {
        kitPromise = null;
        throw err;
      });
    }
    return kitPromise;
  }

  // Show the wallet list; resolves with the chosen wallet instance.
  async function chooseWallet(title = 'Connect a NEAR wallet') {
    const d = openModal(title, spinner);
    const kit = await walletKit();
    const modules = kit.selector.store.getState().modules;
    return new Promise((resolve) => {
      $('.modal-body', d).innerHTML = `<p class="muted" style="margin:0 0 14px">Pick your wallet. Signing in signs a message only: no transaction, no fee.</p>
        <div class="wallet-list">${modules.map((m) => `<button class="wallet-btn" data-wallet-id="${esc(m.id)}">
          <img src="${esc(m.metadata.iconUrl || '/logo.svg')}" alt="" onerror="this.onerror=null;this.src='/logo.svg'"><span>${esc(m.metadata.name)}<span class="w-sub">${m.type === 'browser' ? 'Opens in a new window' : m.metadata.available === false ? 'Not installed' : 'Browser extension or app'}</span></span></button>`).join('')}</div>`;
      d.querySelectorAll('[data-wallet-id]').forEach((b) => b.addEventListener('click', async () => {
        const id = b.dataset.walletId;
        try { localStorage.setItem('nearWalletId', id); } catch {}
        b.disabled = true;
        resolve({ kit, id, wallet: await kit.selector.wallet(id) });
      }));
    });
  }

  async function signIn() {
    try {
      const { kit, wallet } = await chooseWallet();
      $('#modal .modal-body').innerHTML = `${spinner}<p class="muted" style="text-align:center;margin:0">Approve the sign-in message in your wallet…</p>`;
      const challenge = await api('/auth/challenge', { method: 'POST', body: {} });
      const callbackUrl = `${location.origin}/`;
      const params = { message: challenge.message, recipient: challenge.recipient, nonce: kit.Buffer.from(challenge.nonce, 'base64'), callbackUrl };
      let signed;
      try {
        signed = await wallet.signMessage(params);
      } catch (err) {
        if (/reject|cancel|closed/i.test(err.message || '')) throw err;
        await wallet.signIn({}); // some wallets want a connected account first
        signed = await wallet.signMessage(params);
      }
      if (!signed || !signed.accountId) throw new Error('The wallet did not return a signature');
      const { user, isNew } = await api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, callbackUrl } });
      $('#modal').close();
      state.me = user;
      renderChrome();
      toast(isNew ? 'Welcome to Near Social! Reading your trades…' : `Signed in as ${user.wallet}`);
      if (isNew) location.hash = '#/settings';
      else route();
    } catch (err) {
      const msg = /reject|cancel|closed/i.test(err.message || '') ? 'Sign-in cancelled' : err.message || 'Could not sign in';
      const body = $('#modal .modal-body');
      if ($('#modal').open && body) body.innerHTML = `<div class="notice">${esc(msg)}</div><button class="btn primary block" data-action="signin">Try again</button>`;
      else toast(msg);
    }
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    try {
      const kit = await walletKit();
      const w = await kit.selector.wallet();
      await w.signOut();
    } catch {
      // no wallet session to end
    }
    state.me = null;
    renderChrome();
    toast('Signed out');
    location.hash = '#/';
  }

  // ------------------------------------------------------------------ modal
  function openModal(title, html) {
    const d = $('#modal');
    d.innerHTML = `<div class="modal-head"><span>${esc(title)}</span><button class="close" data-close aria-label="Close">${icon('x', 'sm')}</button></div><div class="modal-body">${html}</div>`;
    if (!d.open) d.showModal();
    return d;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) $('#modal').close();
  });

  function requireLogin() {
    if (state.me) return true;
    openModal('Join Near Social', `<p class="muted" style="margin-top:0">Connect your NEAR wallet to post, like, repost and tip. Signing in is free and is not a transaction.</p><button class="btn primary block lg" data-action="signin">${icon('wallet')} Connect NEAR wallet</button>`);
    return false;
  }

  function tipDialog(to, postId) {
    if (!requireLogin()) return;
    const min = state.config.minTipNear;
    const d = openModal(`Tip ${nameOf(to)}`, `
      <p class="muted" style="margin-top:0">Sends NEAR from your wallet straight to <b>${esc(to.wallet)}</b>. Near Social takes nothing.</p>
      <div class="presets">${[0.1, 0.5, 1, 5].map((v) => `<button class="btn sm ${v === 0.5 ? 'on' : ''}" data-preset="${v}">${v} Ⓝ</button>`).join('')}</div>
      <label class="field"><span>Amount (NEAR)</span><input type="number" id="tipAmount" min="${min}" step="0.01" value="0.5" inputmode="decimal"></label>
      <button class="btn primary block lg" id="tipSend">${icon('tip')} Send tip</button>
      <p class="muted" id="tipStatus" style="margin:12px 0 0;min-height:1.5em"></p>`);
    d.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      $('#tipAmount').value = b.dataset.preset;
      d.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#tipSend').addEventListener('click', async () => {
      const near = Number($('#tipAmount').value);
      const status = $('#tipStatus');
      if (!(near >= min)) return void (status.textContent = `Minimum tip is ${min} NEAR`);
      if (near > 100 && !confirm(`Send ${near} NEAR? That is a lot.`)) return;
      const btn = $('#tipSend');
      btn.disabled = true;
      try {
        status.textContent = 'Opening your wallet…';
        const kit = await walletKit();
        let id = null;
        try { id = localStorage.getItem('nearWalletId'); } catch {}
        let wallet = id ? await kit.selector.wallet(id).catch(() => null) : null;
        if (!wallet) wallet = (await chooseWallet('Choose the wallet to tip with')).wallet;
        let accounts = await wallet.getAccounts().catch(() => []);
        if (!accounts.some((a) => a.accountId === state.me.wallet)) accounts = await wallet.signIn({});
        if (!accounts.some((a) => a.accountId === state.me.wallet)) throw new Error(`Switch your wallet to ${state.me.wallet} and try again.`);
        // Whole yoctoNEAR without floating point error.
        const [whole, frac = ''] = String(near).split('.');
        const deposit = (BigInt(whole) * 10n ** 24n + BigInt((frac + '0'.repeat(24)).slice(0, 24))).toString();
        status.textContent = 'Approve the transfer in your wallet…';
        const outcome = await wallet.signAndSendTransaction({ signerId: state.me.wallet, receiverId: to.wallet, actions: [{ type: 'Transfer', params: { deposit } }] });
        const txHash = outcome && (outcome.transaction?.hash || outcome.transaction_outcome?.id);
        if (!txHash) throw new Error('The wallet did not return a transaction');
        status.textContent = 'Sent. Confirming on-chain…';
        for (let i = 0; i < 20; i++) {
          const r = await api('/tips', { method: 'POST', body: { txHash, to: to.wallet, postId } });
          if (r.status !== 202) {
            $('#modal').close();
            toast(`Tipped ${r.near} NEAR`);
            route();
            return;
          }
          await new Promise((res) => setTimeout(res, 2500));
        }
        status.innerHTML = `Not confirmed yet. <a href="${txUrl(txHash)}" target="_blank" rel="noopener">View on NearBlocks</a>`;
      } catch (err) {
        status.textContent = /reject|cancel|closed/i.test(err.message || '') ? 'Cancelled' : err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ posts
  function tradeCard(t) {
    if (!t) return '';
    return `<div class="trade-card">
      ${tokenIcon(t)}
      <div class="t-main">
        <div class="t-line"><span class="badge ${t.side}">${t.side}</span><a class="t-token" href="${tokenLink(t.mint)}">${esc(tokenName(t))}</a></div>
        <div class="t-sub">${amount(t.tokenAmount)} tokens · <a href="${txUrl(t.signature)}" target="_blank" rel="noopener">view tx</a></div>
      </div>
      <div class="t-amt"><b class="num">${amount(t.quoteAmount)} ${esc(t.quoteSymbol)}</b><div class="t-sub num">≈ ${usd(t.valueUsd)}</div></div>
    </div>`;
  }

  function postHtml(p) {
    const top = p.repostedBy ? `<div class="repost-line">${icon('repost', 'sm')}<a href="#/u/${esc(p.repostedBy.wallet)}">${esc(nameOf(p.repostedBy))}</a> reposted</div>` : '';
    const body = p.kind === 'trade'
      ? `<div class="post-text muted" style="margin-bottom:4px">${p.trade && p.trade.side === 'sell' ? 'Sold' : 'Bought'} on-chain</div>${tradeCard(p.trade)}`
      : `<div class="post-text">${richText(p.body)}</div>`;
    const reply = p.replyTo ? `<div class="reply-line">Replying to <a href="#/p/${p.replyTo}">a post</a></div>` : '';
    return `<div class="repost-wrap">${top}<article class="post" data-id="${p.id}">
      <a href="#/u/${esc(p.author.wallet)}" aria-label="${esc(nameOf(p.author))}">${avatar(p.author)}</a>
      <div class="post-body">
        <div class="post-head">
          <a class="name" href="#/u/${esc(p.author.wallet)}">${esc(nameOf(p.author))}</a>
          <span class="handle">@${esc(shortAcc(p.author.wallet))}</span>
          <span class="handle">·</span>
          <a class="handle" href="#/p/${p.id}" title="${new Date(p.createdAt).toLocaleString()}">${ago(p.createdAt)}</a>
        </div>
        ${reply}${body}
        <div class="actions">
          <button class="act reply" data-action="reply" data-id="${p.id}" aria-label="Reply">${icon('reply', 'sm')}<span class="n">${p.replies || ''}</span></button>
          <button class="act repost ${p.reposted ? 'on' : ''}" data-action="repost" data-id="${p.id}" aria-label="Repost" aria-pressed="${p.reposted}">${icon('repost', 'sm')}<span class="n">${p.reposts || ''}</span></button>
          <button class="act like ${p.liked ? 'on' : ''}" data-action="like" data-id="${p.id}" aria-label="Like" aria-pressed="${p.liked}">${icon('heart', 'sm')}<span class="n">${p.likes || ''}</span></button>
          ${p.mine ? `<button class="act more" data-action="delete" data-id="${p.id}" aria-label="Delete">${icon('trash', 'sm')}</button>` : `<button class="act tip ${p.tipsNear ? 'on' : ''}" data-action="tip" data-id="${p.id}" data-wallet="${esc(p.author.wallet)}" data-name="${esc(p.author.name || '')}" aria-label="Tip">${icon('tip', 'sm')}<span class="n">${p.tipsNear ? amount(p.tipsNear) + ' Ⓝ' : ''}</span></button>`}
          <button class="act more" data-action="share" data-id="${p.id}" aria-label="Copy link">${icon('share', 'sm')}</button>
        </div>
      </div>
    </article></div>`;
  }

  function composer({ replyTo = null, placeholder = "What's happening on NEAR?" } = {}) {
    if (!state.me) {
      return replyTo ? '' : `<section class="card hero">
        <span class="kicker">${icon('spark', 'sm')} Social, backed by the chain</span>
        <h1>Where every NEAR trader's <em>profit is real</em>.</h1>
        <p>Connect your NEAR wallet and your profile shows your holdings, profit and trade history, read straight from the blockchain. No screenshots. No fake PnL.</p>
        <div class="features">
          <div class="feature">${icon('chart')}<b>Real PnL</b>Holdings and profit from your wallet</div>
          <div class="feature">${icon('repost')}<b>Social</b>Post, like, repost, reply, follow</div>
          <div class="feature">${icon('tip')}<b>Tips</b>Send NEAR to great calls in one tap</div>
        </div>
        <button class="btn primary lg" data-action="signin">${icon('wallet')} Connect NEAR wallet</button>
      </section>`;
    }
    return `<section class="card composer">
      ${avatar(state.me)}
      <form data-form="post" data-reply="${replyTo ?? ''}">
        <textarea name="body" maxlength="500" rows="2" placeholder="${esc(placeholder)}" aria-label="Post text" required></textarea>
        <div class="composer-foot"><span class="muted num" data-counter>0 / 500</span><button class="btn primary" type="submit">${replyTo ? 'Reply' : 'Post'}</button></div>
      </form>
    </section>`;
  }

  // ------------------------------------------------------------------ pages
  const main = () => $('#main');
  const setPage = (html) => { main().innerHTML = html; };
  const mobileTop = () => `<div class="mobile-top"><a class="brand" href="#/"><img src="/logo.svg" alt="" width="30" height="30">${esc(state.config.appName)}</a>${state.me ? `<a href="#/u/${esc(state.me.wallet)}">${avatar(state.me, 'sm')}</a>` : `<button class="btn sm primary" data-action="signin">Connect</button>`}</div>`;
  const pageHead = (title, sub) => `<div class="page-head"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;

  async function pageHome(tab = 'latest') {
    setPage(`${mobileTop()}<div class="stack">${composer()}
      <div><div class="tabs"><a href="#/" class="${tab === 'latest' ? 'active' : ''}">Latest</a><a href="#/following" class="${tab === 'following' ? 'active' : ''}">Following</a></div>
      <section class="card feed" id="feed">${spinner}</section></div></div>`);
    const emptyText = tab === 'following' && !state.me ? 'Connect your wallet to see people you follow.' : tab === 'following' ? 'Follow traders to fill this tab.' : 'No posts yet. Say gm!';
    await loadFeed(`/feed?tab=${tab}`, $('#feed'), emptyText);
  }

  async function loadFeed(path, el, emptyText, append = false) {
    try {
      const { posts, next } = await api(path);
      const html = posts.map(postHtml).join('');
      if (!append) el.innerHTML = html || empty('reply', esc(emptyText));
      else el.insertAdjacentHTML('beforeend', html);
      el.querySelector('[data-more]')?.remove();
      if (next) {
        el.insertAdjacentHTML('beforeend', `<div class="pad" data-more style="text-align:center"><button class="btn sm">Load more</button></div>`);
        el.querySelector('[data-more] button').addEventListener('click', () => loadFeed(`${path}${path.includes('?') ? '&' : '?'}before=${next}`, el, emptyText, true));
      }
    } catch (err) {
      el.innerHTML = empty('x', `Could not load: ${esc(err.message)}`);
    }
  }

  async function pagePost(id) {
    setPage(`${mobileTop()}${spinner}`);
    try {
      const { post, parent, replies } = await api(`/posts/${id}`);
      setPage(`${mobileTop()}<div class="stack">
        <a class="btn sm ghost" href="javascript:history.back()">← Back</a>
        ${parent ? `<section class="card feed">${postHtml(parent)}</section>` : ''}
        <section class="card feed">${postHtml(post)}</section>
        ${composer({ replyTo: post.id, placeholder: 'Post your reply' })}
        <section class="card feed"><div class="pad" style="padding-bottom:0"><h2 class="section-title">Replies</h2></div>${replies.map(postHtml).join('') || empty('reply', 'No replies yet.')}</section></div>`);
    } catch (err) {
      setPage(`${mobileTop()}<section class="card">${empty('x', esc(err.message))}</section>`);
    }
  }

  function tradeTable(trades, withUser, withToken = true) {
    return `<table><thead><tr>${withUser ? '<th>Trader</th>' : ''}<th>Side</th>${withToken ? '<th>Token</th>' : ''}<th class="r">Amount</th><th class="r">Paid / got</th><th class="r">Value</th><th class="r">When</th></tr></thead><tbody>
      ${trades.map((t) => `<tr>
        ${withUser ? `<td><a class="cell-user" href="#/u/${esc(t.wallet)}">${avatar(t.user || { wallet: t.wallet }, 'sm')} ${esc(nameOf(t.user || { wallet: t.wallet }))}</a></td>` : ''}
        <td><span class="badge ${t.side}">${t.side}</span></td>
        ${withToken ? `<td><a class="cell-token" href="${tokenLink(t.mint)}">${tokenIcon(t, 'sm')} ${esc(tokenName(t))}</a></td>` : ''}
        <td class="r">${amount(t.tokenAmount)}</td>
        <td class="r">${amount(t.quoteAmount)} ${esc(t.quoteSymbol)}</td>
        <td class="r">${usd(t.valueUsd)}</td>
        <td class="r"><a class="muted" href="${txUrl(t.signature)}" target="_blank" rel="noopener">${ago(t.time)}</a></td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function pageTrades() {
    setPage(`${mobileTop()}${pageHead('Recent trades', `Buys and sells from every account on ${esc(state.config.appName)}, read from the NEAR blockchain.`)}
      <section class="card"><div class="table-wrap" id="tradeList">${spinner}</div></section>`);
    try {
      const { trades } = await api('/trades/recent');
      $('#tradeList').innerHTML = trades.length ? tradeTable(trades, true) : empty('trades', 'No trades yet. They appear once members swap tokens.');
    } catch (err) {
      $('#tradeList').innerHTML = empty('x', esc(err.message));
    }
  }

  async function loadOverview(u, prof) {
    const box = $('#overview');
    const enc = encodeURIComponent(u.wallet);
    const [p, sim] = await Promise.all([api(`/users/${enc}/pnl`).catch(() => null), api(`/users/${enc}/copy-sim?days=30&amount=100`).catch(() => null)]);
    if (!box || !document.body.contains(box)) return;
    const tile = (label, value, sub = '', c = '') => `<div class="tile"><div class="label">${label}</div><div class="value ${c}">${value}</div><div class="sub">${sub}</div></div>`;
    box.innerHTML = `<div class="tiles">
      ${tile('Total profit', p ? signedUsd(p.totalUsd) : '—', p ? `${signedUsd(p.realizedUsd)} realized` : 'unavailable', p ? cls(p.totalUsd) : '')}
      ${tile('Win rate', p && p.closedPositions ? p.winRatePct.toFixed(0) + '%' : '—', p ? `${p.wins} of ${p.closedPositions} closed` : '')}
      ${tile('Volume', p ? compactUsd(p.volumeUsd) : '—', p && p.best ? `best: $${esc(p.best.symbol || '?')}` : '')}
      ${tile('Copy · 30 days', sim && sim.copiedBuys ? pct(sim.returnPct) : '—', sim && sim.copiedBuys ? `${signedUsd(sim.totalUsd)} on $100/trade` : 'no recent trades', sim ? cls(sim.totalUsd) : '')}
    </div>`;
  }

  async function pageLeaderboard() {
    setPage(`${mobileTop()}${pageHead('Leaderboard', 'Top NEAR traders by profit on trades recorded here. Updated every 5 minutes.')}
      <div id="podium"></div>
      <section class="card"><div class="table-wrap" id="board">${spinner}</div></section>`);
    try {
      const { rows } = await api('/leaderboard');
      if (state.me) state.copyMap = new Map((await api('/copy').catch(() => ({ copies: [] }))).copies.map((c) => [c.leader.wallet, c.amountUsd]));
      const top = rows.slice(0, 3);
      const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
      $('#podium').innerHTML = top.length ? `<div class="podium">${order.map((r) => {
        const i = rows.indexOf(r);
        return `<a class="card podium-card p${i + 1}" href="#/u/${esc(r.user.wallet)}"><span class="rank r${i + 1}">${i + 1}</span>${avatar(r.user, i === 0 ? 'xl' : 'lg')}
          <b class="podium-name">${esc(nameOf(r.user))}</b><span class="podium-pnl ${cls(r.totalUsd)}">${signedUsd(r.totalUsd)}</span>
          <span class="handle">${r.closedPositions ? r.winRatePct.toFixed(0) + '% win rate' : `${r.trades} trades`} · ${plural(r.copiers || 0, 'copier')}</span></a>`;
      }).join('')}</div>` : '';
      $('#board').innerHTML = rows.length ? `<table><thead><tr><th>#</th><th>Trader</th><th class="r">Profit</th><th class="r">Win rate</th><th class="r">Copy 30d</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => {
          const copying = state.copyMap && state.copyMap.get(r.user.wallet);
          const mine = state.me && state.me.wallet === r.user.wallet;
          return `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td>
          <td><a class="cell-user" href="#/u/${esc(r.user.wallet)}">${avatar(r.user, 'sm')} ${esc(nameOf(r.user))}</a></td>
          <td class="r ${cls(r.totalUsd)}"><b>${signedUsd(r.totalUsd)}</b>${r.estimate ? '<span class="muted" title="Partly estimated"> *</span>' : ''}</td>
          <td class="r">${r.closedPositions ? r.winRatePct.toFixed(0) + '%' : '—'}</td>
          <td class="r ${cls(r.copy30 && r.copy30.totalUsd)}">${r.copy30 && r.copy30.copiedBuys ? pct(r.copy30.returnPct) : '—'}</td>
          <td class="r">${mine ? '' : `<button class="btn sm ${copying ? '' : 'primary'}" data-action="copy-user" data-wallet="${esc(r.user.wallet)}" data-name="${esc(r.user.name || '')}" data-amount="${copying || ''}">${copying ? 'Copying' : 'Copy'}</button>`}</td></tr>`;
        }).join('')}
        </tbody></table><p class="foot-note pad" style="margin:0">* Estimate: some trades happened before the account joined. Copy 30d = return from copying every trade at $100 over the last 30 days, after 1% swap cost each way.</p>` : empty('trophy', 'No traders yet.');
    } catch (err) {
      $('#board').innerHTML = empty('x', esc(err.message));
    }
  }

  async function pagePeople(q = '') {
    setPage(`${mobileTop()}${pageHead('People', 'Find traders by name, X handle or NEAR account.')}
      <form data-form="search" class="search" style="margin-bottom:14px">${icon('search', 'sm')}<input type="search" name="q" value="${esc(q)}" placeholder="Search name, @handle or account.near" aria-label="Search people"></form>
      <section class="card" id="people">${spinner}</section>`);
    try {
      const { users } = await api(`/users?q=${encodeURIComponent(q)}`);
      if (!users.length && isAccount(q)) {
        location.hash = `#/u/${q}`;
        return;
      }
      $('#people').innerHTML = users.map((u) => `<a class="person" href="#/u/${esc(u.wallet)}">${avatar(u)}<div class="who"><b>${esc(nameOf(u))}</b> <span class="handle">@${esc(shortAcc(u.wallet))}</span><div class="bio-line">${esc(u.bio || '')}</div></div></a>`).join('') || empty('users', 'Nobody found.');
    } catch (err) {
      $('#people').innerHTML = empty('x', esc(err.message));
    }
  }

  async function pageProfile(acc, tab = 'posts') {
    setPage(`${mobileTop()}${spinner}`);
    let prof;
    try {
      prof = await api(`/users/${encodeURIComponent(acc)}`);
    } catch (err) {
      setPage(`${mobileTop()}<section class="card">${empty('user', `${esc(err.status === 404 ? `${acc} has not joined Near Social yet.` : err.message)}<p><a href="${accountUrl(acc)}" target="_blank" rel="noopener">View on NearBlocks</a></p>`)}</section>`);
      return;
    }
    const u = prof.user;
    const tabs = [['posts', 'Posts'], ['portfolio', 'Holdings'], ['pnl', 'Profit'], ['trades', 'Trades'], ['tips', 'Tips']];
    setPage(`${mobileTop()}<section class="card">
      <div class="cover" style="${coverStyle(u.wallet)}"></div>
      <div class="profile-head">
        <div class="profile-top">${avatar(u, 'xl')}
          <div class="profile-actions">${prof.isMe
            ? `<a class="btn sm" href="#/settings">${icon('edit', 'sm')} Edit profile</a><button class="btn sm" data-action="sync">${icon('refresh', 'sm')} Refresh trades</button>`
            : `<button class="btn sm" data-action="tip-user" data-wallet="${esc(u.wallet)}" data-name="${esc(u.name)}">${icon('tip', 'sm')} Tip</button><button class="btn sm ${prof.copying ? 'copying' : ''}" data-action="copy-user" data-wallet="${esc(u.wallet)}" data-name="${esc(u.name)}" data-amount="${prof.copying ? prof.copying.amountUsd : ''}">${icon('copytrade', 'sm')} ${prof.copying ? `Copying · $${prof.copying.amountUsd}` : 'Copy trades'}</button><button class="btn sm ${prof.isFollowing ? '' : 'primary'}" data-action="follow" data-wallet="${esc(u.wallet)}">${prof.isFollowing ? 'Following' : 'Follow'}</button>`}</div>
        </div>
        <div class="profile-name">${esc(nameOf(u))}</div>
        <div class="handle">@${esc(u.wallet)}</div>
        <div class="chips">
          <span class="chip" data-action="copy" data-text="${esc(u.wallet)}" title="Copy account">${icon('copy', 'sm')} Copy</span>
          <a class="chip" href="${accountUrl(u.wallet)}" target="_blank" rel="noopener">${icon('link', 'sm')} NearBlocks</a>
          ${u.xHandle ? `<a class="chip" href="https://x.com/${esc(u.xHandle)}" target="_blank" rel="noopener">𝕏 @${esc(u.xHandle)}</a>` : ''}
        </div>
        ${u.bio ? `<p class="bio">${richText(u.bio)}</p>` : ''}
        <div class="stat-row"><span><b>${prof.followers}</b> ${prof.followers === 1 ? 'follower' : 'followers'}</span><span><b>${prof.following}</b> following</span><span><b>${prof.trades}</b> trades</span><span><b>${amount(prof.tipsReceivedNear)} Ⓝ</b> tips</span><span><b>${prof.copiers}</b> ${prof.copiers === 1 ? 'copier' : 'copiers'}</span><span>Joined ${new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span></div>
      </div>
      <div class="overview" id="overview"><div class="tiles">${['Total profit', 'Win rate', 'Volume', 'Copy · 30 days'].map((l) => `<div class="tile"><div class="label">${l}</div><div class="value muted">…</div></div>`).join('')}</div></div>
      <div class="profile-tabs"><div class="tabs">${tabs.map(([k, l]) => `<a href="#/u/${esc(u.wallet)}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div></div>
      <div id="ptab" class="feed">${spinner}</div>
    </section>`);
    loadOverview(u, prof);
    const el = $('#ptab');
    const enc = encodeURIComponent(u.wallet);
    try {
      if (tab === 'posts') await loadFeed(`/users/${enc}/posts`, el, 'No posts yet.');
      if (tab === 'portfolio') {
        const h = await api(`/users/${enc}/holdings`);
        el.innerHTML = `<div class="pad"><div class="tiles"><div class="tile"><div class="label">Account value</div><div class="value">${usd(h.totalUsd)}</div></div><div class="tile"><div class="label">Tokens held</div><div class="value">${h.tokens.length}</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>Token</th><th class="r">Amount</th><th class="r">Price</th><th class="r">Value</th></tr></thead><tbody>
          ${h.tokens.map((t) => `<tr><td><a class="cell-token" href="${tokenLink(t.mint)}">${tokenIcon(t, 'sm')} ${esc(t.mint === 'near' ? 'NEAR' : tokenName(t))}</a></td>
            <td class="r">${amount(t.amount)}</td><td class="r">${fmtPrice(t.priceUsd)}</td><td class="r"><b>${usd(t.valueUsd)}</b></td></tr>`).join('')}
          </tbody></table></div>${h.unpriced ? `<p class="foot-note">${h.unpriced} token(s) have no market price and are not counted.</p>` : ''}
          <p class="foot-note">Live from the NEAR blockchain · updated ${ago(h.updatedAt)} ago</p></div>`;
      }
      if (tab === 'pnl') {
        const p = await api(`/users/${enc}/pnl`);
        el.innerHTML = `<div class="pad">
          <div class="tiles">
            <div class="tile"><div class="label">Total profit</div><div class="value ${cls(p.totalUsd)}">${signedUsd(p.totalUsd)}</div></div>
            <div class="tile"><div class="label">Realized</div><div class="value ${cls(p.realizedUsd)}">${signedUsd(p.realizedUsd)}</div></div>
            <div class="tile"><div class="label">Unrealized</div><div class="value ${cls(p.unrealizedUsd)}">${signedUsd(p.unrealizedUsd)}</div></div>
            <div class="tile"><div class="label">Win rate</div><div class="value">${p.closedPositions ? p.winRatePct.toFixed(0) + '%' : '—'}</div><div class="sub">${p.wins} of ${p.closedPositions} closed</div></div>
            <div class="tile"><div class="label">Volume</div><div class="value">${compactUsd(p.volumeUsd)}</div></div>
          </div>
          ${p.estimate ? '<div class="notice">Estimate: some tokens were bought before this account joined (cost unknown), or prices are temporarily unavailable.</div>' : ''}
          <div class="table-wrap"><table><thead><tr><th>Token</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Holding</th><th class="r">Realized</th><th class="r">Unrealized</th><th class="r">Total</th></tr></thead><tbody>
          ${p.tokens.map((t) => `<tr><td><a class="cell-token" href="${tokenLink(t.mint)}">${tokenIcon(t, 'sm')} ${esc(tokenName(t))}</a>${t.closed ? ' <span class="muted" style="font-size:12px">closed</span>' : ''}</td>
            <td class="r">${usd(t.boughtUsd)}</td><td class="r">${usd(t.soldUsd)}</td><td class="r">${t.closed ? '—' : usd(t.valueNowUsd)}</td>
            <td class="r ${cls(t.realizedUsd)}">${signedUsd(t.realizedUsd)}</td><td class="r ${cls(t.unrealizedUsd)}">${signedUsd(t.unrealizedUsd)}</td><td class="r ${cls(t.totalUsd)}"><b>${signedUsd(t.totalUsd)}</b></td></tr>`).join('') || `<tr><td colspan="7">${empty('chart', 'No trades recorded yet.')}</td></tr>`}
          </tbody></table></div>
          <p class="foot-note">Average-cost method on swaps recorded here. Dollar values use the NEAR price when each trade was recorded.</p></div>`;
      }
      if (tab === 'trades') {
        const { trades } = await api(`/users/${enc}/trades`);
        el.innerHTML = trades.length ? `<div class="table-wrap">${tradeTable(trades, false)}</div>` : empty('trades', `No trades recorded yet.${prof.isMe ? ' Press “Refresh trades” to read your latest swaps.' : ''}`);
      }
      if (tab === 'tips') {
        const { tips } = await api(`/users/${enc}/tips`);
        el.innerHTML = tips.length ? `<div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th class="r">Amount</th><th class="r">When</th></tr></thead><tbody>
          ${tips.map((t) => `<tr><td><a class="cell-user" href="#/u/${esc(t.from.wallet)}">${avatar(t.from, 'sm')} ${esc(nameOf(t.from))}</a></td><td><a class="cell-user" href="#/u/${esc(t.to.wallet)}">${avatar(t.to, 'sm')} ${esc(nameOf(t.to))}</a></td>
            <td class="r"><b>${amount(t.near)} Ⓝ</b></td><td class="r"><a class="muted" href="${txUrl(t.txHash)}" target="_blank" rel="noopener">${ago(t.createdAt)}</a></td></tr>`).join('')}</tbody></table></div>` : empty('tip', 'No tips yet.');
      }
    } catch (err) {
      el.innerHTML = empty('x', `Could not load: ${esc(err.message)}${err.status === 502 ? '<br><span style="font-size:13px">A NEAR data service is busy. Try again in a minute.</span>' : ''}`);
    }
  }

  async function pageSettings() {
    if (!state.me) {
      setPage(`${mobileTop()}${composer()}`);
      return;
    }
    const { user } = await api('/me');
    setPage(`${mobileTop()}${pageHead('Edit profile', `Signed in as <span class="mono">${esc(user.wallet)}</span>`)}
      <form class="card pad" data-form="profile">
        <label class="field"><span>Display name</span><input type="text" name="name" maxlength="40" value="${esc(user.name)}" placeholder="What should people call you?"></label>
        <label class="field"><span>Bio</span><textarea name="bio" maxlength="280" rows="3" placeholder="Trader, builder, degen…">${esc(user.bio)}</textarea></label>
        <label class="field"><span>X handle</span><input type="text" name="xHandle" maxlength="16" value="${esc(user.xHandle)}" placeholder="without @"></label>
        <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:18px"><input type="checkbox" name="shareTrades" ${user.shareTrades ? 'checked' : ''} style="margin-top:5px;accent-color:var(--mint)">
          <span>Post my new trades to the feed<br><span class="muted" style="font-size:13px">Your holdings and trades are public on the blockchain either way.</span></span></label>
        <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button class="btn primary" type="submit">Save profile</button><button class="btn" type="button" data-action="signout">${icon('logout', 'sm')} Sign out</button></div>
      </form>`);
  }

  function pageAbout() {
    const app = esc(state.config.appName);
    const steps = [
      ['wallet', 'Connect', 'Pick a NEAR wallet and sign a short message. It proves you own the account. No transaction, no fee.'],
      ['chart', 'Your profile fills itself', 'Holdings, profit and trade history are read from the NEAR blockchain. Nothing to upload, nothing to fake.'],
      ['repost', 'Post and follow', 'Share calls, reply, like and repost. Follow traders and see their buys and sells in your feed.'],
      ['tip', 'Tip what helps you', 'Send NEAR straight to a post or profile. It goes wallet to wallet, and the site checks it on-chain.'],
    ];
    const layers = [
      ['On-chain (public, permanent)', ['Your NEAR account and its keys', 'Token balances and every swap you make', 'Tips: real NEAR transfers between accounts']],
      ['Off-chain (on our server)', ['Profile name, bio and X handle', 'Posts, replies, likes, reposts and follows', 'A cached copy of your trades, for speed']],
    ];
    const compare = [
      ['', app, 'Near Social (BOS)', 'Farcaster', 'Lens'],
      ['Chain', 'NEAR', 'NEAR', 'Ethereum L2 (Optimism)', 'Lens Chain'],
      ['Sign in', 'NEAR wallet', 'NEAR wallet', 'Farcaster account', 'Lens profile'],
      ['Profit and holdings on profile', '✓ from chain', '—', '—', '—'],
      ['Trades auto-posted to feed', '✓', '—', '—', '—'],
      ['Copy trading', '✓ you approve each swap', '—', '—', '—'],
      ['Tips in native token', '✓ NEAR', 'via apps', 'via apps', 'via apps'],
      ['Posts stored', 'Server', 'On-chain (SocialDB)', 'Hubs (off-chain network)', 'Lens Chain + storage network'],
    ];
    const faq = [
      ['Is it free?', `Yes. Signing in, posting and liking cost nothing. Only tips move money, and 100% of a tip goes to the person you tip. ${app} takes no fee.`],
      ['Can someone fake their profit?', 'No. Profit is worked out from swaps on the NEAR blockchain, not typed in. Trades made before an account joined are marked as estimates.'],
      ['Can the site move my funds?', 'No. The site never gets your keys. Signing in signs a text message. Tips only happen when you approve them in your own wallet.'],
      ['Which trades are counted?', 'Swaps where you trade NEAR, USDC or USDT for a token, or the reverse, on any NEAR DEX. Plain transfers and airdrops are not trades.'],
      ['Can I hide my trades?', 'You can stop new trades being posted to the feed in your profile settings. Your holdings stay public on the blockchain either way.'],
      ['How does copy trading work?', 'Pick a trader and an amount per trade. When they buy or sell, you get a signal with a ready-made swap on a NEAR DEX. You check it and approve it in your own wallet. The site never trades for you and never holds your funds.'],
      ['Which wallets work?', 'Meteor, HOT, Intear, HERE and MyNearWallet, on desktop and mobile.'],
    ];
    setPage(`${mobileTop()}${pageHead(`About ${app}`, 'The social network where every profile is backed by the NEAR blockchain.')}
      <div class="stack">
        <section class="card pad"><h2 class="section-title">How it works</h2>
          <div class="steps">${steps.map(([ic, t, d], i) => `<div class="step"><span class="step-n">${i + 1}</span><div>${icon(ic)}<b>${esc(t)}</b><p>${esc(d)}</p></div></div>`).join('')}</div></section>
        <section class="card pad"><h2 class="section-title">What lives where</h2>
          <div class="how">${layers.map(([t, items], i) => `<div class="feature">${icon(i ? 'users' : 'shield')}<b>${esc(t)}</b><ul class="plain">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
            <div class="feature">${icon('link')}<b>Data sources</b><ul class="plain"><li>NEAR RPC (FastNEAR)</li><li>NearBlocks token history</li><li>Ref Finance prices</li></ul></div></div></section>
        <section class="card pad"><h2 class="section-title">Trust and safety</h2>
          <div class="how">
            <div class="feature">${icon('shield')}<b>Verified sign-in</b>The server checks your signature and that the key has full access to your account. Nobody can post as you.</div>
            <div class="feature">${icon('tip')}<b>Verified tips</b>A tip appears only after the site finds the NEAR transfer on-chain, once per transaction.</div>
            <div class="feature">${icon('spark')}<b>Safe content</b>Posts are shown as plain text with safe links only, and posting is rate limited against spam.</div>
          </div></section>
        <section class="card"><div class="pad" style="padding-bottom:0"><h2 class="section-title">Compared with other on-chain social apps</h2></div>
          <div class="table-wrap"><table><thead><tr>${compare[0].map((h, i) => `<th${i === 1 ? ' style="color:var(--mint)"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>
          ${compare.slice(1).map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="muted"' : i === 1 ? ' style="font-weight:700"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <p class="foot-note pad" style="margin:0">Feature summary, not an endorsement. Other apps change often; check their own docs.</p></section>
        <section class="card pad"><h2 class="section-title">FAQ</h2>
          ${faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
        <p class="foot-note" style="text-align:center">Not financial advice. Memecoins are extremely risky. Profits shown are past on-chain results.</p>
      </div>`);
  }

  // ------------------------------------------------------------------ copy trading
  const pct = (v) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

  function copyDialog(leader, current = 0) {
    if (!requireLogin()) return;
    if (leader.wallet === state.me.wallet) return toast('You cannot copy yourself');
    const d = openModal(current ? `Edit copy of ${nameOf(leader)}` : `Copy ${nameOf(leader)}`, `
      <p class="muted" style="margin-top:0">When <b>${esc(leader.wallet)}</b> buys or sells, you get a signal with a ready-made swap. You approve every trade in your own wallet; nothing runs without you.</p>
      <div class="presets">${[25, 50, 100, 250].map((v) => `<button class="btn sm ${v === (current || 100) ? 'on' : ''}" data-amt="${v}">$${v}</button>`).join('')}</div>
      <label class="field"><span>Amount per trade (USD)</span><input type="number" id="copyAmount" min="1" step="1" value="${current || 100}" inputmode="decimal"></label>
      <div class="sim-box" id="copySim">${spinner}</div>
      <button class="btn primary block lg" id="copySave">${icon('copytrade')} ${current ? 'Save' : 'Start copying'}</button>
      ${current ? `<button class="btn ghost block" style="margin-top:8px" data-action="stop-copy" data-wallet="${esc(leader.wallet)}" data-name="${esc(leader.name || '')}">Stop copying</button>` : ''}`);
    let timer;
    const preview = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const amt = Number($('#copyAmount').value) || 100;
        try {
          const sim = await api(`/users/${encodeURIComponent(leader.wallet)}/copy-sim?days=30&amount=${amt}`);
          $('#copySim').innerHTML = sim.copiedBuys
            ? `<div class="sim-label">If you had copied for the last 30 days</div>
               <div class="sim-row"><span>${sim.copiedBuys} buys copied · ${usd(sim.investedUsd, 0)} in</span><b class="${cls(sim.totalUsd)}">${signedUsd(sim.totalUsd)} (${pct(sim.returnPct)})</b></div>
               <div class="sim-note">Includes 1% swap cost each way. Past results, not a promise.</div>`
            : '<div class="sim-label">No trades from this trader in the last 30 days to simulate.</div>';
        } catch {
          $('#copySim').innerHTML = '<div class="sim-label">Simulation unavailable right now.</div>';
        }
      }, 250);
    };
    d.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => {
      $('#copyAmount').value = b.dataset.amt;
      d.querySelectorAll('[data-amt]').forEach((x) => x.classList.toggle('on', x === b));
      preview();
    }));
    $('#copyAmount').addEventListener('input', preview);
    preview();
    $('#copySave').addEventListener('click', async () => {
      try {
        const amountUsd = Number($('#copyAmount').value);
        await api(`/copy/${encodeURIComponent(leader.wallet)}`, { method: 'PUT', body: { amountUsd } });
        d.close();
        toast(`Copying ${nameOf(leader)} with $${amountUsd} per trade`);
        route();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  function signalCard(sg, nearUsd) {
    const near = nearUsd && sg.yourAmountUsd ? sg.yourAmountUsd / nearUsd : null;
    const fresh = Date.now() - sg.time < 15 * 60000;
    return `<article class="signal">
      <a href="#/u/${esc(sg.wallet)}">${avatar(sg.user || { wallet: sg.wallet })}</a>
      <div class="signal-body">
        <div class="post-head"><a class="name" href="#/u/${esc(sg.wallet)}">${esc(nameOf(sg.user || { wallet: sg.wallet }))}</a>
          <span class="handle">${sg.side === 'buy' ? 'bought' : 'sold'}</span>
          <a class="name" href="${tokenLink(sg.mint)}">${esc(tokenName(sg))}</a>
          <span class="handle">· ${ago(sg.time)}</span>${fresh ? '<span class="live-dot" title="Fresh signal"></span>' : ''}</div>
        <div class="signal-meta"><span>Them: <b>${amount(sg.quoteAmount)} ${esc(sg.quoteSymbol)}</b> (${usd(sg.valueUsd)})</span>
          ${sg.side === 'buy' ? `<span>You: <b>${usd(sg.yourAmountUsd, 0)}</b>${near ? ` ≈ ${amount(near)} NEAR` : ''}</span>` : '<span>You: sell the same share of your position</span>'}</div>
      </div>
      <div class="signal-actions">
        <a class="btn sm ${sg.side === 'buy' ? 'primary' : ''}" href="${esc(sg.swapUrl)}" target="_blank" rel="noopener">${icon('bolt', 'sm')} ${sg.side === 'buy' ? 'Copy buy' : 'Copy sell'}</a>
        <a class="btn sm ghost" href="${txUrl(sg.signature)}" target="_blank" rel="noopener" aria-label="View transaction">${icon('external', 'sm')}</a>
      </div>
    </article>`;
  }

  function discoverCard(r) {
    const c = r.copy30 || {};
    const copying = state.copyMap && state.copyMap.get(r.user.wallet);
    return `<div class="trader-card">
      <a class="trader-top" href="#/u/${esc(r.user.wallet)}">${avatar(r.user)}<span class="who"><b>${esc(nameOf(r.user))}</b><span class="handle">@${esc(shortAcc(r.user.wallet))}</span></span></a>
      <div class="trader-stats">
        <div><span>Profit</span><b class="${cls(r.totalUsd)}">${signedUsd(r.totalUsd)}</b></div>
        <div><span>Win rate</span><b>${r.closedPositions ? r.winRatePct.toFixed(0) + '%' : '—'}</b></div>
        <div><span>Copiers</span><b>${r.copiers || 0}</b></div>
      </div>
      <div class="trader-sim"><span>$100/trade, last 30 days</span><b class="${cls(c.totalUsd)}">${c.copiedBuys ? `${signedUsd(c.totalUsd)} (${pct(c.returnPct)})` : 'no trades'}</b></div>
      ${state.me && state.me.wallet === r.user.wallet ? '<span class="btn sm block" style="pointer-events:none;opacity:.6">This is you</span>'
        : `<button class="btn sm block ${copying ? '' : 'primary'}" data-action="copy-user" data-wallet="${esc(r.user.wallet)}" data-name="${esc(r.user.name || '')}" data-amount="${copying || ''}">${icon('copytrade', 'sm')} ${copying ? `Copying · $${copying}` : 'Copy'}</button>`}
    </div>`;
  }

  async function pageCopy(tab = 'signals') {
    const tabs = [['signals', 'Signals'], ['copying', 'Copying'], ['discover', 'Find traders']];
    setPage(`${mobileTop()}${pageHead('Copy trades', 'Follow the best NEAR traders trade by trade. You keep your keys and approve every swap.')}
      <section class="card copy-hero">
        <div class="copy-points">
          <div>${icon('copytrade')}<b>Pick traders</b><span>Choose who to copy and your size per trade.</span></div>
          <div>${icon('bolt')}<b>Get signals</b><span>Their buys and sells land here as they happen.</span></div>
          <div>${icon('shield')}<b>You approve</b><span>One tap opens the swap. Nothing trades without you.</span></div>
        </div>
      </section>
      <div class="tabs">${tabs.map(([k, l]) => `<a href="#/copy/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div>
      <div id="copyBody">${spinner}</div>`);
    const el = $('#copyBody');
    try {
      let mine = { copies: [], signals: [], nearUsd: null };
      if (state.me) mine = await api('/copy');
      state.copyMap = new Map(mine.copies.map((c) => [c.leader.wallet, c.amountUsd]));
      if (tab === 'signals') {
        if (!state.me) el.innerHTML = `<section class="card">${empty('copytrade', 'Connect your wallet and copy a trader to get signals.')}<div style="text-align:center;padding-bottom:20px"><button class="btn primary" data-action="signin">${icon('wallet')} Connect NEAR wallet</button></div></section>`;
        else if (!mine.copies.length) el.innerHTML = `<section class="card">${empty('copytrade', 'You are not copying anyone yet.')}<div style="text-align:center;padding-bottom:20px"><a class="btn primary" href="#/copy/discover">Find traders to copy</a></div></section>`;
        else el.innerHTML = `<section class="card feed">${mine.signals.map((sg) => signalCard(sg, mine.nearUsd)).join('') || empty('bolt', 'No signals yet. They appear when the traders you copy make a trade.')}</section>
          <p class="foot-note">“Copy” opens the swap on a NEAR DEX in a new tab, ready for you to check and approve. Always check the token before you swap.</p>`;
      }
      if (tab === 'copying') {
        if (!state.me) el.innerHTML = `<section class="card">${empty('copytrade', 'Connect your wallet to copy traders.')}</section>`;
        else el.innerHTML = mine.copies.length ? `<div class="copy-grid">${mine.copies.map((c) => `<div class="card copy-card">
            <div class="copy-card-top"><a class="trader-top" href="#/u/${esc(c.leader.wallet)}">${avatar(c.leader)}<span class="who"><b>${esc(nameOf(c.leader))}</b><span class="handle">since ${new Date(c.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · $${c.amountUsd}/trade</span></span></a></div>
            <div class="copy-pnl ${cls(c.totalUsd)}">${signedUsd(c.totalUsd)}<small>${pct(c.returnPct)}</small></div>
            <div class="trader-stats"><div><span>Buys copied</span><b>${c.copiedBuys}</b></div><div><span>Invested</span><b>${usd(c.investedUsd, 0)}</b></div><div><span>Win rate</span><b>${c.closedPositions ? c.winRatePct.toFixed(0) + '%' : '—'}</b></div></div>
            <div style="display:flex;gap:8px"><button class="btn sm" data-action="copy-user" data-wallet="${esc(c.leader.wallet)}" data-name="${esc(c.leader.name || '')}" data-amount="${c.amountUsd}">${icon('edit', 'sm')} Edit</button><button class="btn sm ghost" data-action="stop-copy" data-wallet="${esc(c.leader.wallet)}" data-name="${esc(c.leader.name || '')}">Stop</button></div>
          </div>`).join('')}</div><p class="foot-note">Results show what copying every trade at your size would have made since you started, including ${mine.costPct}% swap cost each way.</p>`
          : `<section class="card">${empty('copytrade', 'You are not copying anyone yet.')}<div style="text-align:center;padding-bottom:20px"><a class="btn primary" href="#/copy/discover">Find traders to copy</a></div></section>`;
      }
      if (tab === 'discover') {
        const { rows } = await api('/leaderboard');
        el.innerHTML = rows.length ? `<div class="copy-grid">${rows.slice(0, 30).map(discoverCard).join('')}</div>` : `<section class="card">${empty('trophy', 'No traders yet.')}</section>`;
      }
    } catch (err) {
      el.innerHTML = `<section class="card">${empty('x', esc(err.message))}</section>`;
    }
  }

  // ------------------------------------------------------------------ token page
  async function pageToken(contract) {
    setPage(`${mobileTop()}${spinner}`);
    let d;
    try {
      d = await api(`/tokens/${encodeURIComponent(contract)}`);
    } catch (err) {
      setPage(`${mobileTop()}<section class="card">${empty('x', esc(err.message))}</section>`);
      return;
    }
    const t = d.token;
    const st = d.stats;
    setPage(`${mobileTop()}<section class="card token-head">
        <div class="token-title">${tokenIcon(t, 'lg')}<div><h1>${esc(t.symbol ? '$' + t.symbol : shortAcc(t.mint))}</h1><div class="handle">${esc(t.name || '')} · <span class="mono">${esc(shortAcc(t.mint))}</span></div></div>
          <div class="token-price"><b>${fmtPrice(t.priceUsd)}</b><span class="handle">price</span></div></div>
        <div class="chips">
          <a class="btn sm primary" href="${esc(d.swap.buyUrl)}" target="_blank" rel="noopener">${icon('bolt', 'sm')} Buy</a>
          <a class="btn sm" href="${esc(d.swap.sellUrl)}" target="_blank" rel="noopener">Sell</a>
          <a class="chip" href="${tokenUrl(t.mint)}" target="_blank" rel="noopener">${icon('link', 'sm')} NearBlocks</a>
          <span class="chip" data-action="copy" data-text="${esc(t.mint)}">${icon('copy', 'sm')} Contract</span>
        </div>
      </section>
      <div class="tiles" style="margin-top:14px">
        <div class="tile"><div class="label">Members trading</div><div class="value">${st.members}</div><div class="sub">${st.holders} still holding</div></div>
        <div class="tile"><div class="label">24h buys / sells</div><div class="value"><span class="up">${st.buys24h}</span> / <span class="down">${st.sells24h}</span></div></div>
        <div class="tile"><div class="label">24h member volume</div><div class="value">${compactUsd(st.volume24hUsd)}</div></div>
        <div class="tile"><div class="label">Member profit</div><div class="value ${cls(st.memberProfitUsd)}">${signedUsd(st.memberProfitUsd)}</div></div>
      </div>
      <section class="card"><div class="pad" style="padding-bottom:0"><h2 class="section-title">Members on this token</h2></div>
        <div class="table-wrap">${d.members.length ? `<table><thead><tr><th>Trader</th><th class="r">Avg entry</th><th class="r">Bought</th><th class="r">Profit</th><th></th></tr></thead><tbody>
        ${d.members.map((m) => `<tr><td><a class="cell-user" href="#/u/${esc(m.user.wallet)}">${avatar(m.user, 'sm')} ${esc(nameOf(m.user))}</a>${m.holding > 0 ? ' <span class="badge buy">holding</span>' : ''}</td>
          <td class="r">${fmtPrice(m.avgEntryUsd)}</td><td class="r">${usd(m.boughtUsd)}</td>
          <td class="r ${cls(m.totalUsd)}"><b>${signedUsd(m.totalUsd)}</b></td>
          <td class="r">${state.me && state.me.wallet === m.user.wallet ? '' : `<button class="btn sm" data-action="copy-user" data-wallet="${esc(m.user.wallet)}" data-name="${esc(m.user.name || '')}">Copy</button>`}</td></tr>`).join('')}
        </tbody></table>` : empty('users', 'No member has traded this token yet.')}</div></section>
      <section class="card"><div class="pad" style="padding-bottom:0"><h2 class="section-title">Recent member trades</h2></div>
        <div class="table-wrap">${d.trades.length ? tradeTable(d.trades, true, false) : empty('trades', 'No trades yet.')}</div></section>`);
  }

  // ------------------------------------------------------------------ chrome
  function renderChrome() {
    const nav = [
      ['home', '#/', 'Home'],
      ['trades', '#/trades', 'Trades'],
      ['copytrade', '#/copy', 'Copy', 'copy'],
      ['trophy', '#/leaderboard', 'Leaderboard', 'leaderboard'],
      ['users', '#/people', 'People', 'people'],
      ['user', state.me ? `#/u/${state.me.wallet}` : '#/settings', 'Profile', 'me'],
      ['info', '#/about', 'About', 'about'],
    ];
    $('#nav').innerHTML = nav.map(([ic, href, label, r]) => `<a href="${esc(href)}" data-route="${r || ic}">${icon(ic)}<span>${label}</span></a>`).join('')
      + (state.me ? '' : `<button class="btn primary lg cta" data-action="signin">${icon('wallet')} Connect wallet</button>`);
    $('#account').innerHTML = state.me
      ? `<a class="me-card" href="#/u/${esc(state.me.wallet)}">${avatar(state.me)}<span class="who"><b>${esc(nameOf(state.me))}</b><span class="handle">@${esc(shortAcc(state.me.wallet))}</span></span></a>`
      : '';
    markNav();
  }

  function markNav() {
    const [page = 'home', arg] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const active = page === 'u' && state.me && arg === state.me.wallet ? 'me' : page === 'following' || page === 'home' ? 'home' : page === 'settings' ? 'me' : page === 't' ? 'trades' : page;
    document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === active));
  }

  async function renderRail() {
    $('#rail').innerHTML = `<form data-form="search" class="search">${icon('search', 'sm')}<input type="search" name="q" placeholder="Search Near Social" aria-label="Search"></form>
      <section class="card pad"><h3>Top traders</h3><div id="railBoard">${spinner}</div></section>
      <section class="card pad"><h3>Live trades</h3><div id="railTrades">${spinner}</div></section>
      <div class="rail-foot"><a href="#/about">About</a> · Not financial advice · Built on NEAR</div>`;
    api('/leaderboard').then(({ rows }) => {
      $('#railBoard').innerHTML = rows.slice(0, 5).map((r, i) => `<a class="mini" href="#/u/${esc(r.user.wallet)}"><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>${avatar(r.user, 'sm')}<span class="who"><b>${esc(nameOf(r.user))}</b></span><b class="num ${cls(r.totalUsd)}">${signedUsd(r.totalUsd)}</b></a>`).join('') || '<p class="muted" style="margin:0">No traders yet.</p>';
    }).catch(() => { $('#railBoard').innerHTML = '<p class="muted" style="margin:0">Unavailable right now.</p>'; });
    api('/trades/recent').then(({ trades }) => {
      $('#railTrades').innerHTML = trades.slice(0, 6).map((t) => `<a class="mini" href="#/u/${esc(t.wallet)}">${tokenIcon(t, 'sm')}<span class="who"><b>${esc(nameOf(t.user || { wallet: t.wallet }))}</b> <span class="badge ${t.side}">${t.side}</span> ${esc(tokenName(t))}</span><span class="muted">${ago(t.time)}</span></a>`).join('') || '<p class="muted" style="margin:0">No trades yet.</p>';
    }).catch(() => { $('#railTrades').innerHTML = '<p class="muted" style="margin:0">Unavailable right now.</p>'; });
  }

  // ------------------------------------------------------------------ router
  async function route() {
    const [page = 'home', arg, sub] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    markNav();
    window.scrollTo(0, 0);
    if (page === 'home') return pageHome('latest');
    if (page === 'following') return pageHome('following');
    if (page === 'trades') return pageTrades();
    if (page === 'leaderboard') return pageLeaderboard();
    if (page === 'people') return pagePeople(arg || '');
    if (page === 'about' || page === 'roadmap') return pageAbout();
    if (page === 'settings') return pageSettings();
    if (page === 'copy') return pageCopy(arg || 'signals');
    if (page === 't' && arg) return pageToken(arg);
    if (page === 'u' && arg) return pageProfile(arg, sub || 'posts');
    if (page === 'p' && arg) return pagePost(arg);
    setPage(`<section class="card">${empty('map', 'Page not found. <a href="#/">Go home</a>')}</section>`);
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------------ events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    try {
      if (a === 'signin') return signIn();
      if (a === 'signout') return signOut();
      if (a === 'reply') return void (location.hash = `#/p/${id}`);
      if (a === 'share') {
        await navigator.clipboard.writeText(`${location.origin}/#/p/${id}`).catch(() => {});
        return toast('Link copied');
      }
      if (a === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text).catch(() => {});
        return toast('Account copied');
      }
      if (a === 'copy-user') return copyDialog({ wallet: el.dataset.wallet, name: el.dataset.name }, Number(el.dataset.amount) || 0);
      if (a === 'tip' || a === 'tip-user') return tipDialog({ wallet: el.dataset.wallet, name: el.dataset.name }, a === 'tip' ? Number(id) : null);
      if (!requireLogin()) return;
      if (a === 'like') {
        const r = await api(`/posts/${id}/like`, { method: 'POST' });
        document.querySelectorAll(`[data-action="like"][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('on', r.liked);
          b.setAttribute('aria-pressed', r.liked);
          b.querySelector('.n').textContent = r.likes || '';
        });
      }
      if (a === 'repost') {
        const r = await api(`/posts/${id}/repost`, { method: 'POST' });
        document.querySelectorAll(`[data-action="repost"][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('on', r.reposted);
          b.querySelector('.n').textContent = r.reposts || '';
        });
        toast(r.reposted ? 'Reposted' : 'Repost removed');
      }
      if (a === 'delete') {
        if (!confirm('Delete this post?')) return;
        await api(`/posts/${id}`, { method: 'DELETE' });
        toast('Deleted');
        route();
      }
      if (a === 'stop-copy') {
        if (!confirm(`Stop copying ${el.dataset.name || el.dataset.wallet}?`)) return;
        await api(`/copy/${encodeURIComponent(el.dataset.wallet)}`, { method: 'DELETE' });
        toast('Stopped copying');
        route();
      }
      if (a === 'follow') {
        const r = await api(`/users/${encodeURIComponent(el.dataset.wallet)}/follow`, { method: 'POST' });
        toast(r.following ? 'Following' : 'Unfollowed');
        route();
      }
      if (a === 'sync') {
        el.disabled = true;
        el.innerHTML = `${icon('refresh', 'sm')} Reading the chain…`;
        const r = await api(`/users/${encodeURIComponent(state.me.wallet)}/sync`, { method: 'POST' });
        toast(r.added ? `Found ${r.added} new trade(s)` : 'No new trades');
        route();
      }
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-form="post"]');
    if (form && e.target.name === 'body') {
      form.querySelector('[data-counter]').textContent = `${e.target.value.length} / 500`;
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`;
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type="submit"]');
    try {
      if (form.dataset.form === 'search') return void (location.hash = `#/people/${encodeURIComponent((data.q || '').trim())}`);
      if (btn) btn.disabled = true;
      if (form.dataset.form === 'post') {
        const replyTo = form.dataset.reply ? Number(form.dataset.reply) : undefined;
        await api('/posts', { method: 'POST', body: { body: data.body, replyTo } });
        form.reset();
        toast(replyTo ? 'Replied' : 'Posted');
        route();
      }
      if (form.dataset.form === 'profile') {
        const { user } = await api('/me', { method: 'PUT', body: { name: data.name, bio: data.bio, xHandle: data.xHandle, shareTrades: Boolean(data.shareTrades) } });
        state.me = user;
        renderChrome();
        toast('Profile saved');
        location.hash = `#/u/${user.wallet}`;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------ boot
  (async function boot() {
    try {
      const [config, me] = await Promise.all([api('/config'), api('/me')]);
      state.config = config;
      state.me = me.user;
    } catch {
      // keep defaults
    }
    document.title = state.config.appName;
    $('#brandName').textContent = state.config.appName;
    renderChrome();
    renderRail();
    route();
  })();
})();
