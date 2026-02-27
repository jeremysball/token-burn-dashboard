import { formatNumber } from '../utils/formatters.js';
import { ProgressBar } from './ProgressBar.js';

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
