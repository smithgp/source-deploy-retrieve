/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { basename, dirname, join, sep } from 'path';
import { TreeContainer } from './types';
import { TypeInferenceError } from '../errors';
import { extName, parentName } from '../utils/path';
import { parseMetadataXml } from '../utils/registry';
import { SourceAdapterFactory } from './adapters/sourceAdapterFactory';
import { ForceIgnore } from './forceIgnore';
import { SourceComponent } from './sourceComponent';
import { MetadataType, SourcePath } from '../common';
import { NodeFSTreeContainer } from './treeContainers';
import { RegistryAccess } from './registryAccess';
import { ComponentSet } from '../collections';

/**
 * Resolver for metadata type and component objects.
 */
export class MetadataResolver {
  private forceIgnore: ForceIgnore;
  private sourceAdapterFactory: SourceAdapterFactory;
  private tree: TreeContainer;
  private registry: RegistryAccess;

  /**
   * @param registry Custom registry data
   * @param tree `TreeContainer` to traverse with
   */
  constructor(registry = new RegistryAccess(), tree: TreeContainer = new NodeFSTreeContainer()) {
    this.registry = registry;
    this.tree = tree;
    this.sourceAdapterFactory = new SourceAdapterFactory(this.registry, tree);
  }

  /**
   * Resolve metadata source paths into component objects.
   *
   * @param fsPath File path to metadata or directory
   * @param filter Set to filter which components are resolved
   */
  public resolveSource(
    fsPathOrPaths: string | string[],
    filter?: ComponentSet
  ): ComponentSet<SourceComponent> {
    const fsPaths = typeof fsPathOrPaths === 'string' ? [fsPathOrPaths] : fsPathOrPaths;

    // eslint-disable-next-line
    const resolver = this;
    return new ComponentSet(
      (function* (): Iterable<SourceComponent> {
        for (const fsPath of fsPaths) {
          if (!resolver.tree.exists(fsPath)) {
            throw new TypeInferenceError('error_path_not_found', fsPath);
          }

          resolver.forceIgnore = ForceIgnore.findAndCreate(fsPath);

          if (resolver.tree.isDirectory(fsPath) && !resolver.resolveDirectoryAsComponent(fsPath)) {
            yield* resolver.resolveSourceRecursive(fsPath, filter);
            continue;
          }

          yield resolver.resolveComponent(fsPath, true);
        }
      })(),
      this.registry
    );
  }

  private *resolveSourceRecursive(
    dir: SourcePath,
    filter?: ComponentSet
  ): Generator<SourceComponent> {
    const dirQueue: SourcePath[] = [];
    const ignore = new Set();

    if (this.forceIgnore.denies(dir)) {
      return;
    }

    for (const file of this.tree.readDirectory(dir)) {
      const fsPath = join(dir, file);

      if (ignore.has(fsPath)) {
        continue;
      }

      if (this.tree.isDirectory(fsPath)) {
        if (this.resolveDirectoryAsComponent(fsPath)) {
          const component = this.resolveComponent(fsPath, true);
          if (!filter || filter.has(component)) {
            yield component;
            ignore.add(component.xml);
          }
        } else {
          dirQueue.push(fsPath);
        }
      } else if (this.isMetadata(fsPath)) {
        const component = this.resolveComponent(fsPath, false);
        if (component) {
          if (!filter || filter.has(component)) {
            yield component;
            ignore.add(component.content);
          } else {
            for (const child of component.getChildren()) {
              if (filter.has(child)) {
                yield child;
              }
            }
          }
          // don't traverse further if not in a root type directory. performance optimization
          // for mixed content types and ensures we don't add duplicates of the component.
          const typeDir = basename(dirname(component.type.inFolder ? dirname(fsPath) : fsPath));
          if (component.type.strictDirectoryName && typeDir !== component.type.directoryName) {
            return;
          }
        }
      }
    }

    for (const dir of dirQueue) {
      yield* this.resolveSourceRecursive(dir, filter);
    }
  }

  private resolveComponent(fsPath: SourcePath, isResolvingSource: boolean): SourceComponent {
    if (this.isMetadata(fsPath) && this.forceIgnore.denies(fsPath)) {
      // don't resolve the component if the metadata xml is denied
      return;
    }
    const type = this.resolveType(fsPath);
    if (type) {
      const adapter = this.sourceAdapterFactory.getAdapter(type, this.forceIgnore);
      // short circuit the component resolution unless this is a resolve for a
      // source path or allowed content-only path, otherwise the adapter
      // knows how to handle it
      const shouldResolve =
        isResolvingSource ||
        !this.parseAsContentMetadataXml(fsPath) ||
        !adapter.allowMetadataWithContent();
      return shouldResolve ? adapter.getComponent(fsPath, isResolvingSource) : undefined;
    }
    throw new TypeInferenceError('error_could_not_infer_type', fsPath);
  }

