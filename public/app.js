/* SolCircle: social network for Solana traders. Plain JS, no build step. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '');
  const nameOf = (u) => (u && u.name) || short(u && u.wallet);
  const usd = (v, digits = 2) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const signedUsd = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + usd(v));
  const compactUsd = (v) => (v == null ? '—' : '$' + Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v));
  const amount = (v) => (v == null ? '—' : v >= 1000 ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v) : Number(v.toPrecision(4)).toString());
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const solscanTx = (sig) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;
  const dexToken = (mint) => `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;
  const isWalletLike = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return `${Math.floor(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
    return new Date(t).toLocaleDateString();
  }

  // Deterministic avatar colors from the wallet address.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function avatar(u, size = '') {
    const w = (u && u.wallet) || '?';
    const h = hash(w);
    const a = h % 360;
    const b = (a + 40 + ((h >> 9) % 80)) % 360;
    const letter = esc((nameOf(u) || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0) || '◎');
    return `<span class="avatar ${size}" style="background:linear-gradient(135deg,hsl(${a} 70% 52%),hsl(${b} 75% 45%))" aria-hidden="true">${letter}</span>`;
  }
  function coverStyle(w) {
    const h = hash(w || '');
    return `background:linear-gradient(120deg,hsl(${h % 360} 70% 45%),hsl(${(h >> 8) % 360} 70% 40%))`;
  }

  // Post text: escape, then link https URLs, @wallets and $TICKERS.
  function richText(text) {
    let out = esc(text);
    out = out.replace(/https:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${url.replace(/^https:\/\//, '')}</a>`);
    out = out.replace(/(^|\s)\$([A-Za-z][A-Za-z0-9]{1,11})\b/g, '$1<span class="ticker">$$$2</span>');
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

  // ---------------------------------------------------------------- state
  const state = { me: null, config: { appName: 'SolCircle', minTipSol: 0.001 } };

  // ---------------------------------------------------------------- wallet
  function walletProvider() {
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) return { name: 'Phantom', p: window.phantom.solana };
    if (window.solflare && window.solflare.isSolflare) return { name: 'Solflare', p: window.solflare };
    if (window.backpack && window.backpack.solana) return { name: 'Backpack', p: window.backpack.solana };
    if (window.solana) return { name: 'Wallet', p: window.solana };
    return null;
  }

  async function connectWallet() {
    const w = walletProvider();
    if (!w) {
      openModal('No Solana wallet found', `
        <p>Install a Solana wallet browser extension, then reload this page.</p>
        <p><a class="btn primary" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a>
        <a class="btn" href="https://solflare.com/download" target="_blank" rel="noopener">Get Solflare</a></p>
        <p class="muted">On a phone, open this site inside your wallet app's browser.</p>`);
      return null;
    }
    const res = await w.p.connect();
    const key = (res && res.publicKey) || w.p.publicKey;
    return { ...w, wallet: key.toString() };
  }

  function toBase64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }

  async function signIn() {
    try {
      const w = await connectWallet();
      if (!w) return;
      const { nonce, message } = await api('/auth/challenge', { method: 'POST', body: { wallet: w.wallet } });
      const signed = await w.p.signMessage(new TextEncoder().encode(message), 'utf8');
      const sig = signed && signed.signature ? signed.signature : signed;
      const { user, isNew } = await api('/auth/verify', { method: 'POST', body: { nonce, signature: toBase64(sig) } });
      state.me = user;
      renderAccount();
      toast(isNew ? 'Welcome! Reading your trade history from the chain…' : 'Signed in');
      if (isNew) location.hash = '#/settings';
      else route();
    } catch (err) {
      toast(err.message && err.message.includes('User rejected') ? 'Signing cancelled' : err.message || 'Could not sign in');
    }
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    renderAccount();
    toast('Signed out');
    location.hash = '#/';
  }

  // Load the Solana library only when someone tips (it is large).
  let web3Promise = null;
  function loadWeb3() {
    if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
    if (!web3Promise) {
      web3Promise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/lib/index.iife.min.js';
        s.integrity = 'sha384-1/Ll6ABlJDlMx1URcif2stL9Fxod/1rg71YHzGqTl6Bwzi0Vq993Jt/oVLFXfUgQ';
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve(window.solanaWeb3);
        s.onerror = () => {
          web3Promise = null;
          reject(new Error('Could not load the Solana library'));
        };
        document.head.appendChild(s);
      });
    }
    return web3Promise;
  }

  // ---------------------------------------------------------------- modal
  function openModal(title, html) {
    const d = $('#modal');
    d.innerHTML = `<div class="modal-head"><span>${esc(title)}</span><button class="close" data-close aria-label="Close">×</button></div><div class="modal-body">${html}</div>`;
    d.showModal();
    return d;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) $('#modal').close();
  });

  function requireLogin() {
    if (state.me) return true;
    openModal('Connect your wallet', `<p>Sign in with your Solana wallet to post, like, repost and tip. Signing a message is free and is not a transaction.</p><button class="btn gradient block" data-action="signin">Connect wallet</button>`);
    return false;
  }

  function tipDialog(to, postId) {
    if (!requireLogin()) return;
    const min = state.config.minTipSol;
    const d = openModal(`Tip ${nameOf(to)}`, `
      <p class="muted">Sends SOL from your wallet straight to theirs. ${esc(state.config.appName)} takes nothing.</p>
      <div class="presets">${[0.01, 0.05, 0.1, 0.5].map((v) => `<button class="btn small" data-preset="${v}">${v} SOL</button>`).join('')}</div>
      <label class="field"><span>Amount (SOL)</span><input type="number" id="tipAmount" min="${min}" step="0.001" value="0.01" inputmode="decimal"></label>
      <button class="btn gradient block" id="tipSend">Send tip</button>
      <p class="muted" id="tipStatus" style="margin-bottom:0"></p>`);
    d.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { $('#tipAmount').value = b.dataset.preset; }));
    $('#tipSend').addEventListener('click', async () => {
      const sol = Number($('#tipAmount').value);
      const status = $('#tipStatus');
      if (!(sol >= min)) return void (status.textContent = `Minimum tip is ${min} SOL`);
      if (sol > 100 && !confirm(`Send ${sol} SOL? That is a lot.`)) return;
      const btn = $('#tipSend');
      btn.disabled = true;
      try {
        status.textContent = 'Preparing…';
        const w = await connectWallet();
        if (!w) return;
        if (w.wallet !== state.me.wallet) throw new Error('Your wallet switched accounts. Sign in again with the same wallet.');
        const web3 = await loadWeb3();
        const { blockhash, lastValidBlockHeight } = await api('/solana/blockhash');
        const tx = new web3.Transaction({ feePayer: new web3.PublicKey(w.wallet), blockhash, lastValidBlockHeight }).add(
          web3.SystemProgram.transfer({ fromPubkey: new web3.PublicKey(w.wallet), toPubkey: new web3.PublicKey(to.wallet), lamports: Math.round(sol * 1e9) }),
        );
        status.textContent = 'Approve the transfer in your wallet…';
        const sent = await w.p.signAndSendTransaction(tx);
        const signature = typeof sent === 'string' ? sent : sent.signature;
        status.textContent = 'Sent. Waiting for confirmation…';
        for (let i = 0; i < 20; i++) {
          const r = await api('/tips', { method: 'POST', body: { signature, to: to.wallet, postId } });
          if (r.status !== 202) {
            toast(`Tipped ${r.sol} SOL`);
            d.close();
            route();
            return;
          }
          await new Promise((res) => setTimeout(res, 3000));
        }
        status.innerHTML = `Not confirmed yet. Check it on <a href="${solscanTx(signature)}" target="_blank" rel="noopener">Solscan</a>.`;
      } catch (err) {
        status.textContent = err.message && err.message.includes('User rejected') ? 'Cancelled' : err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- render: posts
  function tradeCard(t) {
    if (!t) return '';
    const sym = t.symbol ? `$${t.symbol}` : short(t.mint);
    return `<div class="trade-card">
      <span class="badge ${t.side}">${t.side}</span>
      <div><a class="token" href="${dexToken(t.mint)}" target="_blank" rel="noopener">${esc(sym)}</a>
        <div class="muted" style="font-size:13px">${amount(t.tokenAmount)} tokens · <a href="${solscanTx(t.signature)}" target="_blank" rel="noopener">tx</a></div></div>
      <div class="amt"><b class="num">${amount(t.quoteAmount)} ${esc(t.quoteSymbol)}</b><div class="muted num" style="font-size:13px">≈ ${usd(t.valueUsd)}</div></div>
    </div>`;
  }

  function postHtml(p) {
    const top = p.repostedBy ? `<div class="repost-line">⟲ <a href="#/u/${esc(p.repostedBy.wallet)}">${esc(nameOf(p.repostedBy))}</a> reposted</div>` : '';
    const body = p.kind === 'trade'
      ? `<div class="post-text muted">${p.trade && p.trade.side === 'sell' ? 'Sold' : 'Bought'} on-chain</div>${tradeCard(p.trade)}`
      : `<div class="post-text">${richText(p.body)}</div>`;
    const reply = p.replyTo ? `<div class="reply-line">Replying to <a href="#/p/${p.replyTo}">a post</a></div>` : '';
    return `${top}<article class="post" data-id="${p.id}">
      <a href="#/u/${esc(p.author.wallet)}">${avatar(p.author)}</a>
      <div class="post-body">
        <div class="post-head">
          <a class="name" href="#/u/${esc(p.author.wallet)}">${esc(nameOf(p.author))}</a>
          <span class="muted mono">${short(p.author.wallet)}</span>
          <span class="muted">·</span>
          <a class="muted" href="#/p/${p.id}" title="${new Date(p.createdAt).toLocaleString()}">${ago(p.createdAt)}</a>
        </div>
        ${reply}${body}
        <div class="actions">
          <button class="act" data-action="reply" data-id="${p.id}" aria-label="Reply">💬 <span class="n">${p.replies || ''}</span></button>
          <button class="act repost ${p.reposted ? 'on' : ''}" data-action="repost" data-id="${p.id}" aria-label="Repost" aria-pressed="${p.reposted}">⟲ <span class="n">${p.reposts || ''}</span></button>
          <button class="act like ${p.liked ? 'on' : ''}" data-action="like" data-id="${p.id}" aria-label="Like" aria-pressed="${p.liked}">${p.liked ? '♥' : '♡'} <span class="n">${p.likes || ''}</span></button>
          ${p.mine ? '' : `<button class="act tip ${p.tipsSol ? 'on' : ''}" data-action="tip" data-id="${p.id}" data-wallet="${esc(p.author.wallet)}" data-name="${esc(p.author.name || '')}" aria-label="Tip">◎ <span class="n">${p.tipsSol ? `${amount(p.tipsSol)}` : 'Tip'}</span></button>`}
          <button class="act" data-action="share" data-id="${p.id}" aria-label="Copy link">↗</button>
          ${p.mine ? `<button class="act" data-action="delete" data-id="${p.id}" aria-label="Delete">🗑</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function composer({ replyTo = null, placeholder = "What's happening in the trenches?" } = {}) {
    if (!state.me) {
      return replyTo ? '' : `<div class="panel hero">
        <h1>The social network where every profile shows real trades.</h1>
        <p>Connect a Solana wallet and your profile shows what you hold, your profit and your trade history, read straight from the chain. No screenshots, no fake PnL.</p>
        <ul><li>Post, like, repost and reply</li><li>Tip anyone in SOL, wallet to wallet</li><li>Follow traders and see their buys and sells live</li></ul>
        <button class="btn gradient" data-action="signin">Connect wallet</button>
      </div>`;
    }
    return `<div class="panel composer">
      ${avatar(state.me)}
      <form style="flex:1" data-form="post" data-reply="${replyTo ?? ''}">
        <textarea name="body" maxlength="500" placeholder="${esc(placeholder)}" aria-label="Post text" required></textarea>
        <div class="composer-foot"><span class="muted num" data-counter>0 / 500</span><button class="btn primary" type="submit">${replyTo ? 'Reply' : 'Post'}</button></div>
      </form>
    </div>`;
  }

  // ---------------------------------------------------------------- pages
  const main = () => $('#main');
  function setPage(html) {
    main().innerHTML = html;
  }
  const mobileTop = () => `<div class="mobile-top"><a class="brand" href="#/"><span class="logo"></span>${esc(state.config.appName)}</a>${state.me ? `<a href="#/u/${esc(state.me.wallet)}">${avatar(state.me, 'sm')}</a>` : '<button class="btn small gradient" data-action="signin">Connect</button>'}</div>`;

  async function pageHome(tab = 'latest') {
    setPage(`${mobileTop()}${composer()}
      <div class="panel" style="margin-top:12px">
        <div class="tabs" style="padding:0 8px;margin:0">
          <a href="#/" class="${tab === 'latest' ? 'active' : ''}">Latest</a>
          <a href="#/following" class="${tab === 'following' ? 'active' : ''}">Following</a>
        </div>
        <div id="feed"><div class="loading">Loading posts…</div></div>
      </div>`);
    await loadFeed(`/feed?tab=${tab}`, $('#feed'), tab === 'following' && !state.me ? 'Connect your wallet to see posts from people you follow.' : tab === 'following' ? 'Follow traders to fill this tab.' : 'No posts yet. Be the first.');
  }

  async function loadFeed(path, el, emptyText, append = false) {
    try {
      const { posts, next } = await api(path);
      const html = posts.map(postHtml).join('');
      if (!append) el.innerHTML = html || `<div class="empty">${esc(emptyText)}</div>`;
      else el.insertAdjacentHTML('beforeend', html);
      el.querySelector('[data-more]')?.remove();
      if (next) {
        el.insertAdjacentHTML('beforeend', `<div class="pad" data-more style="text-align:center"><button class="btn">Load more</button></div>`);
        el.querySelector('[data-more] button').addEventListener('click', () => loadFeed(`${path}${path.includes('?') ? '&' : '?'}before=${next}`, el, emptyText, true));
      }
    } catch (err) {
      el.innerHTML = `<div class="empty">Could not load: ${esc(err.message)}</div>`;
    }
  }

  async function pagePost(id) {
    setPage(`${mobileTop()}<div class="loading">Loading…</div>`);
    try {
      const { post, parent, replies } = await api(`/posts/${id}`);
      setPage(`${mobileTop()}<p><a href="javascript:history.back()">← Back</a></p>
        ${parent ? `<div class="panel">${postHtml(parent)}</div>` : ''}
        <div class="panel" style="margin-top:12px">${postHtml(post)}</div>
        <div style="margin-top:12px">${composer({ replyTo: post.id, placeholder: 'Write your reply' })}</div>
        <div class="panel" style="margin-top:12px"><h2 class="section-title pad" style="margin:0;padding-bottom:0">Replies</h2>
          ${replies.map(postHtml).join('') || '<div class="empty">No replies yet.</div>'}</div>`);
    } catch (err) {
      setPage(`${mobileTop()}<div class="panel empty">${esc(err.message)}</div>`);
    }
  }

  async function pageTrades() {
    setPage(`${mobileTop()}<h1 class="page">Recent trades</h1><p class="page-sub">Buys and sells from every wallet on ${esc(state.config.appName)}, read from the chain.</p>
      <div class="panel"><div class="table-wrap" id="tradeList"><div class="loading">Loading…</div></div></div>`);
    try {
      const { trades } = await api('/trades/recent');
      $('#tradeList').innerHTML = trades.length ? tradeTable(trades, true) : '<div class="empty">No trades recorded yet. Trades show up after wallets join and swap tokens.</div>';
    } catch (err) {
      $('#tradeList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function tradeTable(trades, withUser) {
    return `<table><thead><tr>${withUser ? '<th>Trader</th>' : ''}<th>Side</th><th>Token</th><th class="r">Amount</th><th class="r">Paid / got</th><th class="r">Value</th><th class="r">When</th></tr></thead><tbody>
      ${trades.map((t) => `<tr>
        ${withUser ? `<td><a href="#/u/${esc(t.wallet)}" style="display:inline-flex;align-items:center;gap:8px;color:var(--text)">${avatar(t.user || { wallet: t.wallet }, 'sm')} ${esc(nameOf(t.user || { wallet: t.wallet }))}</a></td>` : ''}
        <td><span class="badge ${t.side}">${t.side}</span></td>
        <td><a href="${dexToken(t.mint)}" target="_blank" rel="noopener">${esc(t.symbol ? '$' + t.symbol : short(t.mint))}</a></td>
        <td class="r">${amount(t.tokenAmount)}</td>
        <td class="r">${amount(t.quoteAmount)} ${esc(t.quoteSymbol)}</td>
        <td class="r">${usd(t.valueUsd)}</td>
        <td class="r"><a class="muted" href="${solscanTx(t.signature)}" target="_blank" rel="noopener">${ago(t.time)}</a></td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function pageLeaderboard() {
    setPage(`${mobileTop()}<h1 class="page">Leaderboard</h1><p class="page-sub">Top traders by profit on trades recorded here. Refreshed every 5 minutes.</p>
      <div class="panel"><div class="table-wrap" id="board"><div class="loading">Crunching numbers…</div></div></div>`);
    try {
      const { rows } = await api('/leaderboard');
      $('#board').innerHTML = rows.length ? `<table><thead><tr><th>#</th><th>Trader</th><th class="r">Profit</th><th class="r">Realized</th><th class="r">Win rate</th><th class="r">Volume</th><th>Best token</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td>
          <td><a href="#/u/${esc(r.user.wallet)}" style="display:inline-flex;align-items:center;gap:8px;color:var(--text)">${avatar(r.user, 'sm')} ${esc(nameOf(r.user))}</a></td>
          <td class="r ${cls(r.totalUsd)}"><b>${signedUsd(r.totalUsd)}</b>${r.estimate ? ' <span class="muted" title="Some trades happened before this wallet joined">*</span>' : ''}</td>
          <td class="r ${cls(r.realizedUsd)}">${signedUsd(r.realizedUsd)}</td>
          <td class="r">${r.closedPositions ? r.winRatePct.toFixed(0) + '%' : '—'}</td>
          <td class="r">${compactUsd(r.volumeUsd)}</td>
          <td>${r.best ? esc('$' + (r.best.symbol || short(r.best.mint))) : '—'}</td></tr>`).join('')}
        </tbody></table><p class="muted pad" style="margin:0;font-size:13px">* Estimate: some trades happened before the wallet joined.</p>` : '<div class="empty">No traders yet.</div>';
    } catch (err) {
      $('#board').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function pagePeople(q = '') {
    setPage(`${mobileTop()}<h1 class="page">People</h1><p class="page-sub">Find traders by name, X handle or wallet address.</p>
      <form data-form="search" style="margin-bottom:12px"><input type="search" name="q" value="${esc(q)}" placeholder="Search name, @handle or wallet" aria-label="Search people"></form>
      <div class="panel" id="people"><div class="loading">Loading…</div></div>`);
    try {
      if (isWalletLike(q)) {
        location.hash = `#/u/${q}`;
        return;
      }
      const { users } = await api(`/users?q=${encodeURIComponent(q)}`);
      $('#people').innerHTML = users.map((u) => `<a class="person" href="#/u/${esc(u.wallet)}">${avatar(u)}<div class="who"><b>${esc(nameOf(u))}</b> <span class="muted mono">${short(u.wallet)}</span><div class="bio">${esc(u.bio || '')}</div></div></a>`).join('') || '<div class="empty">Nobody found.</div>';
    } catch (err) {
      $('#people').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function pageProfile(wallet, tab = 'posts') {
    setPage(`${mobileTop()}<div class="loading">Loading profile…</div>`);
    let prof;
    try {
      prof = await api(`/users/${encodeURIComponent(wallet)}`);
    } catch (err) {
      setPage(`${mobileTop()}<div class="panel empty">${esc(err.status === 404 ? 'This wallet has not joined yet.' : err.message)}<p><a href="https://solscan.io/account/${encodeURIComponent(wallet)}" target="_blank" rel="noopener">View it on Solscan</a></p></div>`);
      return;
    }
    const u = prof.user;
    const tabs = ['posts', 'portfolio', 'pnl', 'trades', 'tips'];
    const labels = { posts: 'Posts', portfolio: 'Holdings', pnl: 'Profit', trades: 'Trade history', tips: 'Tips' };
    setPage(`${mobileTop()}<div class="panel">
      <div class="cover" style="${coverStyle(u.wallet)}"></div>
      <div class="profile-head">
        <div class="profile-top">${avatar(u, 'lg')}
          <div style="display:flex;gap:8px">${prof.isMe
            ? `<a class="btn" href="#/settings">Edit profile</a><button class="btn" data-action="sync">↻ Refresh trades</button>`
            : `<button class="btn" data-action="tip-user" data-wallet="${esc(u.wallet)}" data-name="${esc(u.name)}">◎ Tip</button><button class="btn ${prof.isFollowing ? '' : 'primary'}" data-action="follow" data-wallet="${esc(u.wallet)}">${prof.isFollowing ? 'Following' : 'Follow'}</button>`}</div>
        </div>
        <div class="profile-name">${esc(nameOf(u))}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <span class="chip mono" data-action="copy" data-text="${esc(u.wallet)}" title="Copy address">${short(u.wallet)} ⧉</span>
          <a class="chip" href="https://solscan.io/account/${esc(u.wallet)}" target="_blank" rel="noopener">Solscan ↗</a>
          ${u.xHandle ? `<a class="chip" href="https://x.com/${esc(u.xHandle)}" target="_blank" rel="noopener">@${esc(u.xHandle)}</a>` : ''}
        </div>
        ${u.bio ? `<p class="post-text" style="margin-top:10px">${richText(u.bio)}</p>` : ''}
        <div class="stats-row"><span><b>${prof.followers}</b> followers</span><span><b>${prof.following}</b> following</span><span><b>${prof.trades}</b> trades</span><span><b>${amount(prof.tipsReceivedSol)}</b> SOL tips received</span><span>Joined ${new Date(u.createdAt).toLocaleDateString()}</span></div>
      </div>
      <div class="tabs" style="padding:0 8px;margin:0">${tabs.map((t) => `<a href="#/u/${esc(u.wallet)}/${t}" class="${t === tab ? 'active' : ''}">${labels[t]}</a>`).join('')}</div>
      <div id="ptab"><div class="loading">Loading…</div></div>
    </div>`);
    const el = $('#ptab');
    try {
      if (tab === 'posts') await loadFeed(`/users/${encodeURIComponent(u.wallet)}/posts`, el, 'No posts yet.');
      if (tab === 'portfolio') {
        const h = await api(`/users/${encodeURIComponent(u.wallet)}/holdings`);
        el.innerHTML = `<div class="pad"><div class="tiles"><div class="tile"><div class="label">Wallet value</div><div class="value">${usd(h.totalUsd)}</div></div><div class="tile"><div class="label">Tokens held</div><div class="value">${h.tokens.length}</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>Token</th><th class="r">Amount</th><th class="r">Price</th><th class="r">Value</th></tr></thead><tbody>
          ${h.tokens.map((t) => `<tr><td>${t.mint === 'So11111111111111111111111111111111111111112' ? '<b>SOL</b>' : `<a href="${dexToken(t.mint)}" target="_blank" rel="noopener">${esc(t.symbol ? '$' + t.symbol : short(t.mint))}</a>`} <span class="muted" style="font-size:13px">${esc(t.name || '')}</span></td>
            <td class="r">${amount(t.amount)}</td><td class="r">${t.priceUsd ? (t.priceUsd < 0.01 ? '$' + t.priceUsd.toPrecision(3) : usd(t.priceUsd)) : '—'}</td><td class="r">${usd(t.valueUsd)}</td></tr>`).join('')}
          </tbody></table></div>${h.unpriced ? `<p class="muted" style="font-size:13px">${h.unpriced} token(s) have no market price (often spam airdrops) and are not counted.</p>` : ''}
          <p class="muted" style="font-size:13px;margin-bottom:0">Live from the chain · updated ${ago(h.updatedAt)} ago</p></div>`;
      }
      if (tab === 'pnl') {
        const p = await api(`/users/${encodeURIComponent(u.wallet)}/pnl`);
        el.innerHTML = `<div class="pad">
          <div class="tiles">
            <div class="tile"><div class="label">Total profit</div><div class="value ${cls(p.totalUsd)}">${signedUsd(p.totalUsd)}</div></div>
            <div class="tile"><div class="label">Realized</div><div class="value ${cls(p.realizedUsd)}">${signedUsd(p.realizedUsd)}</div></div>
            <div class="tile"><div class="label">Unrealized</div><div class="value ${cls(p.unrealizedUsd)}">${signedUsd(p.unrealizedUsd)}</div></div>
            <div class="tile"><div class="label">Win rate</div><div class="value">${p.closedPositions ? p.winRatePct.toFixed(0) + '%' : '—'}</div><div class="muted" style="font-size:12px">${p.wins} of ${p.closedPositions} closed</div></div>
            <div class="tile"><div class="label">Volume</div><div class="value">${compactUsd(p.volumeUsd)}</div></div>
          </div>
          ${p.estimate ? '<p class="notice">Estimate: this wallet sold some tokens bought before it joined, so their cost is unknown and left out.</p>' : ''}
          <div class="table-wrap"><table><thead><tr><th>Token</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Holding</th><th class="r">Realized</th><th class="r">Unrealized</th><th class="r">Total</th></tr></thead><tbody>
          ${p.tokens.map((t) => `<tr><td><a href="${dexToken(t.mint)}" target="_blank" rel="noopener">${esc(t.symbol ? '$' + t.symbol : short(t.mint))}</a>${t.closed ? ' <span class="muted" style="font-size:12px">closed</span>' : ''}</td>
            <td class="r">${usd(t.boughtUsd)}</td><td class="r">${usd(t.soldUsd)}</td><td class="r">${t.closed ? '—' : usd(t.valueNowUsd)}</td>
            <td class="r ${cls(t.realizedUsd)}">${signedUsd(t.realizedUsd)}</td><td class="r ${cls(t.unrealizedUsd)}">${signedUsd(t.unrealizedUsd)}</td><td class="r ${cls(t.totalUsd)}"><b>${signedUsd(t.totalUsd)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No trades recorded yet.</td></tr>'}
          </tbody></table></div>
          <p class="muted" style="font-size:13px;margin-bottom:0">Average-cost method on swaps this site has recorded. Dollar values use the SOL price when each trade was recorded.</p></div>`;
      }
      if (tab === 'trades') {
        const { trades } = await api(`/users/${encodeURIComponent(u.wallet)}/trades`);
        el.innerHTML = trades.length ? `<div class="table-wrap">${tradeTable(trades, false)}</div>` : `<div class="empty">No trades recorded yet.${prof.isMe ? ' Press “Refresh trades” to read your latest swaps.' : ''}</div>`;
      }
      if (tab === 'tips') {
        const { tips } = await api(`/users/${encodeURIComponent(u.wallet)}/tips`);
        el.innerHTML = tips.length ? `<div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th class="r">Amount</th><th class="r">When</th></tr></thead><tbody>
          ${tips.map((t) => `<tr><td><a href="#/u/${esc(t.from.wallet)}">${esc(nameOf(t.from))}</a></td><td><a href="#/u/${esc(t.to.wallet)}">${esc(nameOf(t.to))}</a></td>
            <td class="r"><b>${amount(t.sol)} SOL</b></td><td class="r"><a class="muted" href="${solscanTx(t.signature)}" target="_blank" rel="noopener">${ago(t.createdAt)}</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No tips yet.</div>';
      }
    } catch (err) {
      el.innerHTML = `<div class="empty">Could not load: ${esc(err.message)}${err.status === 502 ? '<br><span style="font-size:13px">The Solana data service is busy. Try again in a minute.</span>' : ''}</div>`;
    }
  }

  async function pageSettings() {
    if (!state.me) {
      setPage(`${mobileTop()}${composer()}`);
      return;
    }
    const { user } = await api('/me');
    setPage(`${mobileTop()}<h1 class="page">Your profile</h1><p class="page-sub">Wallet <span class="mono">${esc(user.wallet)}</span></p>
      <form class="panel pad" data-form="profile">
        <label class="field"><span>Display name</span><input type="text" name="name" maxlength="40" value="${esc(user.name)}"></label>
        <label class="field"><span>Bio</span><textarea name="bio" maxlength="280" rows="3">${esc(user.bio)}</textarea></label>
        <label class="field"><span>X handle</span><input type="text" name="xHandle" maxlength="16" value="${esc(user.xHandle)}" placeholder="without @"></label>
        <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:16px"><input type="checkbox" name="shareTrades" ${user.shareTrades ? 'checked' : ''} style="margin-top:4px">
          <span>Post my new trades to the feed automatically<br><span class="muted" style="font-size:13px">Your holdings and trade history are public on-chain either way.</span></span></label>
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-action="signout">Sign out</button></div>
      </form>`);
  }

  function pageRoadmap() {
    const phases = [
      { s: 'done', t: 'Phase 1 · Trading engine', when: 'Shipped', items: ['Solana memecoin scanner on live DexScreener data', 'Rug filters + RugCheck safety check', 'Demo fund with real Jupiter swap quotes', 'Grok second opinion that reads X before each buy', '“Ready for real money?” checklist'] },
      { s: 'done', t: 'Phase 2 · Social layer', when: 'Shipped', items: ['Sign in with Phantom, Solflare or Backpack (message signature, no transaction)', 'Posts, replies, likes, reposts, follows', 'SOL tips wallet-to-wallet, verified on-chain', 'Live holdings, profit and trade history for every member', 'Recent trades feed and leaderboard'] },
      { s: 'now', t: 'Phase 3 · Signal', when: 'Next', items: ['Copy-trade alerts: get notified when wallets you follow buy', 'Token pages: who on the site holds it and their average entry', 'Bot strategy cards: share the demo bot’s calls to the feed', 'Notifications for likes, reposts, replies and tips'] },
      { s: '', t: 'Phase 4 · Creator economy', when: 'Planned', items: ['Paid groups gated by holding a token', 'Tip leaderboards and creator stats', 'Verified badges for KOL and project wallets', 'Mobile app (PWA) with push notifications'] },
      { s: '', t: 'Phase 5 · On-chain social', when: 'Exploring', items: ['Store posts on-chain or on Arweave so profiles are portable', 'Open API so other apps can read profiles and PnL', 'Live trading for the bot, only after the demo passes every readiness check'] },
    ];
    setPage(`${mobileTop()}<h1 class="page">Roadmap</h1><p class="page-sub">Where ${esc(state.config.appName)} is going. Built in public.</p>
      <div class="panel">${phases.map((p) => `<div class="phase"><span class="dot ${p.s}"></span><div><h3>${esc(p.t)}<span class="status ${p.s === 'done' ? 'up' : p.s === 'now' ? '' : 'muted'}">${esc(p.when)}</span></h3><ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div></div>`).join('')}</div>
      <div class="panel pad" style="margin-top:12px">
        <h2 class="section-title">How it works</h2>
        <p><b>Real data only.</b> Holdings come from Solana RPC. Trades are swaps read from each member's transactions: one token in, SOL/USDC/USDT out (or the reverse). Profit uses the average-cost method on recorded trades.</p>
        <p><b>Your keys stay yours.</b> Signing in signs a text message, never a transaction. Tips are normal SOL transfers you approve in your wallet; the server checks them on-chain before showing them.</p>
        <p style="margin-bottom:0"><b>Not financial advice.</b> Memecoins are extremely risky. Profits shown here are past results on-chain, not promises.</p>
      </div>`);
  }

  // ---------------------------------------------------------------- rail & account
  function renderAccount() {
    const el = $('#account');
    el.innerHTML = state.me
      ? `<a class="mini" href="#/u/${esc(state.me.wallet)}">${avatar(state.me)}<span class="who"><b>${esc(nameOf(state.me))}</b><br><span class="muted mono">${short(state.me.wallet)}</span></span></a>`
      : '<button class="btn gradient block" data-action="signin">Connect wallet</button>';
    $('#navMe').href = state.me ? `#/u/${state.me.wallet}` : '#/settings';
  }

  async function renderRail() {
    const rail = $('#rail');
    rail.innerHTML = `<div class="panel pad"><h3>Top traders</h3><div id="railBoard" class="muted">Loading…</div></div>
      <div class="panel pad"><h3>Latest trades</h3><div id="railTrades" class="muted">Loading…</div></div>
      <div class="panel pad"><h3>Demo trading bot</h3><p class="muted" style="margin:0 0 8px">Our memecoin bot trades a demo fund with live prices and Grok checks.</p><a class="btn small" href="/bot">Open dashboard</a></div>
      <p class="muted" style="font-size:12px;padding:0 4px"><a href="#/roadmap">Roadmap</a> · Not financial advice</p>`;
    api('/leaderboard').then(({ rows }) => {
      $('#railBoard').innerHTML = rows.slice(0, 5).map((r, i) => `<a class="mini" href="#/u/${esc(r.user.wallet)}"><span class="muted">${i + 1}</span>${avatar(r.user, 'sm')}<span class="who">${esc(nameOf(r.user))}</span><b class="num ${cls(r.totalUsd)}">${signedUsd(r.totalUsd)}</b></a>`).join('') || 'No traders yet.';
    }).catch(() => { $('#railBoard').textContent = 'Unavailable right now.'; });
    api('/trades/recent').then(({ trades }) => {
      $('#railTrades').innerHTML = trades.slice(0, 6).map((t) => `<a class="mini" href="#/u/${esc(t.wallet)}">${avatar(t.user || { wallet: t.wallet }, 'sm')}<span class="who">${esc(nameOf(t.user || { wallet: t.wallet }))} <span class="badge ${t.side}">${t.side}</span> ${esc(t.symbol ? '$' + t.symbol : '')}</span><span class="muted">${ago(t.time)}</span></a>`).join('') || 'No trades yet.';
    }).catch(() => { $('#railTrades').textContent = 'Unavailable right now.'; });
  }

  // ---------------------------------------------------------------- router
  async function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const [page = 'home', arg, sub] = parts;
    document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === (page === 'u' && state.me && arg === state.me.wallet ? 'me' : page === 'following' ? 'home' : page)));
    window.scrollTo(0, 0);
    if (page === 'home') return pageHome('latest');
    if (page === 'following') return pageHome('following');
    if (page === 'trades') return pageTrades();
    if (page === 'leaderboard') return pageLeaderboard();
    if (page === 'people') return pagePeople(arg || '');
    if (page === 'roadmap') return pageRoadmap();
    if (page === 'settings') return pageSettings();
    if (page === 'me') return state.me ? (location.hash = `#/u/${state.me.wallet}`) : pageSettings();
    if (page === 'u' && arg) return pageProfile(arg, sub || 'posts');
    if (page === 'p' && arg) return pagePost(arg);
    setPage('<div class="panel empty">Page not found. <a href="#/">Go home</a></div>');
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    try {
      if (a === 'signin') {
        $('#modal').open && $('#modal').close();
        return signIn();
      }
      if (a === 'signout') return signOut();
      if (a === 'reply') return void (location.hash = `#/p/${id}`);
      if (a === 'share') {
        await navigator.clipboard.writeText(`${location.origin}/#/p/${id}`).catch(() => {});
        return toast('Link copied');
      }
      if (a === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text).catch(() => {});
        return toast('Address copied');
      }
      if (a === 'tip' || a === 'tip-user') return tipDialog({ wallet: el.dataset.wallet, name: el.dataset.name }, a === 'tip' ? Number(id) : null);
      if (!requireLogin()) return;
      if (a === 'like') {
        const r = await api(`/posts/${id}/like`, { method: 'POST' });
        document.querySelectorAll(`[data-action="like"][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('on', r.liked);
          b.setAttribute('aria-pressed', r.liked);
          b.innerHTML = `${r.liked ? '♥' : '♡'} <span class="n">${r.likes || ''}</span>`;
        });
      }
      if (a === 'repost') {
        const r = await api(`/posts/${id}/repost`, { method: 'POST' });
        document.querySelectorAll(`[data-action="repost"][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('on', r.reposted);
          b.innerHTML = `⟲ <span class="n">${r.reposts || ''}</span>`;
        });
        toast(r.reposted ? 'Reposted' : 'Repost removed');
      }
      if (a === 'delete') {
        if (!confirm('Delete this post?')) return;
        await api(`/posts/${id}`, { method: 'DELETE' });
        toast('Deleted');
        route();
      }
      if (a === 'follow') {
        const r = await api(`/users/${encodeURIComponent(el.dataset.wallet)}/follow`, { method: 'POST' });
        toast(r.following ? 'Following' : 'Unfollowed');
        route();
      }
      if (a === 'sync') {
        el.disabled = true;
        el.textContent = 'Reading the chain…';
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
    if (form) form.querySelector('[data-counter]').textContent = `${e.target.value.length} / 500`;
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type="submit"]');
    try {
      if (form.dataset.form === 'search') return void (location.hash = `#/people/${encodeURIComponent(data.q || '')}`);
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
        renderAccount();
        toast('Saved');
        location.hash = `#/u/${user.wallet}`;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- boot
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
    renderAccount();
    renderRail();
    route();
  })();
})();
