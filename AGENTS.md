# AGENTS.md - AI Tools Repository

## Overview
This repository contains static HTML projects including portfolio sites, resume templates, and AI studio interfaces. No build system or test framework is configured.

## Project Structure
```
├── FlowHub.html          # FlowHub portfolio site
├── Resume AI.html        # AI resume template
├── V-GEN STUDIO.html    # V-GEN STUDIO portfolio
├── Visionary AI.html    # Visionary AI portfolio
├── index.html           # Main landing page
└── *.backup             # Backup files
```

## Commands

### Running Locally
Since this is a static HTML project, open files directly in a browser or use a simple HTTP server:
```bash
# Python 3
python -m http.server 8000

# Or using Node.js (if installed)
npx serve .
```

### Linting
No JavaScript linting configured. For HTML validation:
- Use W3C HTML Validator: https://validator.w3.org/
- Browser DevTools show warnings in console

### Testing
No automated tests exist. Manual testing:
1. Open each HTML file in browser
2. Check console for JavaScript errors
3. Verify all assets (images, fonts, CSS) load correctly
4. Test responsive behavior across screen sizes

### No Single Test Command
This project has no test framework (no Jest, Vitest, etc.).

## Code Style Guidelines

### General
- This is a **static HTML/CSS/JS** project - no TypeScript or modern frameworks
- All code is vanilla HTML, CSS, and JavaScript
- Keep JavaScript minimal and inline or in script tags
- No external build tools (webpack, vite, etc.)
- No package.json or npm dependencies

### HTML Conventions
- Use semantic HTML5 elements (`<header>`, `<main>`, `<footer>`, `<nav>`, `<section>`)
- Include `alt` attributes on all `<img>` elements
- Use lowercase for tag names and attributes
- Quote attribute values (e.g., `class="header"`, not `class=header`)
- Close all tags properly
- Use proper document structure: DOCTYPE, html, head, body
- Include viewport meta tag for responsive design
- Put CSS in `<style>` tags in `<head>`, JS in `<script>` tags before `</body>`

### CSS Guidelines
- Use CSS custom properties (variables) for colors and spacing
- Prefer Flexbox and Grid for layout
- Keep styles in `<style>` tags in `<head>` or external stylesheets
- Use mobile-first responsive design with media queries
- Avoid `!important` unless necessary
- Use BEM-like naming for complex class names (e.g., `block__element--modifier`)
- Group related styles together
- Use shorthand properties where appropriate
- Define colors in a consistent format (hex or rgb)

### JavaScript Conventions
- Use `const` and `let` instead of `var`
- Use ES6+ syntax (arrow functions, template literals, destructuring)
- Prefer `querySelector` over `getElementById`/`getElementsByClassName`
- Handle errors with try-catch blocks
- Use meaningful variable and function names (camelCase)
- Avoid global variables, wrap in IIFE or use modules
- Use strict equality (===) instead of (==)
- Declare variables before using them
- Prefer const for values that won't be reassigned

### Naming Conventions
- Files: kebab-case (e.g., `resume-ai.html`, `flow-hub.html`)
- CSS classes: kebab-case (e.g., `.main-header`, `.nav-menu`)
- JavaScript: camelCase (e.g., `initApp()`, `userName`)
- HTML ids: kebab-case (e.g., `id="main-content"`)
- Avoid abbreviated names unless widely understood

### Import/Dependency Guidelines
- Minimize external dependencies
- Prefer CDN links for common libraries (Font Awesome, Google Fonts)
- Only include libraries that are actually used
- Keep jQuery or other large libraries out unless explicitly needed
- Use defer/async attributes for external scripts

### Formatting
- Use 2 spaces for indentation
- Keep lines under 120 characters when possible
- Add whitespace around operators and after commas
- Use blank lines to separate logical code blocks
- Format HTML attributes on new lines for readability if many attributes exist

### Error Handling
- Wrap async code in try-catch
- Log errors to console with meaningful messages
- Provide fallback content for missing assets
- Handle null/undefined values before accessing properties
- Validate user input before processing

### Accessibility
- Use semantic HTML for screen reader support
- Include proper heading hierarchy (h1 → h2 → h3)
- Ensure sufficient color contrast
- Make interactive elements keyboard accessible
- Use ARIA labels when necessary

### Performance
- Optimize images before adding to project
- Use appropriate image formats (WebP, SVG where suitable)
- Minimize DOM depth
- Avoid unnecessary reflows
- Lazy load images if the page is image-heavy

### Best Practices
- Keep HTML, CSS, and JS separate when possible
- Test in multiple browsers (Chrome, Firefox, Edge, Safari)
- Use version control for all changes
- Create backups before major edits
- Validate HTML after making changes

### Backup File Management
- Maximum 5 backup versions per file (e.g., `file.html.backup`, `file.html.backup2`, etc.)
- When exceeding 5 versions, delete the oldest backup file automatically
- Backup files should follow the pattern: `filename.backup`, `filename.backup2`, etc.

## Git Workflow
- Commit message format: `<type>: <description>`
- Types: `feat`, `fix`, `update`, `docs`, `style`
- Example: `feat: add new portfolio template`
- Commit frequently with clear messages
- Push changes to remote after commits

## Notes for Agents
- This is a simple static site - no complex build processes
- Avoid adding Node.js dependencies unless explicitly requested
- Ask user before adding new files or making significant changes
- Do not commit secrets or API keys
- Always verify changes work in browser before considering complete
