const $ = (id) => document.getElementById(id);
const state = {
  bootstrap: null,
  draft: null,
  history: { drafts: [], handoffs: [], attempts: [] },
  busy: false,
  sending: false,
  delivered: null,
  failed: false,
  knowledgeLanguage: 'en',
  category: 'all',
  selectedArticle: null,
  evaluation: null,
  evaluating: false,
};

const statusLabels = {
  answered: 'Ready for review',
  'needs-information': 'Needs more context',
  'no-answer': 'No supported answer',
  blocked: 'Request blocked',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function announce(message) {
  $('announcement').textContent = message;
}

function notice(id, message, kind = 'error') {
  const node = $(id);
  node.textContent = message;
  node.className = `notice ${kind}`;
  node.hidden = !message;
}

async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `The request failed (${response.status}). Please try again.`);
    if (data === null) throw new Error('The server returned an unreadable response. Please try again.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Your saved drafts are still available. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the local server. Check that it is running, then try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function badge(status, label) {
  const className = status === 'answered' || status === 'delivered' || status === 'passed'
    ? '' : status === 'needs-information' ? 'warning' : 'error';
  return element('span', `status-badge ${className}`, label || statusLabels[status] || status);
}

function updateTicketCount() {
  $('ticket-count').textContent = `${$('ticket').value.length.toLocaleString()} / 4,000`;
}

function updateModeDescription() {
  const live = $('mode').value === 'live';
  $('mode-description').textContent = live
    ? 'Uses the configured AI provider with retrieved evidence. Generated replies still need your review.'
    : 'Finds relevant passages in the knowledge base. Uses source text, with no AI generation.';
  $('privacy-note').textContent = live
    ? 'Live requests send the ticket and evidence to your configured provider.'
    : 'Extractive mode runs locally. Nothing leaves this workspace.';
}

function changedTicket() {
  $('approve').checked = false;
  updateTicketCount();
  updateModeDescription();
  updateHandoffControls();
}

function updateHandoffControls() {
  const draft = state.draft;
  const eligible = draft && ['answered', 'needs-information'].includes(draft.status);
  const stale = draft && (draft.ticket !== $('ticket').value.trim()
    || draft.language !== $('language').value || draft.mode !== $('mode').value);
  const delivered = Boolean(state.delivered);
  const locked = delivered || state.sending || state.busy;
  $('approve').disabled = !eligible || locked || stale;
  $('reply').readOnly = locked;
  $('simulate-failure').disabled = !eligible || locked || stale;
  $('send-button').disabled = !eligible || locked || stale || !$('approve').checked || !$('reply').value.trim();
  $('send-button').querySelector('span').textContent = delivered ? 'Delivered to mock CRM'
    : state.sending ? 'Making the handoff…' : state.failed ? 'Retry mock handoff' : 'Send to mock CRM';
  let explanation = '';
  if (draft && !eligible) explanation = 'This draft cannot be handed off. Add a supported question or more context and try again.';
  else if (stale) explanation = 'The question or settings have changed. Create a new draft before sending.';
  $('handoff-eligibility').textContent = explanation;
  $('handoff-eligibility').hidden = !explanation;
}

function showArticle(id) {
  state.selectedArticle = id;
  state.category = 'all';
  state.knowledgeLanguage = state.draft?.language || 'en';
  $('knowledge-search').value = '';
  renderKnowledge();
  if (location.hash !== '#knowledge') location.hash = 'knowledge';
  else switchView('knowledge');
  requestAnimationFrame(() => {
    const article = Array.from($('knowledge-list').children).find((node) => node.dataset.articleId === id);
    if (article) {
      article.scrollIntoView({ block: 'center', behavior: 'instant' });
      article.focus({ preventScroll: true });
    }
  });
}

