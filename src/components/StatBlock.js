import { formatNumber } from '../utils/formatters.js';

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
