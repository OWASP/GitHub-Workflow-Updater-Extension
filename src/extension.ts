import * as vscode from "vscode";
import * as path from "path";
import { GitHubApiService } from "./githubApi";
import { WorkflowParser, UpdateResult } from "./workflowParser";

interface CooldownSkip {
  repository: string;
  latestVersion: string;
  publishedAt: Date | null;
  cooldownHours: number;
}

interface ProcessResult {
  updates: UpdateResult[];
  errors: string[];
  cooldownSkips: CooldownSkip[];
  skippedCount: number;
  actionsFound: number;
}

export function activate(context: vscode.ExtensionContext) {
  // Migrate existing token from configuration to secret storage
  migrateTokenToSecretStorage(context);

  const updateCommand = vscode.commands.registerCommand(
    "github-workflow-updater.updateWorkflow",
    async (uri?: vscode.Uri) => {
      await updateWorkflowCommand(context, uri);
    }
  );

  const updateAllCommand = vscode.commands.registerCommand(
    "github-workflow-updater.updateAllWorkflows",
    async (uri?: vscode.Uri) => {
      await updateAllWorkflowsInCurrentFolder(context, uri);
    }
  );

  const configureTokenCommand = vscode.commands.registerCommand(
    "github-workflow-updater.configureToken",
    async () => {
      await configureToken(context);
    }
  );

  context.subscriptions.push(updateCommand);
  context.subscriptions.push(updateAllCommand);
  context.subscriptions.push(configureTokenCommand);
}