function renderDraft(draft) {
  state.draft = draft;
  state.delivered = state.history.handoffs.find((handoff) => handoff.draftId === draft.id) || null;
  const attempts = state.history.attempts.filter((attempt) => attempt.draftId === draft.id);
  state.failed = !state.delivered && attempts.some((attempt) => attempt.status === 'failed');
  $('review-empty').hidden = true;
  $('review-loading').hidden = true;
  $('review-result').hidden = false;
  const status = badge(draft.status);
  $('review-state').className = status.className;
  $('review-state').textContent = status.textContent;
  $('draft-summary').textContent = draft.summary;
  $('draft-summary').lang = draft.language === 'zh' ? 'zh-Hant' : 'en';
  $('draft-mode').textContent = draft.mode === 'extractive' ? 'EXTRACTIVE · NO AI GENERATION'
    : draft.providerUsed ? 'LIVE AI · REVIEW REQUIRED' : 'LOCAL EVIDENCE CHECK · NO AI CALL';
  $('draft-time').textContent = displayDate(draft.createdAt);
  $('questions-box').hidden = !draft.questions?.length;
  $('questions-list').replaceChildren(...(draft.questions || []).map((question) => element('li', '', question)));
  $('questions-list').lang = draft.language === 'zh' ? 'zh-Hant' : 'en';
  $('source-count').textContent = `(${draft.sources.length})`;
  $('sources').replaceChildren();
  for (const [index, source] of draft.sources.entries()) {
    const card = element('article', 'source-card');
    card.lang = draft.language === 'zh' ? 'zh-Hant' : 'en';
    const heading = element('div', 'source-card-heading');
    heading.append(element('span', 'source-number', String(index + 1).padStart(2, '0')), element('h4', 'source-title', source.title));
    const link = element('button', 'text-button', 'Read full article');
    link.type = 'button';
    link.lang = 'en';
    link.append(icon('arrow'));
    link.addEventListener('click', () => showArticle(source.id));
    card.append(heading, element('p', '', source.excerpt), link);
    $('sources').append(card);
  }
  if (!draft.sources.length) $('sources').append(element('p', 'no-sources', draft.status === 'needs-information'
    ? 'There isn’t enough context to select a source yet. Ask the follow-up question before offering advice.'
    : 'No supporting source was selected. This draft is held back from handoff.'));
  $('reply').value = state.delivered?.reply || draft.reply;
  $('reply').lang = draft.language === 'zh' ? 'zh-Hant' : 'en';
  $('approve').checked = Boolean(state.delivered);
  $('simulate-failure').checked = false;
  notice('handoff-message', state.delivered
    ? `Delivered locally on ${displayDate(state.delivered.createdAt)}. No real CRM was contacted.`
    : state.failed ? 'A previous handoff failed. Review the reply and retry when ready.' : '', state.failed ? 'warning' : '');
  $('step-review').classList.add('current');
  $('step-handoff').classList.toggle('current', Boolean(state.delivered));
  updateHandoffControls();
}

async function createDraft(event) {
  event.preventDefault();
  if (state.busy || state.sending) return;
  const ticket = $('ticket').value.trim();
  if (!ticket) {
    notice('draft-error', 'Enter a customer question before finding a reply.');
    $('ticket').focus();
    return;
  }
  state.busy = true;
  $('approve').checked = false;
  setTicketControls(true);
  notice('draft-error', '');
  $('review-empty').hidden = true;
  $('review-result').hidden = true;
  $('review-loading').hidden = false;
  document.querySelector('.review-panel').setAttribute('aria-busy', 'true');
  $('loading-description').textContent = $('mode').value === 'live'
    ? 'Checking the evidence and consulting the configured provider when supported.' : 'Checking the local knowledge base.';
  $('review-state').textContent = 'Finding evidence';
  $('review-state').className = 'status-badge neutral';
  $('generate-button').querySelector('span').textContent = 'Finding the right context…';
  updateHandoffControls();
  announce('Finding a grounded reply.');
  try {
    const { draft } = await request('/api/drafts', { ticket, language: $('language').value, mode: $('mode').value });
    renderDraft(draft);
    announce(`${statusLabels[draft.status]}. ${draft.sources.length} supporting sources found.`);
    await loadHistory();
  } catch (error) {
    notice('draft-error', error.message);
    $('review-loading').hidden = true;
    $('review-empty').hidden = Boolean(state.draft);
    $('review-result').hidden = !state.draft;
    const status = state.draft ? badge(state.draft.status) : element('span', 'status-badge neutral', 'Awaiting a question');
    $('review-state').className = status.className;
    $('review-state').textContent = status.textContent;
    announce('The draft could not be created. Your previous reply has been kept.');
  } finally {
    state.busy = false;
    setTicketControls(false);
    document.querySelector('.review-panel').setAttribute('aria-busy', 'false');
    $('generate-button').querySelector('span').textContent = 'Find a grounded reply';
    updateHandoffControls();
  }
}

