const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");
const fs = require("fs");

const originalLoad = Module._load;

function createMockVscode(options = {}) {
  const registeredCommands = [];
  const documents = options.documents || new Map();
  const workspaceFolders = options.workspaceFolders || [];
  const replacements = [];
  const openedDocuments = [];
  const savedDocuments = [];
  const messages = [];
  const shownDocuments = [];
  const progressReports = [];

  let configuration = {
    suppressTokenWarning: false,
    cooldownHours: 0,
  };

  class MockUri {
    constructor(fsPath) {
      this.fsPath = fsPath;
    }
    static file(fsPath) {
      return new MockUri(fsPath);
    }
    toString() {
      return this.fsPath;
    }
  }

  class MockRange {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class MockRelativePattern {
    constructor(base, pattern) {
      this.base = typeof base === "string" ? base : base.fsPath;
      this.pattern = pattern;
    }
  }

  class MockWorkspaceEdit {
    replace(uri, range, content) {
      replacements.push({ uri, range, content });
    }
  }

  function createMockDocument(uri, content) {
    return {
      fileName: uri.fsPath,
      uri,
      getText() {
        return content;
      },
      positionAt(offset) {
        const lines = content.slice(0, offset).split("\n");
        return {
          line: lines.length - 1,
          character: lines[lines.length - 1].length,
        };
      },
      async save() {
        savedDocuments.push({ uri, content });
      },
    };
  }

  const mockVscode = {
    Uri: MockUri,
    Range: MockRange,
    RelativePattern: MockRelativePattern,
    WorkspaceEdit: MockWorkspaceEdit,
    ProgressLocation: { Notification: 1 },
    ConfigurationTarget: { Global: 1 },
    window: {
      activeTextEditor: options.activeTextEditor || null,
      createInputBox() {
        return {
          value: "",
          show: () => {},
          dispose: () => {},
          onDidAccept: () => {},
          onDidHide: () => {},
        };
      },
      showErrorMessage(msg) {
        messages.push({ type: "error", message: msg });
      },
      showWarningMessage(msg, ...items) {
        messages.push({ type: "warning", message: msg, items });
        return Promise.resolve(items[0]);
      },
      showInformationMessage(msg, ...items) {
        messages.push({ type: "info", message: msg, items });
        return Promise.resolve(undefined);
      },
      showTextDocument(doc) {
        shownDocuments.push(doc);
        return Promise.resolve(doc);
      },
      async withProgress(options, task) {
        const progress = {
          report(value) {
            progressReports.push(value);
          },
        };
        const token = { isCancellationRequested: false };
        return await task(progress, token);
      },
    },
    workspace: {
      workspaceFolders,
      getWorkspaceFolder() {
        return workspaceFolders[0] || undefined;
      },
      getConfiguration(section) {
        return {
          get(key, defaultValue) {
            return configuration[key] ?? defaultValue;
          },
          async update(key, value) {
            configuration[key] = value;
          },
        };
      },
      async openTextDocument(input) {
        if (input && typeof input === "object" && input.content !== undefined) {
          const uri = new MockUri("markdown://summary");
          return createMockDocument(uri, input.content);
        }
        const uri = input.fsPath ? input : new MockUri(input);
        openedDocuments.push(uri);
        if (documents.has(uri.fsPath)) {
          return createMockDocument(uri, documents.get(uri.fsPath));
        }
        if (uri.fsPath && fs.existsSync(uri.fsPath)) {
          return createMockDocument(uri, fs.readFileSync(uri.fsPath, "utf8"));
        }
        throw new Error(`Document not found: ${uri.fsPath}`);
      },
      async findFiles(pattern) {
        return options.findFilesResult || [];
      },
      async applyEdit() {
        return true;
      },
    },
    commands: {
      registerCommand(commandId, callback) {
        registeredCommands.push({ commandId, callback });
        return { dispose: () => {} };
      },
    },
  };

  return {
    mockVscode,
    registeredCommands,
    replacements,
    openedDocuments,
    savedDocuments,
    messages,
    shownDocuments,
    progressReports,
    setConfiguration(value) {
      configuration = { ...configuration, ...value };
    },
  };
}

function loadExtension(mockVscode, mockGithubApi) {
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return mockVscode;
    }
    if (request === "./githubApi" && mockGithubApi && parent && parent.filename && parent.filename.endsWith("out/extension.js")) {
      return mockGithubApi;
    }
    return originalLoad(request, parent, isMain);
  };

  const extensionPath = path.join(__dirname, "..", "out", "extension.js");
  delete require.cache[extensionPath];
  delete require.cache[path.join(__dirname, "..", "out", "githubApi.js")];
  delete require.cache[path.join(__dirname, "..", "out", "workflowParser.js")];

  return require(extensionPath);
}

