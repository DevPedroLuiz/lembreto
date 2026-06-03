const DEFAULT_APP_ORIGIN = 'https://lembreto.vercel.app';
const LEGACY_LOCAL_APP_ORIGIN = 'http://localhost:3001';
const STORAGE_KEYS = ['appOrigin', 'token', 'user'];

const els = {
  sessionLabel: document.getElementById('sessionLabel'),
  statusBox: document.getElementById('statusBox'),
  authPanel: document.getElementById('authPanel'),
  viewTitle: document.getElementById('viewTitle'),
  refreshButton: document.getElementById('refreshButton'),
  quickCreateButton: document.getElementById('quickCreateButton'),
  syncSessionButton: document.getElementById('syncSessionButton'),
  openSiteButton: document.getElementById('openSiteButton'),
  authOpenSiteButton: document.getElementById('authOpenSiteButton'),
  authSyncButton: document.getElementById('authSyncButton'),
  pendingMetric: document.getElementById('pendingMetric'),
  overdueMetric: document.getElementById('overdueMetric'),
  todayMetric: document.getElementById('todayMetric'),
  notesMetric: document.getElementById('notesMetric'),
  dashboardTaskList: document.getElementById('dashboardTaskList'),
  quickTaskForm: document.getElementById('quickTaskForm'),
  quickTitle: document.getElementById('quickTitle'),
  quickDate: document.getElementById('quickDate'),
  quickTime: document.getElementById('quickTime'),
  quickPriority: document.getElementById('quickPriority'),
  quickCategory: document.getElementById('quickCategory'),
  quickDescription: document.getElementById('quickDescription'),
  taskSearch: document.getElementById('taskSearch'),
  taskStatusFilter: document.getElementById('taskStatusFilter'),
  taskPriorityFilter: document.getElementById('taskPriorityFilter'),
  taskSort: document.getElementById('taskSort'),
  taskList: document.getElementById('taskList'),
  taskDetailsTitle: document.getElementById('taskDetailsTitle'),
  taskEditForm: document.getElementById('taskEditForm'),
  emptyTaskDetails: document.getElementById('emptyTaskDetails'),
  editTaskId: document.getElementById('editTaskId'),
  editTitle: document.getElementById('editTitle'),
  editDate: document.getElementById('editDate'),
  editTime: document.getElementById('editTime'),
  editPriority: document.getElementById('editPriority'),
  editCategory: document.getElementById('editCategory'),
  editDescription: document.getElementById('editDescription'),
  completeTaskButton: document.getElementById('completeTaskButton'),
  deleteTaskButton: document.getElementById('deleteTaskButton'),
  noteForm: document.getElementById('noteForm'),
  noteTitle: document.getElementById('noteTitle'),
  notePriority: document.getElementById('notePriority'),
  noteCategory: document.getElementById('noteCategory'),
  noteContent: document.getElementById('noteContent'),
  noteList: document.getElementById('noteList'),
  assistantPrompt: document.getElementById('assistantPrompt'),
  assistantSendButton: document.getElementById('assistantSendButton'),
  captureTabSelect: document.getElementById('captureTabSelect'),
  captureInstruction: document.getElementById('captureInstruction'),
  refreshTabsButton: document.getElementById('refreshTabsButton'),
  captureButton: document.getElementById('captureButton'),
  appOrigin: document.getElementById('appOrigin'),
  saveOriginButton: document.getElementById('saveOriginButton'),
  settingsSyncButton: document.getElementById('settingsSyncButton'),
  settingsOpenSiteButton: document.getElementById('settingsOpenSiteButton'),
};

let state = {
  appOrigin: DEFAULT_APP_ORIGIN,
  token: null,
  user: null,
  activeView: 'dashboard',
  allTasks: [],
  tasks: [],
  notes: [],
  selectedTaskId: null,
  recaptchaRequired: true,
};

