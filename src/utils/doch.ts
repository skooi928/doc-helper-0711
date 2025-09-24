import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';



const TEMPLATE_CONFIG = `\
# .doch/config.yml
# Source directories to monitor
sourceDirectories:
  - "src/"
  - "lib/"
  - "app/"

# File extensions to monitor (without the dot)
fileExtensions:
  - "ts"
  - "js"
  - "tsx"
`;

// Files and directories to ignore
const TEMPLATE_IGNORE = `# .dochignore
# Exclude DocHelper’s own data and caches
.doch/**
node_modules/**
dist/**
`;

// Check doc drifting and update doc-state.json after each commit
const HOOK_POST_COMMIT = `#!/usr/bin/env sh
echo "DocHelper: Updating doc status…"

# Function to validate doch repo
validate_doch_repo() {
  if [ ! -d ".doch" ]; then
    echo "DocHelper not initialized. Missing: .doch directory"
    exit 1
  fi
  if [ ! -f ".doch/config.yml" ]; then
    echo "DocHelper configuration missing. Expected config file at: .doch/config.yml"
    exit 1
  fi
  if [ ! -d ".doch/metadata" ]; then
    mkdir -p ".doch/metadata"
  fi
}

# Function to read config and get extensions/directories
read_config() {
  if [ -f ".doch/config.yml" ]; then
    # Extract fileExtensions from YAML
    EXTENSIONS=$(grep -A 10 "fileExtensions:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\\n' '|' | sed 's/|$//')
    if [ -z "$EXTENSIONS" ]; then
      EXTENSIONS="ts|js|tsx"
    fi
    
    # Extract sourceDirectories from YAML
    SOURCE_DIRS=$(grep -A 10 "sourceDirectories:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | sed 's|/$||g')
    if [ -z "$SOURCE_DIRS" ]; then
      SOURCE_DIRS="src lib app"
    fi
  else
    EXTENSIONS="ts|js|tsx"
    SOURCE_DIRS="src lib app"
  fi
}

# Function to get docs directory from VS Code settings
get_docs_directory() {
  DOCS_DIR="docs/"
  if [ -f ".vscode/settings.json" ]; then
    # Try to extract docs directory from VS Code settings
    SETTING_DOCS=$(grep -o '"doc-helper-0711.docsDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' ".vscode/settings.json" | sed 's/.*"\\([^"]*\\)"$/\\1/' | head -1)
    if [ -n "$SETTING_DOCS" ]; then
      DOCS_DIR="$SETTING_DOCS"
    fi
  fi
}

# Function to load ignore patterns
load_ignore_patterns() {
  IGNORE_PATTERNS=""
  if [ -f ".dochignore" ]; then
    IGNORE_PATTERNS=$(grep -v "^#" ".dochignore" | grep -v "^$")
  fi
}

# Function to check if file should be ignored
should_ignore() {
  local file="$1"
  if [ -n "$IGNORE_PATTERNS" ]; then
    echo "$IGNORE_PATTERNS" | while read -r pattern; do
      if [ -n "$pattern" ] && echo "$file" | grep -q "$pattern"; then
        return 0
      fi
    done
  fi
  return 1
}

# Function to get last commit message
get_last_commit_message() {
  local file="$1"
  git log -n 1 --pretty=format:"%s" -- "$file" 2>/dev/null || echo ""
}

# Function to check if change is minor
is_minor_change() {
  local commit_msg="$1"
  echo "$commit_msg" | grep -iq "\\(fix\\|bug\\|refactor\\)"
}

# Function to update doc state
update_doc_state() {
  local src_rel="$1"
  local documented="$2"
  local timestamp="$3"
  local doc_time="$4"
  local status="$5"
  
  local state_file=".doch/metadata/doc-state.json"
  
  # Create empty state file if it doesn't exist
  if [ ! -f "$state_file" ]; then
    echo "{}" > "$state_file"
  fi
  
  # Use node to update JSON (if available) or create simple update
  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      let state = {};
      try { state = JSON.parse(fs.readFileSync('$state_file', 'utf8')); } catch(e) {}
      state['$src_rel'] = {
        documented: $documented,
        timestamp: '$timestamp',
        docTime: '$doc_time',
        status: '$status'
      };
      fs.writeFileSync('$state_file', JSON.stringify(state, null, 2));
    "
  else
    echo "Warning: Node.js not available, state update skipped"
  fi
}

# Main logic
validate_doch_repo
read_config
get_docs_directory
load_ignore_patterns

# Build regex pattern
PATTERN="\\\\.($EXTENSIONS|md)$"

# Get changed files
if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  # Not the first commit
  CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | grep -E "$PATTERN")
else
  # First commit
  CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r --root HEAD | grep -E "$PATTERN")
fi

if [ -z "$CHANGED_FILES" ]; then
  echo "No relevant files changed"
  exit 0
fi

echo "Processing changed files..."
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "$CHANGED_FILES" | while read -r file; do
  if [ -z "$file" ]; then continue; fi
  
  # Check if file should be ignored
  if should_ignore "$file"; then
    continue
  fi
  
  # Check if file is in source directory or docs directory
  in_source_dir=false
  for src_dir in $SOURCE_DIRS; do
    if echo "$file" | grep -q "^$src_dir/"; then
      in_source_dir=true
      break
    fi
  done
  
  if [ "$in_source_dir" = "false" ] && ! echo "$file" | grep -q "^$DOCS_DIR"; then
    continue
  fi
  
  src_rel=""
  doc_rel=""
  
  # Determine source and doc file relationships
  if echo "$file" | grep -q "^$DOCS_DIR.*\\.md$"; then
    # This is a doc file, find corresponding source
    doc_rel="$file"
    base_name=$(echo "$file" | sed "s|^$DOCS_DIR||" | sed 's|\\.md$||')
    
    for src_dir in $SOURCE_DIRS; do
      for ext in $(echo "$EXTENSIONS" | tr '|' ' '); do
        candidate="$src_dir/$base_name.$ext"
        if [ -f "$candidate" ]; then
          src_rel="$candidate"
          break 2
        fi
      done
    done
  else
    # This is a source file, find corresponding doc
    for src_dir in $SOURCE_DIRS; do
      if echo "$file" | grep -q "^$src_dir/"; then
        src_rel="$file"
        base_name=$(echo "$file" | sed "s|^$src_dir/||" | sed 's|\\.[^.]*$||')
        doc_rel="$DOCS_DIR$base_name.md"
        break
      fi
    done
  fi
  
  if [ -z "$src_rel" ] || [ -z "$doc_rel" ]; then
    echo "Could not determine corresponding source/documentation path for $file, skipping."
    continue
  fi
  
  # Check if both files exist and update state
  if [ -f "$doc_rel" ] && [ -f "$src_rel" ]; then
    # Both files exist - check timestamps and commit message
    commit_msg=$(get_last_commit_message "$src_rel")
    
    if is_minor_change "$commit_msg"; then
      # Minor change - mark as up to date
      update_doc_state "$src_rel" "true" "$CURRENT_TIME" "$CURRENT_TIME" "uptodate"
    else
      # Major change - check if doc is newer
      if [ "$doc_rel" -nt "$src_rel" ]; then
        update_doc_state "$src_rel" "true" "$CURRENT_TIME" "$CURRENT_TIME" "uptodate"
      else
        update_doc_state "$src_rel" "true" "$CURRENT_TIME" "$CURRENT_TIME" "outdated"
      fi
    fi
  elif [ -f "$src_rel" ]; then
    # Only source exists - no docs
    update_doc_state "$src_rel" "false" "$CURRENT_TIME" "" "nodocs"
  fi
done

echo "DocHelper: Updated documentation state"
`;

