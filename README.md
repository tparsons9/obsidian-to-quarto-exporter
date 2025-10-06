# Obsidian to Quarto Exporter

This plugin for Obsidian (https://obsidian.md) allows you to export your Obsidian notes to Quarto-compatible QMD files. It provides various options to customize the export process, including date formatting, tag handling, and output file management, along with seamless integration with VS Code Insiders.

## Features

### Export Features
- Export Obsidian notes to Quarto-compatible QMD format
- Add creation or modification date to exported files
- Customize date format (YYYY-MM-DD, etc.)
- Option to include or exclude tags from Obsidian notes
- Specify output folder for exported files (supports both vault paths and external absolute paths)
- Choose to overwrite existing files or create new ones with incremented names

### Bidirectional Linking
- Automatically creates bidirectional links between original MD and exported QMD files
- Original MD file gets `code: "[[path/to/exported.qmd]]"` frontmatter property
- Exported QMD file gets `note: "[[path/to/original.md]]"` frontmatter property

### VS Code Insiders Integration
- Automatically inserts a clickable button in the original note
- Button opens both the workspace folder and specific QMD file in VS Code Insiders
- Works via Command Palette or button click
- No additional plugins required

### Content Conversion
- Converts Obsidian image syntax (`![[image.png]]`) to standard Markdown (`![](image.png)`)
- Expands embedded notes (`![[note]]`, `![[note#header]]`, `![[note^blockid]]`)
- Converts Obsidian callouts to Quarto callout format
- Preserves frontmatter and pre-header content

## Installation

### From the Obsidian Community Plugins

1. Open Obsidian Settings > Community Plugins
2. Disable Safe Mode
3. Click Browse community plugins
4. Search for "Quarto Exporter"
5. Click Install
6. Once installed, close the community plugins window and activate the newly installed plugin

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` (if available) from the latest release in the GitHub repository.
2. Create a new folder named `quarto-exporter` in your vault's plugins folder: `<vault>/.obsidian/plugins/`
3. Move the downloaded files into the `obsidian-to-quarto-exporter` folder.
4. Reload Obsidian
5. If prompted about Safe Mode, you can disable safe mode and enable the plugin.
   Otherwise, head to Settings, third-party plugins, make sure safe mode is off and
   enable the plugin from there.

## Usage

### Exporting a Note

1. Open the Obsidian note you want to export.
2. Use the command palette (Ctrl/Cmd + P) and search for "Export to Quarto QMD".
3. The plugin will:
   - Create a new QMD file based on your settings
   - Add a `code` property to the original note's frontmatter linking to the QMD file
   - Insert a button at the top of the note to open the QMD in VS Code Insiders
   - Add a `note` property to the QMD file's frontmatter linking back to the original

### Opening in VS Code Insiders

After exporting, you can open the QMD file in VS Code Insiders in two ways:

1. **Click the button** at the top of your note (requires [Buttons plugin](https://github.com/shabegom/buttons))
2. **Use Command Palette**: Search for "Open Exported QMD in VS Code Insiders"

Both methods will open the workspace folder and the specific QMD file simultaneously in VS Code Insiders.

### Example

After exporting, your original note will look like this:

````markdown
---
code: "[[/path/to/exported/file.qmd]]"
---

```button
name Open in VS Code Insiders
type command
action Quarto Exporter: Open Exported QMD in VS Code Insiders
color blue
```

# Your Note Title

Your note content...
````

And the exported QMD file will include:

```yaml
---
title: "Your Note Title"
note: "[[path/to/original/note.md]]"
tags:
  - your-tag
---
```

## Settings

- **Allow External Paths**: If enabled, allows exporting files to locations outside the Obsidian vault using absolute paths.
- **Output Folder**: Set a specific folder for exported files. Use absolute path (e.g., `/home/user/exports`) to save outside vault, or relative path for inside vault. Leave blank to use the same folder as the original note.
- **Date Option**: Choose to add creation date, modification date, or no date to the exported file.
- **Date Format**: Specify the format for the date using tokens:
  - `YYYY` - 4-digit year
  - `MM` - 2-digit month
  - `DD` - 2-digit day
  - `HH` - 2-digit hour
  - `mm` - 2-digit minute
  - `ss` - 2-digit second
  - Example: `YYYY-MM-DD` outputs `2025-01-06`
- **Overwrite Existing Files**: Choose whether to overwrite existing files or create new ones with incremented names (e.g., `file_1.qmd`, `file_2.qmd`).
- **Import Tags**: Decide whether to include tags from the Obsidian note in the exported Quarto file's frontmatter.

## Requirements

### Optional: Buttons Plugin

For the best experience with the VS Code Insiders integration, install the [Buttons plugin](https://github.com/shabegom/buttons) by shabegom. This enables the clickable button feature at the top of your notes.

**Installation:**
1. Open Obsidian Settings > Community Plugins
2. Search for "Buttons"
3. Install and enable

Without this plugin, you can still use the Command Palette to open files in VS Code Insiders.

### Optional: VS Code Insiders

The plugin includes integration with VS Code Insiders. If you prefer regular VS Code or another editor, you can:
- Use the wikilink in the `code` frontmatter property to navigate to exported files
- Manually open files in your preferred editor
- The core export functionality works independently of any editor

## Troubleshooting

**Button shows "Command not found" error:**
- Make sure the Quarto Exporter plugin is enabled
- Try reloading Obsidian or toggling the plugin off and on
- Re-export the note to update the button with the correct command

**VS Code doesn't open:**
- Ensure `code-insiders` command is available in your system PATH
- On macOS, you may need to install the command via VS Code: `Cmd+Shift+P` → "Shell Command: Install 'code-insiders' command in PATH"
- On Windows/Linux, verify VS Code Insiders is properly installed

**Export to external path fails:**
- Enable "Allow External Paths" in settings
- Ensure the output folder path is absolute (e.g., `/Users/name/exports` not `~/exports`)
- Check that you have write permissions to the destination folder

## Development

If you want to contribute to the development of this plugin, follow these steps:

1. Clone this repository.
2. Run `npm i` to install dependencies.
3. Run `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/quarto-exporter/`.

## Support

If you encounter any issues or have feature requests, please file them in the Issues section of the GitHub repository.

## License

[MIT](LICENSE)
