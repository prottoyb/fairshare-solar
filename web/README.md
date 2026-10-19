# FairShare Solar: web

The Vue 3 dashboard. See the [root README](../README.md) for setup, architecture and testing.

- `npm.cmd run dev -w web`: Vite on http://localhost:5173, proxying `/api` and `/socket.io` to the API on port 3000 (start both with `npm.cmd run dev` at the root)
- `npm.cmd run test:unit -w web`: Vitest component tests
- `npm.cmd run e2e`: Cypress smoke test (needs the dev servers running)
- Set `VUE_DEVTOOLS=1` before `npm.cmd run dev` to load the Vue DevTools overlay
