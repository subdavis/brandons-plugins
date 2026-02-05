# Brandon's Plugin Marketplace

## Marketplace Installation

```bash
# From GitHub
/plugin marketplace add subdavis/brandons-plugins

# From local path
/plugin marketplace add ./brandons-plugins
```

## Plugin: Verify Sonar

```bash
/plugin install verify-sonar@brandons-plugins
```

Once installed, use the `/verify-sonar` skill:

```bash
/verify-sonar                    # Scan outstanding git changes (default)
/verify-sonar ./src              # Scan a directory
/verify-sonar ./src/index.ts     # Scan a specific file
/verify-sonar ./src ./lib        # Scan multiple paths
```

Requirements

- Node.js >= 20
- VS Code or IntelliJ must be running
- SonarQube for IDE extension must be installed and active
- The scanned files must be in the IDE's open workspace