const viewLabels = {
  dashboard: 'Dashboard',
  tasks: 'Lembretes',
  notes: 'Notas',
  assistant: 'Assistente',
  settings: 'Configuracoes',
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

function queryTabs(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function getTab(tabId) {
  return new Promise((resolve) => chrome.tabs.get(tabId, resolve));
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve) => chrome.tabs.update(tabId, updateProperties, resolve));
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(dataUrl);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOrigin(value) {
  const raw = String(value || DEFAULT_APP_ORIGIN).trim().replace(/\/+$/, '');
  return new URL(raw).origin;
}

function setStatus(message, tone = 'neutral') {
  els.statusBox.textContent = message || '';
  els.statusBox.className = `status${message ? ' visible' : ''}${tone === 'error' ? ' error' : ''}${tone === 'success' ? ' success' : ''}`;
}

function setBusy(isBusy) {
  document.body.classList.toggle('isBusy', isBusy);
  for (const button of document.querySelectorAll('button')) {
    button.disabled = isBusy;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    cache: 'no-store',
    credentials: 'include',
    headers,
  });

  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data.error === 'string' ? data.error : 'Nao foi possivel completar a acao.';
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

function updateSessionUi() {
  const signedIn = Boolean(state.token);
  els.authPanel.classList.toggle('hidden', signedIn);
  els.sessionLabel.textContent = signedIn
    ? state.user?.email || 'Sessao ativa'
    : 'Sem sessao sincronizada';
}

function priorityLabel(value) {
  if (value === 'high') return 'Alta';
  if (value === 'low') return 'Baixa';
  return 'Media';
}

function derivedTaskStatus(task) {
  if (task.deletedAt) return 'deleted';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.dueDate) {
    const due = Date.parse(task.dueDate);
    if (!Number.isNaN(due) && due < Date.now()) return 'overdue';
  }
  return 'pending';
}

