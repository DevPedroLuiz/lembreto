const DEFAULT_APP_ORIGIN = 'http://localhost:3001';
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
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  loginButton: document.getElementById('loginButton'),
  syncSessionButton: document.getElementById('syncSessionButton'),
  manualTab: document.getElementById('manualTab'),
  captureTab: document.getElementById('captureTab'),
  taskForm: document.getElementById('taskForm'),
  capturePanel: document.getElementById('capturePanel'),
  title: document.getElementById('title'),
  description: document.getElementById('description'),
  date: document.getElementById('date'),
  time: document.getElementById('time'),
  priority: document.getElementById('priority'),
  category: document.getElementById('category'),
  createButton: document.getElementById('createButton'),
  captureInstruction: document.getElementById('captureInstruction'),
  captureButton: document.getElementById('captureButton'),
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
    setStatus('Informe um endereco valido, como http://localhost:3001.', 'error');
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
    return;
  }

  const data = await apiRequest('/api/auth/me', { method: 'GET' });
  state.token = data.token;
  state.user = data.user || null;
  await storageSet({ token: state.token, user: state.user });
  updateSessionUi();
  setStatus('Sessao sincronizada com o site.', 'success');
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
}

function showManualTab() {
  els.manualTab.classList.add('active');
  els.captureTab.classList.remove('active');
  els.taskForm.classList.remove('hidden');
  els.capturePanel.classList.add('hidden');
}

function showCaptureTab() {
  els.captureTab.classList.add('active');
  els.manualTab.classList.remove('active');
  els.capturePanel.classList.remove('hidden');
  els.taskForm.classList.add('hidden');
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

async function init() {
  const stored = await storageGet(STORAGE_KEYS);
  state = {
    appOrigin: stored.appOrigin || DEFAULT_APP_ORIGIN,
    token: stored.token || null,
    user: stored.user || null,
  };
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
  }
}

els.saveSettingsButton.addEventListener('click', () => runWithBusy(saveSettings));
els.openAppButton.addEventListener('click', () => runWithBusy(openApp));
els.loginButton.addEventListener('click', () => runWithBusy(login));
els.syncSessionButton.addEventListener('click', () => runWithBusy(restoreFromSiteSession));
els.taskForm.addEventListener('submit', (event) => runWithBusy(() => createManualTask(event)));
els.captureButton.addEventListener('click', () => runWithBusy(captureAndCreateTask));
els.manualTab.addEventListener('click', showManualTab);
els.captureTab.addEventListener('click', showCaptureTab);

void init();
