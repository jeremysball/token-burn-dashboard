

const normalizePricingSource = (source) => {
  const value = String(source || 'local').toLowerCase();
  if (value === 'openrouter') {
    return {
      source: 'openrouter',
      label: 'OpenRouter',
      title: 'Pricing sourced from OpenRouter'
    };
  }

  return {
    source: 'local',
    label: 'Local',
    title: 'Using local fallback pricing'
  };
};

export class DetailPanel {
  constructor({ title, rows, pricingSource }) {
    this.title = title || '—';
    this.rows = rows || [];
    this.pricingSource = normalizePricingSource(pricingSource);
  }

  render() {
    const el = document.createElement('aside');
    el.className = 'mono-detail';

    const header = document.createElement('div');
    header.className = 'mono-detail__header';

    const label = document.createElement('div');
    label.className = 'mono-detail__label';
    label.textContent = 'selected model';

    const titleRow = document.createElement('div');
    titleRow.className = 'mono-detail__title-row';

    const title = document.createElement('div');
    title.className = 'mono-detail__title';
    title.id = 'detail-title';
    title.textContent = this.title;

    this.sourceBadge = document.createElement('span');
    this.sourceBadge.className = `pricing-source-badge ${this.pricingSource.source}`;
    this.sourceBadge.textContent = this.pricingSource.label;
    this.sourceBadge.title = this.pricingSource.title;

    titleRow.appendChild(title);
    titleRow.appendChild(this.sourceBadge);

    header.appendChild(label);
    header.appendChild(titleRow);
    el.appendChild(header);

    this.rowsContainer = document.createElement('div');
    this.updateRows(this.rows);
    el.appendChild(this.rowsContainer);

    return el;
  }

  update(title, rows, { pricingSource } = {}) {
    this.title = title;
    this.rows = rows;

    if (pricingSource !== undefined) {
      this.pricingSource = normalizePricingSource(pricingSource);
    }

    const titleEl = document.querySelector('#detail-title');
    if (titleEl) {
      titleEl.textContent = title;
    }

    if (this.sourceBadge) {
      this.sourceBadge.className = `pricing-source-badge ${this.pricingSource.source}`;
      this.sourceBadge.textContent = this.pricingSource.label;
      this.sourceBadge.title = this.pricingSource.title;
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
