const { RegistryAccess } = require('../lib');
const { GitFileContainer } = require('../lib/metadata-registry/fileContainers');

async function go(dir, ref1, ref2) {
  const container = new GitFileContainer();
  const registry = new RegistryAccess(undefined, container);
  process.chdir(dir);

  await container.initialize('local', { treeRef: ref1 });
  const ref1Components = registry.getComponentsFromPath('force-app');
  const ref1Map = buildTypeMap(ref1Components);

  await container.initialize('local', { treeRef: ref2 });
  const ref2Components = registry.getComponentsFromPath('force-app');
  const ref2Map = buildTypeMap(ref2Components);

  const changes = diff(ref1Map, ref2Map);
  if (changes.added.size > 0) {
    printChanges(`\u001b[32m+++ ${ref2}\u001b[0m`, changes.added);
  }
  if (changes.deleted.size > 0) {
    printChanges(`\u001b[31m--- ${ref1}\u001b[0m`, changes.deleted);
  }
}

function printChanges(label, changeMap) {
  let output = `${label}\n`;
  for (const entry of changeMap.entries()) {
    output += `  \u001b[37;1m${entry[0]}\u001b[0m\n`;
    for (const fullName of entry[1]) {
      output += `    - ${fullName}\n`;
    }
  }
  console.log(output);
}

function buildTypeMap(components) {
  const typeMap = new Map();
  components.forEach(component => {
    const typeName = component.type.name;
    if (!typeMap.has(typeName)) {
      typeMap.set(typeName, new Set());
    }
    typeMap.get(typeName).add(component.fullName);
  });
  return typeMap;
}

function diff(map1, map2) {
  const diffs = {
    added: new Map(),
    deleted: new Map(),
    modified: new Map()
  };
  for (const entry of map1.entries()) {
    const typeName = entry[0];
    const map2FullNames = map2.get(typeName);
    for (const fullName of entry[1]) {
      if (!map2FullNames || !map2FullNames.has(fullName)) {
        if (!diffs.deleted.has(typeName)) {
          diffs.deleted.set(typeName, new Set());
        }
        diffs.deleted.get(typeName).add(fullName);
      }
    }
  }

  for (const entry of map2.entries()) {
    const typeName = entry[0];
    const map1FullNames = map1.get(typeName);
    for (const fullName of entry[1]) {
      if (!map1FullNames || !map1FullNames.has(fullName)) {
        if (!diffs.added.has(typeName)) {
          diffs.added.set(typeName, new Set());
        }
        diffs.added.get(typeName).add(fullName);
      }
    }
  }

  return diffs;
}

go(process.argv[2], process.argv[3], process.argv[4]);
