(() => {
  'use strict';

  // ================== CONFIG (FAST TESTING) ==================
  const CONFIG = {
    messageTemplates: [
      'check it out: resources.theuntab.com',
      'take a look: resources.theuntab.com',
      'get it here: resources.theuntab.com',
      'access it now: resources.theuntab.com',
      'find it here: resources.theuntab.com',
      'go view it: resources.theuntab.com',
      'see it now: resources.theuntab.com'
    ],
    keywords: ['systems'],
    maxRepliesPerRun: 5,             // fast test cap
    skipIfAlreadyReplied: true,
    skipIfLiked: false,
    likeAfterReply: true,
    requireLikeAsProcessed: false,

    // FAST delays (bump these up for production)
    delays: {
      betweenActionsMs: [300, 600],       // was [4000, 9000]
      betweenRepliesMs: [1000, 2000],     // was [15000, 30000]
      afterLoadMoreMs: [250, 500],        // was [1500, 3000]
      typingPerCharMs: [5, 15]            // was [25, 60]
    },
    dryRun: false,

    scroll: {
      viewportJumps: 1,
      pauseMs: [300, 600],
      maxScrollChunks: 80
    },

    // editor/submit robustness
    editorSettleMs: [250, 450],      // short settle after typing
    submitGuardTimeoutMs: 2500,      // max time to wait for editor/submit readiness
  };

  // ================== STATE ==================
  let running = false;
  let paused = false;
  let shouldStop = false;
  let repliedThisRun = 0;

  // ================== UTILS ==================
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const pick = arr => arr[rand(0, arr.length-1)];
  const delay = ([a,b]) => sleep(rand(a,b));
  const log = (m,t='info')=>{
    const p = t==='error'?'❌':t==='success'?'✅':'ℹ️';
    console.log(`${p} Systems-Auto: ${m}`);
  };

  async function waitWhilePausedOrStopped(){
    while (paused && !shouldStop) { await sleep(150); }
    return !shouldStop;
  }

  async function waitFor(pred, timeoutMs){
    const start = Date.now();
    let ok = pred();
    while (!ok) {
      if (shouldStop) return false;
      if (Date.now() - start > timeoutMs) return false;
      await sleep(60);
      ok = pred();
    }
    return true;
  }

  const containsKeyword = (s='') => {
    const txt = (s||'').toLowerCase();
    return CONFIG.keywords.some(k => txt.includes(String(k).toLowerCase()));
  };

  // ================== PROGRESS (PERSISTED) ==================
  const STORAGE_PREFIX = 'li-auto-reply.progress:';
  function getPostKey(){
    const urnEl = document.querySelector('[data-urn*="activity"]');
    const urn = urnEl?.getAttribute('data-urn') || '';
    return STORAGE_PREFIX + (urn || location.pathname);
  }
  function normalizeStoredKey(k='') {
    const s = String(k);
    const m = s.match(/urn:li:comment:\([^)]*\)/);
    if (m) return m[0];
    return s.replace(/\s+/g,' ').trim();
  }
  function loadProgress(){
    try {
      const raw = localStorage.getItem(getPostKey());
      const obj = raw ? JSON.parse(raw) : { processed: [] };
      const migrated = (obj.processed || []).map(normalizeStoredKey);
      return { processed: Array.from(new Set(migrated)) };
    } catch { return { processed: [] }; }
  }
  function saveProgress(p){
    try { localStorage.setItem(getPostKey(), JSON.stringify(p)); } catch {}
  }
  const progress = loadProgress();
  const processedSet = new Set(progress.processed || []);
  function persistKey(key){
    processedSet.add(key);
    progress.processed = Array.from(processedSet);
    saveProgress(progress);
  }

  // ================== DISCOVERY / SELECTORS ==================
  async function clickAllLoadMore(rounds=1){
    const sels = [
      'button[aria-label*="more comments" i]',
      'button[aria-label*="see more comments" i]',
      'button[aria-label*="more replies" i]',
      'button[aria-label*="view more replies" i]',
      'button[aria-label*="load more comments" i]'
    ];
    for (let r=0; r<rounds; r++){
      let clicks = 0;
      for (const sel of sels){
        document.querySelectorAll(sel).forEach(b=>{
          if (!b.disabled && b.offsetParent !== null) { b.click(); clicks++; }
        });
      }
      if (!clicks) break;
      await delay(CONFIG.delays.afterLoadMoreMs);
      if (!(await waitWhilePausedOrStopped())) return;
    }
  }

  async function autoScrollChunks(chunks){
    for (let i=0; i<chunks; i++){
      if (!(await waitWhilePausedOrStopped())) return;
      window.scrollBy(0, window.innerHeight * 0.9);
      await delay(CONFIG.scroll.pauseMs);
    }
  }

  function findComments(){
    const cands = [
      '[data-urn*="comment"]',
      '[data-comment-id]',
      '[data-id*="comment"]',
      'div[role="comment"]',
      '.comments-comment-item',
      '.feed-shared-comment'
    ];
    for (const sel of cands){
      const list = Array.from(document.querySelectorAll(sel)).filter(n=>n.offsetParent!==null);
      if (list.length) return list;
    }
    return [];
  }

  function stableCommentKey(el){
    const urn = el.getAttribute('data-urn');
    if (urn) return normalizeStoredKey(urn);
    const cid = el.getAttribute('data-comment-id') || el.getAttribute('data-id') || el.id || '';
    return cid.trim();
  }

  function getCommentText(el){
    const sels = [
      '[data-test-id="comment-body"]',
      '[data-test-reusable-comment__text] .update-components-text',
      '.comments-comment-item-content-body',
      '.update-components-comment__comment',
      '[data-test-id*="text"]'
    ];
    for (const s of sels){
      const n = el.querySelector(s);
      if (n && n.textContent?.trim()) return n.textContent.trim();
    }
    return el.textContent?.trim() || '';
  }

  // ---------- Reply + Submit ----------
  function findReplyButton(el){
    const sels = [
      'button[aria-label*="reply" i]',
      'button[role="button"][data-control-name*="reply" i]',
      'button[aria-haspopup][aria-label*="reply" i]',
      'button[role="button"]'
    ];
    for (const s of sels){
      const btns = el.querySelectorAll(s);
      for (const b of btns){
        const txt = (b.innerText||b.textContent||'').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label')||'').toLowerCase();
        if (b.offsetParent!==null && (aria.includes('reply') || txt==='reply' || txt.includes('reply'))) return b;
      }
    }
    return null;
  }
  function activeEditor(){
    const list = Array.from(document.querySelectorAll('div[role="textbox"][contenteditable="true"]'))
      .filter(n=>n.offsetParent!==null);
    return list[list.length-1] || null;
  }
  function findSubmitNear(editorEl){
    const container = editorEl.closest('.comments-comment-box, .comments-comment-card, form, .comments-comment-item') || document;
    const sels = [
      'button[class*="comments-comment-box__submit-button"]',
      'button[aria-label*="reply" i]',
      'button[aria-label*="post reply" i]',
      'button[data-control-name*="post_comment" i]',
      'button[type="submit"][aria-label*="post" i]',
      'button[aria-label="Post"]',
      'button'
    ];
    for (const s of sels){
      const btns = container.querySelectorAll(s);
      for (const b of btns){
        const txt = (b.innerText||b.textContent||'').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label')||'').toLowerCase();
        const enabled = !b.disabled && b.getAttribute('aria-disabled')!=='true';
        const visible = b.offsetParent!==null;
        const looksRight = aria.includes('reply') || aria.includes('post') || txt==='reply' || txt.includes('reply') || txt==='post' || txt.includes('post');
        if (visible && enabled && looksRight) return b;
      }
    }
    return null;
  }

  // ---------- Like ----------
  function findLikeButton(el){
    const candidates = el.querySelectorAll('button[aria-label*="Like" i], button[aria-label*="React Like" i], button[aria-pressed]');
    for (const b of candidates){
      if (b.offsetParent === null) continue;
      return b;
    }
    return null;
  }
  function isLiked(btn){
    if (!btn) return false;
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    const aria = (btn.getAttribute('aria-label')||'').toLowerCase();
    return aria.includes('unreact like');
  }

  async function appendIntoEditor(editorEl, text){
    editorEl.scrollIntoView({behavior:'smooth', block:'center'});
    await delay(CONFIG.delays.betweenActionsMs);
    if (!(await waitWhilePausedOrStopped())) return false;

    editorEl.focus();
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const lastChar = (editorEl.textContent || '').slice(-1);
    const toInsert = (lastChar && !/\s/.test(lastChar) ? ' ' : ' ') + text;

    if (!CONFIG.dryRun) {
      for (const ch of toInsert.split('')) {
        if (!(await waitWhilePausedOrStopped())) return false;
        document.execCommand('insertText', false, ch);
        await sleep(rand(...CONFIG.delays.typingPerCharMs));
      }
    } else {
      editorEl.style.outline = '2px solid dodgerblue';
    }

    editorEl.dispatchEvent(new Event('input', {bubbles:true}));
    editorEl.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:' '}));

    // small settle so LinkedIn binds state
    await delay(CONFIG.editorSettleMs);
    return true;
  }

  // ========= FILTERS =========
  function hasOwnReply(el){
    const blocks = el.querySelectorAll('[data-test-id*="reply"], .comments-comment-item--reply, [id*="reply-"]');
    for (const b of blocks){
      if (b.querySelector('[aria-label^="You"], .comments-comment-item__main-content--own')) return true;
      const meta = b.querySelector('[data-test-reusable-actor__meta], [data-test-reusable-actor__name]');
      if (meta && /(^|\s)you(\s|$)/i.test(meta.textContent||'')) return true;
    }
    return false;
  }

  // ================== MAIN ACTION ==================
  async function replyAndMaybeLike(commentEl, key){
    try{
      commentEl.scrollIntoView({behavior:'smooth', block:'center'});
      await delay(CONFIG.delays.betweenActionsMs);
      if (!(await waitWhilePausedOrStopped())) return false;

      // Reply button
      const replyBtn = findReplyButton(commentEl);
      if (!replyBtn){ log('Reply button not found', 'error'); return false; }
      if (CONFIG.dryRun) { replyBtn.style.outline='2px solid orange'; log('DRY-RUN: would click Reply'); }
      else { replyBtn.click(); }

      await delay(CONFIG.delays.betweenActionsMs);
      if (!(await waitWhilePausedOrStopped())) return false;

      // Editor + type
      const editor = activeEditor();
      if (!editor){ log('Reply editor not found', 'error'); return false; }

      const message = pick(CONFIG.messageTemplates);
      log(`Appending reply: "${message}"`);
      const typed = await appendIntoEditor(editor, message);
      if (!typed) return false;

      // Guard: wait until editor actually contains message AND submit is enabled
      const submitReady = await waitFor(() => {
        const hasMsg = (editor.textContent || '').includes(message);
        const btn = findSubmitNear(editor);
        const btnReady = !!(btn && !btn.disabled && btn.offsetParent !== null && btn.getAttribute('aria-disabled') !== 'true');
        return hasMsg && btnReady;
      }, CONFIG.submitGuardTimeoutMs);

      if (!submitReady) {
        log('Editor/Submit not ready; trying Enter key to submit…');
        // Fallback: send Enter to editor
        editor.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
        editor.dispatchEvent(new KeyboardEvent('keyup',   {key: 'Enter', code: 'Enter', bubbles: true}));
        await delay(CONFIG.delays.betweenActionsMs);
      } else {
        const submit = findSubmitNear(editor);
        if (!submit){ log('Submit/Reply button not found near editor', 'error'); return false; }
        if (CONFIG.dryRun) { submit.style.outline='2px solid lime'; log('DRY-RUN: would click Submit'); }
        else { submit.click(); }
        await delay(CONFIG.delays.betweenActionsMs);
      }

      // Like after reply
      if (CONFIG.likeAfterReply) {
        const likeBtn = findLikeButton(commentEl);
        if (likeBtn && !isLiked(likeBtn)) {
          if (CONFIG.dryRun) { likeBtn.style.outline = '2px solid magenta'; log('DRY-RUN: would click Like'); }
          else { likeBtn.click(); }
          await sleep(250);
        }
      }

      // Persist
      if (!CONFIG.requireLikeAsProcessed || (CONFIG.requireLikeAsProcessed && isLiked(findLikeButton(commentEl)))) {
        persistKey(key);
      }

      return true;
    } catch (e){
      log(`Error in reply flow: ${e?.message || e}`, 'error');
      return false;
    }
  }

  // ================== ORCHESTRATOR ==================
  function findLikeButton(el){
    const candidates = el.querySelectorAll('button[aria-label*="Like" i], button[aria-label*="React Like" i], button[aria-pressed]');
    for (const b of candidates){
      if (b.offsetParent === null) continue;
      return b;
    }
    return null;
  }
  function isLiked(btn){
    if (!btn) return false;
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    const aria = (btn.getAttribute('aria-label')||'').toLowerCase();
    return aria.includes('unreact like');
  }

  async function process(){
    if (running){ log('Already running', 'error'); return; }
    running = true; shouldStop = false;

    try{
      progress.processed = Array.from(processedSet);
      saveProgress(progress);

      let scrollChunks = 0;
      let lastProcessedCount = -1;

      while (!shouldStop && repliedThisRun < CONFIG.maxRepliesPerRun && scrollChunks < CONFIG.scroll.maxScrollChunks) {
        if (!(await waitWhilePausedOrStopped())) break;

        await clickAllLoadMore(1);
        const comments = findComments();
        if (!comments.length) { log('No comments visible yet… scrolling.', 'info'); await autoScrollChunks(CONFIG.scroll.viewportJumps); scrollChunks += 1; continue; }

        for (let i = 0; i < comments.length && !shouldStop && repliedThisRun < CONFIG.maxRepliesPerRun; i++) {
          if (!(await waitWhilePausedOrStopped())) break;

          const c = comments[i];
          const key = stableCommentKey(c);
          if (!key) continue;

          if (processedSet.has(key)) continue;

          if (CONFIG.skipIfLiked) {
            const lb = findLikeButton(c);
            if (isLiked(lb)) { persistKey(key); continue; }
          }

          const text = getCommentText(c);
          if (!text) continue;
          if (!containsKeyword(text)) continue;

          if (CONFIG.skipIfAlreadyReplied && hasOwnReply(c)) { persistKey(key); continue; }

          const ok = await replyAndMaybeLike(c, key);
          if (ok) {
            repliedThisRun++;
            log(`Replied ${repliedThisRun}/${CONFIG.maxRepliesPerRun}`, 'success');
            await delay(CONFIG.delays.betweenRepliesMs);
          } else {
            log('Reply failed; continuing to next comment', 'error');
          }
        }

        const nowCount = processedSet.size;
        if (nowCount === lastProcessedCount) {
          await autoScrollChunks(CONFIG.scroll.viewportJumps);
          scrollChunks += 1;
        } else {
          lastProcessedCount = nowCount;
        }
      }

      log(`Run complete. Replied this run: ${repliedThisRun}. Total processed: ${processedSet.size}`, 'success');
    } catch (e){
      log(`Fatal: ${e?.message || e}`, 'error');
    } finally {
      running = false;
    }
  }

  // ================== PUBLIC CONTROLS ==================
  window.liReply = {
    pause(){ paused = !paused; log(paused?'Paused':'Resumed'); },
    stop(){ shouldStop = true; paused = false; log('Stop requested; exiting ASAP'); },
    setMax(n){ if (Number.isFinite(n) && n>0){ CONFIG.maxRepliesPerRun = n; log(`maxRepliesPerRun set to ${n}`); } },
    setKeywords(arr){ CONFIG.keywords = Array.isArray(arr) ? arr : [String(arr)]; log(`keywords: ${CONFIG.keywords.join(', ')}`); },
    stats(){
      const k = getPostKey();
      log(`PostKey: ${k}`);
      log(`Processed total (persisted): ${processedSet.size}`);
      log(`This run replied: ${repliedThisRun}`);
      return { postKey:k, processedTotal: processedSet.size, repliedThisRun };
    },
    start(){ if (!running) { repliedThisRun = 0; process(); } else { log('Already running'); } }
  };
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase()==='p') window.liReply.pause();
    if (e.key.toLowerCase()==='s') window.liReply.stop();
  });

  // ================== START ==================
  log('Loaded. Controls: liReply.start() / liReply.pause() / liReply.stop() / liReply.setMax(n) / liReply.setKeywords([...]) / liReply.stats()  (P=Pause, S=Stop)');
  log(`Target keywords: ${CONFIG.keywords.join(', ')}  |  Per-run cap: ${CONFIG.maxRepliesPerRun} | Dry-run: ${CONFIG.dryRun}`);
  // For testing, it DOESN'T autostart. Call liReply.start() after adjusting anything.
})();
