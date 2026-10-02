export function renderPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lines-db studio</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header class="top">
  <h1>lines-db studio</h1>
  <span class="dir" id="data-dir"></span>
</header>
<div class="layout">
  <nav class="sidebar">
    <h2>Tables</h2>
    <ul id="tables"></ul>
  </nav>
  <main class="main">
    <div class="toolbar">
      <h2 id="table-title">Select a table</h2>
      <input id="filter" type="search" placeholder="Filter rows" aria-label="Filter rows" disabled>
      <button id="add" type="button" disabled>Add row</button>
      <button id="reload" type="button">Reload</button>
    </div>
    <div id="problems" class="notice error" hidden></div>
    <div id="notice" class="notice" role="status" hidden></div>
    <div id="readonly" class="readonly" hidden></div>
    <div class="grid-wrap"><table id="grid" class="grid"></table></div>
  </main>
</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --panel: #f6f8fa;
  --accent: #0969da; --accent-fg: #ffffff; --danger: #cf222e; --danger-bg: #ffebe9;
  --warn-bg: #fff8c5; --ok-bg: #dafbe1; --edit-bg: #ddf4ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --panel: #161b22;
    --accent: #4493f8; --accent-fg: #0d1117; --danger: #f85149; --danger-bg: #3c1618;
    --warn-bg: #3b2e00; --ok-bg: #12351d; --edit-bg: #0c2d4d;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, sans-serif; }
