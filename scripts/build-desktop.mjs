import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'desktop-dist');
const tempOutputDir = await mkdtemp(path.join(os.tmpdir(), 'lembreto-desktop-'));

const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronBuilderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');

const buildInstaller = process.argv.includes('--installer');
const builderArgs = buildInstaller ? ['--win', 'nsis'] : ['--dir'];
builderArgs.push(`--config.directories.output=${tempOutputDir}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

try {
  await run(process.execPath, [viteCli, 'build']);
  await run(process.execPath, [electronBuilderCli, ...builderArgs]);

  await rm(outputDir, { recursive: true, force: true });
  await cp(tempOutputDir, outputDir, { recursive: true });
  console.log(`Desktop build copied to ${outputDir}`);
} finally {
  await rm(tempOutputDir, { recursive: true, force: true }).catch(() => undefined);
}