async function updateWorkflowCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri
): Promise<void> {
  let document: vscode.TextDocument;
  let filePath: string;

  if (uri) {
    document = await vscode.workspace.openTextDocument(uri);
    filePath = uri.fsPath;
  } else {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active editor found");
      return;
    }

    document = editor.document;
    filePath = document.fileName;
  }

  // Check if it's a workflow file
  if (
    !WorkflowParser.isWorkflowFile(filePath) &&
    !isLikelyWorkflowFile(document.getText())
  ) {
    const proceed = await vscode.window.showWarningMessage(
      "This doesn't appear to be a GitHub workflow file. Continue anyway?",
      "Yes",
      "No"
    );
    if (proceed !== "Yes") {
      return;
    }
  }

  const content = document.getText();

  // Validate workflow syntax
  const validation = WorkflowParser.validateWorkflowSyntax(content);
  if (!validation.valid) {
    vscode.window.showErrorMessage(
      `Invalid workflow file: ${validation.error}`
    );
    return;
  }

  const { githubToken, suppressTokenWarning, cooldownHours, cutoffTime } =
    await getTokenAndSettings(context);

  if (!githubToken && !suppressTokenWarning) {
    const result = await vscode.window.showWarningMessage(
      "No GitHub token configured. This may limit access to private repositories.",
      "Configure Token",
      "Continue Anyway",
      "Don't Show Again"
    );

    if (result === "Configure Token") {
      await configureToken(context);
      return;
    } else if (result === "Don't Show Again") {
      const config = vscode.workspace.getConfiguration("github-workflow-updater");
      await config.update(
        "suppressTokenWarning",
        true,
        vscode.ConfigurationTarget.Global
      );
    }
  }

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Updating GitHub Workflow Actions",
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const githubApi = new GitHubApiService(githubToken);
        progress.report({
          message: `Processing ${path.basename(document.fileName)}...`,
        });

        const result = await processWorkflowContent(
          content,
          githubApi,
          cutoffTime,
          cooldownHours,
          token
        );

        if (result.actionsFound === 0) {
          vscode.window.showInformationMessage(
            "No GitHub actions found in this workflow"
          );
          return;
        }

        if (result.skippedCount > 0) {
          vscode.window.showInformationMessage(
            `Skipping ${result.skippedCount} action(s) marked with skip-pinning`
          );
        }

        if (result.actionsFound === result.skippedCount) {
          vscode.window.showInformationMessage(
            "All actions are marked to skip pinning"
          );
          return;
        }

        await applyWorkflowUpdates(document, result.updates);

        // Show summary
        if (result.updates.length > 0) {
          let message = `Updated ${result.updates.length} action(s)`;
          if (result.cooldownSkips.length > 0) {
            message += `, ${result.cooldownSkips.length} skipped due to cooldown`;
          }
          vscode.window
            .showInformationMessage(message, "Show Details")
            .then((selection) => {
              if (selection === "Show Details") {
                showUpdateDetails(
                  result.updates,
                  result.errors,
                  result.cooldownSkips
                );
              }
            });
        } else if (result.cooldownSkips.length > 0) {
          vscode.window
            .showInformationMessage(
              `${result.cooldownSkips.length} action(s) skipped due to cooldown`,
              "Show Details"
            )
            .then((selection) => {
              if (selection === "Show Details") {
                showUpdateDetails(
                  result.updates,
                  result.errors,
                  result.cooldownSkips
                );
              }
            });
        } else {
          vscode.window.showInformationMessage("No actions needed updating");
        }

        // Show errors if any
        if (result.errors.length > 0) {
          vscode.window
            .showWarningMessage(
              `${result.errors.length} error(s) occurred during update`,
              "Show Errors"
            )
            .then((selection) => {
              if (selection === "Show Errors") {
                showErrors(result.errors);
              }
            });
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update workflow: ${error}`);
      }
    }
  );
}

async function getTokenAndSettings(
  context: vscode.ExtensionContext
): Promise<{
  githubToken: string;
  suppressTokenWarning: boolean;
  cooldownHours: number;
  cutoffTime: Date | undefined;
}> {
  const githubToken = await getStoredToken(context);
  const config = vscode.workspace.getConfiguration("github-workflow-updater");
  const suppressTokenWarning = config.get<boolean>(
    "suppressTokenWarning",
    false
  );
  const cooldownHours = config.get<number>("cooldownHours", 0);
  const cutoffTime =
    cooldownHours > 0
      ? new Date(Date.now() - cooldownHours * 60 * 60 * 1000)
      : undefined;

  return { githubToken, suppressTokenWarning, cooldownHours, cutoffTime };
}

async function processWorkflowContent(
  content: string,
  githubApi: GitHubApiService,
  cutoffTime: Date | undefined,
  cooldownHours: number,
  token?: vscode.CancellationToken
): Promise<ProcessResult> {
  const actions = WorkflowParser.parseWorkflow(content);
  const result: ProcessResult = {
    updates: [],
    errors: [],
    cooldownSkips: [],
    skippedCount: 0,
    actionsFound: actions.length,
  };

  if (actions.length === 0) {
    return result;
  }

  const skippedActions = actions.filter((action) => action.hasSkipPinning);
  const actionsToUpdate = actions.filter((action) => !action.hasSkipPinning);
  result.skippedCount = skippedActions.length;

  for (let i = 0; i < actionsToUpdate.length; i++) {
    if (token?.isCancellationRequested) {
      break;
    }

    const action = actionsToUpdate[i];

    try {
      const updateInfo = await githubApi.getLatestActionVersion(
        action.repository,
        cutoffTime
      );

      if (!updateInfo) {
        continue;
      }

      // Check if already up-to-date (even if within cooldown)
      const currentVersion = WorkflowParser.extractVersionFromComment(
        action.currentComment
      );
      const isAlreadyPinned = action.currentRef.length === 40; // SHA is 40 chars
      const isSameVersion = WorkflowParser.areVersionsEqual(
        currentVersion,
        updateInfo.latestVersion
      );
      const isSameCommit =
        updateInfo.latestCommit &&
        action.currentRef === updateInfo.latestCommit;

      // Debug logging
      console.log(
        `${action.repository}: current="${currentVersion}", latest="${updateInfo.latestVersion}", pinned=${isAlreadyPinned}, sameVersion=${isSameVersion}, sameCommit=${isSameCommit}`
      );

      if (isAlreadyPinned && (isSameVersion || isSameCommit)) {
        // Skip - already up to date
        continue;
      }

      // Not on the latest version — check cooldown
      if (updateInfo.withinCooldown) {
        result.cooldownSkips.push({
          repository: action.repository,
          latestVersion: updateInfo.latestVersion,
          publishedAt: updateInfo.publishedAt,
          cooldownHours,
        });
        continue;
      }

      const updatedLine = WorkflowParser.updateActionLine(
        action,
        updateInfo.latestVersion,
        updateInfo.latestCommit
      );

      result.updates.push({
        line: action.line,
        original: action.original,
        updated: updatedLine,
        repository: action.repository,
        oldVersion: currentVersion || action.currentRef,
        newVersion: updateInfo.latestVersion,
        newCommit: updateInfo.latestCommit,
      });
    } catch (error) {
      const errorMsg = `Failed to update ${action.repository}: ${error}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  return result;
}

