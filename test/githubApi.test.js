const test = require("node:test");
const assert = require("node:assert/strict");
const { GitHubApiService } = require("../out/githubApi");

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function createMockApi(responses) {
  const api = new GitHubApiService("");
  let callIndex = 0;
  api.makeRequest = async (url) => {
    if (callIndex >= responses.length) {
      throw new Error(`Unexpected request #${callIndex}: ${url}`);
    }
    const response = responses[callIndex++];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return api;
}

test("getLatestActionVersion returns latest release when no cooldown", async () => {
  const api = createMockApi([
    [
      {
        tag_name: "v1.2.3",
        target_commitish: "main",
        prerelease: false,
        published_at: hoursAgo(48).toISOString(),
      },
    ],
    { object: { sha: "abc123", type: "commit" } },
  ]);

  const result = await api.getLatestActionVersion("owner/repo");

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.latestCommit, "abc123");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
});

test("getLatestActionVersion returns withinCooldown when release is too new", async () => {
  const api = createMockApi([
    [
      {
        tag_name: "v1.2.3",
        target_commitish: "main",
        prerelease: false,
        published_at: hoursAgo(2).toISOString(),
      },
    ],
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.withinCooldown, true);
  assert.ok(result.publishedAt > cutoff);
});

test("getLatestActionVersion returns release when published before cooldown", async () => {
  const api = createMockApi([
    [
      {
        tag_name: "v1.2.3",
        target_commitish: "main",
        prerelease: false,
        published_at: hoursAgo(48).toISOString(),
      },
    ],
    { object: { sha: "abc123", type: "commit" } },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.latestCommit, "abc123");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
});

test("getLatestActionVersion returns withinCooldown for semver tag when commit is too new", async () => {
  const api = createMockApi([
    [],
    [{ name: "v1.2.3", commit: { sha: "tagsha" } }],
    {
      sha: "tagsha",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.withinCooldown, true);
  assert.ok(result.publishedAt > cutoff);
});

test("getLatestActionVersion returns semver tag when commit is older than cooldown", async () => {
  const api = createMockApi([
    [],
    [{ name: "v1.2.3", commit: { sha: "tagsha" } }],
    {
      sha: "tagsha",
      commit: { committer: { date: hoursAgo(48).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.latestCommit, "tagsha");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
});

test("getLatestActionVersion returns withinCooldown for non-semver tag when commit is too new", async () => {
  const api = createMockApi([
    [],
    [{ name: "nightly", commit: { sha: "nightsha" } }],
    {
      sha: "nightsha",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "nightly");
  assert.equal(result.withinCooldown, true);
  assert.ok(result.publishedAt > cutoff);
});

test("getLatestActionVersion finds older commit on default branch when cutoff is set", async () => {
  const api = createMockApi([
    [],
    [],
    { default_branch: "main" },
    [
      {
        sha: "oldsha",
        commit: { committer: { date: hoursAgo(48).toISOString() } },
      },
    ],
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "main");
  assert.equal(result.latestCommit, "oldsha");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
});

test("getLatestActionVersion reports cooldown when default branch has no commit old enough", async () => {
  const api = createMockApi([
    [],
    [],
    { default_branch: "main" },
    [],
    {
      sha: "newsha",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "main");
  assert.equal(result.latestCommit, "newsha");
  assert.equal(result.withinCooldown, true);
  assert.ok(result.publishedAt > cutoff);
});

test("getLatestActionVersion uses latest commit on default branch when no cooldown", async () => {
  const api = createMockApi([
    [],
    [],
    { default_branch: "main" },
    {
      sha: "headsha",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
  ]);

  const result = await api.getLatestActionVersion("owner/repo");

  assert.equal(result.latestVersion, "main");
  assert.equal(result.latestCommit, "headsha");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
});

test("getLatestActionVersion returns tag with null publishedAt when no cooldown", async () => {
  const api = createMockApi([
    [],
    [{ name: "v1.2.3", commit: { sha: "tagsha" } }],
  ]);

  const result = await api.getLatestActionVersion("owner/repo");

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.latestCommit, "tagsha");
  assert.equal(result.withinCooldown, undefined);
  assert.equal(result.publishedAt, null);
});

test("getLatestActionVersion proceeds with tag when commit date fetch fails", async () => {
  const api = createMockApi([
    [],
    [{ name: "v1.2.3", commit: { sha: "tagsha" } }],
    new Error("network error"),
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.3");
  assert.equal(result.latestCommit, "tagsha");
  assert.equal(result.withinCooldown, undefined);
  assert.equal(result.publishedAt, null);
});
