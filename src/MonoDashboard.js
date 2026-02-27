import { StatBlock } from './components/StatBlock.js';
import { DataTable } from './components/DataTable.js';
import { DetailPanel } from './components/DetailPanel.js';
import { formatNumber, formatPercent } from './utils/formatters.js';

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
