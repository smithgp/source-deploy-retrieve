const { convertSource, convertSourceCli, RegistryAccess } = require('../lib');

async function time(f) {
  const start = new Date();
  await f();
  //@ts-ignore
  const elapsed = new Date() - start;
  console.log('Elapsed ms: ' + elapsed);
}

const pathToForceApp =
  '/Users/b.powell/dev/dx-projects/sample-convert/force-app';
const destination = '/Users/b.powell/Desktop/converted';

function test() {
  const registry = new RegistryAccess();
  const components = registry.getComponentsFromPath(pathToForceApp);
  time(async () => {
    await convertSource(components, destination);
  });
}

function testCli() {
  time(async () => {
    await convertSourceCli(pathToForceApp, destination);
  });
}

// testCli();
test();