  private resolveType(fsPath: SourcePath): MetadataType | undefined {
    let resolvedType: MetadataType;

    // attempt 1 - check if the file is part of a component that requires a strict type folder
    const pathParts = new Set(fsPath.split(sep));
    for (const type of this.registry.getStrictFolderTypes()) {
      if (pathParts.has(type.directoryName)) {
        // types with folders only have folder components living at the top level.
        // if the fsPath is a folder component, let a future strategy deal with it
        // const isFolderType = this.getTypeFromName(typeId).inFolder;
        if (!type.inFolder || parentName(fsPath) !== type.directoryName) {
          resolvedType = type;
        }
        break;
      }
    }

    // attempt 2 - check if it's a metadata xml file
    if (!resolvedType) {
      const parsedMetaXml = parseMetadataXml(fsPath);
      if (parsedMetaXml) {
        resolvedType = this.registry.getTypeBySuffix(parsedMetaXml.suffix);
      }
    }

    // attempt 2.5 - test for a folder style xml file
    if (!resolvedType) {
      const metadataFolder = this.parseAsFolderMetadataXml(fsPath);
      if (metadataFolder) {
        // multiple matching directories may exist - folder components are not 'inFolder'
        resolvedType = this.registry.findType(
          (type) => type.directoryName === metadataFolder && !type.inFolder
        );
      }
    }

    // attempt 3 - try treating the file extension name as a suffix
    if (!resolvedType) {
      resolvedType = this.registry.getTypeBySuffix(extName(fsPath));
    }

    return resolvedType;
  }

  /**
   * Whether or not a directory that represents a single component should be resolved as one,
   * or if it should be walked for additional components.
   *
   * If a type can be determined from a directory path, and the end part of the path isn't
   * the directoryName of the type itself, infer the path is part of a mixedContent component
   *
   * @param dirPath Path to a directory
   */
  private resolveDirectoryAsComponent(dirPath: SourcePath): boolean {
    let shouldResolve = true;

    const type = this.resolveType(dirPath);
    if (type) {
      const { directoryName, inFolder } = type;
      const parts = dirPath.split(sep);
      const folderOffset = inFolder ? 2 : 1;
      const typeDirectoryIndex = parts.indexOf(directoryName);
      if (
        typeDirectoryIndex === -1 ||
        parts.length - folderOffset <= typeDirectoryIndex ||
        // types with children may want to resolve them individually
        type.children
      ) {
        shouldResolve = false;
      }
    } else {
      shouldResolve = false;
    }

    return shouldResolve;
  }

  /**
   * Any file with a registered suffix is potentially a content metadata file.
   *
   * @param fsPath File path of a potential content metadata file
   */
  private parseAsContentMetadataXml(fsPath: SourcePath): boolean {
    return !!this.registry.getTypeBySuffix(extName(fsPath));
  }

  /**
   * Identify metadata xml for a folder component:
   *    .../email/TestFolder-meta.xml
   *
   * Do not match this pattern:
   *    .../tabs/TestFolder.tab-meta.xml
   */
  private parseAsFolderMetadataXml(fsPath: SourcePath): string {
    const match = basename(fsPath).match(/(.+)-meta\.xml/);
    if (match && !match[1].includes('.')) {
      const parts = fsPath.split(sep);
      return parts.length > 1 ? parts[parts.length - 2] : undefined;
    }
  }

  private isMetadata(fsPath: SourcePath): boolean {
    return (
      !!parseMetadataXml(fsPath) ||
      this.parseAsContentMetadataXml(fsPath) ||
      !!this.parseAsFolderMetadataXml(fsPath)
    );
  }
}

interface ResolveSourceOptions {
  paths: string[];
  tree?: TreeContainer;
  registry?: RegistryAccess;
}

export function resolveSource(fsPath: string): ComponentSet<SourceComponent>;
export function resolveSource(fsPaths: string[]): ComponentSet<SourceComponent>;
export function resolveSource(
  input: string | string[] | ResolveSourceOptions
): ComponentSet<SourceComponent> {
  let fsPaths = [];
  let registry = new RegistryAccess();
  let tree = new NodeFSTreeContainer();

  if (typeof input === 'object' && !Array.isArray(input)) {
    const options = input as ResolveSourceOptions;
    fsPaths = options.paths;
    registry = options.registry ?? registry;
    tree = options.tree ?? tree;
  } else {
    fsPaths = typeof input === 'string' ? [input] : input;
  }

  const resolver = new MetadataResolver(registry, tree);
  // const components = new ComponentSet<SourceComponent>(undefined, registry);

  return resolver.resolveSource(fsPaths);
}
