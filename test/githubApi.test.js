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

test("getLatestActionVersion returns previous release when latest is within cooldown", async () => {
  const api = createMockApi([
    [
      {
        tag_name: "v1.2.3",
        target_commitish: "main",
        prerelease: false,
        published_at: hoursAgo(2).toISOString(),
      },
      {
        tag_name: "v1.2.2",
        target_commitish: "main",
        prerelease: false,
        published_at: hoursAgo(48).toISOString(),
      },
    ],
    { object: { sha: "abc122", type: "commit" } },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.2");
  assert.equal(result.latestCommit, "abc122");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
  assert.ok(result.publishedAt <= cutoff);
});

test("getLatestActionVersion returns previous semver tag when latest is within cooldown", async () => {
  const api = createMockApi([
    [],
    [
      { name: "v1.2.3", commit: { sha: "tagsha3" } },
      { name: "v1.2.2", commit: { sha: "tagsha2" } },
    ],
    {
      sha: "tagsha3",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
    {
      sha: "tagsha2",
      commit: { committer: { date: hoursAgo(48).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "v1.2.2");
  assert.equal(result.latestCommit, "tagsha2");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
  assert.ok(result.publishedAt <= cutoff);
});

test("getLatestActionVersion returns previous non-semver tag when latest is within cooldown", async () => {
  const api = createMockApi([
    [],
    [
      { name: "nightly-2025-01-01", commit: { sha: "nightsha1" } },
      { name: "nightly-2024-12-31", commit: { sha: "nightsha2" } },
    ],
    {
      sha: "nightsha1",
      commit: { committer: { date: hoursAgo(2).toISOString() } },
    },
    {
      sha: "nightsha2",
      commit: { committer: { date: hoursAgo(48).toISOString() } },
    },
  ]);

  const cutoff = hoursAgo(24);
  const result = await api.getLatestActionVersion("owner/repo", cutoff);

  assert.equal(result.latestVersion, "nightly-2024-12-31");
  assert.equal(result.latestCommit, "nightsha2");
  assert.equal(result.withinCooldown, undefined);
  assert.ok(result.publishedAt);
  assert.ok(result.publishedAt <= cutoff);
});

test("getLatestActionVersion caches results for the same repository and cutoff", async () => {
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

  const result1 = await api.getLatestActionVersion("owner/repo", cutoff);
  assert.equal(result1.latestVersion, "v1.2.3");

  const result2 = await api.getLatestActionVersion("owner/repo", cutoff);
  assert.equal(result2.latestVersion, "v1.2.3");
});