.top { display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
.top h1 { font-size: 16px; margin: 0; }
.dir { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; }
.layout { display: flex; min-height: calc(100vh - 45px); }
.sidebar { width: 200px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 12px; }
.sidebar h2 { font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.sidebar ul { list-style: none; margin: 0; padding: 0; }
.sidebar button { width: 100%; text-align: left; border: 0; background: none; color: inherit; padding: 4px 8px; border-radius: 6px; cursor: pointer; font: inherit; }
.sidebar button:hover { background: var(--panel); }
.sidebar button[aria-current="true"] { background: var(--accent); color: var(--accent-fg); }
.main { flex: 1; min-width: 0; padding: 12px 16px; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.toolbar h2 { font-size: 16px; margin: 0 auto 0 0; }
button, input, select, textarea { font: inherit; color: inherit; }
button { border: 1px solid var(--line); background: var(--panel); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button.danger { color: var(--danger); }
input, select, textarea { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; }
textarea { font-family: ui-monospace, monospace; font-size: 12px; min-width: 240px; min-height: 60px; }
.notice { border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; white-space: pre-wrap; }
.notice.error { background: var(--danger-bg); color: var(--danger); }
.notice.ok { background: var(--ok-bg); }
.notice.info { background: var(--warn-bg); }
.notice ul { margin: 4px 0 0; padding-left: 20px; }
.readonly { background: var(--warn-bg); border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; }
.grid-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
.grid { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.grid th { position: sticky; top: 0; background: var(--panel); white-space: nowrap; }
.grid th .type { color: var(--muted); font-weight: normal; font-size: 11px; margin-left: 4px; }
.grid th .pk { color: var(--accent); font-size: 11px; margin-left: 4px; }
.grid td.cell { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; font-size: 12px; }
.grid td.cell.editable { cursor: text; }
.grid td.cell.editable:hover { background: var(--panel); }
.grid td.editing { background: var(--edit-bg); }
.grid td .null { color: var(--muted); font-style: italic; }
.grid td.defaulted { color: var(--muted); }
.grid td .badge { margin-left: 6px; padding: 0 5px; border: 1px solid var(--line); border-radius: 8px; font-size: 10px; font-family: system-ui, sans-serif; color: var(--muted); }
.grid tr.new td { background: var(--edit-bg); }
.grid td.actions { white-space: nowrap; width: 1%; }
.editor { display: flex; flex-direction: column; gap: 4px; }
.editor .row { display: flex; gap: 6px; align-items: center; }
.editor label { color: var(--muted); font-size: 12px; display: flex; gap: 4px; align-items: center; }
.empty { color: var(--muted); padding: 16px; }
`;

const SCRIPT = `
(function () {
  var state = { tables: [], current: null, rows: [], defaulted: new Map(), filter: '', editing: null, adding: false, deleteArmed: null };
  var el = function (id) { return document.getElementById(id); };

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), attrs[key]);
        else if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== false) node.setAttribute(key, attrs[key] === true ? '' : attrs[key]);
      });
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function api(method, path, body) {
    var init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (response) {
      return response.json().then(function (data) { return { status: response.status, data: data }; });
    });
  }

  function notify(kind, message, issues) {
    var notice = el('notice');
    notice.hidden = false;
    notice.className = 'notice ' + kind;
    var hasIssues = !!(issues && issues.length);
    notice.textContent = hasIssues ? message.split('\\n')[0] : message;
    if (hasIssues) {
      var list = h('ul');
      issues.forEach(function (issue) {
        var path = (issue.path || []).map(function (segment) {
          return typeof segment === 'object' && segment !== null ? String(segment.key) : String(segment);
        }).join('.');
        list.appendChild(h('li', { text: (path || 'row') + ': ' + issue.message }));
      });
      notice.appendChild(list);
    }
  }
  function clearNotice() { el('notice').hidden = true; }

  function renderProblems(problems) {
    var box = el('problems');
    box.hidden = !problems.length;
    box.textContent = 'These rows failed validation, so their tables are not shown. Fix them in the files and click Reload.';
    var list = h('ul');
    problems.forEach(function (problem) { list.appendChild(h('li', { text: problem })); });
    box.appendChild(list);
  }

  function currentTable() {
    for (var i = 0; i < state.tables.length; i++) if (state.tables[i].name === state.current) return state.tables[i];
    return null;
  }

  function loadTables() {
    return api('GET', '/api/tables').then(function (result) {
      if (result.status !== 200) { notify('error', result.data.message); return; }
      state.tables = result.data.tables;
      el('data-dir').textContent = result.data.dataDir || '';
      renderProblems(result.data.problems || []);
      if (!currentTable()) state.current = state.tables.length ? readHash() || state.tables[0].name : null;
      if (!currentTable() && state.tables.length) state.current = state.tables[0].name;
      renderTables();
      return loadRows();
    });
  }

  function readHash() {
    var name = decodeURIComponent(location.hash.slice(1));
    for (var i = 0; i < state.tables.length; i++) if (state.tables[i].name === name) return name;
    return null;
  }

  function loadRows() {
    var table = currentTable();
    if (!table) { render(); return; }
    return api('GET', '/api/tables/' + encodeURIComponent(table.name) + '/rows').then(function (result) {
      if (result.status !== 200) { notify('error', result.data.message); return; }
      state.rows = result.data.rows;
      state.defaulted = new Map();
      state.rows.forEach(function (row, index) { state.defaulted.set(row, (result.data.defaulted || [])[index] || []); });
      render();
    });
  }

  function selectTable(name) {
    state.current = name;
    state.editing = null;
    state.adding = false;
    state.filter = '';
    el('filter').value = '';
    location.hash = encodeURIComponent(name);
    clearNotice();
    renderTables();
    loadRows();
  }

  function renderTables() {
    var list = el('tables');
    list.textContent = '';
    state.tables.forEach(function (table) {
      list.appendChild(h('li', null, [h('button', {
        type: 'button', text: table.name, 'aria-current': table.name === state.current ? 'true' : 'false',
        onclick: function () { selectTable(table.name); }
      })]));
    });
  }

  function display(value) {
    if (value === null || value === undefined) return h('span', { class: 'null', text: 'null' });
    if (typeof value === 'object') return document.createTextNode(JSON.stringify(value));
    return document.createTextNode(String(value));
  }

  function rowKey(row) { return JSON.stringify(row[currentTable().primaryKey]); }

  function visibleRows() {
    if (!state.filter) return state.rows;
    var needle = state.filter.toLowerCase();
    return state.rows.filter(function (row) { return JSON.stringify(row).toLowerCase().indexOf(needle) !== -1; });
  }

  function render() {
    var table = currentTable();
    var grid = el('grid');
    grid.textContent = '';
    el('table-title').textContent = table ? table.name : 'No tables found';
    el('filter').disabled = !table;
    el('add').disabled = !table || !!table.readOnlyReason || state.adding;
    el('readonly').hidden = !(table && table.readOnlyReason);
    el('readonly').textContent = table && table.readOnlyReason ? 'Read-only: ' + table.readOnlyReason : '';
    if (!table) return;

    var writable = !table.readOnlyReason;
    var head = h('tr', null, table.columns.map(function (column) {
      return h('th', null, [
        document.createTextNode(column.name),
        h('span', { class: 'type', text: column.valueType === 'boolean' ? 'BOOLEAN' : column.type }),
        column.primaryKey ? h('span', { class: 'pk', text: 'PK' }) : null
      ]);
    }).concat(writable ? [h('th')] : []));
    grid.appendChild(h('thead', null, [head]));

    var body = h('tbody');
    if (state.adding) body.appendChild(renderNewRow(table));
    var rows = visibleRows();
    rows.forEach(function (row) { body.appendChild(renderRow(table, row, writable)); });
    if (!rows.length && !state.adding) {
      body.appendChild(h('tr', null, [h('td', { class: 'empty', colspan: String(table.columns.length + 1), text: state.rows.length ? 'No rows match the filter.' : 'This table has no rows.' })]));
    }
    grid.appendChild(body);
  }

  function renderRow(table, row, writable) {
    var key = rowKey(row);
    var cells = table.columns.map(function (column) {
      var editing = state.editing && state.editing.key === key && state.editing.column === column.name;
      if (editing) {
        var editor = createEditor(column, row[column.name]);
        return h('td', { class: 'editing' }, [h('div', { class: 'editor' }, [editor.node, h('div', { class: 'row' }, [
          h('button', { type: 'button', class: 'primary', text: 'Save', onclick: function () { saveCell(row, column, editor); } }),
          h('button', { type: 'button', text: 'Cancel', onclick: function () { state.editing = null; render(); } }),
          isDefaulted(row, column) ? null : h('button', {
            type: 'button', text: 'Use default', title: 'Remove the value from the file and leave it to the schema',
            onclick: function () { resetCell(row, column); }
          })
        ])])]);
      }
      var editable = writable && !column.primaryKey;
      var defaulted = isDefaulted(row, column);
      return h('td', {
        class: 'cell' + (editable ? ' editable' : '') + (defaulted ? ' defaulted' : ''),
        title: defaulted ? 'Filled in by the schema; not written in the file' : editable ? 'Click to edit' : undefined,
        onclick: editable ? function () { state.editing = { key: key, column: column.name }; render(); focusEditor(); } : undefined
      }, [display(row[column.name]), defaulted ? h('span', { class: 'badge', text: 'default' }) : null]);
    });
    if (writable) {
      var armed = state.deleteArmed === key;
      cells.push(h('td', { class: 'actions' }, [h('button', {
        type: 'button', class: 'danger', text: armed ? 'Click again to delete' : 'Delete',
        onclick: function () { if (armed) deleteRow(row); else armDelete(key); }
      })]));
    }
    return h('tr', null, cells);
  }

  function isDefaulted(row, column) {
    return (state.defaulted.get(row) || []).indexOf(column.name) !== -1;
  }

  function armDelete(key) {
    state.deleteArmed = key;
    render();
    setTimeout(function () { if (state.deleteArmed === key) { state.deleteArmed = null; render(); } }, 3000);
  }

  function renderNewRow(table) {
    var editors = {};
    var cells = table.columns.map(function (column) {
      var editor = createEditor(column, undefined);
      editors[column.name] = editor;
      return h('td', null, [h('div', { class: 'editor' }, [editor.node])]);
    });
    cells.push(h('td', { class: 'actions' }, [h('div', { class: 'editor' }, [
      h('button', { type: 'button', class: 'primary', text: 'Insert', onclick: function () { insertRow(table, editors); } }),
      h('button', { type: 'button', text: 'Cancel', onclick: function () { state.adding = false; render(); } })
    ])]));
    return h('tr', { class: 'new' }, cells);
  }

  function createEditor(column, value) {
    var isNew = value === undefined;
    var nullBox = h('input', { type: 'checkbox', 'aria-label': 'Set ' + column.name + ' to null' });
    nullBox.checked = value === null;
    var input;
    if (column.valueType === 'boolean') {
      input = h('select', { 'aria-label': column.name }, [h('option', { value: 'true', text: 'true' }), h('option', { value: 'false', text: 'false' })]);
      input.value = value === false ? 'false' : 'true';
    } else if (column.type === 'JSON') {
      input = h('textarea', { spellcheck: 'false', 'aria-label': column.name, placeholder: isNew ? 'default' : undefined });
      input.value = value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
    } else {
      input = h('input', { 'aria-label': column.name, placeholder: isNew ? 'default' : undefined, type: column.type === 'INTEGER' || column.type === 'REAL' ? 'number' : 'text', step: column.type === 'REAL' ? 'any' : undefined });
      input.value = value === undefined || value === null ? '' : String(value);
    }
    var touched = !isNew;
    input.addEventListener('input', function () { touched = true; nullBox.checked = false; });
    nullBox.addEventListener('change', function () { touched = true; });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { state.editing = null; render(); }
      if (event.key === 'Enter' && input.tagName !== 'TEXTAREA') {
        var save = input.closest('td').querySelector('button.primary');
        if (save) save.click();
      }
    });
    var node = h('div', { class: 'row' }, [input, h('label', null, [nullBox, document.createTextNode('null')])]);
    return {
      node: node,
      read: function () {
        if (nullBox.checked) return { value: null };
        if (isNew && !touched) return { omit: true };
        if (column.valueType === 'boolean') return { value: input.value === 'true' };
        if (column.type === 'JSON') {
          try { return { value: JSON.parse(input.value) }; }
          catch (error) { return { error: column.name + ': not valid JSON (' + error.message + ')' }; }
        }
        if (column.type === 'INTEGER' || column.type === 'REAL') {
          if (input.value.trim() === '') return { error: column.name + ': enter a number, or check null' };
          var number = Number(input.value);
          if (!isFinite(number)) return { error: column.name + ': not a number' };
          return { value: number };
        }
        return { value: input.value };
      }
    };
  }

  function focusEditor() {
    var field = document.querySelector('td.editing input:not([type=checkbox]), td.editing select, td.editing textarea');
    if (field) field.focus();
  }

  function handleWrite(result, successMessage) {
    if (result.status === 200 || result.status === 201) {
      notify('ok', successMessage);
      state.editing = null;
      state.adding = false;
      state.deleteArmed = null;
      return loadRows();
    }
    notify('error', result.data.message, result.data.issues);
    if (result.status === 409) return loadTables();
  }

  function rowPath(row) {
    return '/api/tables/' + encodeURIComponent(state.current) + '/rows/' + encodeURIComponent(rowKey(row));
  }

  function saveCell(row, column, editor) {
    var read = editor.read();
    if (read.error) { notify('error', read.error); return; }
    var changes = {};
    changes[column.name] = read.value;
    api('PATCH', rowPath(row), { changes: changes }).then(function (result) {
      handleWrite(result, 'Saved ' + column.name + ' of ' + currentTable().primaryKey + ' ' + rowKey(row) + '.');
    });
  }

  function resetCell(row, column) {
    api('PATCH', rowPath(row), { changes: {}, resetToDefault: [column.name] }).then(function (result) {
      handleWrite(result, 'Left ' + column.name + ' of ' + currentTable().primaryKey + ' ' + rowKey(row) + ' to its default.');
    });
  }

  function insertRow(table, editors) {
    var row = {};
    for (var i = 0; i < table.columns.length; i++) {
      var column = table.columns[i];
      var read = editors[column.name].read();
      if (read.error) { notify('error', read.error); return; }
      if (!read.omit) row[column.name] = read.value;
    }
    api('POST', '/api/tables/' + encodeURIComponent(table.name) + '/rows', { row: row }).then(function (result) {
      handleWrite(result, 'Inserted a row.');
    });
  }

  function deleteRow(row) {
    api('DELETE', rowPath(row)).then(function (result) {
      handleWrite(result, 'Deleted ' + currentTable().primaryKey + ' ' + rowKey(row) + '.');
    });
  }

  el('add').addEventListener('click', function () { state.adding = true; state.editing = null; render(); });
  el('reload').addEventListener('click', function () { clearNotice(); state.editing = null; state.adding = false; loadTables(); });
  el('filter').addEventListener('input', function (event) { state.filter = event.target.value; render(); });
  var events = new EventSource('/api/events');
  var connectedBefore = false;
  // Not only on 'changed': a change made while the stream was down sent no event
  events.addEventListener('open', function () {
    if (connectedBefore && !state.editing && !state.adding) loadTables();
    connectedBefore = true;
  });
  events.addEventListener('changed', function () {
    if (state.editing || state.adding) {
      notify('info', 'The files changed on disk. Click Reload to show the current rows; what you are typing is discarded.');
      return;
    }
    loadTables();
  });

  loadTables();
})();
`;