// Warn pushing to github if there are undocumented or stale .md files
// If pushing directly to main/master, block it
const HOOK_PRE_PUSH = `#!/usr/bin/env sh
echo "DocHelper: Checking documentation status before push…"

# Function to validate doch repo
validate_doch_repo() {
  if [ ! -d ".doch" ]; then
    echo "DocHelper not initialized. Missing: .doch directory"
    exit 1
  fi
  if [ ! -f ".doch/config.yml" ]; then
    echo "DocHelper configuration missing. Expected config file at: .doch/config.yml"
    exit 1
  fi
  if [ ! -d ".doch/metadata" ]; then
    mkdir -p ".doch/metadata"
  fi
}

# Function to read config and get extensions/directories
read_config() {
  if [ -f ".doch/config.yml" ]; then
    # Extract fileExtensions from YAML
    EXTENSIONS=$(grep -A 10 "fileExtensions:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\\n' '|' | sed 's/|$//')
    if [ -z "$EXTENSIONS" ]; then
      EXTENSIONS="ts|js|tsx"
    fi
    
    # Extract sourceDirectories from YAML
    SOURCE_DIRS=$(grep -A 10 "sourceDirectories:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | sed 's|/$||g')
    if [ -z "$SOURCE_DIRS" ]; then
      SOURCE_DIRS="src lib app"
    fi
  else
    EXTENSIONS="ts|js|tsx"
    SOURCE_DIRS="src lib app"
  fi
}

# Function to get docs directory from VS Code settings
get_docs_directory() {
  DOCS_DIR="docs/"
  if [ -f ".vscode/settings.json" ]; then
    # Try to extract docs directory from VS Code settings
    SETTING_DOCS=$(grep -o '"doc-helper-0711.docsDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' ".vscode/settings.json" | sed 's/.*"\\([^"]*\\)"$/\\1/' | head -1)
    if [ -n "$SETTING_DOCS" ]; then
      DOCS_DIR="$SETTING_DOCS"
    fi
  fi
}

# Function to load ignore patterns
load_ignore_patterns() {
  IGNORE_PATTERNS=""
  if [ -f ".dochignore" ]; then
    IGNORE_PATTERNS=$(grep -v "^#" ".dochignore" | grep -v "^$")
  fi
}

# Function to check if file should be ignored
should_ignore() {
  local file="$1"
  if [ -n "$IGNORE_PATTERNS" ]; then
    while IFS= read -r pattern; do
      if [ -n "$pattern" ] && echo "$file" | grep -q "$pattern"; then
        return 0
      fi
    done <<< "$IGNORE_PATTERNS"
  fi
  return 1
}

# Function to get file status from state
get_file_status() {
  local src_rel="$1"
  local state_file=".doch/metadata/doc-state.json"
  
  if [ ! -f "$state_file" ]; then
    echo "nodocs"
    return
  fi
  
  if command -v node >/dev/null 2>&1; then
    status=$(node -e "
      const fs = require('fs');
      try {
        const state = JSON.parse(fs.readFileSync('$state_file', 'utf8'));
        const entry = state['$src_rel'];
        if (!entry) {
          console.log('nodocs');
        } else {
          console.log(entry.status || 'unknown');
        }
      } catch (e) {
        console.log('nodocs');
      }
    " 2>/dev/null)
    echo "$status"
  else
    echo "unknown"
  fi
}

# Function to check documentation status
check_documentation() {
  validate_doch_repo
  read_config
  get_docs_directory
  load_ignore_patterns
  
  # Find all source files and check their status
  for src_dir in $SOURCE_DIRS; do
    if [ -d "$src_dir" ]; then
      # Use a for loop with glob to avoid subshell issues
      find "$src_dir" -type f -name "*.ts" -o -name "*.js" -o -name "*.tsx" | while IFS= read -r src_file; do
        if [ -z "$src_file" ]; then continue; fi

        if should_ignore "$src_file"; then
          continue
        fi
        
        status=$(get_file_status "$src_file")
        
        case "$status" in
          "nodocs")
            echo "❌ Missing documentation: $src_file"
            exit 1  # Exit immediately when issue found
            ;;
          "outdated")
            echo "⚠️  Outdated documentation: $src_file"
            exit 1  # Exit immediately when issue found
            ;;
          "uptodate")
            # OK, continue checking other files
            ;;
          *)
            # Unknown status, treat as issue
            echo "❓ Unknown status for: $src_file (status: $status)"
            exit 1  # Exit immediately when issue found
            ;;
        esac
      done
      
      # Check if the subshell exited with error
      if [ $? -ne 0 ]; then
        return 1
      fi
    fi
  done
  
  echo "✅ All files have up-to-date documentation"
  return 0
}

# Check if pushing to main branch (regardless of current local branch)
PUSHING_TO_MAIN=false
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

while read local_ref local_sha remote_ref remote_sha; do
  # Check if the remote reference is main or master
  if [ "$remote_ref" = "refs/heads/main" ] || [ "$remote_ref" = "refs/heads/master" ]; then
    PUSHING_TO_MAIN=true
    REMOTE_BRANCH=$(echo "$remote_ref" | sed 's|refs/heads/||')
    echo "Detected push from branch '$CURRENT_BRANCH' to remote branch '$REMOTE_BRANCH'"
    break
  fi
done

if [ "$PUSHING_TO_MAIN" = true ]; then
  echo "Pushing to main/master branch, checking documentation status…"
  if ! check_documentation; then
    echo ""
    echo "❌ Push to main/master BLOCKED due to documentation issues."
    echo "Please update documentation for the files listed above before pushing."
    echo ""
    exit 1
  fi
else
  if ! check_documentation; then
    echo ""
    echo "🚧 Warning: Documentation issues detected."
    read -p "Continue push anyway? [y/N] " yn < /dev/tty
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
      echo "Proceeding with push…"
    else
      echo "Push aborted. Please review documentation for the files listed above."
      exit 1
    fi
  fi
fi

exit 0
`;

