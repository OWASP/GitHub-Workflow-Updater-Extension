import * as https from 'https';
import * as semver from 'semver';

export interface GitHubTag {
    name: string;
    commit: {
        sha: string;
    };
}

export interface GitHubRelease {
    tag_name: string;
    target_commitish: string;
    prerelease: boolean;
    published_at: string;
}

export interface ActionUpdate {
    currentVersion: string;
    latestVersion: string;
    latestCommit: string;
    repository: string;
    publishedAt: Date | null;
    withinCooldown?: boolean;
}

export class GitHubApiService {
    private token: string;
    private cache: Map<string, any> = new Map();
    private versionCache: Map<string, ActionUpdate | null> = new Map();

    constructor(token: string = '') {
        this.token = token;
    }

    private async makeRequest(url: string): Promise<any> {
        if (this.cache.has(url)) {
            return this.cache.get(url);
        }

        const result = await new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'GitHub-Workflow-Updater-VSCode',
                    'Accept': 'application/vnd.github.v3+json',
                    ...(this.token && { 'Authorization': `token ${this.token}` })
                }
            };

            https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (error) {
                            reject(new Error(`Failed to parse JSON: ${error}`));
                        }
                    } else {
                        reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
                    }
                });
            }).on('error', reject);
        });

        this.cache.set(url, result);
        return result;
    }

    async getLatestActionVersion(repository: string, cutoffDate?: Date): Promise<ActionUpdate | null> {
        const cacheKey = `${repository}#${cutoffDate?.toISOString() || 'none'}`;
        if (this.versionCache.has(cacheKey)) {
            return this.versionCache.get(cacheKey)!;
        }

        const result = await (async (): Promise<ActionUpdate | null> => {
            try {
                // First try to get releases (official releases)
            const releases = await this.getReleases(repository);
            const validReleases = this.getSortedSemverReleases(releases);
            if (validReleases.length > 0) {
                if (cutoffDate) {
                    for (const release of validReleases) {
                        const publishedAt = new Date(release.published_at);
                        if (publishedAt <= cutoffDate) {
                            return {
                                currentVersion: '',
                                latestVersion: release.tag_name,
                                latestCommit: await this.getCommitForTag(repository, release.tag_name),
                                repository,
                                publishedAt
                            };
                        }
                    }
                    // All valid releases are too new
                    const latestRelease = validReleases[0];
                    return {
                        currentVersion: '',
                        latestVersion: latestRelease.tag_name,
                        latestCommit: '',
                        repository,
                        publishedAt: new Date(latestRelease.published_at),
                        withinCooldown: true
                    };
                } else {
                    const latestRelease = validReleases[0];
                    const publishedAt = new Date(latestRelease.published_at);
                    return {
                        currentVersion: '',
                        latestVersion: latestRelease.tag_name,
                        latestCommit: await this.getCommitForTag(repository, latestRelease.tag_name),
                        repository,
                        publishedAt
                    };
                }
            }

            // Fallback to tags
            const tags = await this.getTags(repository);
            const validTags = this.getSortedSemverTags(tags);
            if (validTags.length > 0) {
                if (cutoffDate) {
                    for (const tag of validTags) {
                        const commitDate = await this.getCommitDate(repository, tag.commit.sha);
                        if (commitDate === null) {
                            return {
                                currentVersion: '',
                                latestVersion: tag.name,
                                latestCommit: tag.commit.sha,
                                repository,
                                publishedAt: null
                            };
                        }
                        if (commitDate <= cutoffDate) {
                            return {
                                currentVersion: '',
                                latestVersion: tag.name,
                                latestCommit: tag.commit.sha,
                                repository,
                                publishedAt: commitDate
                            };
                        }
                    }
                    // All semver tags are too new
                    const latestTag = validTags[0];
                    const commitDate = await this.getCommitDate(repository, latestTag.commit.sha);
                    return {
                        currentVersion: '',
                        latestVersion: latestTag.name,
                        latestCommit: latestTag.commit.sha,
                        repository,
                        publishedAt: commitDate || new Date(),
                        withinCooldown: true
                    };
                } else {
                    const latestTag = validTags[0];
                    return {
                        currentVersion: '',
                        latestVersion: latestTag.name,
                        latestCommit: latestTag.commit.sha,
                        repository,
                        publishedAt: null
                    };
                }
            }

            // If no semver tags, use most recent tag
            if (tags.length > 0) {
                if (cutoffDate) {
                    for (const tag of tags) {
                        const commitDate = await this.getCommitDate(repository, tag.commit.sha);
                        if (commitDate === null) {
                            return {
                                currentVersion: '',
                                latestVersion: tag.name,
                                latestCommit: tag.commit.sha,
                                repository,
                                publishedAt: null
                            };
                        }
                        if (commitDate <= cutoffDate) {
                            return {
                                currentVersion: '',
                                latestVersion: tag.name,
                                latestCommit: tag.commit.sha,
                                repository,
                                publishedAt: commitDate
                            };
                        }
                    }
                    // All tags are too new
                    const mostRecentTag = tags[0];
                    const commitDate = await this.getCommitDate(repository, mostRecentTag.commit.sha);
                    return {
                        currentVersion: '',
                        latestVersion: mostRecentTag.name,
                        latestCommit: mostRecentTag.commit.sha,
                        repository,
                        publishedAt: commitDate || new Date(),
                        withinCooldown: true
                    };
                } else {
                    const mostRecentTag = tags[0];
                    return {
                        currentVersion: '',
                        latestVersion: mostRecentTag.name,
                        latestCommit: mostRecentTag.commit.sha,
                        repository,
                        publishedAt: null
                    };
                }
            }

            // Final fallback: get latest commit from default branch
            const defaultBranch = await this.getDefaultBranch(repository);
            if (cutoffDate) {
                const commit = await this.getLatestCommitBefore(repository, defaultBranch, cutoffDate);
                if (commit) {
                    return {
                        currentVersion: '',
                        latestVersion: defaultBranch,
                        latestCommit: commit.sha,
                        repository,
                        publishedAt: commit.date
                    };
                }
                // No commit old enough found - report cooldown skip
                const latestCommit = await this.getLatestCommit(repository, defaultBranch);
                return {
                    currentVersion: '',
                    latestVersion: defaultBranch,
                    latestCommit: latestCommit.sha,
                    repository,
                    publishedAt: latestCommit.date,
                    withinCooldown: true
                };
            } else {
                const latestCommit = await this.getLatestCommit(repository, defaultBranch);
                return {
                    currentVersion: '',
                    latestVersion: defaultBranch,
                    latestCommit: latestCommit.sha,
                    repository,
                    publishedAt: latestCommit.date
                };
            }

        } catch (error) {
            throw new Error(`Failed to get latest version for ${repository}: ${error}`);
        }
        })();

        this.versionCache.set(cacheKey, result);
        return result;
    }

    private async getReleases(repository: string): Promise<GitHubRelease[]> {
        const url = `https://api.github.com/repos/${repository}/releases`;
        return await this.makeRequest(url);
    }

    private async getTags(repository: string): Promise<GitHubTag[]> {
        const url = `https://api.github.com/repos/${repository}/tags`;
        return await this.makeRequest(url);
    }

    private async getCommitForTag(repository: string, tagName: string): Promise<string> {
        const url = `https://api.github.com/repos/${repository}/git/refs/tags/${tagName}`;
        try {
            const tagRef = await this.makeRequest(url);
            // For annotated tags, we need to get the commit the tag points to
            if (tagRef.object.type === 'tag') {
                const tagObject = await this.makeRequest(tagRef.object.url);
                return tagObject.object.sha;
            }
            return tagRef.object.sha;
        } catch {
            // Fallback: try to get commit directly from tags API
            const tags = await this.getTags(repository);
            const tag = tags.find(t => t.name === tagName);
            return tag?.commit.sha || '';
        }
    }

    private async getDefaultBranch(repository: string): Promise<string> {
        const url = `https://api.github.com/repos/${repository}`;
        const repo = await this.makeRequest(url);
        return repo.default_branch || 'main';
    }

    private async getLatestCommit(repository: string, branch: string): Promise<{ sha: string; date: Date }> {
        const url = `https://api.github.com/repos/${repository}/commits/${branch}`;
        const commit = await this.makeRequest(url);
        return {
            sha: commit.sha,
            date: new Date(commit.commit?.committer?.date || commit.commit?.author?.date)
        };
    }

    private async getCommitDate(repository: string, sha: string): Promise<Date | null> {
        const url = `https://api.github.com/repos/${repository}/commits/${sha}`;
        try {
            const commit = await this.makeRequest(url);
            return new Date(commit.commit?.committer?.date || commit.commit?.author?.date);
        } catch {
            return null;
        }
    }

    private async getLatestCommitBefore(repository: string, branch: string, cutoffDate: Date): Promise<{ sha: string; date: Date } | null> {
        const url = `https://api.github.com/repos/${repository}/commits?sha=${encodeURIComponent(branch)}&per_page=1&until=${encodeURIComponent(cutoffDate.toISOString())}`;
        const commits = await this.makeRequest(url);
        if (!Array.isArray(commits) || commits.length === 0) {
            return null;
        }
        const commit = commits[0];
        const date = new Date(commit.commit?.committer?.date || commit.commit?.author?.date);
        if (date > cutoffDate) {
            return null;
        }
        return { sha: commit.sha, date };
    }

    private getSortedSemverReleases(releases: GitHubRelease[]): GitHubRelease[] {
        return releases
            .filter(release => !release.prerelease)
            .filter(release => semver.valid(release.tag_name))
            .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name));
    }

    private getSortedSemverTags(tags: GitHubTag[]): GitHubTag[] {
        return tags
            .filter(tag => semver.valid(tag.name))
            .sort((a, b) => semver.rcompare(a.name, b.name));
    }
}