# PRD: Deep Code Cleanup and Bugfixes

## 1. Problem Statement
The token burn dashboard is an excellent showcase but initially behaved as a half-baked demo. It suffered from runtime data processing errors (especially dealing with missing properties on historical data arrays), layout edge cases on mobile, and an API/SSE coupling that left lingering connections or timed out ungracefully. This resulted in brittle testing and unreliable dashboard rendering when consuming real session files.

## 2. Solution Overview
Conduct a comprehensive, deep-level cleanup and stabilization effort. The focus is to make the dashboard resilient to partial historical data, fix the Playwright mobile test suite to correctly mock endpoints, and ensure proper server connection lifecycles (timeout/keepalive handling on SSE). 

## 3. Milestones & Implementation Plan

### [x] Milestone 1: Stabilize Core Data Pipelines
- Identify and patch data null-pointer exceptions in `dashboard/index.html`.
- Safely extract model statistics during array mapping for both sparklines and model trend charts.
- Fix historical mapping issues when `tokens_by_model` object does not include specific model keys.

### [x] Milestone 2: Resolve Mobile & Desktop Test Suite
- Integrate `@playwright/test` correctly.
- Establish robust mock API responses for `/api/tokens`, `/api/tokens/stream`, and importantly `/api/tokens/historical`.
- Resolve failing visual verification tests for donut charts and sparklines by ensuring proper element rendering and timeouts.
- All 18 tests passing securely.

### [x] Milestone 3: Server Timeout and SSE Reconnection Lifecycle
- Add Keep-Alive and periodic update intervals (30s and 5s respectively) to `/api/tokens/stream`.
- Add overall request timeouts for standard API endpoints to prevent 504 gateway hangs.
- Enable automatic connection recycling for EventSource on the client.

### [ ] Milestone 4: Code Organization & Final Cleanup
- Remove residual debugging output.
- Clean up unused or temporary mock JSONs.
- Prepare `index.html` structure for future componentization if needed.

## 4. Success Criteria
- 100% of Playwright tests passing reliably on local/CI environments.
- Dashboard gracefully handles real `.pi/agent/sessions` logs without JavaScript console errors.
- Visuals (Sparklines, Compare View, History Line Graph) consistently draw using the provided data structure.
