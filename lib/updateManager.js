const path = require('path');
const { execFile } = require('child_process');

const CODE_FILE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx']);

const DEFAULT_REPO_PATH = path.resolve(__dirname, '..');
const DEFAULT_REMOTE = 'origin';
let updateInProgress = false;

function runGit(args, { repoPath = DEFAULT_REPO_PATH } = {}) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: repoPath }, (error, stdout, stderr) => {
            if (error) {
                const err = new Error(stderr?.trim() || error.message || 'Git command failed');
                err.code = error.code;
                err.stderr = stderr;
                err.args = args;
                return reject(err);
            }
            resolve((stdout || '').toString());
        });
    });
}

async function getCurrentBranch(options = {}) {
    const output = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], options);
    return output.trim();
}

async function getShortHash(ref, options = {}) {
    const output = await runGit(['rev-parse', '--short', ref], options);
    return output.trim();
}

async function getFullHash(ref, options = {}) {
    const output = await runGit(['rev-parse', ref], options);
    return output.trim();
}

async function ensureRemoteBranch(remoteRef, options = {}) {
    try {
        await runGit(['rev-parse', '--verify', remoteRef], options);
        return true;
    } catch (err) {
        return false;
    }
}

async function getAheadBehind(branch, remoteRef, options = {}) {
    const output = await runGit(['rev-list', '--left-right', '--count', `${branch}...${remoteRef}`], options);
    const parts = output.trim().split(/\s+/);
    if (parts.length < 2) {
        return { ahead: 0, behind: 0 };
    }
    return {
        ahead: Number(parts[0]) || 0,
        behind: Number(parts[1]) || 0
    };
}

function extractPathFromStatusLine(line) {
    if (!line) return null;
    const trimmed = line.trimEnd();
    if (!trimmed) return null;
    const arrowIdx = trimmed.indexOf('->');
    if (arrowIdx !== -1) {
        return trimmed.slice(arrowIdx + 2).trim();
    }
    if (trimmed.length <= 3) {
        return null;
    }
    return trimmed.slice(3).trim();
}

function isCodeFile(filePath) {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return CODE_FILE_EXTENSIONS.has(ext);
}

async function getWorkingTreeCodeChanges(options = {}) {
    const output = await runGit(['status', '--porcelain'], options);
    if (!output.trim()) return [];
    const files = new Set();
    for (const rawLine of output.split('\n')) {
        const filePath = extractPathFromStatusLine(rawLine);
        if (filePath && isCodeFile(filePath)) {
            files.add(filePath);
        }
    }
    return Array.from(files);
}

async function getCommittedCodeChanges(branch, remoteRef, options = {}) {
    if (!branch || !remoteRef) return [];
    const output = await runGit(['diff', '--name-only', `${remoteRef}..${branch}`], options);
    if (!output.trim()) return [];
    const files = new Set();
    for (const filePath of output.split('\n')) {
        if (filePath && isCodeFile(filePath.trim())) {
            files.add(filePath.trim());
        }
    }
    return Array.from(files);
}

async function fetchRemote(remote = DEFAULT_REMOTE, options = {}) {
    await runGit(['fetch', remote, '--prune'], options);
}

async function getStatus({ repoPath = DEFAULT_REPO_PATH, remote = DEFAULT_REMOTE } = {}) {
    const branch = await getCurrentBranch({ repoPath });
    await fetchRemote(remote, { repoPath });
    const remoteRef = `${remote}/${branch}`;
    const remoteExists = await ensureRemoteBranch(remoteRef, { repoPath });
    if (!remoteExists) {
        return {
            status: 'no-remote',
            branch,
            remote,
            remoteRef,
            ahead: 0,
            behind: 0,
            localHash: await getShortHash('HEAD', { repoPath }),
            remoteHash: null
        };
    }
    const { ahead, behind } = await getAheadBehind(branch, remoteRef, { repoPath });
    let status = 'up-to-date';
    if (behind > 0 && ahead === 0) {
        status = 'behind';
    } else if (ahead > 0 && behind === 0) {
        status = 'ahead';
    } else if (ahead > 0 && behind > 0) {
        status = 'diverged';
    }
    const workingTreeCodeChanges = await getWorkingTreeCodeChanges({ repoPath });
    const committedCodeChanges = remoteExists ? await getCommittedCodeChanges(branch, remoteRef, { repoPath }) : [];
    const hasCustomCode = workingTreeCodeChanges.length > 0 || committedCodeChanges.length > 0;

    return {
        status,
        branch,
        remote,
        remoteRef,
        ahead,
        behind,
        localHash: await getShortHash('HEAD', { repoPath }),
        remoteHash: await getShortHash(remoteRef, { repoPath }),
        hasCustomCode,
        customCodeDetails: hasCustomCode ? {
            workingTree: workingTreeCodeChanges,
            committed: committedCodeChanges
        } : null
    };
}

async function isWorkingTreeClean(options = {}) {
    const output = await runGit(['status', '--porcelain'], options);
    return output.trim().length === 0;
}

async function applyUpdates({ repoPath = DEFAULT_REPO_PATH, remote = DEFAULT_REMOTE } = {}) {
    if (updateInProgress) {
        throw new Error('An update is already running. Please wait.');
    }
    updateInProgress = true;
    try {
        const clean = await isWorkingTreeClean({ repoPath });
        if (!clean) {
            throw new Error('Working tree has local changes. Please commit or stash them before updating.');
        }
        const branch = await getCurrentBranch({ repoPath });
        await fetchRemote(remote, { repoPath });
        const remoteRef = `${remote}/${branch}`;
        const remoteExists = await ensureRemoteBranch(remoteRef, { repoPath });
        if (!remoteExists) {
            throw new Error(`Remote branch ${remoteRef} not found.`);
        }
        await runGit(['pull', '--ff-only', remote, branch], { repoPath });
        const status = await getStatus({ repoPath, remote });
        return {
            updated: status.behind === 0,
            status
        };
    } finally {
        updateInProgress = false;
    }
}

module.exports = {
    checkForUpdates: getStatus,
    applyUpdates,
    DEFAULT_REPO_PATH
};
