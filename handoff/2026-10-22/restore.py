"""Restore the saved Claude task into a NEW directory. Requires Python 3 and Git."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent

def run(*args, cwd=None):
    return subprocess.check_output(['git', '-c', 'core.autocrlf=false', *args], cwd=cwd)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', default='../hither-resumed')
    parser.add_argument('--source', default='https://github.com/Yupoer/hither_app.git',
                        help='Clone source; default is GitHub. A local source is only for offline verification.')
    args = parser.parse_args()
    dest = Path(args.destination).resolve()
    if dest.exists():
        raise SystemExit('Destination already exists. Choose a new directory; nothing was overwritten.')
    archive = HERE / 'progress.zip'
    expected = (HERE / 'progress.zip.sha256').read_text().split()[0]
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise SystemExit('Archive checksum mismatch.')
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            target = (dest / 'handoff' / name).resolve()
            if not target.is_relative_to(dest / 'handoff'):
                raise SystemExit('Unsafe archive path: ' + name)
        dest.mkdir(parents=True)
        z.extractall(dest / 'handoff')
    handoff = dest / 'handoff'
    for name in ('README.md', 'VERIFICATION.md'):
        shutil.copyfile(HERE / name, handoff / name)
    manifest = json.loads((handoff / 'manifest.json').read_text(encoding='utf-8'))
    bundle = handoff / 'progress.bundle'
    if hashlib.sha256(bundle.read_bytes()).hexdigest() != manifest['bundle_sha256']:
        raise SystemExit('Bundle checksum mismatch.')
    repo = dest / 'repo'
    run('clone', '--no-local', '--single-branch', '--branch', 'master', args.source, str(repo))
    run('config', 'core.autocrlf', 'false', cwd=repo)
    run('bundle', 'verify', str(bundle), cwd=repo)
    run('fetch', str(bundle), 'refs/heads/*:refs/heads/*', cwd=repo)
    results = []
    for item in manifest['worktrees']:
        if item['original_branch'] == 'master':
            continue
        name = item['source_worktree']
        worktree = dest / name
        run('worktree', 'add', str(worktree), item['checkpoint_ref'].removeprefix('refs/heads/'), cwd=repo)
        actual = run('rev-parse', 'HEAD^{tree}', cwd=worktree).decode().strip()
        if actual != item['tree']:
            raise SystemExit('Restored tree mismatch: ' + name)
        # WIP bytes are preserved verbatim, including the formerly untracked hooks.
        for name_, entry in item['saved_uncommitted'].items():
            file = worktree / name_
            if entry.get('deleted'):
                if file.exists():
                    raise SystemExit('Deleted file was unexpectedly restored: ' + name_)
            elif hashlib.sha256(file.read_bytes()).hexdigest() != entry['sha256']:
                raise SystemExit('WIP file checksum mismatch: ' + name_)
        if run('status', '--porcelain', cwd=worktree).strip():
            raise SystemExit('Unexpected dirty restored worktree: ' + str(worktree))
        results.append({'worktree': name, 'head': item['checkpoint_head'], 'tree_verified': True,
                        'wip_files_verified': len(item['saved_uncommitted'])})
    (dest / 'restore-verification.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print('Restored and verified', len(results), 'worktrees in', dest)
    print('Read the handoff README, then continue in the relevant wt-b* directory.')
    print('Dependencies, credentials, and global Claude/Codex tools must be set up on this computer.')

if __name__ == '__main__':
    main()