function setTicketControls(disabled) {
  for (const id of ['example-select', 'ticket', 'language', 'mode', 'generate-button']) $(id).disabled = disabled;
}

async function sendReply() {
  if ($('send-button').disabled || !state.draft) return;
  state.sending = true;
  setTicketControls(true);
  updateHandoffControls();
  notice('handoff-message', '');
  try {
    const { handoff } = await request('/api/handoffs', {
      draftId: state.draft.id,
      reply: $('reply').value.trim(),
      approved: $('approve').checked,
      simulateFailure: $('simulate-failure').checked,
    });
    state.delivered = handoff;
    state.failed = false;
    $('step-handoff').classList.add('current');
    notice('handoff-message', 'Handoff complete. Your approved reply is saved in the local mock CRM. No real message was sent.', '');
    announce('Reply delivered to the local mock CRM.');
  } catch (error) {
    state.failed = true;
    $('simulate-failure').checked = false;
    notice('handoff-message', `${error.message} Your edits are kept. The failure simulation is off; you can retry.`);
    announce('Handoff failed. Your reply is still here and can be retried.');
  } finally {
    state.sending = false;
    setTicketControls(false);
    updateHandoffControls();
    await loadHistory();
  }
}

function renderHistory() {
  $('history-count').textContent = state.history.drafts.length.toLocaleString();
  $('history-list').replaceChildren();
  const drafts = [...state.history.drafts].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  for (const draft of drafts.slice(0, 8)) {
    const delivered = state.history.handoffs.some((handoff) => handoff.draftId === draft.id);
    const failed = !delivered && state.history.attempts.some((attempt) => attempt.draftId === draft.id && attempt.status === 'failed');
    const row = element('button', 'history-row');
    row.type = 'button';
    row.title = `Open saved draft: ${draft.ticket}`;
    const leading = element('span', 'history-icon');
    leading.append(icon(delivered ? 'check' : 'inbox'));
    const content = element('span', 'history-content');
    const title = element('span', 'history-title', draft.ticket);
    title.lang = draft.language === 'zh' ? 'zh-Hant' : 'en';
    content.append(title, element('span', 'history-meta', `${draft.language === 'zh' ? '繁體中文' : 'English'} · ${draft.mode === 'extractive' ? 'Extractive baseline' : 'Live mode'} · ${displayDate(draft.createdAt)}`));
    row.append(leading, content, badge(delivered ? 'delivered' : failed ? 'failed' : draft.status, delivered ? 'Handed off' : failed ? 'Handoff failed' : undefined), icon('arrow'));
    row.addEventListener('click', () => {
      if (state.busy || state.sending) {
        announce('Please wait until the current request finishes before opening another draft.');
        return;
      }
      $('ticket').value = draft.ticket;
      $('language').value = draft.language;
      $('mode').value = draft.mode;
      $('example-select').value = '';
      updateTicketCount();
      updateModeDescription();
      notice('draft-error', '');
      renderDraft(draft);
      document.querySelector('.review-panel').scrollIntoView({ behavior: 'instant', block: 'start' });
      $('reply').focus({ preventScroll: true });
      announce('Saved draft opened.');
    });
    $('history-list').append(row);
  }
  if (!drafts.length) $('history-list').append(element('p', 'empty-history', 'A fresh workspace. Your first draft will appear here.'));
  if (drafts.length > 8) $('history-list').append(element('p', 'empty-history', `Showing the 8 most recent of ${drafts.length} saved drafts.`));
}

async function loadHistory() {
  $('refresh-history').disabled = true;
  try {
    state.history = await request('/api/history');
    renderHistory();
    notice('history-message', '');
  } catch (error) {
    notice('history-message', error.message);
    if (!state.history.drafts.length) $('history-list').replaceChildren(element('p', 'empty-history', 'History is temporarily unavailable. Use Refresh to try again.'));
  } finally {
    $('refresh-history').disabled = false;
  }
}

