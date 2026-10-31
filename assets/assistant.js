(() => {
  'use strict';
  if (location.protocol === 'file:') return;
  const scriptUrl = document.currentScript.src;
  const icons = new URL('assistant-icons.svg', scriptUrl).href;
  const config = window.SAA_ACCOUNT_CONFIG || {};
  const mobile = matchMedia('(max-width:760px)');
  const svg = name => `<svg aria-hidden="true"><use href="${icons}#${name}"/></svg>`;
  const general = { id: 'general', kind: 'general', title: 'SAA-C03 · 자유 질문', text: '', hasImages: false };
  const generalQuestions = ['SAA-C03 공부를 어디서부터 시작하면 좋을까?', '헷갈리기 쉬운 AWS 서비스를 비교해 줘.', '고가용성과 내결함성은 어떻게 달라?', '비용 최적화 문제를 푸는 요령을 알려줘.'];
  const threads = new Map();
  let thread, opener, request, guestClient, guestSignIn, currentQuestion, tooltipTarget;
  const inertBefore = new Map();
  let originalOverflow = null;

  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'saa-ai-fab'; fab.dataset.aiUi = '';
  fab.setAttribute('aria-controls', 'saa-assistant'); fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-label', 'AI 어시스턴트 열기'); fab.innerHTML = svg('robot') + '<span>AI 어시스턴트</span>';
  const panel = document.createElement('section');
  panel.className = 'saa-ai'; panel.id = 'saa-assistant'; panel.dataset.aiUi = ''; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'saa-ai-heading');
  panel.innerHTML = `
    <header class="saa-ai-head"><div class="saa-ai-logo">${svg('robot')}</div><div class="saa-ai-title"><h2 id="saa-ai-heading" tabindex="-1">AI 어시스턴트</h2><p>SAA-C03 학습 도우미</p></div><div class="saa-ai-head-actions"><button type="button" class="saa-ai-icon" data-new aria-label="새 대화" title="새 대화">${svg('edit')}</button><button type="button" class="saa-ai-icon" data-close aria-label="AI 어시스턴트 닫기" title="닫기">${svg('close')}</button></div></header>
    <div class="saa-ai-context-strip">${svg('book')}<div class="saa-ai-context-copy"><small>질문하는 항목</small><p data-context-title></p></div><span class="saa-ai-context-type" data-context-type></span></div>
    <div class="saa-ai-scroll" data-scroll><div class="saa-ai-welcome" data-welcome><p class="saa-ai-eyebrow">YOUR STUDY COMPANION</p><h3 data-welcome-title></h3><p class="saa-ai-description">질문을 고르거나 직접 입력해 보세요.</p><div class="saa-ai-suggestions" data-suggestions aria-label="예상 질문"></div><p class="saa-ai-suggestions-note" data-suggestion-note hidden>${svg('edit')}질문을 선택하면 입력창에만 채워져요.</p></div><div class="saa-ai-messages" data-messages role="log" aria-label="대화 내용" aria-live="polite"></div><p class="saa-ai-feedback" data-feedback role="status" hidden></p><button type="button" class="saa-ai-retry" data-retry hidden>예상 질문 다시 불러오기</button><p class="saa-ai-image-note" data-image-note hidden>이미지 속 내용이 필요하면 질문에 함께 적어 주세요.</p></div>
    <form class="saa-ai-composer-zone"><div class="saa-ai-composer"><label class="saa-ai-sr" for="saa-ai-prompt">AI 어시스턴트에게 질문</label><textarea id="saa-ai-prompt" rows="2" placeholder="궁금한 내용을 입력하세요…" maxlength="2000"></textarea><div class="saa-ai-composer-bottom"><span class="saa-ai-composer-hint" data-hint>질문을 작성한 뒤 전송하세요</span><button class="saa-ai-send" type="submit" disabled aria-label="질문 전송">${svg('up')}</button></div></div><p class="saa-ai-disclaimer">답변은 틀릴 수 있어요. 질문과 학습 내용은 Google로 전송됩니다.</p></form>`;
  // Mount outside study cards so their rounded overflow clips cannot cut it off.
  const tooltip = document.createElement('div');
  tooltip.id = 'saa-ai-tooltip'; tooltip.className = 'saa-ai-tooltip'; tooltip.dataset.aiUi = '';
  tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  document.body.append(fab, panel, tooltip);
  const $ = selector => panel.querySelector(selector);
  const prompt = $('#saa-ai-prompt');

  function textOf(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button,input,script,style,.feedback,.choice-status,.question-actions,.question-tags,.heading-link,.citation').forEach(node => node.remove());
    clone.querySelectorAll('p,h1,h2,h3,li,section,div,label').forEach(node => node.append('\n'));
    return (clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  }
  function contextForConcept(article) {
    const title = textOf(article.querySelector('h1')).slice(0, 180);
    const references = [...article.querySelectorAll('a[href^="https://"]')].map(a => a.href).filter((value, i, all) => all.indexOf(value) === i).slice(0, 8).join('\n');
    return { id: `concept:${location.hash.split('~')[0].slice(1)}`, kind: 'concept', title, text: textOf(article).slice(0, 10500) + '\n공식 참고 문서:\n' + references.slice(0, 1400), hasImages: !!article.querySelector('img') };
  }
  function contextForQuiz(card) {
    return { id: `quiz:${card.dataset.question}`, kind: 'question', title: `${card.dataset.question} · 개념 확인 문제`, text: [textOf(card.querySelector('h3')), textOf(card.querySelector('fieldset')), '참고 답안과 해설 (오류 가능):', textOf(card.querySelector('.explanation'))].join('\n').slice(0, 12000), hasImages: !!card.querySelector('img') };
  }
  function contextForDump() {
    if (!currentQuestion) return general;
    const { q, note } = currentQuestion;
    const reference = ['참고 답안 (오류 가능): ' + (note.answerOverride || q.answer).join(', '), note.answerReview ? '원문 답안 검토가 필요한 문제입니다.' : '', JSON.stringify(note), q.explanation || ''].join('\n').slice(0, 2600);
    const text = [q.stem, ...q.options.map(o => o.key + '. ' + o.text), reference].join('\n');
    return { id: `dumps:${q.id}`, kind: 'question', title: `문제 ${String(q.id).padStart(3, '0')} · SAA-C03 문제집`, text: text.slice(0, 12000), hasImages: /\[\[?(?:image|img)|<img|data:image|\{\{image/i.test(text) || !!document.querySelector('#question-mount .qbody img') };
  }
  function hideTooltip() {
    tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = null; tooltip.hidden = true;
  }
  function showTooltip(button) {
    hideTooltip(); tooltipTarget = button;
    tooltip.textContent = button.getAttribute('aria-label'); tooltip.hidden = false;
    button.setAttribute('aria-describedby', tooltip.id);
    const rect = button.getBoundingClientRect(), bounds = tooltip.getBoundingClientRect();
    const edge = 8, gap = 8;
    const left = Math.max(edge, Math.min(rect.right - bounds.width, innerWidth - bounds.width - edge));
    const above = rect.top - bounds.height - gap;
    const top = Math.max(edge, Math.min(above >= edge ? above : rect.bottom + gap, innerHeight - bounds.height - edge));
    tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
  }
  function trigger(parent, getContext) {
    if (!parent || parent.querySelector(':scope > .saa-ai-trigger')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'saa-ai-trigger'; button.dataset.aiUi = '';
    button.setAttribute('aria-label', '이 항목을 AI에 질문'); button.innerHTML = svg('robot');
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTooltip(button); });
    button.addEventListener('pointerleave', () => {
      if (tooltipTarget === button && !(document.activeElement === button && button.matches(':focus-visible'))) hideTooltip();
    });
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) showTooltip(button); });
    button.addEventListener('blur', () => { if (tooltipTarget === button) hideTooltip(); });
    button.addEventListener('click', () => open(getContext(), button)); parent.append(button);
  }
  function mount() {
    hideTooltip();
    document.querySelectorAll('.term-article').forEach(article => {
      const header = article.querySelector('.article-header');
      header?.classList.add('saa-ai-context'); trigger(header, () => contextForConcept(article));
    });
    document.querySelectorAll('.question-card[data-question]').forEach(card => trigger(card.querySelector('.question-top'), () => contextForQuiz(card)));
    const head = document.querySelector('#question-mount .qhead');
    if (head && !head.querySelector('.saa-ai-actions')) {
      const actions = document.createElement('div'); actions.className = 'saa-ai-actions';
      const flag = head.querySelector('#flag'); if (flag) actions.append(flag); head.append(actions);
      trigger(actions, contextForDump);
    }
  }

  function getThread(context) {
    const key = context.id + '\n' + context.text;
    if (!threads.has(key)) {
      threads.set(key, { context, history: [], draft: '', suggestions: context.kind === 'general' ? generalQuestions : null, error: '', suggestionError: false });
      if (threads.size > 20) threads.delete(threads.keys().next().value);
    }
    return threads.get(key);
  }
  function viewport() {
    if (mobile.matches && !panel.hidden && window.visualViewport) {
      panel.style.setProperty('--ai-visible-height', visualViewport.height + 'px');
      panel.style.setProperty('--ai-visible-top', visualViewport.offsetTop + 'px');
    } else { panel.style.removeProperty('--ai-visible-height'); panel.style.removeProperty('--ai-visible-top'); }
  }
  function modalState() {
    const modal = mobile.matches && !panel.hidden;
    panel.setAttribute('aria-modal', String(modal));
    if (modal) {
      if (originalOverflow === null) originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      for (const child of document.body.children) {
        if (child === panel || child === fab || /^(SCRIPT|STYLE|LINK)$/.test(child.tagName)) continue;
        if (!inertBefore.has(child)) inertBefore.set(child, child.inert);
        child.inert = true;
      }
    } else {
      if (originalOverflow !== null) document.body.style.overflow = originalOverflow;
      originalOverflow = null;
      for (const [node, inert] of inertBefore) node.inert = inert;
      inertBefore.clear();
    }
    viewport();
  }
  function open(context, source) {
    hideTooltip();
    if (context) {
      if (thread) thread.draft = prompt.value;
      cancelRequest(); thread = getThread(context);
    } else if (!thread) thread = getThread(general);
    opener = source || document.activeElement;
    panel.hidden = false; document.body.classList.add('saa-ai-open');
    fab.setAttribute('aria-expanded', 'true'); fab.setAttribute('aria-label', 'AI 어시스턴트 닫기');
    fab.innerHTML = svg('close') + '<span>AI 어시스턴트 닫기</span>';
    render(); modalState(); $('#saa-ai-heading').focus({ preventScroll: true });
    if (!thread.suggestions && !thread.history.length && !request) void suggestions();
  }
  function close() {
    thread.draft = prompt.value; prompt.blur(); panel.hidden = true; document.body.classList.remove('saa-ai-open');
    fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-label', 'AI 어시스턴트 열기');
    fab.innerHTML = svg('robot') + '<span>AI 어시스턴트</span>'; modalState();
    if (opener?.isConnected) opener.focus({ preventScroll: true }); else fab.focus({ preventScroll: true });
  }
  function cancelRequest() {
    if (!request) return;
    clearTimeout(request.timer); request.controller.abort();
    if (request.kind === 'chat') request.thread.draft = request.question;
    request = null;
  }
  function updateComposer() {
    thread.draft = prompt.value;
    $('.saa-ai-send').disabled = !prompt.value.trim() || request?.kind === 'chat';
    prompt.readOnly = request?.kind === 'chat';
    prompt.style.height = 'auto'; prompt.style.height = Math.min(125, prompt.scrollHeight) + 'px';
  }
  // Model output is text, never HTML. Only a small, escaped Markdown subset is rendered.
  function inline(parent, text) {
    const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(text.slice(offset, match.index)); const value = match[0]; let node;
      if (value.startsWith('**')) { node = document.createElement('strong'); node.textContent = value.slice(2, -2); }
      else if (value.startsWith('`')) { node = document.createElement('code'); node.textContent = value.slice(1, -1); }
      else {
        const parts = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(value);
        node = document.createElement('a'); node.textContent = parts[1]; node.href = parts[2]; node.target = '_blank'; node.rel = 'noopener noreferrer';
      }
      parent.append(node); offset = match.index + value.length;
    }
    parent.append(text.slice(offset));
  }
  function answerNode(text) {
    const node = document.createElement('div'); node.className = 'saa-ai-answer';
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      if (lines.every(line => /^\s*[-*] /.test(line))) {
        const list = document.createElement('ul');
        lines.forEach(line => { const li = document.createElement('li'); inline(li, line.replace(/^\s*[-*] /, '')); list.append(li); }); node.append(list);
      } else { const p = document.createElement('p'); inline(p, block.replace(/^#{1,6} /gm, '')); node.append(p); }
    }
    return node;
  }
  function render() {
    const c = thread.context;
    $('[data-context-title]').textContent = c.title;
    $('[data-context-type]').textContent = c.kind === 'concept' ? '개념' : c.kind === 'question' ? '문제' : '학습';
    const heading = c.kind === 'concept' ? `${c.title.split(' (')[0]},\n어떤 점이 궁금한가요?` : c.kind === 'question' ? '이 문제,\n함께 풀어볼까요?' : 'AWS 공부,\n무엇이 궁금한가요?';
    $('[data-welcome-title]').replaceChildren(...heading.split('\n').flatMap((line, i) => i ? [document.createElement('br'), line] : [line]));
    $('[data-welcome]').hidden = !!thread.history.length || request?.kind === 'chat';
    const box = $('[data-suggestions]'); box.replaceChildren();
    for (const question of thread.suggestions || []) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'saa-ai-suggestion';
      button.setAttribute('aria-pressed', 'false');
      const text = document.createElement('span'); text.textContent = question; button.append(text); button.insertAdjacentHTML('beforeend', svg('arrow'));
      button.onclick = () => {
        box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        prompt.value = question; updateComposer(); $('[data-hint]').textContent = '수정한 뒤 전송 버튼을 눌러 주세요'; prompt.focus({ preventScroll: true });
      }; box.append(button);
    }
    $('[data-suggestion-note]').hidden = !thread.suggestions;
    const messages = $('[data-messages]'); messages.replaceChildren();
    const history = request?.kind === 'chat' ? [...thread.history, { role: 'user', text: request.question }] : thread.history;
    for (const message of history) {
      const node = document.createElement('div'); node.className = 'saa-ai-message';
      if (message.role === 'user') { node.classList.add('saa-ai-user'); node.textContent = message.text; node.setAttribute('aria-label', '내 질문'); }
      else { node.innerHTML = `<div class="saa-ai-reply-label">${svg('robot')}AI 어시스턴트</div>`; node.append(answerNode(message.text)); }
      messages.append(node);
    }
    const feedback = $('[data-feedback]');
    feedback.textContent = request ? (request.kind === 'suggestions' ? '이 항목의 예상 질문을 준비하고 있어요…' : '답변을 작성하고 있어요…') : thread.error;
    feedback.hidden = !feedback.textContent; feedback.dataset.error = String(!request && !!thread.error); feedback.classList.toggle('saa-ai-loading', !!request);
    $('[data-retry]').hidden = !!request || !thread.suggestionError;
    $('[data-image-note]').hidden = !c.hasImages;
    prompt.value = thread.draft; $('[data-hint]').textContent = request?.kind === 'chat' ? '답변을 기다리고 있어요' : '질문을 작성한 뒤 전송하세요'; updateComposer();
  }

  async function accessToken() {
    const signedIn = await window.SaaAccount?.getAccessToken();
    if (signedIn) return signedIn;
    if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase) throw new Error('not_configured');
    if (!guestClient) guestClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { storageKey: 'saa-c03-ai-guest-auth', detectSessionInUrl: false, persistSession: true },
      global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(12000) }) },
    });
    let { data, error } = await guestClient.auth.getSession();
    if (error) throw new Error('auth_unavailable');
    if (data.session && data.session.expires_at * 1000 < Date.now() + 60000) ({ data, error } = await guestClient.auth.refreshSession());
    if (error) throw new Error('auth_unavailable');
    if (data.session) return data.session.access_token;
    if (!guestSignIn) guestSignIn = guestClient.auth.signInAnonymously().finally(() => { guestSignIn = null; });
    const result = await guestSignIn;
    if (result.error || !result.data.session) throw new Error(result.error?.code === 'anonymous_provider_disabled' ? 'guest_disabled' : 'auth_unavailable');
    return result.data.session.access_token;
  }
  const errorMessages = {
    not_configured: 'AI 어시스턴트 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.',
    not_ready: 'AI 어시스턴트 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.',
    guest_disabled: '게스트 AI 연결을 준비 중입니다. GitHub로 로그인한 뒤 이용하거나 잠시 후 다시 시도해 주세요.',
    auth_unavailable: '사용자 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    unauthenticated: '사용자 연결이 만료되었습니다. 새로고침한 뒤 다시 이용해 주세요.',
    limit_reached: '게스트의 하루 AI 요청 한도에 도달했습니다. GitHub로 로그인하거나 한도가 초기화된 뒤 다시 이용해 주세요.',
    provider_limit: 'AI 서비스의 공유 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    provider_busy: 'AI 서비스의 사용 한도 또는 일시적인 혼잡으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    invalid_request: '질문이 너무 길거나 내용을 확인할 수 없습니다. 내용을 줄여 다시 전송해 주세요.',
    blocked: '이 질문에 답변을 제공하지 못했습니다. 학습 내용에 맞게 질문을 바꿔 주세요.',
    empty_response: '답변을 완성하지 못했습니다. 질문을 짧게 바꿔 다시 시도해 주세요.',
  };
  async function call(payload, task) {
    const token = await accessToken(); task.controller.signal.throwIfAborted();
    const response = await fetch(new URL('/functions/v1/study-assistant', config.supabaseUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload), signal: task.controller.signal,
    });
    let data; try { data = await response.json(); } catch { throw new Error(response.status === 404 ? 'not_ready' : 'connection'); }
    if (!response.ok) { const e = new Error(data.error || (response.status === 404 ? 'not_ready' : 'connection')); e.retryAfter = Number(data.retryAfter) || 0; throw e; }
    return data;
  }
  function begin(kind, question = '') {
    cancelRequest(); thread.error = ''; thread.suggestionError = false;
    const task = { kind, question, thread, controller: new AbortController() };
    request = task; task.timer = setTimeout(() => task.controller.abort('timeout'), 55000); return task;
  }
  function failed(error, task) {
    if (request !== task) return;
    let message = errorMessages[error.message] || (task.controller.signal.aborted ? '응답 시간이 길어졌습니다. 잠시 후 다시 전송해 주세요.' : 'AI에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    if (error.retryAfter > 0) {
      const wait = error.retryAfter >= 3600 ? `${Math.ceil(error.retryAfter / 3600)}시간` : `${Math.ceil(error.retryAfter / 60)}분`;
      message += ` 약 ${wait} 뒤 다시 시도할 수 있어요.`;
    }
    thread.error = message; thread.suggestionError = task.kind === 'suggestions';
    if (task.kind === 'chat') thread.draft = task.question;
  }
  async function suggestions() {
    const task = begin('suggestions'); render();
    try {
      const data = await call({ action: 'suggestions', context: task.thread.context }, task);
      if (!Array.isArray(data.questions) || data.questions.length !== 4 || data.questions.some(q => typeof q !== 'string' || !q.trim() || q.length > 150)) throw new Error('empty_response');
      if (request === task) thread.suggestions = data.questions;
    } catch (error) { failed(error, task); }
    finally { clearTimeout(task.timer); if (request === task) { request = null; render(); } }
  }
  async function send(event) {
    event.preventDefault(); const question = prompt.value.trim();
    if (!question || request?.kind === 'chat') return;
    const task = begin('chat', question); thread.draft = ''; render();
    $('[data-scroll]').scrollTop = $('[data-scroll]').scrollHeight;
    try {
      const data = await call({ action: 'chat', context: thread.context, question, history: thread.history.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 2000) })) }, task);
      if (typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 14000) throw new Error('empty_response');
      if (request === task) { thread.history.push({ role: 'user', text: question }, { role: 'model', text: data.answer }); thread.history = thread.history.slice(-30); }
    } catch (error) { failed(error, task); }
    finally {
      clearTimeout(task.timer);
      if (request === task) { request = null; render(); requestAnimationFrame(() => { $('[data-scroll]').scrollTop = $('[data-scroll]').scrollHeight; }); }
    }
  }
  fab.onclick = () => panel.hidden ? open(null, fab) : close(); $('[data-close]').onclick = close;
  $('[data-new]').onclick = () => { cancelRequest(); thread.history = []; thread.draft = ''; thread.error = ''; render(); if (!thread.suggestions) void suggestions(); };
  $('[data-retry]').onclick = () => void suggestions(); $('form').onsubmit = send; prompt.oninput = updateComposer;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTooltip();
    if (panel.hidden || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (panel.contains(event.target)) event.stopPropagation();
    if (event.key === 'Tab' && mobile.matches) {
      const focusable = [...panel.querySelectorAll('button:not(:disabled),textarea,a[href]')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === $('#saa-ai-heading'))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('scroll', hideTooltip, { capture: true, passive: true });
  window.addEventListener('resize', hideTooltip, { passive: true });
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
  mobile.addEventListener('change', modalState);
  window.SaaAssistant = { mount, setQuestion(q, note = {}) { currentQuestion = { q, note }; mount(); } };
  mount(); document.dispatchEvent(new Event('saa:assistant-ready'));
})();