// Warn merging if there are undocumented or stale .md files
const HOOK_PRE_MERGE_COMMIT = `#!/usr/bin/env sh
echo "DocHelper: Checking documentation status before merge…"

# Check if this is actually a merge (MERGE_HEAD exists)
if ! git rev-parse --verify MERGE_HEAD >/dev/null 2>&1; then
  # Not a merge, exit normally
  exit 0
fi

# Function to validate doch repo
validate_doch_repo() {
  if [ ! -d ".doch" ]; then
    echo "DocHelper not initialized. Missing: .doch directory"
    exit 1
  fi
  if [ ! -f ".doch/config.yml" ]; then
    echo "DocHelper configuration missing. Expected config file at: .doch/config.yml"
    exit 1
  fi
  if [ ! -d ".doch/metadata" ]; then
    mkdir -p ".doch/metadata"
  fi
}

# Function to read config and get extensions/directories
read_config() {
  if [ -f ".doch/config.yml" ]; then
    # Extract fileExtensions from YAML
    EXTENSIONS=$(grep -A 10 "fileExtensions:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\\n' '|' | sed 's/|$//')
    if [ -z "$EXTENSIONS" ]; then
      EXTENSIONS="ts|js|tsx"
    fi
    
    # Extract sourceDirectories from YAML
    SOURCE_DIRS=$(grep -A 10 "sourceDirectories:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | sed 's|/$||g')
    if [ -z "$SOURCE_DIRS" ]; then
      SOURCE_DIRS="src lib app"
    fi
  else
    EXTENSIONS="ts|js|tsx"
    SOURCE_DIRS="src lib app"
  fi
}

# Function to get docs directory from VS Code settings
get_docs_directory() {
  DOCS_DIR="docs/"
  if [ -f ".vscode/settings.json" ]; then
    # Try to extract docs directory from VS Code settings
    SETTING_DOCS=$(grep -o '"doc-helper-0711.docsDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' ".vscode/settings.json" | sed 's/.*"\\([^"]*\\)"$/\\1/' | head -1)
    if [ -n "$SETTING_DOCS" ]; then
      DOCS_DIR="$SETTING_DOCS"
    fi
  fi
}

# Function to load ignore patterns
load_ignore_patterns() {
  IGNORE_PATTERNS=""
  if [ -f ".dochignore" ]; then
    IGNORE_PATTERNS=$(grep -v "^#" ".dochignore" | grep -v "^$")
  fi
}

# Function to check if file should be ignored
should_ignore() {
  local file="$1"
  if [ -n "$IGNORE_PATTERNS" ]; then
    while IFS= read -r pattern; do
      if [ -n "$pattern" ] && echo "$file" | grep -q "$pattern"; then
        return 0
      fi
    done <<< "$IGNORE_PATTERNS"
  fi
  return 1
}

# Function to get file status from state
get_file_status() {
  local src_rel="$1"
  local state_file=".doch/metadata/doc-state.json"
  
  if [ ! -f "$state_file" ]; then
    echo "nodocs"
    return
  fi
  
  if command -v node >/dev/null 2>&1; then
    status=$(node -e "
      const fs = require('fs');
      try {
        const state = JSON.parse(fs.readFileSync('$state_file', 'utf8'));
        const entry = state['$src_rel'];
        if (!entry) {
          console.log('nodocs');
        } else {
          console.log(entry.status || 'unknown');
        }
      } catch (e) {
        console.log('nodocs');
      }
    " 2>/dev/null)
    echo "$status"
  else
    echo "unknown"
  fi
}

# Function to check documentation status
check_documentation() {
  validate_doch_repo
  read_config
  get_docs_directory
  load_ignore_patterns
  
  # Find all source files and check their status
  for src_dir in $SOURCE_DIRS; do
    if [ -d "$src_dir" ]; then
      # Use a for loop with glob to avoid subshell issues
      find "$src_dir" -type f -name "*.ts" -o -name "*.js" -o -name "*.tsx" | while IFS= read -r src_file; do
        if [ -z "$src_file" ]; then continue; fi

        if should_ignore "$src_file"; then
          continue
        fi
        
        status=$(get_file_status "$src_file")
        
        case "$status" in
          "nodocs")
            echo "❌ Missing documentation: $src_file"
            exit 1  # Exit immediately when issue found
            ;;
          "outdated")
            echo "⚠️  Outdated documentation: $src_file"
            exit 1  # Exit immediately when issue found
            ;;
          "uptodate")
            # OK, continue checking other files
            ;;
          *)
            # Unknown status, treat as issue
            echo "❓ Unknown status for: $src_file (status: $status)"
            exit 1  # Exit immediately when issue found
            ;;
        esac
      done
      
      # Check if the subshell exited with error
      if [ $? -ne 0 ]; then
        return 1
      fi
    fi
  done
  
  echo "✅ All files have up-to-date documentation"
  return 0
}

# Check documentation status and warn user
if ! check_documentation; then
  echo ""
  echo "🚧 Warning: Documentation issues detected before merge."
  read -p "Continue merge anyway? [y/N] " yn < /dev/tty
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    echo "Proceeding with merge…"
  else
    echo "Merge aborted. Please review documentation for the files listed above."
    exit 1
  fi
fi

exit 0
`;

