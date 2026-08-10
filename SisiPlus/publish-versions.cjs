const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const project = __dirname;
const repository = path.resolve(project, '..');
const output = path.join(project, 'dist', 'versions');
const versions = {
  '1.0.0': '75cf4ba',
  '1.0.1': '2a79bd5',
  '1.0.2': '2e05f6e',
  'beta-1.0.0': '26baa16'
};

fs.mkdirSync(output, { recursive: true });
Object.entries(versions).forEach(([version, commit]) => {
  const bundle = execFileSync('git', ['show', `${commit}:SisiPlus/dist/sisiplus.js`], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  fs.writeFileSync(path.join(output, `${version}.js`), bundle, 'utf8');
  console.log(`Published ${version} from ${commit}`);
});

fs.copyFileSync(path.join(project, 'version-router.js'), path.join(project, 'dist', 'sisiplus.js'));
console.log('Published version router to dist/sisiplus.js');
