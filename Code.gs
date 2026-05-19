/**
 * Personal Task Manager - Google Apps Script Backend
 *
 * セットアップ手順:
 * 1. このコードを Google Apps Script のエディタに貼り付ける
 * 2. スプレッドシートに紐付け、initSheet() を1回だけ実行してヘッダー行を作成
 * 3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    - 実行ユーザー: 自分
 *    - アクセス権限: 全員
 * 4. 発行された URL を app.js の API_URL に貼り付け
 */

const SHEET_NAME = 'Tasks';
const TIMEZONE = 'Asia/Tokyo';

const HEADERS = [
  'id', 'title', 'category', 'priority',
  'start_date', 'due_date', 'estimated_hours',
  'memo', 'status',
  'created_at', 'updated_at', 'completed_at'
];

/**
 * 初回セットアップ用 - 一度だけ手動実行
 */
function initSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * メインの POST ハンドラ
 * フロントは text/plain で JSON 文字列を送る (CORS preflight 回避)
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result;

    switch (action) {
      case 'list':
        result = listTasks();
        break;
      case 'create':
        result = createTask(params.data);
        break;
      case 'update':
        result = updateTask(params.id, params.data);
        break;
      case 'delete':
        result = deleteTask(params.id);
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

/**
 * 動作確認用の GET ハンドラ (ブラウザで直接 URL を開いたとき)
 */
function doGet() {
  return jsonResponse({
    ok: true,
    message: 'Task Manager API is running. Use POST requests.'
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet not found. Run initSheet() first.');
  }
  return sheet;
}

function formatDate(d) {
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function formatDateOnly(d) {
  if (!d) return '';
  if (d instanceof Date) {
    return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  }
  return String(d);
}

function rowToTask(row) {
  const task = {};
  HEADERS.forEach((h, i) => {
    let v = row[i];
    if (v instanceof Date) {
      if (h === 'start_date' || h === 'due_date') {
        v = formatDateOnly(v);
      } else {
        v = formatDate(v);
      }
    }
    task[h] = v;
  });
  return task;
}

function listTasks() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const tasks = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    tasks.push(rowToTask(data[i]));
  }
  return tasks;
}

function generateId() {
  return 't_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

function createTask(data) {
  const sheet = getSheet();
  const now = new Date();
  const nowStr = formatDate(now);
  const id = generateId();

  const row = [
    id,
    data.title || '',
    data.category || '個人',
    data.priority || '中',
    data.start_date || '',
    data.due_date || '',
    data.estimated_hours || '',
    data.memo || '',
    data.status || '未着手',
    nowStr,
    nowStr,
    data.status === '完了' ? nowStr : ''
  ];

  sheet.appendRow(row);
  return { id: id };
}

function updateTask(id, data) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const now = formatDate(new Date());

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] !== id) continue;
    const rowIdx = i + 1;

    const fieldMap = {
      title: 2, category: 3, priority: 4,
      start_date: 5, due_date: 6, estimated_hours: 7,
      memo: 8, status: 9
    };

    Object.keys(fieldMap).forEach(key => {
      if (data[key] !== undefined) {
        sheet.getRange(rowIdx, fieldMap[key]).setValue(data[key]);
      }
    });

    if (data.status === '完了' && !values[i][11]) {
      sheet.getRange(rowIdx, 12).setValue(now);
    } else if (data.status && data.status !== '完了') {
      sheet.getRange(rowIdx, 12).setValue('');
    }

    sheet.getRange(rowIdx, 11).setValue(now);
    return { id: id };
  }
  throw new Error('Task not found: ' + id);
}

function deleteTask(id) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { id: id };
    }
  }
  throw new Error('Task not found: ' + id);
}
