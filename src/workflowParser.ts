import * as yaml from 'yaml';

export interface WorkflowAction {
    line: number;
    original: string;
    repository: string;
    fullPath: string;
    currentRef: string;
    currentComment: string;
    hasSkipPinning: boolean;
    indentation: string;
}

export interface UpdateResult {
    line: number;
    original: string;
    updated: string;
    repository: string;
    oldVersion: string;
    newVersion: string;
    newCommit: string;
    filePath?: string;
}

export class WorkflowParser {
    private static readonly ACTION_REGEX = /^(\s*)(?:-\s+)?uses:\s+([^@\s]+)@([^\s#]+)(?:\s*#\s*(.*))?$/;
    private static readonly REUSABLE_WORKFLOW_REGEX = /^([^\/]+\/[^\/]+)\/\.github\/workflows\/.*$/;
    private static readonly SUB_ACTION_REGEX = /^([^\/]+\/[^\/]+)\/(.+)$/;
    private static readonly SKIP_PINNING_REGEX = /skip-pinning/i;

    static parseWorkflow(content: string): WorkflowAction[] {
        const lines = content.split('\n');
        const actions: WorkflowAction[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(this.ACTION_REGEX);
            
            if (match) {
                const [, indentation, fullPath, ref, comment = ''] = match;
                const hasSkipPinning = this.SKIP_PINNING_REGEX.test(comment);
                
                // Extract repository name for reusable workflows and sub-actions
                let repository = fullPath.trim();
                const reusableWorkflowMatch = fullPath.match(this.REUSABLE_WORKFLOW_REGEX);
                const subActionMatch = fullPath.match(this.SUB_ACTION_REGEX);
                
                if (reusableWorkflowMatch) {
                    // Reusable workflow: owner/repo/.github/workflows/workflow.yml -> owner/repo
                    repository = reusableWorkflowMatch[1];
                } else if (subActionMatch && !fullPath.includes('.github/workflows')) {
                    // Sub-action: owner/repo/sub-action -> owner/repo
                    repository = subActionMatch[1];
                }
                
                actions.push({
                    line: i,
                    original: line,
                    repository: repository,
                    fullPath: fullPath.trim(),
                    currentRef: ref.trim(),
                    currentComment: comment.trim(),
                    hasSkipPinning,
                    indentation: indentation
                });
            }
        }

        return actions;
    }

    static updateActionLine(
        action: WorkflowAction, 
        newVersion: string, 
        newCommit: string
    ): string {
        if (action.hasSkipPinning) {
            return action.original;
        }

        const extractedVersion = this.extractVersionFromComment(action.currentComment);
        const isDashFormat = action.original.includes('- uses:');
        
        let comment: string;
        if (!action.currentComment) {
            comment = ` # ${newVersion}`;
        } else if (extractedVersion) {
            comment = ` # ${newVersion}`;
        } else {
            comment = action.currentComment ? ` # ${action.currentComment}` : '';
        }
        
        if (isDashFormat) {
            return `${action.indentation}- uses: ${action.fullPath}@${newCommit}${comment}`;
        } else {
            return `${action.indentation}uses: ${action.fullPath}@${newCommit}${comment}`;
        }
    }

    static applyUpdates(content: string, updates: UpdateResult[]): string {
        const lines = content.split('\n');
        
        // Sort updates by line number in descending order to avoid index shifting
        const sortedUpdates = updates.sort((a, b) => b.line - a.line);
        
        for (const update of sortedUpdates) {
            if (update.line < lines.length) {
                lines[update.line] = update.updated;
            }
        }
        
        return lines.join('\n');
    }

    static extractVersionFromComment(comment: string): string {
        const trimmed = comment.trimEnd();
        
        // Match version at end of comment with various prefixes
        // Supports dependabot formats: v2.1.0, 2.1.0, @v2.1.0, pin @v2.1.0, tag=v2.1.0, #v2.1.0
        // Also supports old extension format: tag v1.2.3
        // Ignores comments with text after the version
        const versionMatch = trimmed.match(
            /(?:tag\s+|tag=|pin\s*@?|@?)?(v?\d+(?:\.\d+)+(?:[._-][\w]+)*)\s*$/
        );
        return versionMatch ? versionMatch[1] : '';
    }

    static normalizeVersion(version: string): string {
        // Normalize version for comparison by ensuring consistent v prefix
        if (!version) return '';
        return version.startsWith('v') ? version : `v${version}`;
    }

    static areVersionsEqual(version1: string, version2: string): boolean {
        return this.normalizeVersion(version1) === this.normalizeVersion(version2);
    }

    static isWorkflowFile(filePath: string): boolean {
        return /\.(yml|yaml)$/.test(filePath) && 
               (filePath.includes('.github/workflows/') || filePath.includes('workflows/'));
    }

    static validateWorkflowSyntax(content: string): { valid: boolean; error?: string } {
        try {
            const parsed = yaml.parse(content);
            
            // Basic validation - check if it has workflow structure
            if (!parsed || typeof parsed !== 'object') {
                return { valid: false, error: 'Invalid YAML structure' };
            }
            
            if (!parsed.jobs || typeof parsed.jobs !== 'object') {
                return { valid: false, error: 'No jobs found in workflow' };
            }
            
            return { valid: true };
        } catch (error) {
            return { valid: false, error: `YAML parse error: ${error}` };
        }
    }
}