import * as vscode from "vscode";
import { GitHubApiService, ActionUpdate } from "./githubApi";
import { WorkflowParser, WorkflowAction, UpdateResult } from "./workflowParser";

export function activate(context: vscode.ExtensionContext) {
  // Migrate existing token from configuration to secret storage
  migrateTokenToSecretStorage(context);

  const updateCommand = vscode.commands.registerCommand(
    "github-workflow-updater.updateWorkflow",
    async () => {
      await updateWorkflowCommand(context);
    }
  );

  const configureTokenCommand = vscode.commands.registerCommand(
    "github-workflow-updater.configureToken",
    async () => {
      await configureToken(context);
    }
  );

  context.subscriptions.push(updateCommand);
  context.subscriptions.push(configureTokenCommand);
}

async function updateWorkflowCommand(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("No active editor found");
    return;
  }

  const document = editor.document;
  const filePath = document.fileName;

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

  // Get GitHub token from secret storage
  const githubToken = await getStoredToken(context);
  const config = vscode.workspace.getConfiguration("github-workflow-updater");
  const suppressTokenWarning = config.get<boolean>(
    "suppressTokenWarning",
    false
  );

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
        const actions = WorkflowParser.parseWorkflow(content);

        if (actions.length === 0) {
          vscode.window.showInformationMessage(
            "No GitHub actions found in this workflow"
          );
          return;
        }

        const skippedActions = actions.filter(
          (action) => action.hasSkipPinning
        );
        const actionsToUpdate = actions.filter(
          (action) => !action.hasSkipPinning
        );

        if (skippedActions.length > 0) {
          vscode.window.showInformationMessage(
            `Skipping ${skippedActions.length} action(s) marked with skip-pinning`
          );
        }

        if (actionsToUpdate.length === 0) {
          vscode.window.showInformationMessage(
            "All actions are marked to skip pinning"
          );
          return;
        }

        progress.report({
          message: `Processing ${actionsToUpdate.length} actions...`,
        });

        const updates: UpdateResult[] = [];
        const errors: string[] = [];

        for (let i = 0; i < actionsToUpdate.length; i++) {
          if (token.isCancellationRequested) {
            return;
          }

          const action = actionsToUpdate[i];
          progress.report({
            message: `Updating ${action.repository}...`,
            increment: 100 / actionsToUpdate.length,
          });

          try {
            const updateInfo = await githubApi.getLatestActionVersion(
              action.repository
            );

            if (updateInfo) {
              // Check if already up-to-date
              const currentVersion = WorkflowParser.extractVersionFromComment(
                action.currentComment
              );
              const isAlreadyPinned = action.currentRef.length === 40; // SHA is 40 chars
              const isSameVersion = WorkflowParser.areVersionsEqual(
                currentVersion,
                updateInfo.latestVersion
              );
              const isSameCommit =
                action.currentRef === updateInfo.latestCommit;

              // Debug logging
              console.log(
                `${action.repository}: current="${currentVersion}", latest="${updateInfo.latestVersion}", pinned=${isAlreadyPinned}, sameVersion=${isSameVersion}, sameCommit=${isSameCommit}`
              );

              if (isAlreadyPinned && (isSameVersion || isSameCommit)) {
                // Skip - already up to date
                continue;
              }

              const updatedLine = WorkflowParser.updateActionLine(
                action,
                updateInfo.latestVersion,
                updateInfo.latestCommit
              );

              updates.push({
                line: action.line,
                original: action.original,
                updated: updatedLine,
                repository: action.repository,
                oldVersion: currentVersion || action.currentRef,
                newVersion: updateInfo.latestVersion,
                newCommit: updateInfo.latestCommit,
              });
            }
          } catch (error) {
            const errorMsg = `Failed to update ${action.repository}: ${error}`;
            errors.push(errorMsg);
            console.error(errorMsg);
          }
        }

        // Apply updates
        if (updates.length > 0) {
          const updatedContent = WorkflowParser.applyUpdates(content, updates);

          // Replace the entire document content
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(content.length)
          );
          edit.replace(document.uri, fullRange, updatedContent);

          await vscode.workspace.applyEdit(edit);

          // Show summary
          const summary = createUpdateSummary(updates);
          vscode.window
            .showInformationMessage(
              `Updated ${updates.length} action(s)`,
              "Show Details"
            )
            .then((selection) => {
              if (selection === "Show Details") {
                showUpdateDetails(updates, errors);
              }
            });
        } else {
          vscode.window.showInformationMessage("No actions needed updating");
        }

        // Show errors if any
        if (errors.length > 0) {
          vscode.window
            .showWarningMessage(
              `${errors.length} error(s) occurred during update`,
              "Show Errors"
            )
            .then((selection) => {
              if (selection === "Show Errors") {
                showErrors(errors);
              }
            });
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update workflow: ${error}`);
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

function createUpdateSummary(updates: UpdateResult[]): string {
  return updates
    .map(
      (update) =>
        `${update.repository}: ${update.oldVersion} → ${update.newVersion}`
    )
    .join("\n");
}

function showUpdateDetails(updates: UpdateResult[], errors: string[]): void {
  const content = [
    "# GitHub Workflow Update Summary",
    "",
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

      return `- **${update.repository}**: ${update.oldVersion} → ${
        update.newVersion
      } ([View ${isTaggedVersion ? "Release" : "Commit"}](${link}))`;
    }),
    "",
    ...(errors.length > 0
      ? ["## Errors", ...errors.map((error) => `- ${error}`)]
      : []),
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

export function deactivate() {}
