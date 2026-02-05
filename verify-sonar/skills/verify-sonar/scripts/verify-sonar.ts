#!/usr/bin/env node
/**
 * verify-sonar - Standalone SonarQube for IDE scanner
 *
 * Scans code using SonarQube for IDE's embedded analysis service.
 * No external dependencies - uses native Node.js modules only.
 *
 * Usage:
 *   node --experimental-strip-types verify-sonar.ts [paths...]
 *
 * If no paths provided, scans outstanding git changes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { execSync } from 'node:child_process';

// =============================================================================
// Types
// =============================================================================

type IdeSeverity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';

interface IdeTextRange {
  startLine: number;
  endLine: number;
  startLineOffset?: number;
  endLineOffset?: number;
}

interface IdeBridgeFinding {
  ruleKey: string;
  message: string;
  severity: IdeSeverity;
  filePath: string;
  textRange?: IdeTextRange;
}

interface AnalyzeFilesResponse {
  findings: IdeBridgeFinding[];
}

// =============================================================================
// Constants
// =============================================================================

const IDE_BRIDGE_PORT_START = 64120;
const IDE_BRIDGE_PORT_END = 64130;
const WRONG_WORKSPACE_MESSAGE = 'No files were found to be indexed by SonarQube for IDE';
const REQUEST_TIMEOUT = 60000;

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.py', '.go',
  '.c', '.cpp', '.h', '.hpp',
  '.php', '.html', '.htm', '.css', '.scss', '.xml',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode',
]);

// =============================================================================
// HTTP Client (native node:http)
// =============================================================================

interface HttpResponse {
  statusCode: number;
  data: string;
}

function httpRequest(
  port: number,
  method: 'GET' | 'POST',
  urlPath: string,
  body?: string
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'localhost',
        'Origin': 'http://localhost',
        'Connection': 'close',
      },
      timeout: REQUEST_TIMEOUT,
    };

    if (body) {
      options.headers!['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// =============================================================================
// IDE Bridge Discovery
// =============================================================================

async function checkPort(port: number): Promise<boolean> {
  try {
    const response = await httpRequest(port, 'GET', '/sonarlint/api/status');
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

async function scanForIdeBridges(): Promise<number[]> {
  const ports: number[] = [];
  const checks = [];

  for (let port = IDE_BRIDGE_PORT_START; port <= IDE_BRIDGE_PORT_END; port++) {
    checks.push(
      checkPort(port).then((available) => {
        if (available) ports.push(port);
      })
    );
  }

  await Promise.all(checks);
  return ports.sort((a, b) => a - b);
}

async function analyzeFiles(port: number, filePaths: string[]): Promise<AnalyzeFilesResponse> {
  const body = JSON.stringify({ fileAbsolutePaths: filePaths });
  const response = await httpRequest(port, 'POST', '/sonarlint/api/analysis/files', body);

  if (response.statusCode === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (response.statusCode !== 200) {
    if (response.data.includes(WRONG_WORKSPACE_MESSAGE)) {
      throw new Error('WRONG_WORKSPACE');
    }
    throw new Error(`Analysis failed: ${response.statusCode}`);
  }

  return JSON.parse(response.data);
}

async function findCorrectIdeBridge(testFile: string): Promise<number> {
  const availablePorts = await scanForIdeBridges();

  if (availablePorts.length === 0) {
    throw new Error(
      'No SonarQube for IDE instances found.\n' +
      'Please ensure:\n' +
      '  - VS Code (or compatible IDE) is running\n' +
      '  - SonarQube for IDE extension is installed and active'
    );
  }

  for (const port of availablePorts) {
    try {
      await analyzeFiles(port, [testFile]);
      return port;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'RATE_LIMITED') {
          throw new Error('SonarQube for IDE is rate limiting requests. Please wait and try again.');
        }
        if (error.message === 'WRONG_WORKSPACE') {
          continue;
        }
      }
      continue;
    }
  }

  throw new Error(
    `Found ${availablePorts.length} IDE instance(s) but files are not in any workspace.\n` +
    'Please open the correct project in your IDE.'
  );
}

// =============================================================================
// File Collection
// =============================================================================

function collectFilesFromDirectory(dirPath: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dirPath);
  return files;
}

function collectFiles(scanPath: string): string[] {
  const absolutePath = path.resolve(scanPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path does not exist: ${scanPath}`);
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return [absolutePath];
  }

  if (stat.isDirectory()) {
    return collectFilesFromDirectory(absolutePath);
  }

  throw new Error(`Invalid path type: ${scanPath}`);
}

// =============================================================================
// Git Integration
// =============================================================================

interface GitStatusLine {
  status: string;
  filePath: string;
}

function parseGitStatusLine(line: string): GitStatusLine | null {
  if (!line.trim()) return null;

  const status = line.substring(0, 2);
  let filePath = line.substring(3).trim();

  // Handle renamed files (format: "R  old -> new")
  if (status.startsWith('R')) {
    const parts = filePath.split(' -> ');
    filePath = parts[parts.length - 1];
  }

  return { status, filePath };
}

function isScannableGitFile(parsed: GitStatusLine, cwd: string): string | null {
  // Skip deleted files
  if (parsed.status.includes('D')) return null;

  const absolutePath = path.resolve(cwd, parsed.filePath);
  const ext = path.extname(parsed.filePath).toLowerCase();

  if (SUPPORTED_EXTENSIONS.has(ext) && fs.existsSync(absolutePath)) {
    return absolutePath;
  }
  return null;
}

function getGitChangedFiles(): string[] {
  try {
    const output = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const cwd = process.cwd();
    const files: string[] = [];

    for (const line of output.split('\n')) {
      const parsed = parseGitStatusLine(line);
      if (!parsed) continue;

      const absolutePath = isScannableGitFile(parsed, cwd);
      if (absolutePath) {
        files.push(absolutePath);
      }
    }

    return files;
  } catch {
    return [];
  }
}

// =============================================================================
// Output Formatting
// =============================================================================

function getSeverityIcon(severity: IdeSeverity): string {
  switch (severity) {
    case 'BLOCKER':
    case 'CRITICAL':
      return '[x]';
    case 'MAJOR':
      return '[!]';
    case 'MINOR':
    case 'INFO':
    default:
      return '[-]';
  }
}

function formatFinding(finding: IdeBridgeFinding, cwd: string): string {
  const icon = getSeverityIcon(finding.severity);
  const relativePath = path.relative(cwd, finding.filePath);
  const line = finding.textRange?.startLine ?? 1;

  return `${icon} ${relativePath}:${line} (${finding.ruleKey})\n    ${finding.message}`;
}

function formatSummary(findings: IdeBridgeFinding[], fileCount: number): string {
  const counts = {
    blocker: 0,
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
  };

  for (const f of findings) {
    switch (f.severity) {
      case 'BLOCKER': counts.blocker++; break;
      case 'CRITICAL': counts.critical++; break;
      case 'MAJOR': counts.major++; break;
      case 'MINOR': counts.minor++; break;
      case 'INFO': counts.info++; break;
    }
  }

  const errorCount = counts.blocker + counts.critical;
  const warningCount = counts.major;
  const infoCount = counts.minor + counts.info;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error(s)`);
  if (warningCount > 0) parts.push(`${warningCount} warning(s)`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  if (parts.length === 0) {
    return `Scanned ${fileCount} file(s) - no issues found`;
  }

  return `Scanned ${fileCount} file(s) - ${parts.join(', ')}`;
}

// =============================================================================
// Main Helpers
// =============================================================================

function collectFilesFromArgs(args: string[]): string[] {
  const files: string[] = [];
  for (const arg of args) {
    files.push(...collectFiles(arg));
  }
  return files;
}

function getFilesToScan(args: string[]): string[] | null {
  if (args.length === 0) {
    console.log('Scanning outstanding git changes...');
    const files = getGitChangedFiles();
    if (files.length === 0) {
      console.log('No changed files to scan.');
      return null;
    }
    return files;
  }

  const files = collectFilesFromArgs(args);
  return [...new Set(files)];
}

const SEVERITY_ORDER: Record<IdeSeverity, number> = {
  BLOCKER: 0,
  CRITICAL: 1,
  MAJOR: 2,
  MINOR: 3,
  INFO: 4,
};

function sortFindings(findings: IdeBridgeFinding[]): void {
  findings.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return a.filePath.localeCompare(b.filePath);
  });
}

function printFindings(findings: IdeBridgeFinding[], cwd: string): void {
  if (findings.length === 0) return;

  sortFindings(findings);
  for (const finding of findings) {
    console.log(formatFinding(finding, cwd));
  }
  console.log('');
}

function hasFailingIssues(findings: IdeBridgeFinding[]): boolean {
  return findings.some(
    (f) => f.severity === 'BLOCKER' || f.severity === 'CRITICAL' || f.severity === 'MAJOR'
  );
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  const files = getFilesToScan(args);
  if (!files || files.length === 0) {
    if (files !== null) console.log('No scannable files found.');
    return;
  }

  console.log(`Found ${files.length} file(s) to scan`);
  console.log('Connecting to SonarQube for IDE...');

  const port = await findCorrectIdeBridge(files[0]);
  console.log(`Connected on port ${port}`);
  console.log('Analyzing...\n');

  const response = await analyzeFiles(port, files);

  printFindings(response.findings, cwd);
  console.log(formatSummary(response.findings, files.length));

  if (hasFailingIssues(response.findings)) {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