function formatTaskDate(value) {
  if (!value) return 'Sem prazo';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data invalida';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function toIsoDueDate(dateValue, timeValue) {
  if (!dateValue) return null;
  const time = timeValue || '09:00';
  const date = new Date(`${dateValue}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateToFormParts(value) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  const pad = (item) => String(item).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function buildTaskPayload(source) {
  const dueDate = toIsoDueDate(source.date, source.time);
  return {
    title: source.title.trim(),
    description: source.description.trim(),
    dueDate,
    priority: source.priority,
    category: source.category.trim() || 'Geral',
    tags: source.tags || [],
    alarmEnabled: Boolean(dueDate),
    status: 'pending',
  };
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="emptyState">${escapeHtml(message)}</div>`;
}

function renderTaskCard(task, options = {}) {
  const status = derivedTaskStatus(task);
  const selected = task.id === state.selectedTaskId ? ' selected' : '';
  const description = task.description
    ? `<div class="itemDescription">${escapeHtml(task.description).slice(0, 220)}</div>`
    : '';
  return `
    <article class="itemCard clickable${selected}" data-task-id="${escapeHtml(task.id)}">
      <div class="itemHeader">
        <div>
          <div class="itemTitle">${escapeHtml(task.title || 'Sem titulo')}</div>
          <div class="itemMeta">${escapeHtml(formatTaskDate(task.dueDate))} - ${escapeHtml(task.category || 'Geral')}</div>
        </div>
        <span class="badge ${escapeHtml(task.priority || 'medium')}">${escapeHtml(priorityLabel(task.priority))}</span>
      </div>
      ${description}
      <div class="badgeRow">
        <span class="badge ${status === 'overdue' ? 'overdue' : ''}">${escapeHtml(statusLabel(status))}</span>
        ${(task.tags || []).slice(0, 4).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}
      </div>
      ${options.actions ? `
        <div class="actionRow">
          <button class="secondary smallButton" data-open-task="${escapeHtml(task.id)}" type="button">Abrir no site</button>
          <button class="secondary smallButton" data-complete-task="${escapeHtml(task.id)}" type="button">Concluir</button>
        </div>
      ` : ''}
    </article>
  `;
}

function statusLabel(status) {
  if (status === 'completed') return 'Concluido';
  if (status === 'overdue') return 'Atrasado';
  if (status === 'cancelled') return 'Cancelado';
  return 'Pendente';
}

function renderDashboard() {
  const sourceTasks = state.allTasks.length > 0 ? state.allTasks : state.tasks;
  const activeTasks = sourceTasks.filter((task) => !['completed', 'cancelled', 'deleted'].includes(derivedTaskStatus(task)));
  const overdueTasks = sourceTasks.filter((task) => derivedTaskStatus(task) === 'overdue');
  const todayTasks = activeTasks.filter((task) => isToday(task.dueDate));
  els.pendingMetric.textContent = String(activeTasks.length);
  els.overdueMetric.textContent = String(overdueTasks.length);
  els.todayMetric.textContent = String(todayTasks.length);
  els.notesMetric.textContent = String(state.notes.length);

  const upcoming = activeTasks
    .slice()
    .sort(compareTasksByDueDate)
    .slice(0, 7);
  if (upcoming.length === 0) {
    renderEmpty(els.dashboardTaskList, 'Nenhum lembrete pendente encontrado.');
    return;
  }
  els.dashboardTaskList.innerHTML = upcoming.map((task) => renderTaskCard(task, { actions: true })).join('');
}

function compareTasksByDueDate(left, right) {
  const leftTime = left.dueDate ? Date.parse(left.dueDate) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.dueDate ? Date.parse(right.dueDate) : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const order = { high: 0, medium: 1, low: 2 };
  return (order[left.priority] ?? 1) - (order[right.priority] ?? 1);
}

function renderTaskList() {
  if (!state.token) {
    renderEmpty(els.taskList, 'Sincronize sua sessao para ver os lembretes.');
    return;
  }
  if (state.tasks.length === 0) {
    renderEmpty(els.taskList, 'Nenhum lembrete encontrado para este filtro.');
    return;
  }
  els.taskList.innerHTML = state.tasks.map((task) => renderTaskCard(task)).join('');
  renderSelectedTask();
}

function renderSelectedTask() {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId);
  els.taskEditForm.classList.toggle('hidden', !task);
  els.emptyTaskDetails.classList.toggle('hidden', Boolean(task));
  if (!task) {
    els.taskDetailsTitle.textContent = 'Selecione um lembrete';
    return;
  }

  const parts = dateToFormParts(task.dueDate);
  els.taskDetailsTitle.textContent = task.title || 'Lembrete';
  els.editTaskId.value = task.id;
  els.editTitle.value = task.title || '';
  els.editDate.value = parts.date;
  els.editTime.value = parts.time;
  els.editPriority.value = task.priority || 'medium';
  els.editCategory.value = task.category || 'Geral';
  els.editDescription.value = task.description || '';
  els.completeTaskButton.textContent = task.status === 'completed' ? 'Reabrir' : 'Concluir';
}

function renderNotes() {
  if (!state.token) {
    renderEmpty(els.noteList, 'Sincronize sua sessao para ver as notas.');
    return;
  }
  if (state.notes.length === 0) {
    renderEmpty(els.noteList, 'Nenhuma nota salva ainda.');
    return;
  }

  els.noteList.innerHTML = state.notes.map((note) => `
    <article class="itemCard">
      <div class="itemHeader">
        <div>
          <div class="itemTitle">${escapeHtml(note.title || 'Sem titulo')}</div>
          <div class="itemMeta">${escapeHtml(note.category || 'Geral')} - ${escapeHtml(note.mode === 'temporary' ? 'Temporaria' : 'Fixa')}</div>
        </div>
        <span class="badge ${escapeHtml(note.priority || 'medium')}">${escapeHtml(priorityLabel(note.priority))}</span>
      </div>
      <div class="itemDescription">${escapeHtml(note.content || '')}</div>
      <div class="actionRow">
        <button class="dangerButton smallButton" data-delete-note="${escapeHtml(note.id)}" type="button">Excluir</button>
      </div>
    </article>
  `).join('');
}

