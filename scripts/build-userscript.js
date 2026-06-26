const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const parts = [
  'src/userscript.meta.js',

  'src/importer/00-bootstrap.js',
  'src/importer/10-shared.js',
  'src/importer/20-import-data.js',
  'src/importer/30-panel.js',
  'src/importer/40-run.js',

  'src/launcher/index.js',

  'src/checker/00-bootstrap.js',
  'src/checker/10-shared.js',
  'src/checker/20-panel.js',
  'src/checker/30-accounts.js',
  'src/checker/40-account-api.js',
  'src/checker/50-scheduled-api.js',
  'src/checker/60-batch-actions.js',
  'src/checker/70-run.js',
];

const distDir = path.join(root, 'dist');
const outputFile = path.join(distDir, 'sub2-toolbox.user.js');
const legacyOutputName = fs.readdirSync(root).find((name) => name.endsWith('.txt'));
const legacyOutputFile = legacyOutputName ? path.join(root, legacyOutputName) : '';

function readPart(relativePath) {
  const filePath = path.join(root, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing source part: ${relativePath}`);
  }

  return fs.readFileSync(filePath, 'utf8').replace(/\s+$/u, '');
}

function build() {
  const content = `${parts.map(readPart).join('\n\n')}\n`;

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(outputFile, content, 'utf8');

  if (legacyOutputFile) {
    fs.writeFileSync(legacyOutputFile, content, 'utf8');
  }

  console.log(`Built ${path.relative(root, outputFile)}`);

  if (legacyOutputFile) {
    console.log(`Synced ${path.relative(root, legacyOutputFile)}`);
  }
}

build();
