// ============================================================
// 設定: GAS デプロイ後の URL をここに貼る
// ============================================================
const API_URL = 'YOUR_GAS_WEB_APP_URL_HERE';

// ============================================================
// 定数
// ============================================================
const STATUSES = ['未着手', '着手', '進行中', '仕上げ', '完了'];
const STATUS_PROGRESS = {
  '未着手': 0, '着手': 0.25, '進行中': 0.5, '仕上げ': 0.75, '完了': 1.0
};
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// ============================================================
// 状態
// ============================================================
let tasks = [];
let currentView = 'kanban';
let calendarMonth = new Date();
calendarMonth.setDate(1);
let editingId = null;

// ============================================================
// API
// ============================================================
async function api(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

async function fetchTasks() {
  tasks = await api('list');
  render();
}

// ============================================================
// 進捗判定
// ============================================================
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function evaluateTask(task) {
  if (task.status === '完了') return { state: 'done', gap: 0 };

  const today = todayMidnight();
  const start = parseDate(task.start_date);
  const due = parseDate(task.due_date);

  if (!start || !due) return { state: 'normal', gap: 0 };

  const totalMs = due - start;
  const elapsedMs = today - start;

  if (totalMs <= 0) {
    return today > due ? { state: 'delayed', gap: 1 } : { state: 'normal', gap: 0 };
  }

  const expected = Math.max(0, Math.min(1, elapsedMs / totalMs));
  const actual = STATUS_PROGRESS[task.status] ?? 0;
  const gap = expected - actual;

  if (today > due && task.status !== '完了') return { state: 'delayed', gap };
  if (gap >= 0.4) return { state: 'delayed', gap };
  if (gap >= 0.2) return { state: 'warning', gap };
  return { state: 'normal', gap };
}

function isTodayTask(task) {
  if (task.status === '完了') return false;
  const due = parseDate(task.due_date);
  if (!due) return false;
  const today = todayMidnight();
  const diffDays = (due - today) / 86400000;
  return diffDays <= 1;
}

// ============================================================
// 進捗回復のアイデア (Phase 1: ルールベース)
// ============================================================
function getRecoveryIdeas(task) {
  const ideas = [];
  const { state, gap } = evaluateTask(task);

  if (state === 'normal' || state === 'done') return [];

  if (state === 'delayed') {
    ideas.push('期限を1〜2日伸ばせないか関係者と再交渉する');
    ideas.push('タスクを30分単位の最小作業に分解し、今日30分だけ着手する');
    ideas.push('スコープを必須要素に絞り、後回しできる部分を切り出す');
  }

  if (state === 'warning') {
    ideas.push('タスクを最小作業に分解し、まず1つ着手する');
    ideas.push('カレンダーに作業時間を予約してブロックする');
  }

  if (task.priority !== '高') {
    ideas.push('優先度を「高」に引き上げて視認性を上げる');
  }

  ideas.push('他の進行中タスクと優先順位を比較し、入れ替えを検討する');
  ideas.push('移動時間や待ち時間など、ながら時間に進められる部分を切り出す');

  return ideas.slice(0, 5);
}

// ============================================================
// バッジ表示
// ============================================================
function renderBadges() {
  let today = 0, warning = 0, delayed = 0;
  tasks.forEach(t => {
    if (isTodayTask(t)) today++;
    const { state } = evaluateTask(t);
    if (state === 'warning') warning++;
    if (state === 'delayed') delayed++;
  });
  document.getElementById('count-today').textContent = today;
  document.getElementById('count-warning').textContent = warning;
  document.getElementById('count-delayed').textContent = delayed;
}

// ============================================================
// カンバンビュー
// ============================================================

// D&D 状態管理
let dragSrcId = null;

function renderKanban() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';

  STATUSES.forEach(status => {
    const colTasks = tasks.filter(t => t.status === status);
    colTasks.sort((a, b) => {
      const da = parseDate(a.due_date)?.getTime() ?? Infinity;
      const db = parseDate(b.due_date)?.getTime() ?? Infinity;
      return da - db;
    });

    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.status = status;
    col.innerHTML = `
      <div class="col-header">
        <span class="col-title">${status}</span>
        <span class="col-count">${colTasks.length}</span>
      </div>
    `;

    // ドロップゾーンのイベント
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e) => {
      // 子要素への移動では外れないようにする
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const newStatus = col.dataset.status;
      if (dragSrcId && newStatus) {
        dropTask(dragSrcId, newStatus);
      }
    });

    colTasks.forEach(task => col.appendChild(renderCard(task)));
    board.appendChild(col);
  });
}