function switchView(view) {
  state.activeView = view;
  els.viewTitle.textContent = viewLabels[view] || 'Lembreto';
  for (const element of document.querySelectorAll('.view')) {
    element.classList.add('hidden');
  }
  document.getElementById(`${view}View`)?.classList.remove('hidden');
  for (const button of document.querySelectorAll('.navButton')) {
    button.classList.toggle('active', button.dataset.view === view);
  }
  if (view === 'assistant') void loadCaptureTabs();
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
    await loadAll();
    return;
  }

  const data = await apiRequest('/api/auth/me', { method: 'GET' });
  state.token = data.token;
  state.user = data.user || null;
  await storageSet({ token: state.token, user: state.user });
  updateSessionUi();
  setStatus('Sessao sincronizada com o site.', 'success');
  await loadAll();
}

async function loadTasks() {
  if (!state.token) return;
  const params = new URLSearchParams();
  params.set('limit', '80');
  params.set('sort', els.taskSort.value || 'dueDate');
  const status = els.taskStatusFilter.value;
  if (status !== 'all') params.set('status', status);
  const priority = els.taskPriorityFilter.value;
  if (priority !== 'all') params.set('priority', priority);
  const search = els.taskSearch.value.trim();
  if (search) params.set('search', search);

  const data = await apiRequest(`/api/tasks?${params.toString()}`, { method: 'GET' });
  state.tasks = Array.isArray(data?.items) ? data.items : [];
  if (state.selectedTaskId && !state.tasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = null;
  }
  renderDashboard();
  renderTaskList();
}

async function loadAllTasksForDashboard() {
  if (!state.token) return;
  const data = await apiRequest('/api/tasks?limit=100&sort=dueDate', { method: 'GET' });
  state.allTasks = Array.isArray(data?.items) ? data.items : [];
}

async function loadNotes() {
  if (!state.token) return;
  const data = await apiRequest('/api/tasks/notes', { method: 'GET' });
  state.notes = Array.isArray(data) ? data : [];
  renderNotes();
}

async function loadAll() {
  updateSessionUi();
  if (!state.token) {
    state.allTasks = [];
    state.tasks = [];
    state.notes = [];
    state.selectedTaskId = null;
    renderDashboard();
    renderTaskList();
    renderNotes();
    return;
  }

  await Promise.all([loadAllTasksForDashboard(), loadNotes()]);
  renderDashboard();
  await loadTasks();
}

async function saveOrigin() {
  try {
    state.appOrigin = normalizeOrigin(els.appOrigin.value);
    els.appOrigin.value = state.appOrigin;
    await storageSet({ appOrigin: state.appOrigin });
    await refreshAuthConfig();
    setStatus('Endereco salvo.', 'success');
  } catch {
    setStatus('Informe um endereco valido, como https://lembreto.vercel.app.', 'error');
  }
}

async function openSite(path = '/') {
  await chrome.tabs.create({ url: new URL(path, state.appOrigin).toString() });
}

async function createQuickTask(event) {
  event.preventDefault();
  const title = els.quickTitle.value.trim();
  if (!title) {
    setStatus('Digite um titulo para o lembrete.', 'error');
    return;
  }
  const payload = buildTaskPayload({
    title,
    description: els.quickDescription.value,
    date: els.quickDate.value,
    time: els.quickTime.value,
    priority: els.quickPriority.value,
    category: els.quickCategory.value,
  });
  const task = await apiRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  els.quickTaskForm.reset();
  els.quickCategory.value = 'Geral';
  state.selectedTaskId = task.id;
  setStatus(`Lembrete criado: ${task.title || title}`, 'success');
  await loadAll();
}

async function updateSelectedTask(event) {
  event.preventDefault();
  const id = els.editTaskId.value;
  if (!id) return;
  const payload = buildTaskPayload({
    title: els.editTitle.value,
    description: els.editDescription.value,
    date: els.editDate.value,
    time: els.editTime.value,
    priority: els.editPriority.value,
    category: els.editCategory.value,
  });
  await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  setStatus('Lembrete atualizado.', 'success');
  await loadAll();
}

