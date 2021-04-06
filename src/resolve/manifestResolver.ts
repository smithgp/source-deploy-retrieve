/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { RegistryAccess } from '../registry';
import { NodeFSTreeContainer, TreeContainer } from './treeContainers';
import { MetadataComponent, ResolveManifestResult } from './types';
import { parse as parseXml } from 'fast-xml-parser';
import { normalizeToArray } from '../utils';
import { Package, PackageTypeMembers } from 'jsforce';

// these types exist in jsforce, but xml parsing will interpret one element
// as an object and more than one as an array. The manifest resolver takes care
// of normalizing the parsed result.
interface ParsedPackageTypeMembers {
  name: string;
  members: string | string[];
}

interface ParsedPackageManifest extends Omit<Package, 'types'> {
  types: ParsedPackageTypeMembers | ParsedPackageTypeMembers[];
}

/**
 * Resolve metadata components from a manifest file (package.xml)
 */
export class ManifestResolver {
  private tree: TreeContainer;
  private registry: RegistryAccess;

  constructor(tree: TreeContainer = new NodeFSTreeContainer(), registry = new RegistryAccess()) {
    this.tree = tree;
    this.registry = registry;
  }

  public async resolve(manifestPath: string): Promise<ResolveManifestResult> {
    const file = await this.tree.readFile(manifestPath);
    const components: MetadataComponent[] = [];
    const parsedManifest: ParsedPackageManifest = parseXml(file.toString(), {
      stopNodes: ['version'],
    }).Package;
    const packageTypeMembers = normalizeToArray(parsedManifest.types);

    for (const typeMembers of packageTypeMembers) {
      const typeName = typeMembers.name;
      typeMembers.members = normalizeToArray(typeMembers.members);
      for (const fullName of typeMembers.members) {
        let type = this.registry.getTypeByName(typeName);
        // if there is no / delimiter and it's a type in folders, infer folder component
        if (type.folderType && !fullName.includes('/')) {
          type = this.registry.getTypeByName(type.folderType);
        }
        components.push({ fullName, type });
      }
    }

    const normalizedPackage = Object.assign(parsedManifest, {
      types: packageTypeMembers as PackageTypeMembers[],
    });

    return { components, package: normalizedPackage };
  }
}
