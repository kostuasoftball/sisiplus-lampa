const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root, { recursive: true })
  .filter((name) => name.endsWith('.js') && !name.startsWith(`dist${path.sep}`));

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(source, { filename: file });
  process.stdout.write(`OK ${file}\n`);
}
