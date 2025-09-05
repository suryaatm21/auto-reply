(() => {
  'use strict';

  const CONFIG = {
    messageTemplates: [
      'sent ✅',
      'check your inbox',
      'delivered 📧',
      'check your email'
    ],
    minDelay: 3000,
    maxDelay: 8000,
    maxReplies: 10,
    emailRegex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    stopOnError: true,
    dryRun: false
  };

  let repliesCount = 0;
  let isRunning = false;
  let isPaused = false;
  const seen = new Set();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const randomDelay = ()=>rand(CONFIG.minDelay,CONFIG.maxDelay);
  const randomTemplate = ()=>CONFIG.messageTemplates[rand(0,CONFIG.messageTemplates.length-1)];
  const log = (m,t='info')=>{
    const p = t==='error'?'❌':t==='success'?'✅':'ℹ️';
    console.log(`${p} Auto-Reply: ${m}`);
  };
  const containsEmail = (s='')=>CONFIG.emailRegex.test(s);

  async function waitWhilePaused(){
    while(isPaused){ await sleep(500); }
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
      '[data-id*="comment"]',
      '[data-urn*="comment"]',
      '[data-comment-id]',
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
    const id = el.getAttribute('data-id') || el.id || '';
    const who = el.querySelector('[data-test-reusable-actor__name],[aria-label*="Author"],[data-view-name*="actor-name"]')?.textContent?.trim() || '';
    const snip = (el.textContent||'').slice(0,60).trim();
    return `${id}|${who}|${snip}`;
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

  // ⬇️ UPDATED: scope submit to editor container; match Reply/Post and the comments-comment-box__submit-button class
  function findSubmitButtonNear(editorEl){
    const container = editorEl.closest(
      '.comments-comment-box, .comments-comment-card, form, .comments-comment-item'
    ) || document;

    const sels = [
      'button[class*="comments-comment-box__submit-button"]', // class from your screenshot
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
        if (visible && enabled && looksRight) {
          log(`Using submit button: ${b.id || '(no id)'} | classes: ${b.className}`);
          return b;
        }
      }
    }
    return null;
  }

  // ⬇️ UPDATED: append text (keep @mention), place caret at end and insert
  async function appendIntoEditor(editorEl, text){
    editorEl.scrollIntoView({behavior:'smooth', block:'center'});
    await sleep(250);

    editorEl.focus();

    // Move caret to end
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // Ensure there is a space before appending if needed
    const lastChar = (editorEl.textContent || '').slice(-1);
    const toInsert = (lastChar && !/\s/.test(lastChar) ? ' ' : ' ') + text;

    const ok = document.execCommand('insertText', false, toInsert);
    if (!ok){
      editorEl.dispatchEvent(new InputEvent('beforeinput', {inputType:'insertText', data:toInsert, bubbles:true}));
      // fallback direct mutation
      editorEl.textContent = (editorEl.textContent || '') + toInsert;
      editorEl.dispatchEvent(new Event('input', {bubbles:true}));
      editorEl.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:' '}));
    }

    await sleep(250);
  }

  async function replyToComment(commentEl, message){
    try{
      commentEl.scrollIntoView({behavior:'smooth', block:'center'});
      await sleep(300);

      const replyBtn = findReplyButton(commentEl);
      if (!replyBtn){ log('Reply button not found', 'error'); return false; }

      if (CONFIG.dryRun){
        replyBtn.style.outline='2px solid orange';
        log('DRY-RUN: would click Reply');
      } else {
        log('Clicking Reply…');
        replyBtn.click();
      }

      await sleep(700);
      await waitWhilePaused();

      const editor = findActiveReplyEditor();
      if (!editor){ log('Reply editor not found', 'error'); return false; }

      if (CONFIG.dryRun){
        editor.style.outline='2px solid dodgerblue';
        log(`DRY-RUN: would append "${message}"`);
      } else {
        log(`Appending: "${message}"`);
        await appendIntoEditor(editor, message);

        const submit = findSubmitButtonNear(editor);
        if (!submit){ log('Submit/Reply button not found near editor', 'error'); return false; }

        log(`Submitting reply…`);
        submit.click();
      }

      await sleep(1200);
      return true;
    } catch(e){
      log(`Error while replying: ${e?.message || e}`, 'error');
      return false;
    }
  }

  async function processComments(){
    if (isRunning){ log('Script already running', 'error'); return; }
    isRunning = true;

    try{
      log('Expanding threads…');
      await expandAll();

      const comments = findComments();
      log(`Found ${comments.length} visible comments`);

      if (!comments.length){
        log('No comments found on this page.', 'error');
        return;
      }

      for (let i=0; i<comments.length && repliesCount<CONFIG.maxReplies; i++){
        await waitWhilePaused();

        const c = comments[i];
        const k = keyFor(c);
        if (seen.has(k)) continue;
        seen.add(k);

        const text = getCommentText(c);
        const preview = (text||'').slice(0,80).replace(/\s+/g,' ');
        log(`Analyzing #${i+1}: "${preview}…"`);
        if (!text){ log('No readable text — skip'); continue; }

        if (!containsEmail(text)){ log('No email — skip'); continue; }
        if (hasOwnReply(c)){ log('Already replied — skip'); continue; }

        const msg = randomTemplate();
        const ok = await replyToComment(c, msg);
        if (ok){
          repliesCount++;
          log(`Replied (${repliesCount}/${CONFIG.maxReplies})`, 'success');
          const d = randomDelay();
          log(`Cooling down ${(d/1000).toFixed(1)}s…`);
          await sleep(d);
        } else if (CONFIG.stopOnError){
          log('Stopping due to error (stopOnError=true)', 'error');
          break;
        }
      }

      log(`Done. Total replies: ${repliesCount}`, 'success');
    } catch(e){
      log(`Fatal: ${e?.message || e}`, 'error');
    } finally {
      isRunning = false;
    }
  }

  // Controls
  window.pauseLinkedInReply = function(){ isPaused = !isPaused; log(isPaused?'Paused':'Resumed'); };
  window.stopLinkedInReply = function(){ isRunning=false; isPaused=false; log('Stop requested; exiting after current step.'); };
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase()==='p') window.pauseLinkedInReply();
    if (e.key.toLowerCase()==='s') window.stopLinkedInReply();
  });

  // Start
  log('Loaded. Controls: pauseLinkedInReply() / stopLinkedInReply() or press P / S');
  log(`Templates: ${CONFIG.messageTemplates.join(' | ')}`);
  log(`Delay: ${CONFIG.minDelay/1000}-${CONFIG.maxDelay/1000}s  Max: ${CONFIG.maxReplies}`);
  log(`Dry-run: ${CONFIG.dryRun ? 'ON' : 'OFF'}`);
  log('Starting in 3s…');
  setTimeout(processComments, 3000);
})();
