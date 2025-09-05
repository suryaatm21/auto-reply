(() => {
  'use strict';

  // ---------- CONFIG ----------
  const CONFIG = {
    messageTemplates: [
      'sent ✅',
      'check your inbox',
      'delivered 📧',
      'check your email'
    ],
    minDelay: 3000,
    maxDelay: 8000,
    maxRepliesPerRun: 30,        // per-run throttle; NOT a hard limit overall
    emailRegex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    stopOnError: true,
    dryRun: false
  };

  // ---------- STATE ----------
  let running = false;
  let paused = false;
  let repliedThisRun = 0;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const randomDelay = ()=>rand(CONFIG.minDelay,CONFIG.maxDelay);
  const randomTemplate = ()=>CONFIG.messageTemplates[rand(0,CONFIG.messageTemplates.length-1)];
  const log = (m,t='info')=>{
    const p = t==='error'?'❌':t==='success'?'✅':'ℹ️';
    console.log(`${p} Auto-Reply: ${m}`);
  };

  const containsEmail = (s='')=>CONFIG.emailRegex.test(s);

  // ---------- KEY NORMALIZATION ----------
  // Extract the stable URN if present, else fall back to comment id; trim/compact whitespace.
  function normalizeStoredKey(k='') {
    const s = String(k);
    const urnMatch = s.match(/urn:li:comment:\([^)]*\)/); // grab just the URN portion
    if (urnMatch) return urnMatch[0];
    return s.replace(/\s+/g, ' ').trim();
  }

  function stableCommentKey(el) {
    const urn = el.getAttribute('data-urn');                         // best
    if (urn) return normalizeStoredKey(urn);
    const cid = el.getAttribute('data-comment-id') || el.getAttribute('data-id') || el.id || '';
    if (cid) return cid.trim();
    // ultimate fallback: compacted first 80 chars of text (rare)
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0,80);
  }

  // ---------- PROGRESS (PERSISTED) ----------
  const STORAGE_PREFIX = 'li-auto-reply.progress:';
  function getPostKey(){
    const urnEl = document.querySelector('[data-urn*="activity"]');
    const urn = urnEl?.getAttribute('data-urn') || '';
    return STORAGE_PREFIX + (urn || location.pathname);
  }
  function loadProgress(){
    try {
      const raw = localStorage.getItem(getPostKey());
      const obj = raw ? JSON.parse(raw) : { processed: [] };
      // migrate any legacy keys to stable form
      const migrated = (obj.processed || []).map(normalizeStoredKey);
      return { processed: Array.from(new Set(migrated)) };
    } catch {
      return { processed: [] };
    }
  }
  function saveProgress(progress){
    try { localStorage.setItem(getPostKey(), JSON.stringify(progress)); } catch {}
  }
  const progress = loadProgress();
  const processedSet = new Set(progress.processed || []);

  // ---------- HELPERS ----------
  async function waitWhilePaused(){
    while (paused) { await sleep(500); }
  }

  async function expandAll() {
    const sels = [
      'button[aria-label*="more comments" i]',
      'button[aria-label*="see more comments" i]',
      'button[aria-label*="more replies" i]',
      'button[aria-label*="view more replies" i]',
      'button[aria-label*="load more comments" i]'
    ];
    for (let r=0;r<4;r++){
      let n=0;
      sels.forEach(sel=>{
        document.querySelectorAll(sel).forEach(b=>{
          if(!b.disabled && b.offsetParent!==null){ b.click(); n++; }
        });
      });
      if(!n) break;
      await sleep(1200);
    }
  }

  function findComments(){
    const cands = [
      '[data-urn*="comment"]',      // prefer URN-backed nodes
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

  function keyFor(el){
    // Use the new stable key so it matches backfilled storage
    return stableCommentKey(el);
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

  function hasOwnReply(el){
    const blocks = el.querySelectorAll('[data-test-id*="reply"], .comments-comment-item--reply, [id*="reply-"]');
    for (const b of blocks){
      if (b.querySelector('[aria-label^="You"], .comments-comment-item__main-content--own')) return true;
      const meta = b.querySelector('[data-test-reusable-actor__meta], [data-test-reusable-actor__name]');
      if (meta && /(^|\s)you(\s|$)/i.test(meta.textContent||'')) return true;
    }
    return false;
  }

  function findReplyButton(el){
    const sels = [
      'button[aria-label*="reply" i]',
      'button[role="button"][data-control-name*="reply" i]',
      'button[aria-haspopup][aria-expanded][aria-label*="reply" i]',
      'button[role="button"]'
    ];
    for (const s of sels){
      const btns = el.querySelectorAll(s);
      for (const b of btns){
        const txt = (b.innerText||b.textContent||'').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label')||'').toLowerCase();
        if (b.offsetParent!==null && (aria.includes('reply') || txt==='reply' || txt.includes('reply'))) {
          return b;
        }
      }
    }
    return null;
  }

  function findActiveReplyEditor(){
    const list = Array.from(document.querySelectorAll('div[role="textbox"][contenteditable="true"]'))
      .filter(n=>n.offsetParent!==null);
    return list[list.length-1] || null;
  }

  function findSubmitButtonNear(editorEl){
    const container = editorEl.closest(
      '.comments-comment-box, .comments-comment-card, form, .comments-comment-item'
    ) || document;

    const sels = [
      'button[class*="comments-comment-box__submit-button"]', // common in reply UI
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
        const looksRight = aria.includes('reply') || aria.includes('post') || txt==='reply' || txt==='post' || txt.includes('reply') || txt.includes('post');
        if (visible && enabled && looksRight) return b;
      }
    }
    return null;
  }

  // Append (preserve @mention)
  async function appendIntoEditor(editorEl, text){
    editorEl.scrollIntoView({behavior:'smooth', block:'center'});
    await sleep(200);
    editorEl.focus();

    // place caret at end
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const lastChar = (editorEl.textContent || '').slice(-1);
    const toInsert = (lastChar && !/\s/.test(lastChar) ? ' ' : ' ') + text;

    const ok = document.execCommand('insertText', false, toInsert);
    if (!ok){
      editorEl.dispatchEvent(new InputEvent('beforeinput', {inputType:'insertText', data:toInsert, bubbles:true}));
      editorEl.textContent = (editorEl.textContent || '') + toInsert;
      editorEl.dispatchEvent(new Event('input', {bubbles:true}));
      editorEl.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:' '}));
    }
    await sleep(200);
  }

  async function replyToComment(commentEl, message){
    try{
      commentEl.scrollIntoView({behavior:'smooth', block:'center'});
      await sleep(300);

      const btn = findReplyButton(commentEl);
      if (!btn){ log('Reply button not found', 'error'); return false; }

      if (CONFIG.dryRun){ btn.style.outline='2px solid orange'; log('DRY-RUN: would click Reply'); }
      else { btn.click(); }

      await sleep(700);
      await waitWhilePaused();

      const editor = findActiveReplyEditor();
      if (!editor){ log('Reply editor not found', 'error'); return false; }

      if (CONFIG.dryRun){
        editor.style.outline='2px solid dodgerblue';
        log(`DRY-RUN: would append "${message}"`);
      } else {
        await appendIntoEditor(editor, message);
        const submit = findSubmitButtonNear(editor);
        if (!submit){ log('Submit/Reply button not found', 'error'); return false; }
        submit.click();
      }

      await sleep(1000);
      return true;
    } catch(e){
      log(`Reply error: ${e?.message||e}`, 'error');
      return false;
    }
  }

  async function process(){
    if (running){ log('Already running', 'error'); return; }
    running = true;

    try{
      // Save migrated set immediately (so UI reflects normalized keys)
      progress.processed = Array.from(processedSet);
      saveProgress(progress);

      await expandAll();
      let comments = findComments();
      log(`Visible comments: ${comments.length}`);

      if (!comments.length){ log('No comments found on this page.', 'error'); return; }

      for (let i=0; i<comments.length && repliedThisRun<CONFIG.maxRepliesPerRun; i++){
        await waitWhilePaused();

        const c = comments[i];
        const key = keyFor(c);
        if (processedSet.has(key)) {
          // already processed (either backfilled or this run) — skip
          continue;
        }

        const text = getCommentText(c);
        if (!text){ continue; }
        if (!containsEmail(text)){ continue; }

        // If you already replied manually (detected), mark as processed and skip
        if (hasOwnReply(c)){
          processedSet.add(key);
          progress.processed = Array.from(processedSet);
          saveProgress(progress);
          continue;
        }

        const msg = randomTemplate();
        const ok = await replyToComment(c, msg);
        if (ok){
          repliedThisRun++;
          // Mark as processed (normalized key) and persist
          processedSet.add(key);
          progress.processed = Array.from(processedSet);
          saveProgress(progress);

          const d = randomDelay();
          log(`Replied (${repliedThisRun}/${CONFIG.maxRepliesPerRun}). Cooling down ${(d/1000).toFixed(1)}s…`, 'success');
          await sleep(d);
        } else if (CONFIG.stopOnError){
          log('Stopping (stopOnError=true)', 'error');
          break;
        }
      }

      log(`Run complete. Replied this run: ${repliedThisRun}. Total processed (saved): ${processedSet.size}`, 'success');
    } catch(e){
      log(`Fatal: ${e?.message||e}`, 'error');
    } finally {
      running = false;
    }
  }

  // ---------- PUBLIC CONTROLS ----------
  window.liReply = {
    pause(){ paused = !paused; log(paused?'Paused':'Resumed'); },
    stop(){ running=false; paused=false; log('Stop requested; will exit after current step'); },
    setMax(n){ if (Number.isFinite(n) && n>0){ CONFIG.maxRepliesPerRun = n; log(`maxRepliesPerRun set to ${n}`); } },
    stats(){
      const k = getPostKey();
      const total = processedSet.size;
      log(`PostKey: ${k}`);
      log(`Processed total (persisted): ${total}`);
      log(`This run replied: ${repliedThisRun}`);
      return { postKey:k, processedTotal: total, repliedThisRun };
    },
    reset(){
      localStorage.removeItem(getPostKey());
      processedSet.clear?.();
      while(processedSet.size) {
        const first = processedSet.values().next().value;
        if (first===undefined) break;
        processedSet.delete(first);
      }
      progress.processed = [];
      log('Progress for this post cleared.');
    }
  };

  // Keyboard shortcuts: P pause/resume, S stop
  window.addEventListener('keydown', (e)=>{
    if (e.key.toLowerCase()==='p') window.liReply.pause();
    if (e.key.toLowerCase()==='s') window.liReply.stop();
  });

  // ---------- START ----------
  log('Loaded. Controls: liReply.pause() / liReply.stop() / liReply.setMax(n) / liReply.stats() / liReply.reset()  (P=Pause, S=Stop)');
  log(`Delay: ${CONFIG.minDelay/1000}-${CONFIG.maxDelay/1000}s | Per-run cap: ${CONFIG.maxRepliesPerRun} (raise with liReply.setMax(n))`);
  log(`Templates: ${CONFIG.messageTemplates.join(' | ')}`);
  log(`Dry-run: ${CONFIG.dryRun ? 'ON' : 'OFF'}`);
  setTimeout(process, 1200);
})();