// Update drift after merging (similar logic to post-commit)
const HOOK_POST_MERGE = `#!/usr/bin/env sh
echo "DocHelper: Updating documentation status after merge…"

# Function to validate doch repo
validate_doch_repo() {
  if [ ! -d ".doch" ]; then
    echo "DocHelper not initialized. Missing: .doch directory"
    exit 1
  fi
  if [ ! -f ".doch/config.yml" ]; then
    echo "DocHelper configuration missing. Expected config file at: .doch/config.yml"
    exit 1
  fi
  if [ ! -d ".doch/metadata" ]; then
    mkdir -p ".doch/metadata"
  fi
}

# Function to read config and get extensions/directories
read_config() {
  if [ -f ".doch/config.yml" ]; then
    # Extract fileExtensions from YAML
    EXTENSIONS=$(grep -A 10 "fileExtensions:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\\n' '|' | sed 's/|$//')
    if [ -z "$EXTENSIONS" ]; then
      EXTENSIONS="ts|js|tsx"
    fi
    
    # Extract sourceDirectories from YAML
    SOURCE_DIRS=$(grep -A 10 "sourceDirectories:" ".doch/config.yml" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | sed 's|/$||g')
    if [ -z "$SOURCE_DIRS" ]; then
      SOURCE_DIRS="src lib app"
    fi
  else
    EXTENSIONS="ts|js|tsx"
    SOURCE_DIRS="src lib app"
  fi
}

# Function to get docs directory from VS Code settings
get_docs_directory() {
  DOCS_DIR="docs/"
  if [ -f ".vscode/settings.json" ]; then
    # Try to extract docs directory from VS Code settings
    SETTING_DOCS=$(grep -o '"doc-helper-0711.docsDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' ".vscode/settings.json" | sed 's/.*"\\([^"]*\\)"$/\\1/' | head -1)
    if [ -n "$SETTING_DOCS" ]; then
      DOCS_DIR="$SETTING_DOCS"
    fi
  fi
}

# Function to load ignore patterns
load_ignore_patterns() {
  IGNORE_PATTERNS=""
  if [ -f ".dochignore" ]; then
    IGNORE_PATTERNS=$(grep -v "^#" ".dochignore" | grep -v "^$")
  fi
}

# Function to check if file should be ignored
should_ignore() {
  local file="$1"
  if [ -n "$IGNORE_PATTERNS" ]; then
    echo "$IGNORE_PATTERNS" | while read -r pattern; do
      if [ -n "$pattern" ] && echo "$file" | grep -q "$pattern"; then
        return 0
      fi
    done
  fi
  return 1
}

# Function to update doc state (simplified for post-merge)
update_doc_state() {
  local src_rel="$1"
  local state_file=".doch/metadata/doc-state.json"
  
  if [ ! -f "$state_file" ]; then
    echo "{}" > "$state_file"
  fi
  
  # Use node to update JSON if available
  if command -v node >/dev/null 2>&1; then
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    node -e "
      const fs = require('fs');
      let state = {};
      try { state = JSON.parse(fs.readFileSync('$state_file', 'utf8')); } catch(e) {}
      if (!state['$src_rel']) {
        state['$src_rel'] = { documented: false, timestamp: '$timestamp', status: 'nodocs' };
      } else {
        state['$src_rel'].timestamp = '$timestamp';
        if (state['$src_rel'].status === 'uptodate') {
          state['$src_rel'].status = 'outdated';
        }
      }
      fs.writeFileSync('$state_file', JSON.stringify(state, null, 2));
    "
  fi
}

# Main logic
validate_doch_repo
read_config
get_docs_directory
load_ignore_patterns

PATTERN="\\.($EXTENSIONS|md)$"

# Check if ORIG_HEAD exists (indicates a merge just happened)
if git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
  # Get files that were changed in the merge
  CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r ORIG_HEAD HEAD | grep -E "$PATTERN")
else
  # Fallback: compare with previous commit
  if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD~1 HEAD | grep -E "$PATTERN")
  else
    # First commit - get all files
    CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r --root HEAD | grep -E "$PATTERN")
  fi
fi

if [ -n "$CHANGED_FILES" ]; then
  echo "Processing merged files..."
  echo "$CHANGED_FILES" | while read -r file; do
    if [ -z "$file" ]; then continue; fi
    
    if should_ignore "$file"; then
      continue
    fi
    
    # Check if this is a source file in one of our directories
    for src_dir in $SOURCE_DIRS; do
      if echo "$file" | grep -q "^$src_dir/" && echo "$file" | grep -qE "\\.($EXTENSIONS)$"; then
        update_doc_state "$file"
        echo "Updated status for: $file"
        break
      fi
    done
  done
fi
`;

