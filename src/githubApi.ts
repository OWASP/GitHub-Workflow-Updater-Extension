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
}

export interface ActionUpdate {
    currentVersion: string;
    latestVersion: string;
    latestCommit: string;
    repository: string;
}

export class GitHubApiService {
    private token: string;

    constructor(token: string = '') {
        this.token = token;
    }

    private async makeRequest(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
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
    }

    async getLatestActionVersion(repository: string): Promise<ActionUpdate | null> {
        try {
            // First try to get releases (official releases)
            const releases = await this.getReleases(repository);
            if (releases.length > 0) {
                const latestRelease = this.findLatestSemverRelease(releases);
                if (latestRelease) {
                    return {
                        currentVersion: '',
                        latestVersion: latestRelease.tag_name,
                        latestCommit: await this.getCommitForTag(repository, latestRelease.tag_name),
                        repository
                    };
                }
            }

            // Fallback to tags
            const tags = await this.getTags(repository);
            if (tags.length > 0) {
                const latestTag = this.findLatestSemverTag(tags);
                if (latestTag) {
                    return {
                        currentVersion: '',
                        latestVersion: latestTag.name,
                        latestCommit: latestTag.commit.sha,
                        repository
                    };
                }
                
                // If no semver tags, use most recent tag with commit
                const mostRecentTag = tags[0]; // GitHub API returns tags in reverse chronological order
                return {
                    currentVersion: '',
                    latestVersion: mostRecentTag.name,
                    latestCommit: mostRecentTag.commit.sha,
                    repository
                };
            }

            // Final fallback: get latest commit from default branch
            const defaultBranch = await this.getDefaultBranch(repository);
            const latestCommit = await this.getLatestCommit(repository, defaultBranch);
            
            return {
                currentVersion: '',
                latestVersion: defaultBranch,
                latestCommit: latestCommit.sha,
                repository
            };

        } catch (error) {
            throw new Error(`Failed to get latest version for ${repository}: ${error}`);
        }
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

    private async getLatestCommit(repository: string, branch: string): Promise<{ sha: string }> {
        const url = `https://api.github.com/repos/${repository}/commits/${branch}`;
        return await this.makeRequest(url);
    }

    private findLatestSemverRelease(releases: GitHubRelease[]): GitHubRelease | null {
        const validReleases = releases
            .filter(release => !release.prerelease)
            .filter(release => semver.valid(release.tag_name))
            .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name));
        
        return validReleases[0] || null;
    }

    private findLatestSemverTag(tags: GitHubTag[]): GitHubTag | null {
        const validTags = tags
            .filter(tag => semver.valid(tag.name))
            .sort((a, b) => semver.rcompare(a.name, b.name));
        
        return validTags[0] || null;
    }
}