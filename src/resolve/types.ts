/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SourcePath } from '../common/types';
import { SourceComponent } from '.';
import { MetadataType } from '../registry';

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
  parent?: MetadataComponent;
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