// ABOUT DOCH REPO
export async function initDochRepo(folder: vscode.WorkspaceFolder) {
  const base = vscode.Uri.joinPath(folder.uri, '.doch');

  // Initialize .dochignore
  const ignoreUri = vscode.Uri.joinPath(folder.uri, '.dochignore');
  try {
    await vscode.workspace.fs.stat(ignoreUri);
  } catch {
    await vscode.workspace.fs.writeFile(
      ignoreUri,
      Buffer.from(TEMPLATE_IGNORE, 'utf8')
    );
  }

  try {
    // Check if they are any existing .doch folder
    await vscode.workspace.fs.stat(base);
    return;
  } catch {
    // create the root .doch folder
    await vscode.workspace.fs.createDirectory(base);
  }

  // Should not gitignore so every branch has their own doc status
  // // Ensure .gitignore exists and includes .doch/ and .dochignore
  // const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
  // let gitContent = '';
  // try {
  //   const buf = await vscode.workspace.fs.readFile(gitignoreUri);
  //   gitContent = Buffer.from(buf).toString('utf8');
  // } catch {
  //   // no .gitignore → create one with header
  //   const header = '# .gitignore (generated by DocHelper)\n\n';
  //   await vscode.workspace.fs.writeFile(
  //     gitignoreUri,
  //     Buffer.from(header, 'utf8')
  //   );
  //   gitContent = header;
  // }
  // const lines = gitContent.split(/\r?\n/);
  // const toAdd = ['.doch/', '.dochignore'].filter(p => !lines.includes(p));
  // if (toAdd.length) {
  //   const suffix = gitContent.endsWith('\n') ? '' : '\n';
  //   const newContent = gitContent + suffix + toAdd.join('\n') + '\n';
  //   await vscode.workspace.fs.writeFile(
  //     gitignoreUri,
  //     Buffer.from(newContent, 'utf8')
  //   );
  // }

  // 1) Directories to create
  const dirs = [
    'hooks',
    'metadata',
    'cache/drift-reports',
  ];
  for (const d of dirs) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, d));
  }

  // 2) Files to seed
  for (const [rel, content] of [
    ['config.yml', TEMPLATE_CONFIG],
    ['hooks/post-commit', HOOK_POST_COMMIT],
    ['hooks/pre-push', HOOK_PRE_PUSH],
    ['hooks/pre-merge-commit', HOOK_PRE_MERGE_COMMIT],
    ['hooks/post-merge', HOOK_POST_MERGE],
    ['metadata/doc-state.json', '{}'],
  ] as [string,string][]) {
    // create the file
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(base, rel),
      Buffer.from(content, 'utf8')
    );
  }

  const terminal = vscode.window.createTerminal('Doc Helper');
  terminal.show(true);
  terminal.sendText('git init');
  terminal.sendText('git config core.hooksPath .doch/hooks');
  // DEPLOYMENT NOTE:
  // terminal.sendText('npm install -g doc-helper-0711');

  // Ensure the workspace .vscode folder and add markdown quickSuggestions
  const vscodeConfigDir = vscode.Uri.joinPath(folder.uri, '.vscode');
  await vscode.workspace.fs.createDirectory(vscodeConfigDir);
  const settingsUri = vscode.Uri.joinPath(vscodeConfigDir, 'settings.json');

  let settings: any = {};
  try {
    const settingsContent = await vscode.workspace.fs.readFile(settingsUri);
    settings = JSON.parse(Buffer.from(settingsContent).toString('utf8'));
  } catch {
    // no existing settings → start fresh
  }

  settings['[markdown]'] = settings['[markdown]'] || {};
  settings['[markdown]']['editor.snippetSuggestions'] = "top";
  settings['[markdown]']['editor.quickSuggestions'] = true;
  settings['[markdown]']['editor.suggest.showWords'] = false;

  await vscode.workspace.fs.writeFile(
    settingsUri,
    Buffer.from(JSON.stringify(settings, null, 2), 'utf8')
  );

  vscode.window.showInformationMessage(`Initialized .doch in "${folder.name}"`);
}

