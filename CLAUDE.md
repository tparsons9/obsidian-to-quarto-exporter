# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is an Obsidian plugin that exports Obsidian notes to Quarto-compatible QMD files. It handles conversion of Obsidian-specific syntax (callouts, embedded notes, image syntax) to Quarto format, with configurable options for date handling, tag import, and output locations.

## Development Commands

- **Install dependencies**: `npm i`
- **Development mode** (watch mode with inline sourcemaps): `npm run dev`
- **Production build** (type-check + bundle): `npm run build`

The build process uses esbuild configured in `esbuild.config.mjs`. The entry point is `main.ts` and output is `main.js`.

## Architecture

### Core Plugin Structure
The plugin follows Obsidian's plugin architecture with a single main file (`main.ts`) containing:
- **ObsidianToQuartoPlugin**: Main plugin class extending Obsidian's Plugin class
- **ObsidianToQuartoSettingTab**: Settings UI implementation
- **Settings interface**: `ObsidianToQuartoSettings` defines all configurable options

### Export Pipeline
The conversion process in `exportToQuarto()` follows this flow:
1. Validates active file is a Markdown file
2. Reads file content
3. Converts content via `convertToQuarto()`
4. Determines output path (supports both vault paths and external absolute paths)
5. Handles file naming conflicts (overwrite or increment)
6. Writes QMD file and optionally opens it

### Content Conversion (`convertToQuarto`)
The conversion pipeline processes content in this order:
1. **Frontmatter extraction**: Preserves existing frontmatter
2. **Frontmatter generation**: Adds title, optional date, and tags
3. **Pre-header content preservation**: Keeps content before first heading
4. **Image syntax conversion**: `![[image.png]]` → `![](image.png)`
5. **Embedded notes processing**: Expands `![[note]]` references (supports header `#` and block `^` references)
6. **Header formatting**: Adds line breaks before headers
7. **Callout conversion**: Obsidian callouts → Quarto callouts format

### Key Features

**External Path Support** (`allowExternalPaths` setting):
- When enabled with absolute paths, uses Node.js `fs` module directly
- When disabled or using relative paths, uses Obsidian's vault API
- This dual-mode approach allows exporting outside the vault while maintaining vault integration

**Embedded Notes** (`convertEmbeddedNotes` and `getEmbeddedNoteContent`):
- Resolves `![[note]]`, `![[note#header]]`, and `![[note^blockid]]` syntax
- Extracts specific sections based on reference type
- Handles missing files/sections with warning callouts

**Callout Mapping** (`mapCalloutType`):
- Maps Obsidian callout types to Quarto equivalents
- Preserves callout titles and content structure

## Settings
All settings are persisted via `loadData()`/`saveData()`:
- `dateOption`: Add creation/modification date or none
- `dateFormat`: Custom date format string (YYYY-MM-DD, etc.)
- `outputFolder`: Export destination (vault-relative or absolute path)
- `overwriteExisting`: Whether to overwrite or create numbered variants
- `importTags`: Include Obsidian tags in frontmatter
- `allowExternalPaths`: Enable exporting to locations outside vault

## Testing the Plugin
To test changes in Obsidian:
1. Run `npm run dev` to start watch mode
2. Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/obsidian-to-quarto-exporter/` folder
3. Reload Obsidian or toggle the plugin off/on in settings
4. Use command palette → "Export to Quarto QMD" to test
