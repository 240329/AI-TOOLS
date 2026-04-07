# AGENTS.md - AI Tools Repository

## Overview
- **Project**: FlowHub - HR onboarding flow + Feishu (Lark) bot push platform for Dreame Technology
- **Stack**: Node.js >= 16.0.0, Express, MySQL, node-schedule, @larksuiteoapi/node-sdk
- **Entry**: `server.js` (backend), HTML files (frontend)

## Commands
```bash
npm install   # Install dependencies
npm start    # Run server on port 3000
```

## Architecture
- **Backend**: Express server with Feishu bot API integration
- **Frontend**: Static HTML files with inline CSS/JS
- **Database**: MySQL database named `flowhub` must exist (credentials in config.js)

## Testing
No automated tests. Manual verification:
1. Open HTML files in browser
2. Check browser console for JS errors
3. Verify assets load correctly

## Agent Notes
- No linting/typechecking configured
- **Do not commit config.js** - contains API credentials (appId, appSecret) and database password
- Use 2 spaces for indentation
- Files: kebab-case (e.g., `FlowHub.html`), CSS classes: kebab-case, JS: camelCase
- Backups follow pattern `*.backup` (max 5 versions)

## Git Workflow
```
<type>: <description>
Types: feat, fix, update, docs, style
```