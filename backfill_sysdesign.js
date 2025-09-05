(() => {
  'use strict';

  // ===== CONFIG (edit if needed) =====
  const ME = {
    profileHrefStartsWith: '/in/surya-atmuri', // your profile path (no trailing slash OK)
    displayName: 'Surya Atmuri'                // optional fallback
  };

  // Texts that identify your past replies (fallback matcher)
  const TEMPLATES = [
    'check it out: resources.theuntab.com',
    'take a look: resources.theuntab.com',
    'get it here: resources.theuntab.com',
    'access it now: resources.theuntab.com',
    'find it here: resources.theuntab.com',
    'go view it: resources.theuntab.com',
    'see it now: resources.theuntab.com',
    // add prior short templates if you used them historically:
    'sent ✅','check your inbox','delivered 📧','check your email','sent','delivered'
  ];

  // Autoscroll / expansion pacing for large threads (2k+)
  const SCAN = {
    maxRounds: 1200,           // absolute safety limit for rounds
    loadMoreRoundsEach: 2,     // how many times to press “load more …” per round
    scrollByViewport: 1.0,     // ~one screen per round
    pauseBetweenRoundsMs: [500, 900],
    pauseAfterClicksMs: [700, 1200],
    sleepBetweenBatchesMs: [1200, 2000],
    persistEveryN: 25,         // save to localStorage every N additions
    idleStopAfter: 12          // stop after these many rounds with no new discoveries
  };

  // ===== LOGGING =====
  const log = (m,t='info')=>{
    const p = t==='error'?'❌':t==='success'?'✅':'ℹ️';
    console.log(`${p} Backfill v5: ${m}`);
  };
  const rand = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const delay = ([a,b])=>sleep(rand(a,b));
  let running = false, paused = false;

  // ===== STORAGE (URN-only) =====
  const STORAGE_PREFIX = 'li-auto-reply.progress:';
  function getPostKey(){
    const urnEl = document.querySelector('[data-urn*="activity"]');
    const urn = urnEl?.getAttribute('data-urn') || '';
    return STORAGE_PREFIX + (urn || location.pathname);
  }
  function normalizeStoredKey(k=''){
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

  // ===== HELPERS =====
  function normalizeHref(href){
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      let p = u.pathname;
      if (p.length>1 && p.endsWith('/')) p = p.slice(0,-1);
      return p;
    } catch {
      let p = href;
      if (!p.startsWith('/')) return '';
      if (p.length>1 && p.endsWith('/')) p = p.slice(0,-1);
      return p;
    }
  }
  const norm = (s='')=>s.trim().toLowerCase();

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
          if (!b.disabled && b.offsetParent!==null) { b.click(); clicks++; }
        });
      }
      if (!clicks) break;
      await delay(SCAN.pauseAfterClicksMs);
    }
  }

  function findComments(){
    const sels = [
      '[data-urn*="comment"]',      // prefer URN-backed
      '[data-comment-id]',
      '[data-id*="comment"]',
      'div[role="comment"]',
      '.comments-comment-item',
      '.feed-shared-comment'
    ];
    for (const s of sels){
      const list = Array.from(document.querySelectorAll(s)).filter(n=>n.offsetParent!==null);
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

  function replyBlocksUnder(el){
    return el.querySelectorAll('[data-urn*="comment"], .comments-comment-item--reply, [id*="reply-"], li, article');
  }

  function isReplyByMe(block){
    const myPrefix = normalizeHref(ME.profileHrefStartsWith);
    if (myPrefix) {
      const links = block.querySelectorAll('a[href*="/in/"]');
      for (const a of links){
        const href = normalizeHref(a.getAttribute('href')||'');
        if (href && (href===myPrefix || href.startsWith(myPrefix+'/'))) return true;
      }
    }
    if (ME.displayName) {
      const nm = block.querySelector('[data-test-reusable-actor__name], .update-components-actor__name, a[href*="/in/"]');
      const txt = norm(nm?.textContent || '');
      if (txt && txt.includes(norm(ME.displayName))) return true;
    }
    if (block.querySelector('.comments-comment-item__main-content--own')) return true;
    return false;
  }

  function replyLooksLikeTemplate(block){
    const txt = norm(block.textContent || '');
    return TEMPLATES.some(t => txt.includes(norm(t)));
  }

  async function scanVisibleBatch(processedCounter){
    const comments = findComments();
    let added = 0;

    for (const c of comments){
      const key = stableCommentKey(c);
      if (!key || processedSet.has(key)) continue;

      const replies = replyBlocksUnder(c);
      let mine = false;
      for (const r of replies){
        if (isReplyByMe(r) || replyLooksLikeTemplate(r)) { mine = true; break; }
      }
      if (mine){
        processedSet.add(key);
        added++;
        // Persist in batches to avoid losing progress mid-run
        if ((processedCounter.count + added) % SCAN.persistEveryN === 0) {
          progress.processed = Array.from(processedSet);
          saveProgress(progress);
        }
      }
    }
    return added;
  }

  async function process(){
    if (running) { log('Already running', 'error'); return; }
    running = true;
    try {
      // Save any migrated keys back
      progress.processed = Array.from(processedSet);
      saveProgress(progress);

      let totalAdded = 0;
      let idleRounds = 0;

      for (let round=0; round<SCAN.maxRounds; round++){
        if (paused) { await sleep(500); round--; continue; }

        // Expand visible "load more" controls
        await clickAllLoadMore(SCAN.loadMoreRoundsEach);

        // Scan what’s on screen
        const added = await scanVisibleBatch({ count: totalAdded });
        totalAdded += added;

        if (added === 0) {
          idleRounds++;
        } else {
          idleRounds = 0;
        }

        // Persist after each round as well
        progress.processed = Array.from(processedSet);
        saveProgress(progress);

        log(`Round ${round+1}: +${added} (total ${totalAdded}) | stored=${processedSet.size}`);

        if (idleRounds >= SCAN.idleStopAfter) {
          log(`No new items for ${SCAN.idleStopAfter} rounds — stopping.`, 'success');
          break;
        }

        // Scroll to fetch next chunk
        window.scrollBy(0, window.innerHeight * SCAN.scrollByViewport);
        await delay(SCAN.pauseBetweenRoundsMs);
      }

      // Final persist
      progress.processed = Array.from(processedSet);
      saveProgress(progress);

      log(`Backfill complete. Newly marked this run: ${totalAdded}. Total stored: ${processedSet.size}`, 'success');
      log(`Key: ${getPostKey()}`);
    } catch(e){
      log(`Fatal: ${e?.message || e}`, 'error');
    } finally {
      running = false;
    }
  }

  // ===== Controls =====
  window.liBackfill = {
    pause(){ paused = !paused; log(paused?'Paused':'Resumed'); },
    stop(){ running = false; paused = false; log('Stop requested; will exit after current cycle'); },
    stats(){ return { key:getPostKey(), stored: processedSet.size }; }
  };
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase()==='p') window.liBackfill.pause();
    if (e.key.toLowerCase()==='s') window.liBackfill.stop();
  });

  log('Backfill v5 loaded. Controls: liBackfill.pause() / liBackfill.stop() / liBackfill.stats()  (P=Pause, S=Stop)');
  process();
})();
