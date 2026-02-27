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