export async function updateDochContext() {
  const folders = vscode.workspace.workspaceFolders || [];
  let initialized = false;
  for (const folder of folders) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.doch', 'config.yml'));
      initialized = true;
      break;
    } catch {
      // not found = keep looking
    }
  }
  // tell VS Code to re-evaluate when-clauses
  await vscode.commands.executeCommand('setContext', 'docHelper:dochInitialized', initialized);
}

// ABOUT FILE LEVEL
// detect changes to doc-state.json to dynamically update status bar
export function watchDocState(onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
      '**/.doch/metadata/doc-state.json'
  );
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}

// Read doch config.yml file
export interface DochConfig {
  sourceDirectories?: string[];
  fileExtensions?: string[];
}

async function readDochConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<DochConfig> {
  const configUri = vscode.Uri.joinPath(workspaceFolder.uri, '.doch', 'config.yml');
  
  try {
    const configBuffer = await vscode.workspace.fs.readFile(configUri);
    const configContent = Buffer.from(configBuffer).toString('utf8');
    const config = yaml.load(configContent) as DochConfig;
    
    return {
      sourceDirectories: Array.isArray(config.sourceDirectories) ? config.sourceDirectories : ["src/", "lib/", "app/"],
      fileExtensions: Array.isArray(config.fileExtensions) ? config.fileExtensions : ["ts", "js", "tsx"]
    };
  } catch (error) {
    // Fallback to default config
    return { sourceDirectories: ["src/", "lib/", "app/"], fileExtensions: ["ts", "js", "tsx"] };
  }
}

