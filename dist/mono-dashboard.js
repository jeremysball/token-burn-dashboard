// Mono Dashboard v0.1.0
// Bundled: 2026-02-27T04:26:15.328Z

// --- utils/formatters.js ---
export function formatNumber(num) {
  if (num === 0) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

export function formatPercent(value, total) {
  if (total === 0) return '0.00%';
  return ((value / total) * 100).toFixed(2) + '%';
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
  return Math.floor(ms / 3600000) + 'h';
}


// --- utils/dom.js ---
export function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createElementFromHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
}

export function clearElement(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export function onClick(el, handler) {
  el.addEventListener('click', handler);
  return () => el.removeEventListener('click', handler);
}


// --- components/StatBlock.js ---

export class StatBlock {
  constructor({ label, value, accent = false }) {
    this.label = label;
    this.value = value;
    this.accent = accent;
  }

  render() {
    const el = document.createElement('div');
    el.className = 'mono-stat';
    
    const labelEl = document.createElement('div');
    labelEl.className = 'mono-stat__label';
    labelEl.textContent = this.label;
    
    const valueEl = document.createElement('div');
    valueEl.className = `mono-stat__value${this.accent ? ' mono-stat__value--accent' : ''}`;
    valueEl.textContent = typeof this.value === 'number' ? formatNumber(this.value) : this.value;
    
    el.appendChild(labelEl);
    el.appendChild(valueEl);
    
    return el;
  }
}


// --- components/ProgressBar.js ---
export class ProgressBar {
  constructor({ value, max = 100 }) {
    this.value = value;
    this.max = max;
  }

  render() {
    const percentage = Math.min(100, Math.max(0, (this.value / this.max) * 100));
    
    const el = document.createElement('div');
    el.className = 'mono-progress';
    
    const fill = document.createElement('div');
    fill.className = 'mono-progress__fill';
    fill.style.width = `${percentage}%`;
    
    el.appendChild(fill);
    
    return el;
  }
}


// --- components/DataTable.js ---

export class DataTable {
  constructor({ columns, data, onSelect, maxValue }) {
    this.columns = columns;
    this.data = data;
    this.onSelect = onSelect;
    this.maxValue = maxValue || Math.max(...data.map(d => d.total || 0));
    this.selected = null;
    this.sortKey = null;
    this.sortAsc = false;
  }

  render() {
    const wrap = document.createElement('div');
    wrap.className = 'mono-table-wrap';

    const table = document.createElement('table');
    table.className = 'mono-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    this.columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.key === 'progress') {
        th.className = 'mono-table__cell--progress';
      }
      if (col.sortable) {
        th.addEventListener('click', () => this.sort(col.key));
      }
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    this.tbody = document.createElement('tbody');
    this.renderRows();
    table.appendChild(this.tbody);

    wrap.appendChild(table);
    return wrap;
  }

  renderRows() {
    this.tbody.innerHTML = '';
    
    const sorted = this.getSortedData();
    
    sorted.forEach(row => {
      const tr = document.createElement('tr');
      if (this.selected?.name === row.name) {
        tr.className = 'mono-active';
      }
      
      this.columns.forEach(col => {
        const td = document.createElement('td');
        
        if (col.key === 'name') {
          td.className = 'mono-table__cell--name';
          td.textContent = row.name;
        } else if (col.key === 'progress') {
          td.className = 'mono-table__cell--progress';
          const progress = new ProgressBar({ value: row.total, max: this.maxValue });
          td.appendChild(progress.render());
        } else if (col.key === 'total') {
          td.textContent = formatNumber(row[col.key]);
        } else {
          td.textContent = row[col.key] || '';
        }
        
        tr.appendChild(td);
      });
      
      tr.addEventListener('click', () => this.select(row));
      this.tbody.appendChild(tr);
    });
  }

  getSortedData() {
    if (!this.sortKey) return this.data;
    
    return [...this.data].sort((a, b) => {
      const valA = a[this.sortKey];
      const valB = b[this.sortKey];
      
      if (typeof valA === 'string') {
        return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      
      return this.sortAsc ? valA - valB : valB - valA;
    });
  }

  sort(key) {
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = key === 'name';
    }
    this.renderRows();
  }

  select(row) {
    this.selected = row;
    this.renderRows();
    if (this.onSelect) {
      this.onSelect(row);
    }
  }
}


// --- components/DetailPanel.js ---

export class DetailPanel {
  constructor({ title, rows }) {
    this.title = title || '—';
    this.rows = rows || [];
  }

  render() {
    const el = document.createElement('aside');
    el.className = 'mono-detail';

    const header = document.createElement('div');
    header.className = 'mono-detail__header';

    const label = document.createElement('div');
    label.className = 'mono-detail__label';
    label.textContent = 'selected model';

    const title = document.createElement('div');
    title.className = 'mono-detail__title';
    title.id = 'detail-title';
    title.textContent = this.title;

    header.appendChild(label);
    header.appendChild(title);
    el.appendChild(header);

    this.rowsContainer = document.createElement('div');
    this.updateRows(this.rows);
    el.appendChild(this.rowsContainer);

    return el;
  }

