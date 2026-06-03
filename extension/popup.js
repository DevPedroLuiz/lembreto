const DEFAULT_APP_ORIGIN = 'https://lembreto.vercel.app';
const LEGACY_LOCAL_APP_ORIGIN = 'http://localhost:3001';
const STORAGE_KEYS = ['appOrigin', 'token', 'user'];

const els = {
  sessionLabel: document.getElementById('sessionLabel'),
  statusBox: document.getElementById('statusBox'),
  settingsPanel: document.getElementById('settingsPanel'),
  loginPanel: document.getElementById('loginPanel'),
  loginFields: document.getElementById('loginFields'),
  quickPanel: document.getElementById('quickPanel'),
  authHint: document.getElementById('authHint'),
  appOrigin: document.getElementById('appOrigin'),
  saveSettingsButton: document.getElementById('saveSettingsButton'),
  openAppButton: document.getElementById('openAppButton'),
  openFullAppButton: document.getElementById('openFullAppButton'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  loginButton: document.getElementById('loginButton'),
  syncSessionButton: document.getElementById('syncSessionButton'),
  manualTab: document.getElementById('manualTab'),
  assistantTab: document.getElementById('assistantTab'),
  agendaTab: document.getElementById('agendaTab'),
  taskForm: document.getElementById('taskForm'),
  assistantPanel: document.getElementById('assistantPanel'),
  agendaPanel: document.getElementById('agendaPanel'),
  title: document.getElementById('title'),
  description: document.getElementById('description'),
  date: document.getElementById('date'),
  time: document.getElementById('time'),
  priority: document.getElementById('priority'),
  category: document.getElementById('category'),
  createButton: document.getElementById('createButton'),
  assistantPrompt: document.getElementById('assistantPrompt'),
  assistantButton: document.getElementById('assistantButton'),
  captureInstruction: document.getElementById('captureInstruction'),
  captureButton: document.getElementById('captureButton'),
  savePageButton: document.getElementById('savePageButton'),
  refreshAgendaButton: document.getElementById('refreshAgendaButton'),
  agendaList: document.getElementById('agendaList'),
  openAgendaButton: document.getElementById('openAgendaButton'),
};

let state = {
  appOrigin: DEFAULT_APP_ORIGIN,
  token: null,
  user: null,
  recaptchaRequired: true,
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function getCookie(details) {
  return new Promise((resolve) => chrome.cookies.get(details, resolve));
}

function normalizeOrigin(value) {
  const raw = String(value || DEFAULT_APP_ORIGIN).trim().replace(/\/+$/, '');
  const url = new URL(raw);
  return url.origin;
}

function setStatus(message, tone = 'neutral') {
  els.statusBox.textContent = message || '';
  els.statusBox.className = `status${message ? ' visible' : ''}${tone === 'error' ? ' error' : ''}${tone === 'success' ? ' success' : ''}`;
}

function setBusy(isBusy) {
  for (const button of document.querySelectorAll('button')) {
    button.disabled = isBusy;
  }
}

function updateSessionUi() {
  const signedIn = Boolean(state.token);
  els.loginPanel.classList.toggle('hidden', signedIn);
  els.loginPanel.classList.toggle('loginPanelRecaptcha', state.recaptchaRequired);
  els.quickPanel.classList.toggle('hidden', !signedIn);
  els.sessionLabel.textContent = signedIn
    ? state.user?.email || 'Sessao ativa'
    : 'Entre para criar lembretes';
  els.authHint.textContent = state.recaptchaRequired
    ? 'Por seguranca, entre no site e sincronize sua sessao aqui.'
    : 'Entre por senha ou use a sessao aberta no site.';
  els.loginButton.textContent = state.recaptchaRequired ? 'Entrar pelo site' : 'Entrar';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTaskDate(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data invalida';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function priorityLabel(value) {
  if (value === 'high') return 'Alta';
  if (value === 'low') return 'Baixa';
  return 'Media';
}

function buildUrl(path) {
  return `${state.appOrigin}${path}`;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);

  const response = await fetch(buildUrl(path), {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Nao foi possivel completar a acao.';
    if (response.status === 401) {
      state.token = null;
      state.user = null;
      await storageSet({ token: null, user: null });
      updateSessionUi();
    }
    throw new Error(message);
  }
  return data;
}

async function refreshAuthConfig() {
  try {
    const response = await fetch(buildUrl('/api/auth/config'), {
      cache: 'no-store',
      credentials: 'include',
    });
    const data = await response.json().catch(() => ({}));
    state.recaptchaRequired = data.recaptchaRequired !== false;
  } catch {
    state.recaptchaRequired = true;
  }
  updateSessionUi();
}

async function saveSettings() {
  try {
    const appOrigin = normalizeOrigin(els.appOrigin.value);
    state.appOrigin = appOrigin;
    els.appOrigin.value = appOrigin;
    await storageSet({ appOrigin });
    await refreshAuthConfig();
    setStatus('Endereco salvo.', 'success');
  } catch {
    setStatus('Informe um endereco valido, como https://lembreto.vercel.app.', 'error');
  }
}

async function restoreFromSiteSession() {
  const cookie = await getCookie({ url: state.appOrigin, name: 'lembreto_session' });
  if (cookie?.value) {
    state.token = cookie.value;
    state.user = null;
    await apiRequest('/api/tasks?limit=1', { method: 'GET' });
    await storageSet({ token: state.token, user: state.user });
    updateSessionUi();
    setStatus('Sessao do site sincronizada.', 'success');
    void loadAgenda();
    return;
  }

  const data = await apiRequest('/api/auth/me', { method: 'GET' });
  state.token = data.token;
  state.user = data.user || null;
  await storageSet({ token: state.token, user: state.user });
  updateSessionUi();
  setStatus('Sessao sincronizada com o site.', 'success');
  void loadAgenda();
}

async function login() {
  if (state.recaptchaRequired) {
    await openApp();
    setStatus('Entre pelo site do Lembreto e depois clique em "Usar sessao do site".');
    return;
  }

  const email = els.email.value.trim();
  const password = els.password.value;
  if (!email || !password) {
    setStatus('Informe e-mail e senha.', 'error');
    return;
  }

  let data;
  try {
    data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLocaleLowerCase('pt-BR').includes('robo') || message.toLocaleLowerCase('pt-BR').includes('robô')) {
      state.recaptchaRequired = true;
      updateSessionUi();
      throw new Error('Entre pelo site do Lembreto e depois use "Usar sessao do site".');
    }
    throw error;
  }
  state.token = data.token;
  state.user = data.user;
  await storageSet({ token: state.token, user: state.user });
  els.password.value = '';
  updateSessionUi();
  setStatus('Login realizado.', 'success');
  void loadAgenda();
}

function toIsoDueDate(dateValue, timeValue) {
  if (!dateValue) return null;
  const time = timeValue || '09:00';
  const date = new Date(`${dateValue}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function createManualTask(event) {
  event.preventDefault();
  const title = els.title.value.trim();
  if (!title) {
    setStatus('Digite um titulo para o lembrete.', 'error');
    return;
  }

  const dueDate = toIsoDueDate(els.date.value, els.time.value);
  const task = await apiRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: els.description.value.trim(),
      dueDate,
      priority: els.priority.value,
      category: els.category.value.trim() || 'Geral',
      tags: [],
      alarmEnabled: Boolean(dueDate),
      status: 'pending',
    }),
  });

  els.taskForm.reset();
  els.category.value = 'Geral';
  setStatus(`Lembrete criado: ${task.title || title}`, 'success');
  void loadAgenda();
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
  });
}

function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function captureAndCreateTask() {
  const tab = await queryActiveTab();
  const imageDataUrl = await captureVisibleTab();
  const response = await apiRequest('/api/assistant/screenshot', {
    method: 'POST',
    body: JSON.stringify({
      imageDataUrl,
      pageTitle: tab?.title || '',
      pageUrl: tab?.url || '',
      instruction: els.captureInstruction.value.trim(),
    }),
  });

  setStatus(response.message || 'Captura analisada.', response.action?.status === 'success' ? 'success' : 'neutral');
  if (response.action?.status === 'success') void loadAgenda();
}

async function sendAssistantCommand() {
  const message = els.assistantPrompt.value.trim();
  if (!message) {
    setStatus('Digite um comando para a IA.', 'error');
    return;
  }

  const response = await apiRequest('/api/assistant/message', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  els.assistantPrompt.value = '';
  setStatus(response.message || 'Comando enviado para a IA.', response.action?.status === 'success' ? 'success' : 'neutral');
  if (response.action?.status === 'success') void loadAgenda();
}

async function createTaskFromCurrentPage() {
  const tab = await queryActiveTab();
  if (!tab?.url) {
    setStatus('Nao consegui identificar a aba atual.', 'error');
    return;
  }

  const title = tab.title ? `Ver: ${tab.title}` : 'Ver pagina salva';
  const task = await apiRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: title.slice(0, 140),
      description: `Pagina salva pela extensao do Lembreto.\n\n${tab.url}`,
      dueDate: null,
      priority: 'medium',
      category: 'Geral',
      tags: ['Navegador'],
      alarmEnabled: false,
      status: 'pending',
    }),
  });

  setStatus(`Pagina salva: ${task.title || title}`, 'success');
  void loadAgenda();
}

function renderAgenda(items) {
  if (!Array.isArray(items) || items.length === 0) {
    els.agendaList.innerHTML = '<div class="agendaEmpty">Nenhum lembrete pendente encontrado.</div>';
    return;
  }

  els.agendaList.innerHTML = items.map((task) => `
    <article class="agendaItem">
      <div class="agendaItemHeader">
        <div>
          <div class="agendaTitle">${escapeHtml(task.title || 'Sem titulo')}</div>
          <div class="agendaMeta">${escapeHtml(formatTaskDate(task.dueDate))} • ${escapeHtml(task.category || 'Geral')}</div>
        </div>
        <span class="agendaBadge">${escapeHtml(priorityLabel(task.priority))}</span>
      </div>
      <div class="agendaActions">
        <button type="button" class="secondary smallButton" data-open-task="${escapeHtml(task.id)}">Abrir</button>
        <button type="button" class="secondary smallButton" data-complete-task="${escapeHtml(task.id)}">Concluir</button>
      </div>
    </article>
  `).join('');
}

async function loadAgenda() {
  if (!state.token) return;
  els.agendaList.innerHTML = '<div class="agendaEmpty">Carregando lembretes...</div>';
  const data = await apiRequest('/api/tasks?status=pending&sort=dueDate&limit=6', { method: 'GET' });
  renderAgenda(data.items || []);
}

async function openTask(taskId) {
  await chrome.tabs.create({
    url: `${state.appOrigin}/?notificationTarget=task&taskId=${encodeURIComponent(taskId)}`,
  });
}

async function completeTask(taskId) {
  await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'completed' }),
  });
  setStatus('Lembrete concluido.', 'success');
  await loadAgenda();
}

function showManualTab() {
  els.manualTab.classList.add('active');
  els.assistantTab.classList.remove('active');
  els.agendaTab.classList.remove('active');
  els.taskForm.classList.remove('hidden');
  els.assistantPanel.classList.add('hidden');
  els.agendaPanel.classList.add('hidden');
}

function showAssistantTab() {
  els.assistantTab.classList.add('active');
  els.manualTab.classList.remove('active');
  els.agendaTab.classList.remove('active');
  els.assistantPanel.classList.remove('hidden');
  els.taskForm.classList.add('hidden');
  els.agendaPanel.classList.add('hidden');
}

function showAgendaTab() {
  els.agendaTab.classList.add('active');
  els.manualTab.classList.remove('active');
  els.assistantTab.classList.remove('active');
  els.agendaPanel.classList.remove('hidden');
  els.taskForm.classList.add('hidden');
  els.assistantPanel.classList.add('hidden');
  void runWithBusy(loadAgenda);
}

async function runWithBusy(action) {
  try {
    setBusy(true);
    setStatus('');
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Algo deu errado.';
    setStatus(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function openApp() {
  await chrome.tabs.create({ url: state.appOrigin });
}

async function openFullApp() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('full-app.html') });
}

async function openAgenda() {
  await chrome.tabs.create({ url: `${state.appOrigin}/?tab=calendar` });
}

async function init() {
  const stored = await storageGet(STORAGE_KEYS);
  const storedAppOrigin = stored.appOrigin === LEGACY_LOCAL_APP_ORIGIN
    ? DEFAULT_APP_ORIGIN
    : stored.appOrigin;
  state = {
    appOrigin: storedAppOrigin || DEFAULT_APP_ORIGIN,
    token: stored.token || null,
    user: stored.user || null,
  };
  if (stored.appOrigin === LEGACY_LOCAL_APP_ORIGIN) {
    await storageSet({ appOrigin: state.appOrigin });
  }
  els.appOrigin.value = state.appOrigin;
  updateSessionUi();
  await refreshAuthConfig();

  if (!state.token) {
    await runWithBusy(async () => {
      try {
        await restoreFromSiteSession();
      } catch {
        setStatus('Entre pelo site e clique em "Usar sessao do site".');
      }
    });
  } else {
    setStatus('');
    void loadAgenda();
  }
}

els.saveSettingsButton.addEventListener('click', () => runWithBusy(saveSettings));
els.openAppButton.addEventListener('click', () => runWithBusy(openApp));
els.openFullAppButton.addEventListener('click', () => runWithBusy(openFullApp));
els.loginButton.addEventListener('click', () => runWithBusy(login));
els.syncSessionButton.addEventListener('click', () => runWithBusy(restoreFromSiteSession));
els.taskForm.addEventListener('submit', (event) => runWithBusy(() => createManualTask(event)));
els.assistantButton.addEventListener('click', () => runWithBusy(sendAssistantCommand));
els.captureButton.addEventListener('click', () => runWithBusy(captureAndCreateTask));
els.savePageButton.addEventListener('click', () => runWithBusy(createTaskFromCurrentPage));
els.refreshAgendaButton.addEventListener('click', () => runWithBusy(loadAgenda));
els.openAgendaButton.addEventListener('click', () => runWithBusy(openAgenda));
els.manualTab.addEventListener('click', showManualTab);
els.assistantTab.addEventListener('click', showAssistantTab);
els.agendaTab.addEventListener('click', showAgendaTab);
els.agendaList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const taskToOpen = target.dataset.openTask;
  const taskToComplete = target.dataset.completeTask;
  if (taskToOpen) void runWithBusy(() => openTask(taskToOpen));
  if (taskToComplete) void runWithBusy(() => completeTask(taskToComplete));
});

void init();
