const { convertSource, convertSourceCli, RegistryAccess } = require('../lib');
const { existsSync, rmdirSync } = require('fs');

async function time(f) {
  const start = new Date();
  await f();
  //@ts-ignore
  const elapsed = new Date() - start;
  return elapsed;
}

const pathToLargeForceApp =
  '/Users/b.powell/dev/dx-projects/sample-convert/force-app';
const pathToSmallForceApp =
  '/Users/b.powell/dev/dx-projects/sample-convert-small/force-app';
const pathToMediumForceApp =
  '/Users/b.powell/dev/dx-projects/sample-convert-medium/force-app';
const destination = '/Users/b.powell/Desktop/converted';

async function test(forceApp) {
  let start = new Date();
  const registry = new RegistryAccess();
  const components = registry.getComponentsFromPath(forceApp);
  let elapsed = new Date() - start;
  console.log(`Fetching components: ${elapsed} ms`);
  const convertTime = await time(async () => {
    await convertSource(components, destination);
  });
  console.log(`Conversion: ${convertTime} ms`);
  console.log(`Total: ${convertTime + elapsed} ms`);
  console.log(
    `Memory Consumption: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`
  );
}

async function testCli(forceApp) {
  const elapsed = await time(async () => {
    await convertSourceCli(forceApp, destination);
  });
  console.log(`Total: ${elapsed} ms`);
  console.log(
    `Memory Consumption: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`
  );
}

// testCli(pathToSmallForceApp);
// test(pathToSmallForceApp);

testCli(pathToMediumForceApp);
// test(pathToMediumForceApp);

// testCli(pathToLargeForceApp);
// test(pathToLargeForceApp);
