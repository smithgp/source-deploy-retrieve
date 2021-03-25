/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { ComponentSet } from '.';
import { TreeContainer, SourceComponent, MetadataResolver } from '..';
import { RegistryOptions, TreeOptions } from '../common';
import { RegistryAccess } from '../metadata-registry';

interface ResolveSourceOptions extends Partial<TreeOptions>, Partial<RegistryOptions> {
  /**
   * File or directory paths to resolve components against
   */
  fsPaths: string[];
  /**
   * Only resolve components contained in the given set
   */
  inclusiveFilter?: ComponentSet;
}

/**
 * Resolve metadata components from a file or directory path in a file system.
 *
 * @param fsPath File or directory path to resolve against
 */
export function resolveSource(fsPath: string): ComponentSet<SourceComponent>;
/**
 * Resolve metadata components from multiple file or directory paths in a file system.
 *
 * @param fsPaths File or directory paths to resolve against
 */
export function resolveSource(fsPaths: string[]): ComponentSet<SourceComponent>;
/**
 * Resolve metadata components from file or directory paths in a file system.
 * Customize the resolution process using an options object, such as specifying filters
 * and resolving against a different file system abstraction (see {@link TreeContainer}).
 *
 * @param options
 */
export function resolveSource(options: ResolveSourceOptions): ComponentSet<SourceComponent>;
export function resolveSource(
  input: string | string[] | ResolveSourceOptions
): ComponentSet<SourceComponent> {
  let fsPaths = [];
  let registry: RegistryAccess;
  let tree: TreeContainer;
  let filter: ComponentSet;

  if (Array.isArray(input)) {
    fsPaths = input;
  } else if (typeof input === 'object') {
    fsPaths = input.fsPaths;
    registry = input.registry ?? registry;
    tree = input.tree ?? tree;
  } else {
    fsPaths = [input];
  }

  const resolver = new MetadataResolver(registry, tree);

  return resolver.resolveSource(fsPaths, filter);
}