async function applyWorkflowUpdates(
  document: vscode.TextDocument,
  updates: UpdateResult[]
): Promise<boolean> {
  if (updates.length === 0) {
    return false;
  }

  const content = document.getText();
  const updatedContent = WorkflowParser.applyUpdates(content, updates);

  // Replace the entire document content
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(content.length)
  );
  edit.replace(document.uri, fullRange, updatedContent);

  return await vscode.workspace.applyEdit(edit);
}

function getCurrentFolder(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri) {
    const fsPath = uri.fsPath;
    if (/\.(yml|yaml)$/i.test(fsPath)) {
      return vscode.Uri.file(path.dirname(fsPath));
    }
    return vscode.Uri.file(fsPath);
  }

  const editor = vscode.window.activeTextEditor;
  if (editor?.document?.uri) {
    return vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return workspaceFolder.uri;
  }

  return undefined;
}

function findWorkflowFiles(folder: vscode.Uri): vscode.RelativePattern {
  return new vscode.RelativePattern(folder, "**/*.{yml,yaml}");
}

async function updateAllWorkflowsInCurrentFolder(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri
): Promise<void> {
  const currentFolder = getCurrentFolder(uri);
  if (!currentFolder) {
    vscode.window.showErrorMessage(
      "No current folder found. Open a file or folder first."
    );
    return;
  }

  const { githubToken, suppressTokenWarning, cooldownHours, cutoffTime } =
    await getTokenAndSettings(context);

  if (!githubToken && !suppressTokenWarning) {
    const result = await vscode.window.showWarningMessage(
      "No GitHub token configured. This may limit access to private repositories.",
      "Configure Token",
      "Continue Anyway",
      "Don't Show Again"
    );

    if (result === "Configure Token") {
      await configureToken(context);
      return;
    } else if (result === "Don't Show Again") {
      const config = vscode.workspace.getConfiguration(
        "github-workflow-updater"
      );
      await config.update(
        "suppressTokenWarning",
        true,
        vscode.ConfigurationTarget.Global
      );
    }
  }

  const files = await vscode.workspace.findFiles(findWorkflowFiles(currentFolder));

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      "No workflow files found in the current folder"
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Updating All GitHub Workflow Actions",
      cancellable: true,
    },
    async (progress, token) => {
      const githubApi = new GitHubApiService(githubToken);

      let totalUpdatedFiles = 0;
      let totalUpdatedActions = 0;
      let totalCooldownSkips = 0;
      let totalSkipPinning = 0;
      const allErrors: string[] = [];
      const allUpdates: UpdateResult[] = [];
      const allCooldownSkips: CooldownSkip[] = [];

      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        const file = files[i];
        const fileName = path.basename(file.fsPath);
        progress.report({
          message: `Processing ${fileName} (${i + 1}/${files.length})...`,
          increment: 100 / files.length,
        });

        try {
          const document = await vscode.workspace.openTextDocument(file);
          const content = document.getText();

          const validation = WorkflowParser.validateWorkflowSyntax(content);
          if (!validation.valid) {
            allErrors.push(
              `${file.fsPath}: Invalid workflow syntax - ${validation.error}`
            );
            continue;
          }

          const result = await processWorkflowContent(
            content,
            githubApi,
            cutoffTime,
            cooldownHours,
            token
          );

          totalSkipPinning += result.skippedCount;

          if (result.updates.length > 0) {
            const applied = await applyWorkflowUpdates(document, result.updates);
            if (applied) {
              await document.save();
              totalUpdatedFiles++;
              totalUpdatedActions += result.updates.length;
              allUpdates.push(
                ...result.updates.map((update) => ({
                  ...update,
                  filePath: file.fsPath,
                }))
              );
            }
          }

          if (result.cooldownSkips.length > 0) {
            totalCooldownSkips += result.cooldownSkips.length;
            allCooldownSkips.push(...result.cooldownSkips);
          }

          allErrors.push(...result.errors.map((e) => `${file.fsPath}: ${e}`));
        } catch (error) {
          const errorMsg = `Failed to process ${file.fsPath}: ${error}`;
          allErrors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      if (allUpdates.length === 0 && allCooldownSkips.length === 0) {
        if (allErrors.length > 0) {
          vscode.window
            .showWarningMessage(
              `No actions were updated. ${allErrors.length} error(s) occurred.`,
              "Show Errors"
            )
            .then((selection) => {
              if (selection === "Show Errors") {
                showErrors(allErrors);
              }
            });
        } else {
          vscode.window.showInformationMessage(
            "No actions needed updating in any workflow file"
          );
        }
        return;
      }

      // Show summary
      let message = `Updated ${totalUpdatedActions} action(s) in ${totalUpdatedFiles} file(s)`;
      if (totalCooldownSkips > 0) {
        message += `, ${totalCooldownSkips} skipped due to cooldown`;
      }
      if (totalSkipPinning > 0) {
        message += `, ${totalSkipPinning} skipped by #skip-pinning`;
      }

      vscode.window
        .showInformationMessage(message, "Show Details")
        .then((selection) => {
          if (selection === "Show Details") {
            showUpdateDetails(allUpdates, allErrors, allCooldownSkips);
          }
        });

      // Show errors if any
      if (allErrors.length > 0) {
        vscode.window
          .showWarningMessage(
            `${allErrors.length} error(s) occurred during update`,
            "Show Errors"
          )
          .then((selection) => {
            if (selection === "Show Errors") {
              showErrors(allErrors);
            }
          });
      }
    }
  );
}

