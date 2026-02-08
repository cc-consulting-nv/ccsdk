# Git Troubleshooting

## GPG Signing Timeouts

### Problem
`git commit` hangs indefinitely or times out with exit code 124.

### Root Cause
Git is configured to sign commits with GPG (`commit.gpgsign=true`), but the GPG agent is not available or responding in the current environment.

### Solution

**Option 1: Disable GPG for a single commit**
```bash
git -c commit.gpgsign=false commit -m "message"
```

**Option 2: Disable GPG for this repository**
```bash
git config commit.gpgsign false
```

**Option 3: Check if GPG is configured**
```bash
git config --list | grep gpg
# Shows: user.signingkey=XXX and commit.gpgsign=true
```

### Prevention
When working in automated environments (CI/CD, containers), always use `-c commit.gpgsign=false` or ensure GPG is properly configured.

---

## Clean Branch Strategy for PRs

### Problem
PRs have merge conflicts or include unrelated commits from previous work.

### Root Cause
Reusing feature branches after `main` has moved forward with new commits.

### Solution: Fresh Branch per Fix

```bash
# 1. Fetch latest main
git fetch origin main

# 2. Create new branch from latest main
git checkout origin/main -b fix/descriptive-name

# 3. Make your changes
# ... edit files ...

# 4. Commit with GPG disabled (if needed)
git -c commit.gpgsign=false add .
git -c commit.gpgsign=false commit -m "fix: description"

# 5. Push to origin
git push -u origin fix/descriptive-name

# 6. Create PR via GitHub CLI
gh pr create --title "fix: description" --body "..." --base main
```

### Benefits
- No merge conflicts
- Clean commit history
- Easier code review
- Can be merged immediately after approval

---

## Force Push After Rebase

If you need to rebase a branch onto latest main:

```bash
git fetch origin main
git rebase origin/main
# Resolve any conflicts
git push --force-with-lease  # Safer than --force
```

---

## Common Git Aliases

Add to `~/.gitconfig`:

```ini
[alias]
    # Safe commit without GPG
    commit-safe = -c commit.gpgsign=false commit
    
    # Create fresh branch from main
    fresh-branch = !git fetch origin main && git checkout origin/main -b
    
    # Push new branch and set upstream
    publish = push -u origin HEAD
```

Usage:
```bash
git fresh-branch fix/my-bug
# ... make changes ...
git commit-safe -m "fix: my bug"
git publish
```
