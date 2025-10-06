import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, getAllTags, FileSystemAdapter } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

interface ObsidianToQuartoSettings {
    dateOption: 'none' | 'created' | 'modified';
    dateFormat: string;
    outputFolder: string;
    overwriteExisting: boolean;
    importTags: boolean;
    allowExternalPaths: boolean;
    htmlTheme: string;
    useQuartoFilters: boolean;
    generateWikilinksFilter: boolean;
    customCalloutMappings: string;
}

const DEFAULT_SETTINGS: ObsidianToQuartoSettings = {
    dateOption: 'none',
    dateFormat: 'YYYY-MM-DD',
    outputFolder: '',
    overwriteExisting: false,
    importTags: true,
    allowExternalPaths: false,
    htmlTheme: 'cosmo',
    useQuartoFilters: true,
    generateWikilinksFilter: true,
    customCalloutMappings: '{}'
}

export default class ObsidianToQuartoPlugin extends Plugin {
    settings: ObsidianToQuartoSettings;

    async onload() {
        console.log('Loading ObsidianToQuartoPlugin');
        await this.loadSettings();

        this.addCommand({
            id: 'export-to-quarto',
            name: 'Export to Quarto QMD',
            callback: () => this.exportToQuarto(),
        });

        this.addCommand({
            id: 'open-exported-qmd-vscode',
            name: 'Open Exported QMD in VS Code Insiders',
            callback: () => this.openExportedInVSCode(),
        });

        this.addSettingTab(new ObsidianToQuartoSettingTab(this.app, this));
        console.log('ObsidianToQuartoPlugin loaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async exportToQuarto() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile || activeFile.extension !== 'md') {
                new Notice('Please open a Markdown file before exporting');
                return;
            }

            const content = await this.app.vault.read(activeFile);

            let outputPath: string;
            let newFileName = activeFile.basename + '.qmd';
            let newPath: string;
            let qmdRelativePath: string;

            if (this.settings.allowExternalPaths && path.isAbsolute(this.settings.outputFolder)) {
                // Handle absolute path outside vault
                outputPath = path.join(this.settings.outputFolder, activeFile.parent.path);
                try {
                    fs.mkdirSync(outputPath, { recursive: true });
                    newPath = path.join(outputPath, newFileName);

                    if (fs.existsSync(newPath)) {
                        if (this.settings.overwriteExisting) {
                            fs.unlinkSync(newPath);
                        } else {
                            let counter = 1;
                            while (fs.existsSync(newPath)) {
                                newFileName = `${activeFile.basename}_${counter}.qmd`;
                                newPath = path.join(outputPath, newFileName);
                                counter++;
                            }
                        }
                    }

                    qmdRelativePath = newPath;

                    // Generate Quarto filters and get filter paths
                    const filterPaths = await this.generateQuartoFilters(
                        this.settings.outputFolder,
                        newPath,
                        true
                    );

                    const convertedContent = await this.convertToQuarto(content, activeFile, qmdRelativePath, filterPaths);
                    fs.writeFileSync(newPath, convertedContent);

                    // Update original MD file with bidirectional link
                    await this.addFrontmatterProperty(activeFile, 'code', `[[${qmdRelativePath}]]`);

                    // Insert button to open file in VS Code Insiders
                    await this.insertButtonCodeblock(activeFile);

                    new Notice(`Successfully exported to ${newPath}`);
                } catch (error) {
                    console.error('Error writing to external path:', error);
                    new Notice(`Failed to write to external path: ${error.message}`);
                    return;
                }
            } else {
                // Handle vault path
                outputPath = this.settings.outputFolder
                    ? path.join(this.settings.outputFolder, activeFile.parent.path)
                    : activeFile.parent.path;
                await this.app.vault.adapter.mkdir(outputPath);

                newPath = `${outputPath}/${newFileName}`;
                if (await this.app.vault.adapter.exists(newPath)) {
                    if (this.settings.overwriteExisting) {
                        await this.app.vault.adapter.remove(newPath);
                    } else {
                        let counter = 1;
                        while (await this.app.vault.adapter.exists(newPath)) {
                            newFileName = `${activeFile.basename}_${counter}.qmd`;
                            newPath = `${outputPath}/${newFileName}`;
                            counter++;
                        }
                    }
                }

                qmdRelativePath = newPath;

                // Generate Quarto filters and get filter paths
                // For vault paths, use the base output folder or vault root
                const baseFolder = this.settings.outputFolder || '';
                let absoluteNewPath = newPath;
                if (this.app.vault.adapter instanceof FileSystemAdapter) {
                    absoluteNewPath = path.join(this.app.vault.adapter.getBasePath(), newPath);
                }

                const filterPaths = await this.generateQuartoFilters(
                    baseFolder,
                    absoluteNewPath,
                    false
                );

                const convertedContent = await this.convertToQuarto(content, activeFile, qmdRelativePath, filterPaths);
                await this.app.vault.create(newPath, convertedContent);

                // Update original MD file with bidirectional link
                await this.addFrontmatterProperty(activeFile, 'code', `[[${qmdRelativePath}]]`);

                // Insert button to open file in VS Code Insiders
                await this.insertButtonCodeblock(activeFile);

                new Notice(`Successfully exported to ${newFileName}`);
            }
        } catch (error) {
            console.error('Error in exportToQuarto:', error);
            new Notice('Failed to export to Quarto QMD. Check console for details.');
        }
    }

    async openExportedInVSCode() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile || activeFile.extension !== 'md') {
                new Notice('Please open a Markdown file with exported QMD');
                return;
            }

            // Read frontmatter to get the code property
            const content = await this.app.vault.read(activeFile);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);

            if (!frontmatterMatch) {
                new Notice('No frontmatter found. Export a QMD file first.');
                return;
            }

            const frontmatterContent = frontmatterMatch[1];
            const codeMatch = frontmatterContent.match(/^code:\s*"?\[\[(.+?)\]\]"?$/m);

            if (!codeMatch) {
                new Notice('No exported QMD file found in frontmatter. Export a QMD file first.');
                return;
            }

            let qmdPath = codeMatch[1];

            // Handle both absolute and relative paths
            let absoluteFilePath: string;
            let workspaceFolder: string;

            if (path.isAbsolute(qmdPath)) {
                // External path
                absoluteFilePath = qmdPath;
                // Use the configured output folder as workspace
                workspaceFolder = this.settings.outputFolder;
            } else {
                // Relative to vault
                if (this.app.vault.adapter instanceof FileSystemAdapter) {
                    const vaultPath = this.app.vault.adapter.getBasePath();
                    absoluteFilePath = path.join(vaultPath, qmdPath);

                    // Determine workspace folder
                    if (this.settings.outputFolder) {
                        // Use configured output folder relative to vault
                        workspaceFolder = path.join(vaultPath, this.settings.outputFolder);
                    } else {
                        // No output folder configured, use vault root
                        workspaceFolder = vaultPath;
                    }
                } else {
                    new Notice('Cannot determine absolute path');
                    return;
                }
            }

            // Execute code-insiders command to open workspace folder and file
            const command = `code-insiders "${workspaceFolder}" "${absoluteFilePath}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error opening in VS Code:', error);
                    new Notice(`Failed to open in VS Code Insiders: ${error.message}`);
                    return;
                }
                if (stderr) {
                    console.error('VS Code stderr:', stderr);
                }
                new Notice('Opened in VS Code Insiders');
            });

        } catch (error) {
            console.error('Error in openExportedInVSCode:', error);
            new Notice('Failed to open in VS Code Insiders. Check console for details.');
        }
    }

    convertObsidianImages(content: string): string {
        // Convert Obsidian image syntax (![[image.png]]) to standard Markdown (![](<image.png>))
        return content.replace(/!\[\[([^\]]+?)\]\]/g, '![]($1)');
    }

    async convertToQuarto(content: string, file: TFile, qmdRelativePath?: string, filterPaths?: string[]): Promise<string> {
        // Extract frontmatter if it exists
        let frontmatter = '';
        let mainContent = content;
        const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n/);
        if (frontmatterMatch) {
            frontmatter = frontmatterMatch[0];
            mainContent = content.slice(frontmatter.length);
        }

        // Create new frontmatter
        const title = file.basename;
        let newFrontmatter = `---\ntitle: "${title}"\n`;

        if (this.settings.dateOption !== 'none') {
            const date = await this.getFileDate(file);
            newFrontmatter += `date: "${date}"\n`;
        }

        // Add tags if enabled
        if (this.settings.importTags) {
            const fileTags = this.getFileTags(file);
            if (fileTags.length > 0) {
                newFrontmatter += `tags:\n${fileTags.map(tag => `  - ${tag}`).join('\n')}\n`;
            }
        }

        // Add bidirectional link to original note
        if (qmdRelativePath) {
            newFrontmatter += `note: "[[${file.path}]]"\n`;
        }

        // Add Quarto format configuration for HTML export
        newFrontmatter += `format:\n`;
        newFrontmatter += `  html:\n`;
        newFrontmatter += `    theme: ${this.settings.htmlTheme}\n`;
        newFrontmatter += `    code-fold: true\n`;

        // Add filter references if provided
        if (filterPaths && filterPaths.length > 0) {
            newFrontmatter += `filters:\n`;
            filterPaths.forEach(filterPath => {
                newFrontmatter += `  - ${filterPath}\n`;
            });
        }

        // Merge existing frontmatter (if any) with new frontmatter, excluding tags, empty values, and reserved keys
        if (frontmatter) {
            const existingLines = frontmatter
                .slice(4, -4) // Remove '---' delimiters
                .split('\n');

            const filteredLines: string[] = [];
            let skipProperty = false;
            let currentIndent = 0;

            // Keys that we're already handling or should skip
            const reservedKeys = ['title', 'date', 'tags', 'note', 'format', 'filters', 'code', 'aliases'];

            for (let i = 0; i < existingLines.length; i++) {
                const line = existingLines[i];
                const trimmedLine = line.trim();

                // Empty lines
                if (trimmedLine === '') {
                    continue;
                }

                // Determine if this is a top-level property (starts at column 0)
                const lineIndent = line.length - line.trimStart().length;

                if (lineIndent === 0 && trimmedLine.includes(':')) {
                    // This is a new top-level property
                    const propertyKey = trimmedLine.split(':')[0].trim();

                    // Check if this is a reserved key
                    if (reservedKeys.includes(propertyKey)) {
                        skipProperty = true;
                        currentIndent = lineIndent;
                        continue;
                    } else {
                        skipProperty = false;
                        currentIndent = lineIndent;

                        // Check if property has a value
                        const colonIndex = line.indexOf(':');
                        const value = line.slice(colonIndex + 1).trim();

                        // Filter out empty values
                        if (!value || value === '""' || value === "''" || value === 'null' || value === 'undefined') {
                            skipProperty = true;
                            continue;
                        }

                        filteredLines.push(line);
                    }
                } else if (!skipProperty && lineIndent > 0) {
                    // This is an indented line (part of the current property)
                    filteredLines.push(line);
                } else if (skipProperty && lineIndent > currentIndent) {
                    // Skip indented lines that belong to a skipped property
                    continue;
                }
            }

            if (filteredLines.length > 0) {
                newFrontmatter += filteredLines.join('\n') + '\n';
            }
        }
        newFrontmatter += '---\n\n';

        // Process main content
        let convertedContent = mainContent;

        // Preserve content before the first header
        const firstHeaderIndex = convertedContent.search(/^\s*#/m);
        let preHeaderContent = '';
        if (firstHeaderIndex !== -1) {
            preHeaderContent = convertedContent.slice(0, firstHeaderIndex).trim() + '\n\n';
            convertedContent = convertedContent.slice(firstHeaderIndex);
        }

        // Remove button codeblocks from pre-header content
        preHeaderContent = preHeaderContent.replace(/```button\s*\n[\s\S]*?\n```\s*\n*/g, '');

        // Convert Obsidian image syntax before other conversions
        convertedContent = this.convertObsidianImages(convertedContent);

        convertedContent = await this.convertEmbeddedNotes(convertedContent);

        // Remove button codeblocks
        convertedContent = convertedContent.replace(/```button\s*\n[\s\S]*?\n```\s*\n*/g, '');

        // Add line breaks before headers
        convertedContent = convertedContent.replace(/^(#+\s.*)/gm, '\n$1');

        // Convert Obsidian callouts to Quarto callouts (only if not using filters)
        if (!this.settings.useQuartoFilters) {
            convertedContent = convertedContent.replace(
                /> \[!(\w+)\](.*?)\n((?:>.*\n?)*)/g,
                (_, type, title, content) => {
                    const quartoType = this.mapCalloutType(type);
                    return `::: {.callout-${quartoType}}\n${title.trim() ? `## ${title.trim()}\n` : ''}${content.replace(/^>/gm, '').trim()}\n:::\n\n`;
                }
            );
        }

        // Combine all parts
        return newFrontmatter + preHeaderContent + convertedContent;
    }

    getFileTags(file: TFile): string[] {
        const fileCache = this.app.metadataCache.getFileCache(file);
        if (fileCache) {
            const tags = getAllTags(fileCache);
            return tags ? tags.map(tag => tag.replace('#', '')) : [];
        }
        return [];
    }

    async getFileDate(file: TFile): Promise<string> {
        try {
            const stat = await this.app.vault.adapter.stat(file.path);
            if (!stat) {
                console.error('Failed to get file stats');
                return this.formatDate(new Date()); // Use current date as fallback
            }
            const date = this.settings.dateOption === 'created' ? stat.ctime : stat.mtime;
            return this.formatDate(new Date(date));
        } catch (error) {
            console.error('Error getting file date:', error);
            return this.formatDate(new Date()); // Use current date as fallback
        }
    }

    formatDate(date: Date): string {
        const format = this.settings.dateFormat;
        return format
            .replace('YYYY', date.getFullYear().toString())
            .replace('MM', (date.getMonth() + 1).toString().padStart(2, '0'))
            .replace('DD', date.getDate().toString().padStart(2, '0'))
            .replace('HH', date.getHours().toString().padStart(2, '0'))
            .replace('mm', date.getMinutes().toString().padStart(2, '0'))
            .replace('ss', date.getSeconds().toString().padStart(2, '0'));
    }

    async convertEmbeddedNotes(content: string): Promise<string> {
        const embeddedNoteRegex = /!\[\[([^\]]+?)((?:#|\^).+?)?\]\]/g;
        const embedPromises: Promise<string>[] = [];

        content.replace(embeddedNoteRegex, (match, noteName, reference) => {
            embedPromises.push(this.getEmbeddedNoteContent(noteName, reference));
            return match;
        });

        const embeddedContents = await Promise.all(embedPromises);

        return content.replace(embeddedNoteRegex, () => embeddedContents.shift() || '');
    }

    async getEmbeddedNoteContent(noteName: string, reference?: string): Promise<string> {
        const file = this.app.metadataCache.getFirstLinkpathDest(noteName, '');
        if (file instanceof TFile) {
            let content = await this.app.vault.read(file);
            console.log(`Original content length: ${content.length}`);

            if (reference) {
                console.log(`Processing reference: ${reference}`);
                if (reference.startsWith('#')) {
                    // Header reference
                    const headerName = reference.slice(1);
                    console.log(`Looking for header: ${headerName}`);
                    const headerRegex = new RegExp(`^(#+)\\s*${this.escapeRegExp(headerName)}\\s*$`, 'im');
                    const headerMatch = content.match(headerRegex);
                    if (headerMatch) {
                        console.log(`Found header: ${headerMatch[0]}`);
                        const headerLevel = headerMatch[1].length;
                        const headerIndex = headerMatch.index!;
                        const nextHeaderRegex = new RegExp(`^#{1,${headerLevel}}\\s`, 'im');
                        const remainingContent = content.slice(headerIndex + headerMatch[0].length);
                        const nextHeaderMatch = remainingContent.match(nextHeaderRegex);
                        const nextHeaderIndex = nextHeaderMatch ? nextHeaderMatch.index! + headerMatch[0].length : content.length;
                        content = content.slice(headerIndex, headerIndex + nextHeaderIndex);
                        console.log(`Extracted content length: ${content.length}`);
                    } else {
                        console.log(`Header not found: ${headerName}`);
                        return `\n\n> [!warning] Header not found: ${headerName} in ${noteName}\n\n`;
                    }
                } else if (reference.startsWith('^')) {
                    // Block reference
                    const blockId = reference.slice(1);
                    console.log(`Looking for block: ${blockId}`);
                    const blockRegex = new RegExp(`(^|\n)([^\n]+\\s*(?:{{[^}]*}})?\\s*\\^${this.escapeRegExp(blockId)}\\s*$)`, 'm');
                    const blockMatch = content.match(blockRegex);
                    if (blockMatch) {
                        console.log(`Found block: ${blockMatch[2]}`);
                        const blockIndex = blockMatch.index! + blockMatch[1].length;
                        const blockEndIndex = content.indexOf('\n\n', blockIndex);
                        content = blockEndIndex !== -1 
                            ? content.slice(blockIndex, blockEndIndex).trim()
                            : content.slice(blockIndex).trim();
                        console.log(`Extracted content length: ${content.length}`);
                    } else {
                        console.log(`Block not found: ${blockId}`);
                        return `\n\n> [!warning] Block not found: ${blockId} in ${noteName}\n\n`;
                    }
                }
            }

            // Remove the block reference if it exists
            content = content.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, '');

            return `\n\n${content.trim()}\n\n`;
        } else {
            console.log(`File not found: ${noteName}`);
            return `\n\n> [!warning] Embedded note not found: ${noteName}${reference || ''}\n\n`;
        }
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private mapCalloutType(obsidianType: string): string {
        const typeMap: {[key: string]: string} = {
            'note': 'note',
            'info': 'info',
            'tip': 'tip',
            'success': 'success',
            'question': 'question',
            'warning': 'warning',
            'failure': 'error',
            'danger': 'warning',
            'bug': 'bug',
            'example': 'example',
            'quote': 'quote'
        };
        return typeMap[obsidianType.toLowerCase()] || 'note';
    }

    private getCalloutMappings(): Record<string, string> {
        // Default mappings for Obsidian callouts to Quarto callout types
        const defaultMappings: Record<string, string> = {
            'note': 'note',
            'info': 'note',
            'tip': 'tip',
            'success': 'tip',
            'question': 'note',
            'warning': 'warning',
            'failure': 'warning',
            'danger': 'caution',
            'bug': 'caution',
            'example': 'note',
            'quote': 'note',
            'important': 'important'
        };

        // Parse custom mappings from settings
        let customMappings: Record<string, string> = {};
        try {
            if (this.settings.customCalloutMappings && this.settings.customCalloutMappings.trim() !== '') {
                customMappings = JSON.parse(this.settings.customCalloutMappings);
            }
        } catch (error) {
            console.error('Error parsing custom callout mappings:', error);
            new Notice('Invalid custom callout mappings JSON. Using defaults only.');
        }

        // Merge custom mappings with defaults (custom takes precedence)
        return { ...defaultMappings, ...customMappings };
    }

    private generateObsidianCalloutsFilter(filtersDir: string): void {
        const mappings = this.getCalloutMappings();

        // Generate Lua table entries for callout mappings
        const mappingEntries = Object.entries(mappings)
            .map(([key, value]) => `  ["${key}"] = "${value}"`)
            .join(',\n');

        const luaContent = `-- obsidian-callouts.lua
-- Converts Obsidian callout syntax to Quarto callout syntax
-- Auto-generated by Obsidian to Quarto Exporter plugin

-- Callout type mappings to Quarto's 5 standard types
-- Unmapped callout types default to "note"
local callout_mappings = {
${mappingEntries}
}

function BlockQuote(el)
  -- Check if this is an Obsidian callout
  if #el.content == 0 then return el end

  local first_block = el.content[1]
  if first_block.t ~= "Para" and first_block.t ~= "Plain" then
    return el
  end

  if #first_block.content == 0 then return el end

  -- Check if first inline starts with [!
  local first_inline = first_block.content[1]
  if first_inline.t ~= "Str" then return el end

  local callout_match = first_inline.text:match("^%[!([^%]]+)%]")
  if not callout_match then return el end

  local callout_type = callout_match
  -- Map to Quarto type, default to "note" if not found
  local mapped_type = callout_mappings[callout_type:lower()] or "note"

  -- Extract title (everything after [!type])
  local title = first_inline.text:match("^%[![^%]]+%]%s*(.+)$")

  -- Remove the [!type] Title line
  table.remove(el.content, 1)

  -- If there's a title, add it as a header
  local content = {}
  if title and title ~= "" then
    table.insert(content, pandoc.Header(2, {pandoc.Str(title)}))
  end

  -- Add the rest of the content
  for _, block in ipairs(el.content) do
    table.insert(content, block)
  end

  -- Create the callout div
  return pandoc.Div(content, {class = "callout-" .. mapped_type})
end
`;

        const filterPath = path.join(filtersDir, 'obsidian-callouts.lua');

        try {
            fs.writeFileSync(filterPath, luaContent);
        } catch (error) {
            console.error('Error writing Obsidian callouts filter:', error);
            throw error;
        }
    }

    private generateWikilinksFilter(filtersDir: string): void {
        const luaContent = `-- wikilinks-filter.lua
-- Converts Obsidian wikilinks to plain text
-- Auto-generated by Obsidian to Quarto Exporter plugin

function Str(el)
  -- Handle complete wikilinks in a single Str element
  local text = el.text

  -- Replace [[link|alias]] with alias
  text = text:gsub("%[%[([^|%]]+)|([^%]]+)%]%]", "%2")

  -- Replace [[link]] with link
  text = text:gsub("%[%[([^%]]+)%]%]", "%1")

  if text ~= el.text then
    return pandoc.Str(text)
  end
  return el
end
`;

        const filterPath = path.join(filtersDir, 'wikilinks-filter.lua');

        try {
            fs.writeFileSync(filterPath, luaContent);
        } catch (error) {
            console.error('Error writing wikilinks filter:', error);
            throw error;
        }
    }

    private async generateQuartoFilters(outputBaseFolder: string, qmdFilePath: string, isExternalPath: boolean): Promise<string[]> {
        if (!this.settings.useQuartoFilters) {
            return [];
        }

        // Create filters directory - determine absolute path
        let filtersDir: string;
        if (isExternalPath) {
            filtersDir = path.join(outputBaseFolder, 'filters');
        } else {
            // For vault paths, need absolute path for fs operations
            if (this.app.vault.adapter instanceof FileSystemAdapter) {
                const vaultPath = this.app.vault.adapter.getBasePath();
                filtersDir = path.join(vaultPath, outputBaseFolder, 'filters');
            } else {
                throw new Error('Cannot generate filters: vault adapter is not FileSystemAdapter');
            }
        }

        try {
            // Always use fs.mkdirSync for creating the directory (works for both cases)
            if (!fs.existsSync(filtersDir)) {
                fs.mkdirSync(filtersDir, { recursive: true });
            }

            // Generate filters
            this.generateObsidianCalloutsFilter(filtersDir);
            if (this.settings.generateWikilinksFilter) {
                this.generateWikilinksFilter(filtersDir);
            }

            // Calculate relative paths from QMD file to filters
            const qmdDir = path.dirname(qmdFilePath);
            const calloutsFilterPath = path.join(filtersDir, 'obsidian-callouts.lua');
            const wikilinksFilterPath = path.join(filtersDir, 'wikilinks-filter.lua');

            const relativeCallouts = path.relative(qmdDir, calloutsFilterPath);
            const relativeWikilinks = path.relative(qmdDir, wikilinksFilterPath);

            const filterPaths = [relativeCallouts];
            if (this.settings.generateWikilinksFilter) {
                filterPaths.push(relativeWikilinks);
            }

            return filterPaths;
        } catch (error) {
            console.error('Error generating Quarto filters:', error);
            new Notice(`Failed to generate Quarto filters: ${error.message}`);
            return [];
        }
    }

    private slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\w ]+/g, '')
            .replace(/ +/g, '-');
    }

    async addFrontmatterProperty(file: TFile, key: string, value: string): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);

            if (frontmatterMatch) {
                // Frontmatter exists, add/update property
                const frontmatterContent = frontmatterMatch[1];
                const lines = frontmatterContent.split('\n');

                // Check if property already exists
                const propertyIndex = lines.findIndex(line => line.startsWith(`${key}:`));
                if (propertyIndex !== -1) {
                    // Update existing property
                    lines[propertyIndex] = `${key}: "${value}"`;
                } else {
                    // Add new property
                    lines.push(`${key}: "${value}"`);
                }

                const newFrontmatter = `---\n${lines.join('\n')}\n---\n`;
                const newContent = content.replace(/^---\n[\s\S]*?\n---\n/, newFrontmatter);
                await this.app.vault.modify(file, newContent);
            } else {
                // No frontmatter exists, create it
                const newFrontmatter = `---\n${key}: "${value}"\n---\n\n`;
                const newContent = newFrontmatter + content;
                await this.app.vault.modify(file, newContent);
            }
        } catch (error) {
            console.error('Error adding frontmatter property:', error);
            new Notice(`Failed to update frontmatter: ${error.message}`);
        }
    }

    async insertButtonCodeblock(file: TFile): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            const buttonCodeblock = `\`\`\`button
name Open in VS Code Insiders
type command
action Quarto Exporter: Open Exported QMD in VS Code Insiders
color blue
\`\`\`\n\n`;

            // Check if button already exists (check for all previous names)
            if (content.includes('name Open in VS Code Insiders') || content.includes('name Open QMD Workspace') || content.includes('name Open Exported QMD')) {
                // Remove old button first
                const buttonRegex = /```button\s+name Open (?:in VS Code Insiders|QMD Workspace|Exported QMD)[\s\S]*?```\n*/;
                const contentWithoutButton = content.replace(buttonRegex, '');
                const frontmatterMatch = contentWithoutButton.match(/^---\n[\s\S]*?\n---\n\n?/);

                if (frontmatterMatch) {
                    const frontmatter = frontmatterMatch[0];
                    const restContent = contentWithoutButton.slice(frontmatter.length);
                    const newContent = frontmatter + buttonCodeblock + restContent;
                    await this.app.vault.modify(file, newContent);
                } else {
                    const newContent = buttonCodeblock + contentWithoutButton;
                    await this.app.vault.modify(file, newContent);
                }
            } else {
                // Insert button after frontmatter
                const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n\n?/);

                if (frontmatterMatch) {
                    const frontmatter = frontmatterMatch[0];
                    const restContent = content.slice(frontmatter.length);
                    const newContent = frontmatter + buttonCodeblock + restContent;
                    await this.app.vault.modify(file, newContent);
                } else {
                    // No frontmatter, insert at beginning
                    const newContent = buttonCodeblock + content;
                    await this.app.vault.modify(file, newContent);
                }
            }
        } catch (error) {
            console.error('Error inserting button codeblock:', error);
            new Notice(`Failed to insert button: ${error.message}`);
        }
    }
}

