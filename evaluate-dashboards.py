#!/usr/bin/env python3
"""Playwright evaluation script for dashboard comparison."""

import asyncio
from playwright.async_api import async_playwright
from pathlib import Path

async def evaluate_dashboards():
    dashboards = {
        "k2p5": "file:///workspace/token-burn-dashboard-model-faceoff/k2p5/index.html",
        "gemini-3.1-pro": "file:///workspace/token-burn-dashboard-model-faceoff/gemini-3.1-pro/index.html",
        "gpt-5.2-codex": "file:///workspace/token-burn-dashboard-model-faceoff/gpt-5.2-codex/index.html"
    }
    
    results = {}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        
        for name, url in dashboards.items():
            print(f"\n{'='*60}")
            print(f"Evaluating: {name}")
            print('='*60)
            
            page = await browser.new_page(viewport={'width': 1440, 'height': 900})
            
            # Capture console logs
            logs = []
            page.on("console", lambda msg: logs.append(f"{msg.type}: {msg.text}"))
            
            # Navigate and wait for load
            try:
                await page.goto(url, wait_until='networkidle', timeout=30000)
                await asyncio.sleep(2)  # Let animations settle
                
                # Take screenshot
                screenshot_path = f"/workspace/token-burn-dashboard-model-faceoff/{name}-screenshot.png"
                await page.screenshot(path=screenshot_path, full_page=True)
                print(f"✓ Screenshot saved: {screenshot_path}")
                
                # Evaluate metrics
                metrics = await page.evaluate('''() => ({
                    title: document.title,
                    viewport: {
                        width: window.innerWidth,
                        height: document.body.scrollHeight
                    },
                    elementCount: document.querySelectorAll('*').length,
                    hasCharts: !!document.querySelector('canvas') || !!document.querySelector('svg'),
                    hasInteractiveElements: document.querySelectorAll('button, select, input').length,
                    consoleErrors: window.errors || [],
                    loadTime: performance.now()
                })''')
                
                results[name] = {
                    'metrics': metrics,
                    'logs': logs,
                    'screenshot': screenshot_path
                }
                
                print(f"  Title: {metrics['title']}")
                print(f"  Elements: {metrics['elementCount']}")
                print(f"  Charts: {metrics['hasCharts']}")
                print(f"  Interactive elements: {metrics['hasInteractiveElements']}")
                print(f"  Console logs: {len(logs)}")
                
                if logs:
                    print("  Console output:")
                    for log in logs[:5]:
                        print(f"    - {log}")
                
            except Exception as e:
                print(f"✗ Error: {e}")
                results[name] = {'error': str(e)}
            finally:
                await page.close()
        
        await browser.close()
    
    # Summary comparison
    print("\n" + "="*60)
    print("COMPARISON SUMMARY")
    print("="*60)
    
    for name, data in results.items():
        if 'metrics' in data:
            m = data['metrics']
            print(f"\n{name}:")
            print(f"  • Elements: {m['elementCount']} (complexity)")
            print(f"  • Charts: {'Yes' if m['hasCharts'] else 'No'}")
            print(f"  • Interactive: {m['hasInteractiveElements']} elements")
            print(f"  • Console issues: {len([l for l in data['logs'] if 'error' in l.lower()])}")
    
    return results

if __name__ == "__main__":
    asyncio.run(evaluate_dashboards())