function renderCard(task) {
  const { state } = evaluateTask(task);
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;
  if (state === 'warning') card.classList.add('warning');
  if (state === 'delayed') card.classList.add('delayed');
  if (task.status === '完了') card.classList.add('done');

  const dueLabel = formatDueLabel(task, state);

  card.innerHTML = `
    <div class="drag-handle" title="ドラッグして移動" aria-hidden="true">⠿</div>
    <div class="task-title">${escapeHtml(task.title)}</div>
    <div class="task-meta">
      <span class="cat-tag cat-${task.category}">${task.category}</span>
      <span class="priority-mark priority-${task.priority}" title="優先度: ${task.priority}"></span>
      ${dueLabel ? `<span class="due-date ${state}">${dueLabel}</span>` : ''}
    </div>
  `;

  // ドラッグ開始: カードをつかんだ瞬間
  card.addEventListener('dragstart', (e) => {
    dragSrcId = task.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 対応: dataTransfer に何か入れないと動かない
    e.dataTransfer.setData('text/plain', task.id);
  });

  card.addEventListener('dragend', () => {
    dragSrcId = null;
    card.classList.remove('dragging');
    // 全列のハイライトを確実にクリア
    document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
  });

  // クリックとドラッグを区別: mousedown 座標と mouseup 座標のズレで判定
  let mouseDownX = 0, mouseDownY = 0;
  card.addEventListener('mousedown', (e) => {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  });
  card.addEventListener('click', (e) => {
    const dx = Math.abs(e.clientX - mouseDownX);
    const dy = Math.abs(e.clientY - mouseDownY);
    if (dx < 5 && dy < 5) openEditModal(task);
  });

  return card;
}

// ドロップ後の処理: 楽観的UI更新 → API保存
async function dropTask(id, newStatus) {
  const task = tasks.find(t => t.id === id);
  if (!task || task.status === newStatus) return;

  const oldStatus = task.status;

  // 楽観的更新: APIを待たずに即座に画面を更新
  task.status = newStatus;
  renderKanban();
  renderBadges();
  toast(`「${task.title}」→ ${newStatus}`);

  try {
    await api('update', { id, data: { status: newStatus } });
  } catch (err) {
    // 失敗したら元に戻す
    task.status = oldStatus;
    renderKanban();
    renderBadges();
    toast('更新失敗: ' + err.message);
  }
}

function formatDueLabel(task, state) {
  if (task.status === '完了') {
    return task.completed_at ? '完了' : '';
  }
  if (!task.due_date) return '';
  const due = parseDate(task.due_date);
  const today = todayMidnight();
  const diff = Math.round((due - today) / 86400000);

  const md = `${due.getMonth() + 1}/${due.getDate()}`;
  if (state === 'delayed' && diff < 0) return `${md} (${Math.abs(diff)}日超過)`;
  if (diff === 0) return `${md} 今日`;
  if (diff === 1) return `${md} 明日`;
  return md;
}