class ObsidianToQuartoSettingTab extends PluginSettingTab {
    plugin: ObsidianToQuartoPlugin;

    constructor(app: App, plugin: ObsidianToQuartoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Allow External Paths')
            .setDesc('If enabled, allows exporting files to locations outside the Obsidian vault using absolute paths')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.allowExternalPaths)
                .onChange(async (value) => {
                    this.plugin.settings.allowExternalPaths = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Output Folder')
            .setDesc('Specify the folder where QMD files should be saved. Use absolute path (e.g., /home/user/exports) to save outside vault, or relative path for inside vault. Leave blank to use same folder as original file.')
            .addText(text => text
                .setPlaceholder('Enter folder path')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Date Option')
            .setDesc('Choose which date to add to the Quarto document')
            .addDropdown(dropdown => dropdown
                .addOption('none', 'No date')
                .addOption('created', 'Creation date')
                .addOption('modified', 'Last modified date')
                .setValue(this.plugin.settings.dateOption)
                .onChange(async (value) => {
                    this.plugin.settings.dateOption = value as 'none' | 'created' | 'modified';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Date Format')
            .setDesc('Specify the date format (YYYY: year, MM: month, DD: day, HH: hour, mm: minute, ss: second)')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Overwrite Existing Files')
            .setDesc('If checked, existing files will be overwritten. If unchecked, a new file with a number appended will be created.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.overwriteExisting)
                .onChange(async (value) => {
                    this.plugin.settings.overwriteExisting = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Import Tags')
            .setDesc('If checked, tags from the Obsidian note will be imported into the Quarto file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.importTags)
                .onChange(async (value) => {
                    this.plugin.settings.importTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('HTML Theme')
            .setDesc('Select the theme for Quarto HTML output')
            .addDropdown(dropdown => dropdown
                .addOption('cosmo', 'Cosmo')
                .addOption('flatly', 'Flatly')
                .addOption('darkly', 'Darkly')
                .addOption('cerulean', 'Cerulean')
                .addOption('journal', 'Journal')
                .addOption('lumen', 'Lumen')
                .addOption('minty', 'Minty')
                .addOption('pulse', 'Pulse')
                .addOption('sandstone', 'Sandstone')
                .addOption('simplex', 'Simplex')
                .addOption('sketchy', 'Sketchy')
                .addOption('slate', 'Slate')
                .addOption('solar', 'Solar')
                .addOption('spacelab', 'Spacelab')
                .addOption('superhero', 'Superhero')
                .addOption('united', 'United')
                .addOption('yeti', 'Yeti')
                .setValue(this.plugin.settings.htmlTheme)
                .onChange(async (value) => {
                    this.plugin.settings.htmlTheme = value;
                    await this.plugin.saveSettings();
                }));

        // Quarto Filter Settings Section
        containerEl.createEl('h3', { text: 'Quarto Filter Settings' });

        new Setting(containerEl)
            .setName('Use Quarto Filters')
            .setDesc('Generate Lua filters to convert Obsidian callouts at Quarto render time. When disabled, callouts are converted inline in the QMD file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useQuartoFilters)
                .onChange(async (value) => {
                    this.plugin.settings.useQuartoFilters = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Generate Wikilinks Filter')
            .setDesc('Generate a Lua filter to convert Obsidian wikilinks to plain text in Quarto output.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.generateWikilinksFilter)
                .onChange(async (value) => {
                    this.plugin.settings.generateWikilinksFilter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Custom Callout Mappings')
            .setDesc('Map custom Obsidian callout types to standard Quarto callout types (note, tip, warning, caution, important). Format: {"custom": "note", "rocket": "tip"}')
            .addTextArea(text => text
                .setPlaceholder('{"custom": "note"}')
                .setValue(this.plugin.settings.customCalloutMappings)
                .onChange(async (value) => {
                    this.plugin.settings.customCalloutMappings = value;
                    await this.plugin.saveSettings();
                }));
    }
}

declare module 'obsidian' {
    interface App {
        vault: Vault;
        workspace: Workspace;
        metadataCache: MetadataCache;
    }
}