function isLikelyWorkflowFile(content: string): boolean {
  // Check for common workflow patterns
  return (
    content.includes("uses:") &&
    (content.includes("jobs:") || content.includes("on:"))
  );
}

function showUpdateDetails(
  updates: UpdateResult[],
  errors: string[],
  cooldownSkips: CooldownSkip[]
): void {
  const sections: string[] = ["# GitHub Workflow Update Summary", ""];

  if (updates.length > 0) {
    sections.push(
      "## Updated Actions",
      ...updates.map((update) => {
        const isTaggedVersion = update.newVersion.match(/^v?\d+\.\d+\.\d+/);
        let link = "";

        if (isTaggedVersion) {
          // Link to release notes
          link = `https://github.com/${update.repository}/releases/tag/${update.newVersion}`;
        } else {
          // Link to commit
          link = `https://github.com/${update.repository}/commit/${update.newCommit}`;
        }

        const location = update.filePath
          ? `${path.basename(update.filePath)} → `
          : "";

        return `- **${location}${update.repository}**: ${update.oldVersion} → ${
          update.newVersion
        } ([View ${isTaggedVersion ? "Release" : "Commit"}](${link}))`;
      }),
      ""
    );
  }

  if (cooldownSkips.length > 0) {
    sections.push(
      "## Skipped Due to Cooldown",
      ...cooldownSkips.map((skip) => {
        const dateStr = skip.publishedAt
          ? skip.publishedAt.toISOString().replace("T", " ").slice(0, 19)
          : "unknown";
        return `- **${skip.repository}**: Latest version ${skip.latestVersion}${
          dateStr !== "unknown" ? ` published at ${dateStr}` : ""
        } (within ${skip.cooldownHours}h cooldown)`;
      }),
      ""
    );
  }

  if (errors.length > 0) {
    sections.push("## Errors", ...errors.map((error) => `- ${error}`));
  }

  const content = sections.join("\n");

  vscode.workspace
    .openTextDocument({
      content,
      language: "markdown",
    })
    .then((doc) => {
      vscode.window.showTextDocument(doc);
    });
}