// ============================================================
// カレンダービュー
// ============================================================
function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  document.getElementById('cal-title').textContent = `${year}年 ${month + 1}月`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  DOW_LABELS.forEach((label, i) => {
    const cell = document.createElement('div');
    cell.className = 'cal-dow';
    if (i === 0) cell.classList.add('sun');
    if (i === 6) cell.classList.add('sat');
    cell.textContent = label;
    grid.appendChild(cell);
  });

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const startDate = new Date(year, month, 1 - startOffset);
  const today = todayMidnight();

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (d.getMonth() !== month) cell.classList.add('other-month');
    if (d.getTime() === today.getTime()) cell.classList.add('today');

    cell.innerHTML = `<div class="cal-date">${d.getDate()}</div>`;

    const dayTasks = tasks.filter(t => {
      const due = parseDate(t.due_date);
      return due && due.getTime() === d.getTime();
    });

    dayTasks.slice(0, 3).forEach(task => {
      const { state } = evaluateTask(task);
      const pill = document.createElement('div');
      pill.className = `cal-task cat-${task.category}`;
      pill.textContent = task.title;
      if (state === 'delayed') pill.style.boxShadow = `inset 0 0 0 1px var(--danger)`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(task);
      });
      cell.appendChild(pill);
    });

    if (dayTasks.length > 3) {
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${dayTasks.length - 3}`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => {
      openNewModalWithDate(d);
    });

    grid.appendChild(cell);
  }
}

// ============================================================
// モーダル
// ============================================================
function openNewModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '新規タスク';
  document.getElementById('f-title').value = '';
  document.getElementById('f-category').value = '仕事';
  document.getElementById('f-priority').value = '中';
  document.getElementById('f-start').value = todayISO();
  document.getElementById('f-due').value = '';
  document.getElementById('f-hours').value = '';
  document.getElementById('f-status').value = '未着手';
  document.getElementById('f-memo').value = '';
  document.getElementById('btn-delete').style.display = 'none';
  document.getElementById('recovery-box').style.display = 'none';
  showModal();
}

function openNewModalWithDate(d) {
  openNewModal();
  document.getElementById('f-due').value = toISODate(d);
}

function openEditModal(task) {
  editingId = task.id;
  document.getElementById('modal-title').textContent = 'タスクを編集';
  document.getElementById('f-title').value = task.title || '';
  document.getElementById('f-category').value = task.category || '個人';
  document.getElementById('f-priority').value = task.priority || '中';
  document.getElementById('f-start').value = task.start_date || '';
  document.getElementById('f-due').value = task.due_date || '';
  document.getElementById('f-hours').value = task.estimated_hours || '';
  document.getElementById('f-status').value = task.status || '未着手';
  document.getElementById('f-memo').value = task.memo || '';
  document.getElementById('btn-delete').style.display = 'inline-block';

  const ideas = getRecoveryIdeas(task);
  const box = document.getElementById('recovery-box');
  if (ideas.length > 0) {
    const list = document.getElementById('recovery-list');
    list.innerHTML = ideas.map(i => `<li>${escapeHtml(i)}</li>`).join('');
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }

  showModal();
}

function showModal() {
  document.getElementById('modal-overlay').classList.add('active');
  setTimeout(() => document.getElementById('f-title').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  editingId = null;
}

async function saveTask() {
  const data = {
    title: document.getElementById('f-title').value.trim(),
    category: document.getElementById('f-category').value,
    priority: document.getElementById('f-priority').value,
    start_date: document.getElementById('f-start').value,
    due_date: document.getElementById('f-due').value,
    estimated_hours: document.getElementById('f-hours').value,
    memo: document.getElementById('f-memo').value,
    status: document.getElementById('f-status').value
  };

  if (!data.title) {
    toast('タイトルを入力してください');
    return;
  }

  try {
    if (editingId) {
      await api('update', { id: editingId, data });
      toast('更新しました');
    } else {
      await api('create', { data });
      toast('作成しました');
    }
    closeModal();
    await fetchTasks();
  } catch (err) {
    toast('エラー: ' + err.message);
  }
}

async function deleteCurrent() {
  if (!editingId) return;
  if (!confirm('このタスクを削除します。よろしいですか?')) return;

  try {
    await api('delete', { id: editingId });
    toast('削除しました');
    closeModal();
    await fetchTasks();
  } catch (err) {
    toast('エラー: ' + err.message);
  }
}

// ============================================================
// ユーティリティ
// ============================================================
function todayISO() {
  return toISODate(new Date());
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ============================================================
// レンダリング統合
// ============================================================
function render() {
  renderBadges();
  if (currentView === 'kanban') renderKanban();
  else renderCalendar();
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('view-kanban').classList.toggle('active', view === 'kanban');
  document.getElementById('view-calendar').classList.toggle('active', view === 'calendar');
  render();
}

// ============================================================
// イベント
// ============================================================
function init() {
  if (API_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    toast('app.js の API_URL を設定してください');
    return;
  }

  document.querySelectorAll('.view-btn').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  document.getElementById('btn-new').addEventListener('click', openNewModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', saveTask);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrent);

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      openNewModal();
    }
  });

  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    calendarMonth = new Date();
    calendarMonth.setDate(1);
    renderCalendar();
  });

  fetchTasks().catch(err => toast('読込エラー: ' + err.message));
}

init();