async function toggleCompleteSelectedTask() {
  const id = els.editTaskId.value;
  if (!id) return;
  const task = state.tasks.find((item) => item.id === id);
  const nextStatus = task?.status === 'completed' ? 'pending' : 'completed';
  await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: nextStatus }),
  });
  setStatus(nextStatus === 'completed' ? 'Lembrete concluido.' : 'Lembrete reaberto.', 'success');
  await loadAll();
}

async function deleteSelectedTask() {
  const id = els.editTaskId.value;
  if (!id) return;
  await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.selectedTaskId = null;
  setStatus('Lembrete excluido.', 'success');
  await loadAll();
}

async function completeTask(taskId) {
  await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'completed' }),
  });
  setStatus('Lembrete concluido.', 'success');
  await loadAll();
}

async function createNote(event) {
  event.preventDefault();
  const title = els.noteTitle.value.trim();
  if (!title) {
    setStatus('Digite um titulo para a nota.', 'error');
    return;
  }
  await apiRequest('/api/tasks/notes', {
    method: 'POST',
    body: JSON.stringify({
      title,
      content: els.noteContent.value.trim(),
      priority: els.notePriority.value,
      category: els.noteCategory.value.trim() || 'Geral',
      tags: [],
      mode: 'fixed',
      expiresAt: null,
      taskId: null,
    }),
  });
  els.noteForm.reset();
  els.noteCategory.value = 'Geral';
  setStatus('Nota criada.', 'success');
  await loadNotes();
  renderDashboard();
}

