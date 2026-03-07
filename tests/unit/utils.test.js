/**
 * @jest-environment jsdom
 */

import { fmtNum, fmtCur, fmtDate, createSparkline, notify, setText, hide, show, getPlotlyLayout } from '../../dashboard/js/utils.js';

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
      const notif = document.querySelector('.notif');
      expect(notif).toBeTruthy();
      expect(notif.textContent).toBe('Test message');
    });

    it('adds type class', () => {
      notify('Error message', 'error');
      const notif = document.querySelector('.notif');
      expect(notif.classList.contains('error')).toBe(true);
    });

    it('removes notification after timeout', () => {
      notify('Test message');
      jest.advanceTimersByTime(3300);
      const notif = document.querySelector('.notif');
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
});