test.after(() => {
  Module._load = originalLoad;
});

test("activate registers all commands", () => {
  const { mockVscode, registeredCommands } = createMockVscode();
  const extension = loadExtension(mockVscode);

  extension.activate({
    subscriptions: [],
    secrets: {
      get: async () => "",
    },
  });

  const commandIds = registeredCommands.map((c) => c.commandId);
  assert.ok(commandIds.includes("github-workflow-updater.updateWorkflow"));
  assert.ok(commandIds.includes("github-workflow-updater.updateAllWorkflows"));
  assert.ok(commandIds.includes("github-workflow-updater.configureToken"));
});

test("getCurrentFolder returns directory of a file URI", () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const fileUri = mockVscode.Uri.file("/repo/.github/workflows/ci.yml");
  const folder = extension.getCurrentFolder(fileUri);
  assert.equal(folder.fsPath, "/repo/.github/workflows");
});

test("getCurrentFolder returns a folder URI unchanged", () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const folderUri = mockVscode.Uri.file("/repo/.github/workflows");
  const folder = extension.getCurrentFolder(folderUri);
  assert.equal(folder.fsPath, "/repo/.github/workflows");
});

test("getCurrentFolder falls back to active editor file directory", () => {
  const { mockVscode } = createMockVscode({
    activeTextEditor: {
      document: {
        uri: {
          fsPath: "/repo/.github/workflows/ci.yml",
        },
      },
    },
  });
  const extension = loadExtension(mockVscode);

  const folder = extension.getCurrentFolder();
  assert.equal(folder.fsPath, "/repo/.github/workflows");
});

test("getCurrentFolder falls back to first workspace folder", () => {
  const { mockVscode } = createMockVscode({
    workspaceFolders: [
      {
        uri: { fsPath: "/repo" },
        name: "repo",
        index: 0,
      },
    ],
  });
  const extension = loadExtension(mockVscode);

  const folder = extension.getCurrentFolder();
  assert.equal(folder.fsPath, "/repo");
});

test("findWorkflowFiles returns the correct relative pattern", () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const folder = mockVscode.Uri.file("/repo");
  const pattern = extension.findWorkflowFiles(folder);
  assert.equal(pattern.base, "/repo");
  assert.equal(pattern.pattern, "**/*.{yml,yaml}");
});

test("processWorkflowContent returns updates for outdated actions", async () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const githubApi = {
    async getLatestActionVersion(repository) {
      return {
        latestVersion: "v4.2.2",
        latestCommit: "11bd71901bbe5b1630ceea73d27597364c9af683",
        publishedAt: new Date("2024-01-01"),
      };
    },
  };

  const content = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ].join("\n");

  const result = await extension.processWorkflowContent(
    content,
    githubApi,
    undefined,
    0
  );

  assert.equal(result.actionsFound, 1);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].repository, "actions/checkout");
  assert.equal(result.updates[0].newVersion, "v4.2.2");
  assert.ok(
    result.updates[0].updated.includes(
      "@11bd71901bbe5b1630ceea73d27597364c9af683"
    )
  );
});

test("processWorkflowContent skips already-pinned actions", async () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const githubApi = {
    async getLatestActionVersion() {
      return {
        latestVersion: "v4.2.2",
        latestCommit: "11bd71901bbe5b1630ceea73d27597364c9af683",
        publishedAt: new Date("2024-01-01"),
      };
    },
  };

  const content = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
  ].join("\n");

  const result = await extension.processWorkflowContent(
    content,
    githubApi,
    undefined,
    0
  );

  assert.equal(result.updates.length, 0);
});

