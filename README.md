# verify-sonar Marketplace

A Claude Code plugin marketplace containing the `verify-sonar` plugin for scanning code using SonarQube for IDE.

## Installation

### Add the Marketplace

```bash
# From GitHub
/plugin marketplace add github.com/subdavis/brandons-plugins

# From local path
/plugin marketplace add ./brandons-plugins
```

### Install the Plugin

```bash
/plugin install verify-sonar@brandons-plugins
```

## Usage

Once installed, use the `/verify-sonar` skill:

```bash
/verify-sonar                    # Scan outstanding git changes (default)
/verify-sonar ./src              # Scan a directory
/verify-sonar ./src/index.ts     # Scan a specific file
/verify-sonar ./src ./lib        # Scan multiple paths
```

## Requirements

- Node.js >= 20
- VS Code (or compatible IDE) must be running
- SonarQube for IDE extension must be installed and active
- The scanned files must be in the IDE's open workspace

## Testing

### Test the script directly

```bash
cd plugins/verify-sonar/skills/verify-sonar/scripts
node --experimental-strip-types verify-sonar.ts
```

### Test with plugin-dir flag

```bash
claude --plugin-dir ./brandons-plugins/plugins/verify-sonar
```

### Test the marketplace

```bash
claude
/plugin marketplace add ./brandons-plugins
/plugin install verify-sonar@brandons-plugins
/verify-sonar
```

## Supported Languages

- JavaScript/TypeScript: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`
- Java: `.java`
- Python: `.py`
- Go: `.go`
- C/C++: `.c`, `.cpp`, `.h`, `.hpp`
- PHP: `.php`
- Web: `.html`, `.htm`, `.css`, `.scss`
- XML: `.xml`

## How It Works

1. Scans for SonarQube for IDE instances on ports 64120-64130
2. Finds the IDE instance with the correct workspace
3. Sends files for analysis via the IDE bridge HTTP API
4. Displays results with severity indicators:
   - `[x]` BLOCKER/CRITICAL - Must fix
   - `[!]` MAJOR - Should fix
   - `[-]` MINOR/INFO - Consider fixing
5. Exits with code 1 if errors or warnings are found