function showErrors(errors: string[]): void {
  const content = [
    "# GitHub Workflow Update Errors",
    "",
    ...errors.map((error) => `- ${error}`),
  ].join("\n");

  vscode.workspace
    .openTextDocument({
      content,
      language: "markdown",
    })
    .then((doc) => {
      vscode.window.showTextDocument(doc);
    });
}

async function getStoredToken(
  context: vscode.ExtensionContext
): Promise<string> {
  try {
    const token = await context.secrets.get("githubToken");
    return token || "";
  } catch (error) {
    console.error("Failed to retrieve token from secret storage:", error);
    return "";
    }
}

async function setStoredToken(
  context: vscode.ExtensionContext,
  token: string
): Promise<void> {
  try {
    if (token) {
      await context.secrets.store("githubToken", token);
    } else {
      await context.secrets.delete("githubToken");
    }
  } catch (error) {
    console.error("Failed to store token in secret storage:", error);
    throw error;
  }
}

async function configureToken(context: vscode.ExtensionContext): Promise<void> {
  const currentToken = await getStoredToken(context);

  const inputBox = vscode.window.createInputBox();
  inputBox.title = "Configure GitHub Token";
  inputBox.placeholder = "Enter your GitHub Personal Access Token";
  inputBox.password = true;
  inputBox.value = currentToken;
  inputBox.prompt = "Leave empty to clear the token";

  inputBox.onDidAccept(async () => {
    const token = inputBox.value.trim();
    try {
      await setStoredToken(context, token);
      if (token) {
        vscode.window.showInformationMessage(
          "GitHub token configured successfully"
        );
      } else {
        vscode.window.showInformationMessage("GitHub token cleared");
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to configure token: ${error}`);
    }
    inputBox.dispose();
  });

  inputBox.onDidHide(() => {
    inputBox.dispose();
  });

  inputBox.show();
}

async function migrateTokenToSecretStorage(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    // Check if token is already in secret storage
    const existingSecret = await context.secrets.get("githubToken");
    if (existingSecret) {
      // Already migrated
      return;
    }

    // Check if token exists in old configuration
    const config = vscode.workspace.getConfiguration("github-workflow-updater");
    const oldToken = config.get<string>("githubToken", "");

    if (oldToken && oldToken.trim()) {
      // Migrate to secret storage
      await context.secrets.store("githubToken", oldToken);

      // Remove from configuration
      await config.update(
        "githubToken",
        undefined,
        vscode.ConfigurationTarget.Global
      );
      if (vscode.workspace.workspaceFolders) {
        await config.update(
          "githubToken",
          undefined,
          vscode.ConfigurationTarget.Workspace
        );
      }

      console.log(
        "Successfully migrated GitHub token from configuration to secret storage"
      );
    }
  } catch (error) {
    console.error("Failed to migrate token to secret storage:", error);
  }
}

export {
  getCurrentFolder,
  findWorkflowFiles,
  processWorkflowContent,
  applyWorkflowUpdates,
};

export function deactivate() {}
