# Mono Dashboard

A minimal, monospace analytics dashboard framework inspired by MonkeyType's utilitarian aesthetic.

## Features

- **Zero dependencies**: Pure HTML/CSS/JS, no external libraries
- **Monospace everywhere**: JetBrains Mono font throughout
- **Single accent**: One color draws attention (MonkeyType yellow)
- **No AI aesthetic**: No gradients, shadows, or decorative elements
- **Accessible**: WCAG 2.1 AA compliant, keyboard navigable
- **Responsive**: Works on mobile, tablet, and desktop

## Quick Start

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="mono-dashboard.css">
</head>
<body>
    <div id="dashboard"></div>

    <script type="module">
        import { MonoDashboard } from './mono-dashboard.js';

        const dashboard = new MonoDashboard({
            title: 'my_dashboard',
            subtitle: 'data overview',
            stats: [
                { label: 'total', value: 1000000, accent: true },
                { label: 'items', value: 42 }
            ],
            data: [
                { name: "item-a", total: 500000, input: 300000, output: 200000 },
                { name: "item-b", total: 300000, input: 150000, output: 150000 },
                { name: "item-c", total: 200000, input: 100000, output: 100000 }
            ],
            container: '#dashboard'
        });

        dashboard.render();
    </script>
</body>
</html>
```

## API

### MonoDashboard

```javascript
const dashboard = new MonoDashboard({
    title: String,           // Dashboard title
    subtitle: String,        // Subtitle text
    stats: Array,            // Array of stat objects
    data: Array,             // Array of data items
    container: String|Element // CSS selector or DOM element
});

dashboard.render();
```

### Stat Object

```javascript
{
    label: String,   // Label text (displayed uppercase)
    value: Number,   // Numeric value
    accent: Boolean  // Highlight with accent color
}
```

### Data Item

```javascript
{
    name: String,   // Display name
    total: Number,  // Primary value (used for sorting/progress)
    input: Number,  // Optional: shown in detail panel
    output: Number, // Optional: shown in detail panel
    cache: Number   // Optional: shown in detail panel
}
```

## Components

### StatBlock

Displays a single KPI with label and value.

### DataTable

Sortable, selectable table with progress bars.

### DetailPanel

Shows detailed breakdown of selected item.

### ProgressBar

Simple horizontal progress indicator.

## Theming

Customize colors with CSS variables:

```css
:root {
    --mono-bg: #111111;
    --mono-surface: #1a1a1a;
    --mono-surface-hover: #222222;
    --mono-border: #333333;
    --mono-text: #d1d1d1;
    --mono-text-muted: #666666;
    --mono-accent: #e2b714;  /* MonkeyType yellow */
}
```

## Examples

See `/examples/` directory for:

- `token-burn/` - AI token usage analytics
- `sales-metrics/` - Sales data dashboard
- `system-health/` - Server monitoring

## Development

```bash
# Install dependencies
npm install

# Build distribution files
npm run build

# Start development server
npm run dev
```

## Design Principles

1. **Content over chrome**: No decorative elements
2. **Single accent**: One color draws attention
3. **Borders over shadows**: 1px solid lines define structure
4. **Monospace everywhere**: Consistent typography
5. **Whitespace is structure**: Generous padding creates hierarchy
6. **Subtle interactions**: Color changes, not transforms

## License

MIT
