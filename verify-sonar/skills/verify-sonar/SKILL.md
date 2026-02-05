---
name: verify-sonar
description: Scan code for quality and security issues using SonarQube for IDE
allowed-tools: Bash, Glob, Grep, Read
---

# verify-sonar

Scan code for quality and security issues using SonarQube for IDE.

## Description

This skill runs static analysis on code using SonarQube for IDE's embedded analysis engine. It detects bugs, code smells, security vulnerabilities, and other quality issues.

## When to use

- After writing or modifying code to check for issues
- Before committing changes to verify code quality
- When reviewing code for potential problems
- To validate that fixes don't introduce new issues

## Requirements

- VS Code (or compatible IDE) must be running
- SonarQube for IDE extension must be installed and active
- The scanned files must be in the IDE's open workspace

## Usage

```text
/verify-sonar                    # Scan outstanding git changes (default)
/verify-sonar ./src              # Scan a directory
/verify-sonar ./src/index.ts     # Scan a specific file
/verify-sonar ./src ./lib        # Scan multiple paths
```

## Instructions

Run the scanner script with any provided arguments:

```bash
node --experimental-strip-types $SKILL_DIR/scripts/verify-sonar.ts $ARGUMENTS
```

The script will:

1. Collect files to scan (from arguments or git changes)
2. Connect to SonarQube for IDE on ports 64120-64130
3. Send files for analysis
4. Display formatted results with severity icons
5. Exit with code 1 if errors or warnings are found

## Output

Results are formatted with severity indicators:

- `[x]` BLOCKER/CRITICAL - Must fix
- `[!]` MAJOR - Should fix
- `[-]` MINOR/INFO - Consider fixing

Each finding shows: file path, line number, rule key, and message.
