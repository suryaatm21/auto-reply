(() => {
  'use strict';

  const ME = {
    profileHrefStartsWith: '/in/surya-atmuri',   // <<— your slug (no trailing slash OK)
    displayName: 'Surya Atmuri'                  // optional fallback
  };

  const TEMPLATES = [
    'sent ✅',
    'check your inbox',
    'delivered 📧',
    'check your email'
  ];

  const log = (m,t='info')=>{
    const p = t==='error'?'❌':t==='success'?'✅':'ℹ️';
    console.log(`${p} Backfill v4: ${m}`);
  };
  const norm = (s='')=>s.trim().toLowerCase();

  const STORAGE_PREFIX = 'li-auto-reply.progress:';
  function getPostKey(){
    const urnEl = document.querySelector('[data-urn*="activity"]');
    const urn = urnEl?.getAttribute('data-urn') || '';
    return STORAGE_PREFIX + (urn || location.pathname);
  }
  function loadProgress(){ try{const r=localStorage.getItem(getPostKey());return r?JSON.parse(r):{processed:[]};}catch{return{processed:[]}} }
  function saveProgress(p){ try{localStorage.setItem(getPostKey(), JSON.stringify(p));}catch{} }

  function normalizeHref(href){
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      let p = u.pathname;
      // strip trailing slash
      if (p.length>1 && p.endsWith('/')) p = p.slice(0, -1);
      return p; // e.g., '/in/surya-atmuri'
    } catch {
      // relative
      let p = href;
      if (!p.startsWith('/')) return '';
      if (p.length>1 && p.endsWith('/')) p = p.slice(0, -1);
      return p;
    }
  }

  async function expandAll() {
    const sels = [
      'button[aria-label*="more comments" i]',
      'button[aria-label*="see more comments" i]',
      'button[aria-label*="more replies" i]',
      'button[aria-label*="view more replies" i]',
      'button[aria-label*="load more comments" i]'
    ];
    for (let r=0;r<5;r++){
      let n=0;
      sels.forEach(sel=>{
        document.querySelectorAll(sel).forEach(b=>{
          if(!b.disabled && b.offsetParent!==null){ b.click(); n++; }
        });
      });
      if(!n) break;
      await new Promise(res=>setTimeout(res, 900));
    }
  }

  function findComments(){
    const sels = [
      '[data-id*="comment"]','[data-urn*="comment"]','[data-comment-id]',
      'div[role="comment"]','.comments-comment-item','.feed-shared-comment'
    ];
    for (const s of sels){
      const list = Array.from(document.querySelectorAll(s)).filter(n=>n.offsetParent!==null);
      if (list.length) return list;
    }
    return [];
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

  function keyFor(el){
    const id = el.getAttribute('data-id') || el.id || '';
    const who = el.querySelector('[data-test-reusable-actor__name],[aria-label*="Author"],[data-view-name*="actor-name"]')?.textContent?.trim() || '';
    const snip = (getCommentText(el) || '').slice(0,80).trim();
    return `${id}|${who}|${snip}`;
  }

  function replyBlocksUnder(el){
    return el.querySelectorAll(
      // cast a wide net for reply cards
      '[data-urn*="comment"], .comments-comment-item--reply, [id*="reply-"], li, article'
    );
  }

  function isReplyByMe(block){
    // match any actor link that points to your /in/ path (normalized, trailing slash agnostic)
    const myPrefix = normalizeHref(ME.profileHrefStartsWith);
    if (myPrefix) {
      const links = block.querySelectorAll('a[href*="/in/"]');
      for (const a of links){
        const href = normalizeHref(a.getAttribute('href')||'');
        if (href && (href===myPrefix || href.startsWith(myPrefix+'/'))) return true;
      }
    }
    // fallback by display name
    if (ME.displayName) {
      const nm = block.querySelector('[data-test-reusable-actor__name], .update-components-actor__name, a[href*="/in/"]');
      const txt = norm(nm?.textContent||'');
      if (txt && txt.includes(norm(ME.displayName))) return true;
    }
    // last resort: some UIs mark own comments
    if (block.querySelector('.comments-comment-item__main-content--own')) return true;
    return false;
  }

  function replyLooksLikeTemplate(block){
    const txt = norm(block.textContent || '');
    return TEMPLATES.some(t => txt.includes(norm(t)));
  }

  (async function run(){
    log(`Using profile prefix: ${normalizeHref(ME.profileHrefStartsWith) || '(none set)'}`);
    await expandAll();

    const comments = findComments();
    log(`Scanning ${comments.length} comment blocks…`);

    const progress = loadProgress();
    const processedSet = new Set(progress.processed || []);
    let added = 0;

    for (const c of comments){
      const k = keyFor(c);
      if (processedSet.has(k)) continue;

      const replies = replyBlocksUnder(c);
      let mine = false;
      for (const r of replies){
        if (isReplyByMe(r) || replyLooksLikeTemplate(r)) { mine = true; break; }
      }
      if (mine){
        processedSet.add(k);
        added++;
      }
    }

    progress.processed = Array.from(processedSet);
    saveProgress(progress);

    log(`Backfill complete. Newly marked: ${added}`, added?'success':'info');
    log(`Key: ${getPostKey()} | Total stored: ${processedSet.size}`);
  })();
})();