  update(title, rows) {
    this.title = title;
    this.rows = rows;

    const titleEl = document.querySelector('#detail-title');
    if (titleEl) {
      titleEl.textContent = title;
    }
    this.updateRows(rows);
  }

  updateRows(rows) {
    this.rowsContainer.innerHTML = '';

    if (rows.length === 0) {
      const row = document.createElement('div');
      row.className = 'mono-detail__row';
      const key = document.createElement('span');
      key.className = 'mono-detail__key';
      key.textContent = 'select a model';
      row.appendChild(key);
      this.rowsContainer.appendChild(row);
      return;
    }

    rows.forEach(({ key, value }) => {
      const row = document.createElement('div');
      row.className = 'mono-detail__row';

      const keyEl = document.createElement('span');
      keyEl.className = 'mono-detail__key';
      keyEl.textContent = key;

      const valueEl = document.createElement('span');
      valueEl.className = 'mono-detail__value';
      valueEl.textContent = value;

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      this.rowsContainer.appendChild(row);
    });
  }
}


// --- MonoDashboard.js ---

export class MonoDashboard {
  constructor({ title, subtitle, stats, data, container }) {
    this.title = title;
    this.subtitle = subtitle;
    this.stats = stats;
    this.data = data;
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    this.grandTotal = this.data.reduce((sum, d) => sum + (d.total || 0), 0);
    this.selected = this.data[0] || null;
    this.detailPanel = null;
  }

  render() {
    if (!this.container) {
      throw new Error('MonoDashboard: container not found');
    }

    this.container.className = 'mono-dashboard';
    this.container.innerHTML = '';

    this.renderHeader();
    this.renderStats();
    this.renderModelsSection();
    this.renderFooter();

    return this;
  }

  renderHeader() {
    const header = document.createElement('header');
    header.className = 'mono-section';

    const title = document.createElement('h1');
    title.className = 'mono-title';
    title.textContent = this.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'mono-subtitle';
    subtitle.textContent = this.subtitle;

    header.appendChild(title);
    header.appendChild(subtitle);
    this.container.appendChild(header);
  }

  renderStats() {
    const section = document.createElement('section');
    section.className = 'mono-section';

    const title = document.createElement('h2');
    title.className = 'mono-section-title';
    title.textContent = 'overview';

    const grid = document.createElement('div');
    grid.className = 'mono-grid mono-grid--stats';

    this.stats.forEach(stat => {
      const block = new StatBlock({
        label: stat.label,
        value: stat.value,
        accent: stat.accent
      });
      grid.appendChild(block.render());
    });

    section.appendChild(title);
    section.appendChild(grid);
    this.container.appendChild(section);
  }

  renderModelsSection() {
    const section = document.createElement('section');
    section.className = 'mono-section';

    const title = document.createElement('h2');
    title.className = 'mono-section-title';
    title.textContent = 'models';

    const grid = document.createElement('div');
    grid.className = 'mono-grid mono-grid--dashboard';

    // Table
    const table = new DataTable({
      columns: [
        { key: 'name', label: 'model', sortable: true },
        { key: 'progress', label: 'share' },
        { key: 'total', label: 'total', sortable: true }
      ],
      data: this.data,
      maxValue: this.grandTotal,
      onSelect: (row) => this.handleSelect(row)
    });

    grid.appendChild(table.render());

    // Detail panel
    this.detailPanel = new DetailPanel({
      title: this.selected?.name || '—',
      rows: this.getDetailRows(this.selected)
    });

    grid.appendChild(this.detailPanel.render());

    section.appendChild(title);
    section.appendChild(grid);
    this.container.appendChild(section);
  }

  renderFooter() {
    const footer = document.createElement('footer');
    footer.className = 'mono-footer';
    footer.textContent = `generated from mono_dashboard v0.1.0 // ${this.data.length} models`;
    this.container.appendChild(footer);
  }

  handleSelect(row) {
    this.selected = row;
    this.detailPanel.update(row.name, this.getDetailRows(row));
  }

  getDetailRows(row) {
    if (!row) return [];

    const share = formatPercent(row.total, this.grandTotal);
    const rows = [
      { key: 'share', value: share },
      { key: 'total', value: formatNumber(row.total) },
      { key: 'input', value: formatNumber(row.input) }
    ];

    if (row.output !== undefined) {
      rows.push({ key: 'output', value: formatNumber(row.output) });
    }
    if (row.cache !== undefined) {
      rows.push({ key: 'cache', value: formatNumber(row.cache) });
    }

    return rows;
  }
}


export { MonoDashboard };
