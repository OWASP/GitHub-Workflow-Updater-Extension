# GitHub Workflow Updater

A VS Code extension that automatically pins GitHub Actions to specific commits for enhanced security.

> An [OWASP](https://owasp.org) project that helps secure GitHub Actions workflows by pinning actions to immutable commit hashes.

## Features

- **Automatic Pinning**: Updates GitHub Actions to use commit hashes instead of version tags
- **Latest Version Detection**: Finds the highest semantic version and pins to its commit
- **Private Repository Support**: Configure GitHub token for private repositories
- **Skip Pinning**: Use `# skip-pinning` comment to exclude specific actions
- **Comprehensive Updates**: Updates entire workflow file at once
- **Error Handling**: Continues processing other actions if one fails

## Installation

### VSCode
Run the following in the edit prompt (ctrl+shift+p)

```
ext install OWASP.Github-Workflow-Updater-Extension
```

### Cursor
Click <cursor:extension/OWASP.Github-Workflow-Updater-Extension>

### Available from the following registries
[Open VSX Registry](https://open-vsx.org/extension/OWASP-github-workflow-updater/github-workflow-updater)
[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=OWASP.Github-Workflow-Updater-Extension)


## Usage

1. Open a GitHub workflow file (`.yml` or `.yaml`)
2. Click the sync button in the editor toolbar
3. The extension will update all actions to their latest pinned versions

## Configuration

Set your GitHub Personal Access Token in VS Code settings:

```
GitHub Workflow Updater: Github Token
```

This token is required for accessing private repositories and helps avoid rate limits.

## Skip Pinning

To prevent an action from being updated, add a `# skip-pinning` comment:

```yaml
- uses: actions/checkout@main # skip-pinning
```

## Example

**Before:**
```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v3.5.1
```

**After:**
```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65 # v4.0.0
```

## Requirements

- VS Code 1.74.0 or higher
- Internet connection for GitHub API access

## Security

This extension enhances security by:
- Pinning actions to specific commits prevents supply chain attacks
- Immutable references ensure consistent behavior
- Following security best practices from StepSecurity

## Development



### Building the Extension

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Compile TypeScript**:
   ```bash
   npm run compile
   ```
   
   Or watch for changes during development:
   ```bash
   npm run watch
   ```

### Testing the Extension

1. **Open in your editor**: Open this project folder in VS Code or Cursor

2. **Launch Extension Development Host**:
   - Press `F5` or use the "Run and Debug" panel
   - Select "Run Extension" configuration
   - This opens a new window with the extension loaded (VS Code window if using VS Code, Cursor window if using Cursor)

3. **Test the functionality**:
   - In the Extension Development Host window, open a GitHub workflow file (`.yml` or `.yaml`)
   - Click the sync button in the editor toolbar
   - The extension should update actions to pinned versions

4. **Refresh the Extension Development Host**:
   After making code changes, you need to refresh the Extension Development Host:
   - **Method 1**: Use Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
     - Type "Developer: Reload Window" and select it
   - **Method 2**: Close and reopen the Extension Development Host window (press `F5` again)
   - **Method 3**: Use the restart button in the Debug toolbar
   - **Note**: In Cursor on macOS, the Extension Development Host works the same as VS Code

### Running Tests

```bash
npm test
```

The test suite is offline by design:
- it uses Node's built-in test runner, so no extra test framework is required
- it reads the local `test-workflow.yml` fixture and uses mocked update metadata
- it does not call the GitHub API, which keeps tests deterministic and avoids leaking tokens or depending on network access

### Packaging for Distribution

```bash
npm install -g vsce
vsce package
```

This creates a `.vsix` file that can be installed in VS Code or Cursor.

## Installation

### From VS Code Marketplace

```
ext install OWASP.Github-Workflow-Updater-Extension
```

### Manual Installation

1. **Download or build the extension**:
   - Either download a `.vsix` file from releases
   - Or build it yourself following the Development section above

2. **Install the `.vsix` file**:
   - Open VS Code or Cursor
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Extensions: Install from VSIX..."
   - Select the `.vsix` file
   - Restart your editor

3. **Configure GitHub token** (optional but recommended):
   - Go to Settings (Code → Preferences → Settings)
   - Search for "GitHub Workflow Updater"
   - Set your GitHub Personal Access Token

### GitHub Token Scopes

For **Classic Personal Access Tokens**, you need:
- `public_repo` - Access public repositories
- `repo` - Full access to private repositories (if you need private repo access)

For **Fine-grained Personal Access Tokens**, you need:
- **Repository permissions**:
  - `Contents: Read` - Read repository files and metadata
  - `Metadata: Read` - Read repository metadata (required)
  - `Actions: Read` - Read workflow files (if accessing Actions)

**Note**: Fine-grained tokens must be configured for each organization/repository you want to access.

## Troubleshooting

### 404 Not Found Errors

If you see errors like:
```
Failed to update tesslio/github-workflows/.github/workflows/production-deploy.yml: Error: GitHub API error: 404 - {"message":"Not Found"}
```

This typically means:

1. **Reusable workflows**: For reusable workflows like `owner/repo/.github/workflows/workflow.yml@ref`, the extension now correctly extracts just the repository name (`owner/repo`) for API calls while preserving the full path in updates.

2. **Sub-actions**: For GitHub Actions with sub-actions like `actions/cache/restore@ref` or `actions/cache/save@ref`, the extension now correctly extracts the base repository name (`actions/cache`) for API calls while preserving the full sub-action path in updates.

3. **Private repository access**: If the repository is private, ensure your token has access:
   - For fine-grained tokens: Add the repository to your token's repository access list
   - For classic tokens: Use the `repo` scope instead of `public_repo`

4. **Organization permissions**: For organization repositories with fine-grained tokens, the organization must approve your token

5. **Repository name format**: Ensure actions use the correct format: `owner/repo@version` (not file paths)