// Normalize source directories (remove trailing slash)
function normalizeSourceDirectories(sourceDirectories: string[]): string[] {
  return sourceDirectories.map(dir => dir.endsWith('/') ? dir.slice(0, -1) : dir);
}

// Normalize file extensions (remove leading dot)
function normalizeFileExtensions(fileExtensions: string[]): string[] {
  return fileExtensions.map(ext => ext.startsWith('.') ? ext.slice(1) : ext);
}

function buildFileExtensionRegex(extensions: string[]): RegExp {
  const escapedExts = extensions.map(ext => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\.(${escapedExts.join('|')})$`);
}

// Cache for configs per workspace
const configCache = new Map<string, { extensions: string[], regex: RegExp, sourceDirectories: string[] }>();

export async function getWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<{ extensions: string[], regex: RegExp, sourceDirectories: string[] }> {
  const key = workspaceFolder.uri.toString();
  
  if (!configCache.has(key)) {
    const config = await readDochConfig(workspaceFolder);
    const extensions = normalizeFileExtensions(config.fileExtensions || ["ts", "js", "tsx"]);
    const regex = buildFileExtensionRegex(extensions);
    const sourceDirectories = normalizeSourceDirectories(config.sourceDirectories || ["src", "lib", "app"]);
    
    configCache.set(key, { extensions, regex, sourceDirectories });
  }
  
  return configCache.get(key)!;
}

export function clearConfigCache(): void {
  configCache.clear();
}

export function createConfigWatcher(context: vscode.ExtensionContext, onConfigChange?: () => void): vscode.FileSystemWatcher {
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/.doch/config.yml');
  
  configWatcher.onDidChange(() => {
    clearConfigCache(); // Clear cache to reload config
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  configWatcher.onDidCreate(() => {
    clearConfigCache();
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  configWatcher.onDidDelete(() => {
    clearConfigCache();
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  context.subscriptions.push(configWatcher);
  return configWatcher;
}