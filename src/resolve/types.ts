/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SourcePath } from '../common/types';
import { SourceComponent } from '.';
import { MetadataType } from '../registry';
import { TreeContainer } from './treeContainers';

/**
 * Base metadata interface extended by anything that represents a component.
 */
interface Metadata {
  fullName: string;
}

/**
 * Represents a component using a registry-backed metadata type.
 */
export interface MetadataComponent extends Metadata {
  type: MetadataType;
  /**
   * Reference to the parent component if this component is a child.
   */
  parent?: MetadataComponent;
}

/**
 * Represents a component that has related source files in a file system.
 */
export interface SourceBackedComponent extends MetadataComponent {
  /**
   * The name of the component. Differs from `fullName` by not including any references
   * to a component's parent or namespace.
   *
   * e.g. For a CustomField:
   *```
   * component.fullName === 'My_NS__My_Object__c.My_Field__c'
   * component.name === 'My_Field__c'
   * ```
   */
  name: string;
  /**
   * Path to the component's metadata xml file, if it has one.
   */
  xml?: string;
  /**
   * Path to a component's related files.
   *
   * If the component has an associated binary file, this path will point to it. If it has
   * many files, it will point to the directory where the files are contained.
   */
  content?: string;
  parent?: SourceComponent;
  /**
   * The file tree container the source files exist in.
   */
  tree: TreeContainer;
}

/**
 * Represents a component using the name of a metadata type.
 */
export interface MetadataMember extends Metadata {
  type: string;
}

export type ComponentLike = MetadataComponent | MetadataMember;

/**
 * A parsed path of a component's metadata xml file.
 */
export interface MetadataXml extends Metadata {
  suffix: string;
  path: string;
}

/**
 * Represents a file in a {@link VirtualTreeContainer}.
 */
export interface VirtualFile {
  name: string;
  data?: Buffer;
}

/**
 * Represents a directory in a {@link VirtualTreeContainer}.
 */
export interface VirtualDirectory {
  dirPath: string;
  children: (VirtualFile | string)[];
}

/**
 * Infers the source format structure of a metadata component when given a file path.
 */
export interface SourceAdapter {
  /**
   * Create a metadata component object from a file path.
   *
   * @param fsPath Path to resolve
   * @param isResolvingSource Whether the path to resolve is a single file
   */
  getComponent(fsPath: SourcePath, isResolvingSource?: boolean): SourceComponent;

  /**
   * Whether the adapter allows content-only metadata definitions.
   */
  allowMetadataWithContent(): boolean;
}
