# AGENTS.md - AI Tools Repository

## Overview
- **Project**: MI HUB - Multi-app AI tools platform for Dreame Technology
- **Stack**: Node.js >= 16.0.0, Express, MySQL, node-schedule, @larksuiteoapi/node-sdk, xlsx

## Commands
```bash
npm start       # Main hub (port 3000)
npm run flowhub # FlowHub (port 3001)
npm run vgen    # V-GEN Studio (port 3002)
npm run resume  # Resume AI (port 3003)
npm run visionary # Visionary AI (port 3004)
npm run start:all # Run all apps
```

## Architecture
- **Entry points**: Each app runs on its own port
  - Main hub: `server-main.js` (port 3000) -> serves `index.html`, proxies to sub-apps
  - FlowHub: `apps/flowhub/server.js` (port 3001)
  - V-GEN: `apps/vgen/server.js` (port 3002)
  - Resume AI: `apps/resume-ai/server.js` (port 3003)
  - Visionary: `apps/visionary/server.js` (port 3004)
- **Config**: `shared/config.js` (reads `.env`, no hardcoded secrets) -> app-specific `config.js` in each app (contains secrets)
- **Database**: MySQL database `flowhub` must exist; all tables use `flowhub_` prefix per app (e.g. `flowhub_employees`, `flowhub_scheduled_tasks`), auto-created on boot
- **FlowHub is the only layered app**: `server.js` (routes) + `src/models/data.js|task.js` (data + business) + `src/services/database.js|feishu.js` (external I/O) + `src/utils/validators.js`. Other apps are monolithic `server.js`

## Known Pitfalls
- `apps/flowhub/src/utils/logger.js` (winston) is **unused dead code** - do not depend on it
- `apps/flowhub/src/models/task.js` lines ~206-239 contain leftover `[DEBUG]` logs (employee deletion debugging) - can be removed
- FlowHub binds `0.0.0.0` with **no authentication** - LAN users can delete data and trigger Feishu pushes; do not expose to untrusted networks without auth
- Feishu cards send via employee `email` as receive_id; wiki URLs are hardcoded in `feishu.js` (near lines 185/193)
- Once-type tasks delete successfully-pushed employees from the roster automatically

## Important Notes
- **DO NOT commit**: `config.js` (contains appId/appSecret/DB passwords), `.env` (secrets)
- No linting/typechecking - verify manually
- 2 spaces indentation
- Naming: kebab-case for files/CSS, camelCase for JS

## Git Workflow
```
<type>: <description>
Types: feat, fix, update, docs, style
```

## Manual Verification
1. Open `http://localhost:3000`
2. Click tool cards to navigate to sub-apps
3. Check browser console for JS errors