async function deleteNote(noteId) {
  await apiRequest(`/api/tasks/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  setStatus('Nota enviada para a lixeira.', 'success');
  await loadNotes();
  renderDashboard();
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
  setStatus(response?.message || 'Comando enviado para a IA.', response?.action?.status === 'success' ? 'success' : 'neutral');
  if (response?.action?.status === 'success') await loadAll();
}

async function loadCaptureTabs() {
  const tabs = await queryTabs({ currentWindow: true });
  const webTabs = tabs.filter((tab) => /^https?:\/\//i.test(tab.url || ''));
  if (webTabs.length === 0) {
    els.captureTabSelect.innerHTML = '<option value="">Nenhuma aba capturavel</option>';
    return;
  }
  els.captureTabSelect.innerHTML = webTabs.map((tab) => {
    const title = `${tab.title || tab.url || 'Aba'} - ${tab.url || ''}`.slice(0, 120);
    return `<option value="${escapeHtml(tab.id)}">${escapeHtml(title)}</option>`;
  }).join('');
}

async function captureChosenTabAndCreate() {
  const tabId = Number(els.captureTabSelect.value);
  if (!tabId) {
    setStatus('Escolha uma aba para capturar.', 'error');
    return;
  }

  const [currentTab] = await queryTabs({ active: true, currentWindow: true });
  const targetTab = await getTab(tabId);
  await updateTab(tabId, { active: true });
  await delay(450);
  const imageDataUrl = await captureVisibleTab(targetTab.windowId);
  if (currentTab?.id && currentTab.id !== tabId) {
    await updateTab(currentTab.id, { active: true });
  }

  const response = await apiRequest('/api/assistant/screenshot', {
    method: 'POST',
    body: JSON.stringify({
      imageDataUrl,
      pageTitle: targetTab.title || '',
      pageUrl: targetTab.url || '',
      instruction: els.captureInstruction.value.trim(),
    }),
  });
  setStatus(response?.message || 'Captura analisada pela IA.', response?.action?.status === 'success' ? 'success' : 'neutral');
  if (response?.action?.status === 'success') await loadAll();
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

function bindEvents() {
  for (const button of document.querySelectorAll('.navButton')) {
    button.addEventListener('click', () => switchView(button.dataset.view || 'dashboard'));
  }
  for (const button of document.querySelectorAll('[data-view-link]')) {
    button.addEventListener('click', () => switchView(button.dataset.viewLink || 'dashboard'));
  }

  els.refreshButton.addEventListener('click', () => runWithBusy(loadAll));
  els.quickCreateButton.addEventListener('click', () => {
    switchView('dashboard');
    els.quickTitle.focus();
  });
  els.syncSessionButton.addEventListener('click', () => runWithBusy(restoreFromSiteSession));
  els.authSyncButton.addEventListener('click', () => runWithBusy(restoreFromSiteSession));
  els.settingsSyncButton.addEventListener('click', () => runWithBusy(restoreFromSiteSession));
  els.openSiteButton.addEventListener('click', () => runWithBusy(() => openSite('/')));
  els.authOpenSiteButton.addEventListener('click', () => runWithBusy(() => openSite('/')));
  els.settingsOpenSiteButton.addEventListener('click', () => runWithBusy(() => openSite('/')));
  els.saveOriginButton.addEventListener('click', () => runWithBusy(saveOrigin));
  els.quickTaskForm.addEventListener('submit', (event) => runWithBusy(() => createQuickTask(event)));
  els.taskEditForm.addEventListener('submit', (event) => runWithBusy(() => updateSelectedTask(event)));
  els.completeTaskButton.addEventListener('click', () => runWithBusy(toggleCompleteSelectedTask));
  els.deleteTaskButton.addEventListener('click', () => runWithBusy(deleteSelectedTask));
  els.noteForm.addEventListener('submit', (event) => runWithBusy(() => createNote(event)));
  els.assistantSendButton.addEventListener('click', () => runWithBusy(sendAssistantCommand));
  els.refreshTabsButton.addEventListener('click', () => runWithBusy(loadCaptureTabs));
  els.captureButton.addEventListener('click', () => runWithBusy(captureChosenTabAndCreate));

  for (const input of [els.taskSearch, els.taskStatusFilter, els.taskPriorityFilter, els.taskSort]) {
    input.addEventListener('input', () => runWithBusy(loadTasks));
    input.addEventListener('change', () => runWithBusy(loadTasks));
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const viewLink = target.closest('[data-view-link]');
    if (viewLink instanceof HTMLElement) {
      switchView(viewLink.dataset.viewLink || 'dashboard');
      return;
    }

    const openTaskButton = target.closest('[data-open-task]');
    if (openTaskButton instanceof HTMLElement) {
      event.stopPropagation();
      const taskId = openTaskButton.dataset.openTask;
      if (taskId) void runWithBusy(() => openSite(`/?notificationTarget=task&taskId=${encodeURIComponent(taskId)}`));
      return;
    }

    const completeTaskButton = target.closest('[data-complete-task]');
    if (completeTaskButton instanceof HTMLElement) {
      event.stopPropagation();
      const taskId = completeTaskButton.dataset.completeTask;
      if (taskId) void runWithBusy(() => completeTask(taskId));
      return;
    }

    const deleteNoteButton = target.closest('[data-delete-note]');
    if (deleteNoteButton instanceof HTMLElement) {
      const noteId = deleteNoteButton.dataset.deleteNote;
      if (noteId) void runWithBusy(() => deleteNote(noteId));
      return;
    }

    const taskCard = target.closest('[data-task-id]');
    if (taskCard instanceof HTMLElement) {
      state.selectedTaskId = taskCard.dataset.taskId || null;
      renderTaskList();
    }
  });
}

async function init() {
  const stored = await storageGet(STORAGE_KEYS);
  const storedAppOrigin = stored.appOrigin === LEGACY_LOCAL_APP_ORIGIN
    ? DEFAULT_APP_ORIGIN
    : stored.appOrigin;
  state.appOrigin = storedAppOrigin || DEFAULT_APP_ORIGIN;
  state.token = stored.token || null;
  state.user = stored.user || null;
  if (stored.appOrigin === LEGACY_LOCAL_APP_ORIGIN) {
    await storageSet({ appOrigin: state.appOrigin });
  }
  els.appOrigin.value = state.appOrigin;
  bindEvents();
  updateSessionUi();
  await refreshAuthConfig();
  switchView('dashboard');

  if (!state.token) {
    try {
      await restoreFromSiteSession();
    } catch {
      setStatus('Entre no site do Lembreto e clique em "Usar sessao do site".');
    }
    return;
  }

  await runWithBusy(loadAll);
}

void init();