test("processWorkflowContent respects #skip-pinning", async () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const githubApi = {
    async getLatestActionVersion() {
      return {
        latestVersion: "v4.2.2",
        latestCommit: "11bd71901bbe5b1630ceea73d27597364c9af683",
        publishedAt: new Date("2024-01-01"),
      };
    },
  };

  const content = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@main # skip-pinning",
  ].join("\n");

  const result = await extension.processWorkflowContent(
    content,
    githubApi,
    undefined,
    0
  );

  assert.equal(result.actionsFound, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.updates.length, 0);
});

test("processWorkflowContent respects cooldown", async () => {
  const { mockVscode } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const githubApi = {
    async getLatestActionVersion() {
      return {
        latestVersion: "v5.0.0",
        latestCommit: "abc123",
        publishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        withinCooldown: true,
      };
    },
  };

  const content = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ].join("\n");

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await extension.processWorkflowContent(
    content,
    githubApi,
    cutoff,
    24
  );

  assert.equal(result.updates.length, 0);
  assert.equal(result.cooldownSkips.length, 1);
  assert.equal(result.cooldownSkips[0].cooldownHours, 24);
});

test("applyWorkflowUpdates applies replacements via WorkspaceEdit", async () => {
  const { mockVscode, replacements } = createMockVscode();
  const extension = loadExtension(mockVscode);

  const content = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ].join("\n");

  const document = {
    fileName: "/repo/.github/workflows/ci.yml",
    uri: mockVscode.Uri.file("/repo/.github/workflows/ci.yml"),
    getText() {
      return content;
    },
    positionAt(offset) {
      const lines = content.slice(0, offset).split("\n");
      return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
      };
    },
  };

  const updates = [
    {
      line: 3,
      original: "      - uses: actions/checkout@v4",
      updated:
        "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
      repository: "actions/checkout",
      oldVersion: "v4",
      newVersion: "v4.2.2",
      newCommit: "11bd71901bbe5b1630ceea73d27597364c9af683",
    },
  ];

  await extension.applyWorkflowUpdates(document, updates);

  assert.equal(replacements.length, 1);
  const expectedUpdatedContent = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
  ].join("\n");
  assert.equal(replacements[0].content, expectedUpdatedContent);
});

test("updateAllWorkflows command processes and saves workflow files", async () => {
  const workflowContent = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ].join("\n");

  const filePath = "/repo/.github/workflows/ci.yml";
  const documents = new Map([[filePath, workflowContent]]);

  const { mockVscode, registeredCommands, savedDocuments, messages } =
    createMockVscode({
      documents,
      findFilesResult: [{ fsPath: filePath }],
    });
  mockVscode.workspace.getConfiguration().update("suppressTokenWarning", true);

  const mockGithubApi = {
    GitHubApiService: class {
      constructor() {}
      async getLatestActionVersion() {
        return {
          latestVersion: "v4.2.2",
          latestCommit: "11bd71901bbe5b1630ceea73d27597364c9af683",
          publishedAt: new Date("2024-01-01"),
        };
      }
    },
  };

  const extension = loadExtension(mockVscode, mockGithubApi);
  const context = {
    subscriptions: [],
    secrets: {
      get: async () => "",
    },
  };

  extension.activate(context);

  const allWorkflowsCommand = registeredCommands.find(
    (c) => c.commandId === "github-workflow-updater.updateAllWorkflows"
  );
  assert.ok(allWorkflowsCommand);

  await allWorkflowsCommand.callback(mockVscode.Uri.file("/repo"));

  assert.equal(savedDocuments.length, 1);
  assert.equal(savedDocuments[0].uri.fsPath, filePath);

  const infoMessage = messages.find((m) => m.type === "info");
  assert.ok(infoMessage);
  assert.ok(infoMessage.message.includes("Updated"));
});
