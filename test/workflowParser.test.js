const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { WorkflowParser } = require("../out/workflowParser");

const fixturePath = path.join(__dirname, "..", "test-workflow.yml");
const fixtureContent = fs.readFileSync(fixturePath, "utf8");
const fixtureLines = fixtureContent.split("\n");

function getActionByFullPath(actions, fullPath) {
  const action = actions.find((candidate) => candidate.fullPath === fullPath);
  assert.ok(action, `expected to find action ${fullPath}`);
  return action;
}

function getActionByLine(actions, lineNumber) {
  const action = actions.find((candidate) => candidate.line === lineNumber - 1);
  assert.ok(action, `expected to find action on line ${lineNumber}`);
  return action;
}

test("test-workflow fixture parses as a valid workflow", () => {
  const validation = WorkflowParser.validateWorkflowSyntax(fixtureContent);

  assert.equal(validation.valid, true);
  assert.equal(validation.error, undefined);
});

test("test-workflow fixture extracts actions, skip markers, and repository paths", () => {
  const actions = WorkflowParser.parseWorkflow(fixtureContent);

  assert.equal(actions.length, 15);
  assert.equal(actions.filter((action) => action.hasSkipPinning).length, 1);

  const checkout = getActionByFullPath(actions, "actions/checkout");
  assert.equal(checkout.repository, "actions/checkout");

  const cacheRestore = getActionByFullPath(actions, "actions/cache/restore");
  assert.equal(cacheRestore.repository, "actions/cache");
  assert.equal(cacheRestore.fullPath, "actions/cache/restore");
});

test("every action example in test-workflow.yml is parsed with the expected metadata", () => {
  const actions = WorkflowParser.parseWorkflow(fixtureContent);

  const expectedExamples = [
    {
      lineNumber: 14,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "tag v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 15,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "main",
      currentComment: "skip-pinning",
      hasSkipPinning: true,
      extractedVersion: "",
    },
    {
      lineNumber: 16,
      repository: "actions/cache",
      fullPath: "actions/cache/restore",
      currentRef: "5a3ec84eff668545956fd18022155c47e93e2684",
      currentComment: "tag v4.2.3",
      hasSkipPinning: false,
      extractedVersion: "v4.2.3",
    },
    {
      lineNumber: 18,
      repository: "corentinmusard/otel-cicd-action",
      fullPath: "corentinmusard/otel-cicd-action",
      currentRef: "90a4ca6ee4911b65f8e305b7fd7fe70675690362",
      currentComment: "tag v2.2.2",
      hasSkipPinning: false,
      extractedVersion: "v2.2.2",
    },
    {
      lineNumber: 28,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 29,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "4.2.2",
      hasSkipPinning: false,
      extractedVersion: "4.2.2",
    },
    {
      lineNumber: 30,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "@v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 31,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "pin @v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 32,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "tag=v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 33,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "tag v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 34,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 35,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "v4.2.2",
      hasSkipPinning: false,
      extractedVersion: "v4.2.2",
    },
    {
      lineNumber: 40,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "Versions older than v4.2.2 have a security vulnerability",
      hasSkipPinning: false,
      extractedVersion: "",
    },
    {
      lineNumber: 41,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "v4.2.2 - This is an important note",
      hasSkipPinning: false,
      extractedVersion: "",
    },
    {
      lineNumber: 42,
      repository: "actions/checkout",
      fullPath: "actions/checkout",
      currentRef: "11bd71901bbe5b1630ceea73d27597364c9af683",
      currentComment: "do not update this comment",
      hasSkipPinning: false,
      extractedVersion: "",
    },
  ];

  assert.equal(expectedExamples.length, actions.length);

  for (const expected of expectedExamples) {
    const action = getActionByLine(actions, expected.lineNumber);

    assert.equal(action.repository, expected.repository);
    assert.equal(action.fullPath, expected.fullPath);
    assert.equal(action.currentRef, expected.currentRef);
    assert.equal(action.currentComment, expected.currentComment);
    assert.equal(action.hasSkipPinning, expected.hasSkipPinning);
    assert.equal(
      WorkflowParser.extractVersionFromComment(action.currentComment),
      expected.extractedVersion
    );
  }
});

test("every action example in test-workflow.yml rewrites deterministically with mocked metadata", () => {
  const actions = WorkflowParser.parseWorkflow(fixtureContent);
  const mockedCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const mockedVersion = "v9.9.9";

  const updates = actions
    .filter((action) => !action.hasSkipPinning)
    .map((action) => ({
      line: action.line,
      original: action.original,
      updated: WorkflowParser.updateActionLine(
        action,
        mockedVersion,
        mockedCommit
      ),
      repository: action.repository,
      oldVersion: action.currentRef,
      newVersion: mockedVersion,
      newCommit: mockedCommit,
    }));

  const updatedContent = WorkflowParser.applyUpdates(fixtureContent, updates);
  const updatedLines = updatedContent.split("\n");

  const expectedUpdatedLines = [
    [14, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [15, fixtureLines[14]],
    [16, `      - uses: actions/cache/restore@${mockedCommit} # v9.9.9`],
    [18, `        uses: corentinmusard/otel-cicd-action@${mockedCommit} # v9.9.9`],
    [28, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [29, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [30, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [31, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [32, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [33, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [34, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [35, `      - uses: actions/checkout@${mockedCommit} # v9.9.9`],
    [
      40,
      `      - uses: actions/checkout@${mockedCommit} # Versions older than v4.2.2 have a security vulnerability`,
    ],
    [
      41,
      `      - uses: actions/checkout@${mockedCommit} # v4.2.2 - This is an important note`,
    ],
    [
      42,
      `      - uses: actions/checkout@${mockedCommit} # do not update this comment`,
    ],
  ];

  for (const [lineNumber, expectedLine] of expectedUpdatedLines) {
    assert.equal(updatedLines[lineNumber - 1], expectedLine);
  }

  const normalizedVersionComments = updatedContent.match(/# v9\.9\.9/g) || [];
  assert.equal(normalizedVersionComments.length, 11);
  assert.equal(
    (updatedContent.match(new RegExp(mockedCommit, "g")) || []).length,
    14
  );
});

test("reusable workflows are mapped to the repository while preserving the workflow path", () => {
  const reusableWorkflow = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: owner/repo/.github/workflows/reusable.yml@v1",
  ].join("\n");

  const [action] = WorkflowParser.parseWorkflow(reusableWorkflow);

  assert.equal(action.repository, "owner/repo");
  assert.equal(action.fullPath, "owner/repo/.github/workflows/reusable.yml");
});
