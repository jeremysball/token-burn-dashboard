/**
 * @jest-environment jsdom
 */

import {
  fmtNum,
  fmtInt,
  fmtCur,
  fmtDate,
  fmtMultiple,
  createSparkline,
  notify,
  setText,
  hide,
  show,
  getPlotlyLayout,
  splitModelKey,
  displayModel,
  parseModelKey,
  getPricingForModel,
  formatModelPrice,
  escapeHtml,
  resizeVisiblePlots,
  positionNotifications
} from '../../dashboard/js/utils.js';

describe('Utils Module', () => {
  describe('fmtNum', () => {
    it('formats millions with M suffix', () => {
      expect(fmtNum(1_500_000)).toBe('1.50M');
      expect(fmtNum(1_000_000)).toBe('1.00M');
    });

    it('formats thousands with k suffix', () => {
      expect(fmtNum(1_500)).toBe('1.5k');
      expect(fmtNum(1_000)).toBe('1.0k');
    });

    it('returns whole numbers for values under 1000', () => {
      expect(fmtNum(500)).toBe('500');
      expect(fmtNum(0)).toBe('0');
    });
  });

  describe('fmtCur', () => {
    it('formats large amounts with 2 decimals', () => {
      expect(fmtCur(100)).toBe('$100.00');
      expect(fmtCur(1)).toBe('$1.00');
    });

    it('formats medium amounts with 3 decimals', () => {
      expect(fmtCur(0.5)).toBe('$0.500');
      expect(fmtCur(0.01)).toBe('$0.010');
    });

    it('formats small amounts with 4 decimals', () => {
      expect(fmtCur(0.009)).toBe('$0.0090');
      expect(fmtCur(0.001)).toBe('$0.0010');
    });
  });

  describe('fmtDate', () => {
    it('formats dates consistently', () => {
      const date = new Date('2024-03-15');
      const result = fmtDate(date);
      expect(result).toMatch(/Mar/);
      expect(result).toMatch(/15/);
    });
  });

  describe('createSparkline', () => {
    it('returns empty string for insufficient data', () => {
      expect(createSparkline([1])).toBe('');
      expect(createSparkline([])).toBe('');
      expect(createSparkline(null)).toBe('');
    });

    it('generates SVG with correct dimensions', () => {
      const svg = createSparkline([1, 2, 3, 4, 5], 100, 30);
      expect(svg).toContain('width="100"');
      expect(svg).toContain('height="30"');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('includes polyline for data points', () => {
      const svg = createSparkline([1, 2, 3], 100, 30);
      expect(svg).toContain('<polyline');
    });

    it('includes gradient definition', () => {
      const svg = createSparkline([1, 2, 3], 100, 30);
      expect(svg).toContain('<linearGradient');
    });
  });

  describe('notify', () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="notifications"></div>';
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('creates notification element', () => {
      notify('Test message');
      const notif = document.querySelector('.notification');
      expect(notif).toBeTruthy();
      expect(notif.textContent).toBe('Test message');
    });

    it('adds type class', () => {
      notify('Error message', 'error');
      const notif = document.querySelector('.notification');
      expect(notif.classList.contains('error')).toBe(true);
    });

    it('removes notification after timeout', () => {
      notify('Test message');
      jest.advanceTimersByTime(3300);
      const notif = document.querySelector('.notification');
      expect(notif).toBeFalsy();
    });

    it('handles missing container gracefully', () => {
      document.body.innerHTML = '';
      expect(() => notify('Test')).not.toThrow();
    });
  });

  describe('setText', () => {
    it('sets text content on element', () => {
      document.body.innerHTML = '<div id="test"></div>';
      const el = document.getElementById('test');
      setText(el, 'Hello');
      expect(el.textContent).toBe('Hello');
    });

    it('handles null element gracefully', () => {
      expect(() => setText(null, 'Hello')).not.toThrow();
    });
  });

  describe('hide/show', () => {
    it('hides element by setting display to none', () => {
      document.body.innerHTML = '<div id="test"></div>';
      const el = document.getElementById('test');
      hide(el);
      expect(el.style.display).toBe('none');
    });

    it('shows element with specified display', () => {
      document.body.innerHTML = '<div id="test" style="display: none;"></div>';
      const el = document.getElementById('test');
      show(el, 'flex');
      expect(el.style.display).toBe('flex');
    });

    it('handles null element gracefully', () => {
      expect(() => hide(null)).not.toThrow();
      expect(() => show(null)).not.toThrow();
    });
  });

  describe('getPlotlyLayout', () => {
    it('returns base layout structure', () => {
      const layout = getPlotlyLayout();
      expect(layout.paper_bgcolor).toBeDefined();
      expect(layout.plot_bgcolor).toBeDefined();
      expect(layout.font).toBeDefined();
      expect(layout.margin).toBeDefined();
    });

    it('merges extra properties', () => {
      const layout = getPlotlyLayout({ title: 'Test Title' });
      expect(layout.title).toBe('Test Title');
    });

    it('adapts to dark theme by default', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      const layout = getPlotlyLayout();
      expect(layout.paper_bgcolor).toBe('#141414');
    });

    it('adapts to light theme', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      const layout = getPlotlyLayout();
      expect(layout.paper_bgcolor).toBe('#ffffff');
    });
  });

  // ===== NEW TASK 1 TESTS =====
  describe('fmtNum billions (B)', () => {
    it('formats billions with B suffix', () => {
      expect(fmtNum(17021653100)).toBe('17.02B');
      expect(fmtNum(1000000000)).toBe('1.00B');
    });
    it('still formats millions and thousands', () => {
      expect(fmtNum(1_500_000)).toBe('1.50M');
      expect(fmtNum(1500)).toBe('1.5k');
    });
  });

  describe('fmtMultiple comma grouping', () => {
    it('groups large multiples with comma', () => {
      expect(fmtMultiple(64827)).toBe('64,827×');
    });
    it('keeps decimal for small multiples under 10', () => {
      expect(fmtMultiple(9.5)).toBe('9.5×');
    });
    it('shows integer for 10 and above with grouping', () => {
      expect(fmtMultiple(10)).toBe('10×');
      expect(fmtMultiple(1234)).toBe('1,234×');
    });
  });

  describe('fmtInt', () => {
    it('formats with locale', () => {
      expect(fmtInt(1234567)).toBe((1234567).toLocaleString());
      expect(fmtInt(0)).toBe('0');
    });
  });

  describe('splitModelKey first-slash preserves vendor', () => {
    it('preserves vendor slash', () => {
      expect(splitModelKey('openrouter/tencent/hy3:free')).toEqual({ provider: 'openrouter', model: 'tencent/hy3:free' });
    });
    it('splits simple provider/model', () => {
      expect(splitModelKey('anthropic/claude-sonnet-5')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    });
    it('handles no provider', () => {
      expect(splitModelKey('gpt-4o')).toEqual({ provider: '', model: 'gpt-4o' });
    });
    it('handles empty', () => {
      expect(splitModelKey('')).toEqual({ provider: '', model: '' });
      expect(splitModelKey(null)).toEqual({ provider: '', model: '' });
    });
  });

  describe('displayModel returns full provider/model', () => {
    it('returns full key when provider present', () => {
      expect(displayModel('openrouter/tencent/hy3:free')).toBe('openrouter/tencent/hy3:free');
      expect(displayModel('anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');
    });
    it('returns model only when no provider', () => {
      expect(displayModel('gpt-4o')).toBe('gpt-4o');
    });
  });

  describe('parseModelKey canonical', () => {
    it('parses openrouter with vendor slash', () => {
      const r1 = parseModelKey('openrouter/tencent/hy3:free');
      expect(r1.routingProvider).toBe('openrouter');
      expect(r1.vendor).toBe('tencent');
      expect(r1.modelId).toBe('hy3:free');
      expect(r1.canonical).toBe('tencent/hy3:free');
      expect(r1.provider).toBe('openrouter');
      expect(r1.model).toBe('tencent/hy3:free');
      expect(r1.originalKey).toBe('openrouter/tencent/hy3:free');
    });
    it('parses vendor/model without router', () => {
      const r2 = parseModelKey('anthropic/claude-sonnet-5');
      expect(r2.routingProvider).toBeNull();
      expect(r2.vendor).toBe('anthropic');
      expect(r2.modelId).toBe('claude-sonnet-5');
      expect(r2.canonical).toBe('anthropic/claude-sonnet-5');
    });
    it('parses router without vendor', () => {
      const r3 = parseModelKey('openrouter/claude-3-haiku');
      expect(r3.routingProvider).toBe('openrouter');
      expect(r3.vendor).toBe('');
      expect(r3.canonical).toBe('claude-3-haiku');
      expect(r3.modelId).toBe('claude-3-haiku');
    });
    it('parses plain model', () => {
      const r4 = parseModelKey('gpt-4o');
      expect(r4.routingProvider).toBeNull();
      expect(r4.vendor).toBe('');
      expect(r4.modelId).toBe('gpt-4o');
      expect(r4.canonical).toBe('gpt-4o');
    });
    it('handles openpipe router too', () => {
      const r = parseModelKey('openpipe/my-model');
      expect(r.routingProvider).toBe('openpipe');
      expect(r.vendor).toBe('');
      expect(r.canonical).toBe('my-model');
    });
  });

  describe('createSparkline unified', () => {
    it('supports gradient option true', () => {
      const svg = createSparkline([1, 2, 3], 100, 30, { gradient: true });
      expect(svg).toContain('linearGradient');
      expect(svg).toContain('polygon');
    });
    it('supports gradient false gives simple polyline', () => {
      const svg = createSparkline([1, 2, 3], 100, 30, { gradient: false });
      expect(svg).toContain('<polyline');
    });
    it('default still works (backward compat)', () => {
      const svg = createSparkline([1, 2, 3], 100, 30);
      expect(svg).toContain('<svg');
    });
  });

  describe('getPricingForModel and formatModelPrice', () => {
    it('returns pricing from pricing_by_model map', () => {
      const map = { 'gpt-4o': { input: 2.5, output: 10 } };
      expect(getPricingForModel('gpt-4o', map)).toEqual({ input: 2.5, output: 10 });
    });
    it('returns null when not found and no fallback', () => {
      expect(getPricingForModel('unknown-model', {})).toBeNull();
    });
    it('formatModelPrice formats correctly', () => {
      expect(formatModelPrice({ input: 2.5, output: 10 })).toBe('2.50 in / 10.00 out');
      expect(formatModelPrice(null)).toBe('Price unavailable');
    });
  });

  describe('escapeHtml', () => {
    it('escapes html', () => {
      const result = escapeHtml('<script>alert("x")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });
    it('returns empty for falsy', () => {
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(null)).toBe('');
    });
    it('escapes double quotes so attribute payloads cannot break out', () => {
      const payload = 'x" onmouseover="alert(1)';
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain('"');
      expect(escaped).toContain('&quot;');
      document.body.innerHTML = `<div data-key="${escaped}"></div>`;
      const el = document.querySelector('div');
      expect(el.getAttribute('onmouseover')).toBeNull();
      expect(el.dataset.key).toContain('onmouseover');
    });
    it('escapes single quotes for attribute safety', () => {
      const payload = "x' onmouseover='alert(1)";
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain("'");
      expect(escaped).toContain('&#39;');
      document.body.innerHTML = `<div data-key="${escaped}"></div>`;
      const el = document.querySelector('div');
      expect(el.getAttribute('onmouseover')).toBeNull();
    });
  });

  describe('resizeVisiblePlots', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="dashboard-live-chart"></div>
        <div id="timeline-chart-container"></div>
        <div id="compare-chart-container"></div>
        <div id="calendar-container"></div>
        <div id="distribution-chart-container"></div>
      `;
      global.Plotly.Plots = { resize: jest.fn() };
    });

    it('resizes only containers that have already been plotted', () => {
      document.getElementById('dashboard-live-chart').data = [{}];
      document.getElementById('timeline-chart-container').data = [{}];

      resizeVisiblePlots();

      expect(global.Plotly.Plots.resize).toHaveBeenCalledTimes(2);
      expect(global.Plotly.Plots.resize).toHaveBeenCalledWith(document.getElementById('dashboard-live-chart'));
      expect(global.Plotly.Plots.resize).toHaveBeenCalledWith(document.getElementById('timeline-chart-container'));
    });

    it('does nothing for containers that were never plotted', () => {
      resizeVisiblePlots();
      expect(global.Plotly.Plots.resize).not.toHaveBeenCalled();
    });

    it('does nothing when Plotly is unavailable', () => {
      const original = global.Plotly;
      global.Plotly = undefined;
      expect(() => resizeVisiblePlots()).not.toThrow();
      global.Plotly = original;
    });
  });

  describe('positionNotifications', () => {
    it('positions the container below the header', () => {
      document.body.innerHTML = `
        <header class="dashboard-header"></header>
        <div class="notification-container" id="notifications"></div>
      `;
      const header = document.querySelector('.dashboard-header');
      header.getBoundingClientRect = () => ({ bottom: 88 });

      positionNotifications();

      const container = document.getElementById('notifications');
      expect(container.style.top).toBe('100px');
      expect(container.style.bottom).toBe('');
    });

    it('does nothing when the header or container is missing', () => {
      document.body.innerHTML = '';
      expect(() => positionNotifications()).not.toThrow();
    });
  });
});