function renderKnowledge() {
  if (!state.bootstrap) return;
  const { articles } = state.bootstrap;
  const language = state.knowledgeLanguage;
  const search = $('knowledge-search').value.trim().toLocaleLowerCase();
  const categories = ['all', ...new Set(articles.map((article) => article.category))];
  $('knowledge-categories').replaceChildren(...categories.map((category) => {
    const button = element('button', category === state.category ? 'active' : '', category === 'all' ? 'All articles' : category);
    button.type = 'button';
    button.dataset.category = category;
    button.setAttribute('aria-pressed', String(category === state.category));
    button.addEventListener('click', () => {
      state.category = category;
      state.selectedArticle = null;
      renderKnowledge();
      Array.from($('knowledge-categories').children).find((item) => item.dataset.category === category)?.focus();
    });
    return button;
  }));
  document.querySelectorAll('[data-knowledge-language]').forEach((button) => {
    const active = button.dataset.knowledgeLanguage === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const filtered = articles.filter((article) => (state.category === 'all' || article.category === state.category)
    && `${article.id} ${article.category} ${article.title.en} ${article.title.zh} ${article.body.en} ${article.body.zh}`.toLocaleLowerCase().includes(search));
  $('knowledge-count').textContent = `${filtered.length} of ${articles.length} articles · EN / 繁中`;
  $('knowledge-list').replaceChildren();
  for (const article of filtered) {
    const card = element('article', `article-card${article.id === state.selectedArticle ? ' highlighted' : ''}`);
    card.dataset.articleId = article.id;
    card.tabIndex = -1;
    card.append(element('span', 'article-category', article.category));
    const heading = element('h2', '', article.title[language]);
    const body = element('p', 'article-body', article.body[language]);
    heading.lang = body.lang = language === 'zh' ? 'zh-Hant' : 'en';
    card.append(heading, body);
    if (article.followUp?.[language]) {
      const followup = element('div', 'article-followup');
      const question = element('span', '', article.followUp[language]);
      question.lang = language === 'zh' ? 'zh-Hant' : 'en';
      followup.append(element('strong', '', 'WHEN MORE CONTEXT HELPS'), question);
      card.append(followup);
    }
    card.append(element('span', 'article-id', `SOURCE / ${article.id}`));
    $('knowledge-list').append(card);
  }
  if (!filtered.length) $('knowledge-list').append(element('p', 'knowledge-empty', 'No articles match. Try a different phrase or category.'));
}

function renderEvaluation() {
  const evaluation = state.evaluation;
  if (!evaluation) return;
  $('evaluation-empty').hidden = true;
  $('evaluation-results').hidden = false;
  $('eval-total').textContent = evaluation.total.toLocaleString();
  $('eval-passed').textContent = evaluation.passed.toLocaleString();
  $('eval-failed').textContent = (evaluation.total - evaluation.passed).toLocaleString();
  $('evaluation-scope').textContent = evaluation.scope;
  const filter = $('evaluation-filter').value;
  const results = evaluation.results.filter((result) => filter === 'all' || (filter === 'passed') === result.passed);
  $('evaluation-rows').replaceChildren();
  for (const result of results) {
    const row = element('tr');
    row.append(element('td', '', result.id), element('td', '', result.language === 'zh' ? '繁體中文' : 'English'));
    for (const outcome of [result.expected, result.actual]) {
      const cell = element('td', '', outcome.status);
      cell.append(element('span', 'case-source', outcome.sourceIds.length ? outcome.sourceIds.join(', ') : 'No sources'));
      row.append(cell);
    }
    const resultCell = element('td');
    resultCell.append(badge(result.passed ? 'passed' : 'failed', result.passed ? 'Passed' : 'Failed'));
    row.append(resultCell);
    $('evaluation-rows').append(row);
  }
  if (!results.length) {
    const row = element('tr');
    const cell = element('td', 'evaluation-row-empty', 'No results in this filter.');
    cell.colSpan = 5;
    row.append(cell);
    $('evaluation-rows').append(row);
  }
}

async function runEvaluation() {
  if (state.evaluating) return;
  state.evaluating = true;
  $('run-evaluation').disabled = true;
  $('run-evaluation').querySelector('span').textContent = 'Running checks…';
  notice('evaluation-message', 'Running the fixed synthetic corpus against the local extractive baseline…', '');
  try {
    state.evaluation = await request('/api/evaluation');
    renderEvaluation();
    notice('evaluation-message', `Evaluation completed. ${state.evaluation.passed} of ${state.evaluation.total} checks matched expectations.`, '');
    announce('Evaluation complete. Results are ready to inspect.');
  } catch (error) {
    notice('evaluation-message', error.message);
  } finally {
    state.evaluating = false;
    $('run-evaluation').disabled = false;
    $('run-evaluation').querySelector('span').textContent = 'Run evaluation';
  }
}

function switchView(view) {
  const current = ['workbench', 'knowledge', 'evaluation'].includes(view) ? view : 'workbench';
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `view-${current}`; });
  document.querySelectorAll('[data-view]').forEach((link) => {
    const active = link.dataset.view === current;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const title = current.charAt(0).toUpperCase() + current.slice(1);
  $('breadcrumb-view').textContent = title;
  document.title = `${title} · Relay Desk`;
  if (current === 'knowledge') renderKnowledge();
  if (current === 'evaluation' && !state.evaluation) runEvaluation();
}

async function bootstrap() {
  $('retry-bootstrap').disabled = true;
  try {
    state.bootstrap = await request('/api/bootstrap');
    $('global-message').hidden = true;
    const options = [element('option', '', 'Write your own question')];
    options[0].value = '';
    for (const example of state.bootstrap.examples) {
      const option = element('option', '', `${example.language === 'zh' ? '繁中' : 'EN'} · ${example.title}`);
      option.value = example.id;
      options.push(option);
    }
    $('example-select').replaceChildren(...options);
    setTicketControls(false);
    const liveOption = $('mode').querySelector('[value="live"]');
    liveOption.disabled = !state.bootstrap.modes.live;
    liveOption.textContent = state.bootstrap.modes.live ? 'Live AI · configured provider' : 'Live AI · not configured';
    if (!$('ticket').value && state.bootstrap.examples.length) {
      const first = state.bootstrap.examples.find((example) => example.language === 'en') || state.bootstrap.examples[0];
      $('example-select').value = first.id;
      $('ticket').value = first.ticket;
      $('language').value = first.language;
    }
    updateTicketCount();
    updateModeDescription();
    renderKnowledge();
    announce('Workspace ready. Choose a sample or enter a customer question.');
  } catch (error) {
    $('global-message').hidden = false;
    $('global-message-text').textContent = error.message;
    $('example-select').replaceChildren(element('option', '', 'Examples unavailable'));
    $('generate-button').disabled = true;
  } finally {
    $('retry-bootstrap').disabled = false;
  }
}

$('ticket-form').addEventListener('submit', createDraft);
$('example-select').addEventListener('change', () => {
  const example = state.bootstrap.examples.find((item) => item.id === $('example-select').value);
  $('ticket').value = example?.ticket || '';
  if (example) $('language').value = example.language;
  changedTicket();
  $('ticket').focus();
});
$('ticket').addEventListener('input', () => { $('example-select').value = ''; changedTicket(); });
$('language').addEventListener('change', changedTicket);
$('mode').addEventListener('change', changedTicket);
$('approve').addEventListener('change', updateHandoffControls);
$('reply').addEventListener('input', () => { $('approve').checked = false; updateHandoffControls(); });
$('send-button').addEventListener('click', sendReply);
$('copy-reply').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('reply').value);
    announce('Reply copied to clipboard.');
    $('copy-reply').replaceChildren(icon('check'), document.createTextNode(' Copied'));
    setTimeout(() => $('copy-reply').replaceChildren(icon('copy'), document.createTextNode(' Copy')), 1800);
  } catch {
    $('reply').focus();
    $('reply').select();
    announce('Clipboard access is unavailable. The reply is selected; use your keyboard to copy.');
  }
});
$('refresh-history').addEventListener('click', loadHistory);
$('retry-bootstrap').addEventListener('click', bootstrap);
$('knowledge-search').addEventListener('input', () => { state.selectedArticle = null; renderKnowledge(); });
document.querySelectorAll('[data-knowledge-language]').forEach((button) => {
  button.addEventListener('click', () => { state.knowledgeLanguage = button.dataset.knowledgeLanguage; renderKnowledge(); });
});
$('run-evaluation').addEventListener('click', runEvaluation);
$('evaluation-filter').addEventListener('change', renderEvaluation);
window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
switchView(location.hash.slice(1));
Promise.allSettled([bootstrap(), loadHistory()]);
