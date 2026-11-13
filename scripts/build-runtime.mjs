import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

const configuredRoot = process.env.DDT_QBO_RUNTIME_DIR?.trim();
const localAppData = process.env.LOCALAPPDATA?.trim();
const runtimeRoot = configuredRoot ||
  (localAppData
    ? path.join(localAppData, 'DDTFinanceForeman', 'qbo-mcp-dist')
    : path.join(os.homedir(), '.local', 'share', 'DDTFinanceForeman', 'qbo-mcp-dist'));

fs.mkdirSync(runtimeRoot, { recursive: true });

const tscCli = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');

const compile = spawnSync(process.execPath, [tscCli, '--outDir', runtimeRoot], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (compile.error) {
  console.error(`Runtime build failed to start: ${compile.error.message}`);
  process.exit(1);
}
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

// The durable runtime lives outside the repository, so Node cannot resolve
// the repository-installed packages by walking parent directories. Link the
// runtime to the exact dependency tree used for this build instead of copying
// a second, drift-prone node_modules tree.
const dependencySource = path.join(process.cwd(), 'node_modules');
const dependencyTarget = path.join(runtimeRoot, 'node_modules');
if (!fs.existsSync(dependencySource)) {
  console.error(`Runtime dependency source is missing: ${dependencySource}`);
  process.exit(1);
}
if (fs.existsSync(dependencyTarget)) {
  const resolvedTarget = fs.realpathSync(dependencyTarget);
  const resolvedSource = fs.realpathSync(dependencySource);
  if (resolvedTarget !== resolvedSource) {
    console.error(`Runtime dependency path points somewhere unexpected: ${dependencyTarget}`);
    process.exit(1);
  }
} else {
  fs.symlinkSync(dependencySource, dependencyTarget, process.platform === 'win32' ? 'junction' : 'dir');
}

fs.writeFileSync(
  path.join(runtimeRoot, 'package.json'),
  `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  'utf8',
);

// packageRootDir() intentionally resolves to the durable DDTFinanceForeman
// directory when the compiled tree is flattened into qbo-mcp-dist. Keep the
// non-sensitive rules/templates beside that persistent data root so the
// installed MCP classifies with the same reviewed rules as the repository.
const templateSource = path.join(process.cwd(), 'data', 'templates');
const templateTarget = path.join(path.dirname(runtimeRoot), 'data', 'templates');
if (fs.existsSync(templateSource)) {
  fs.mkdirSync(path.dirname(templateTarget), { recursive: true });
  fs.cpSync(templateSource, templateTarget, { recursive: true, force: true });
}

if (process.platform !== 'win32') {
  for (const entry of ['index.js', 'auth-server.js', 'production-auth.js']) {
    const file = path.join(runtimeRoot, entry);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
}

console.log(`QuickBooks MCP runtime built at ${runtimeRoot}`);
