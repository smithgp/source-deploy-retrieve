/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { join, basename } from 'path';
import { parse } from 'fast-xml-parser';
import { ForceIgnore } from './forceIgnore';
import { NodeFSTreeContainer, TreeContainer, VirtualTreeContainer } from './treeContainers';
import { SourceBackedComponent, VirtualDirectory } from './types';
import { baseName, parseMetadataXml } from '../utils';
import { DEFAULT_PACKAGE_ROOT_SFDX } from '../common';
import { JsonMap } from '@salesforce/ts-types';
import { SfdxFileFormat } from '../convert';
import { trimUntil } from '../utils/path';
import { MetadataType } from '../registry';

export type ConstructorProps = Omit<SourceBackedComponent, 'fullName' | 'tree'>;

/**
 * A {@link SourceBackedComponent} with additional functionality to operate on a component's source files.
 */
export class SourceComponent implements SourceBackedComponent {
  public readonly name: string;
  public readonly type: MetadataType;
  public readonly xml?: string;
  public readonly parent?: SourceComponent;
  public content?: string;
  private _tree: TreeContainer;
  private forceIgnore: ForceIgnore;

  constructor(
    props: ConstructorProps,
    tree: TreeContainer = new NodeFSTreeContainer(),
    forceIgnore = new ForceIgnore()
  ) {
    this.name = props.name;
    this.type = props.type;
    this.xml = props.xml;
    this.parent = props.parent;
    this.content = props.content;
    this._tree = tree;
    this.forceIgnore = forceIgnore;
  }

  /**
   * A helper method to instantiate a `SourceComponent` against a fake (virtual)
   * file system. Useful for mocking components.
   * @see VirtualTreeContainer
   *
   * @param props SourceComponent properties
   * @param fs - Structure of the virtual file system
   * @param forceIgnore - ForceIgnore to exclude files when traversing source
   * @returns A `SourceComponent` represented in a virtual file system
   */
  public static createVirtualComponent(
    props: ConstructorProps,
    fs: VirtualDirectory[],
    forceIgnore?: ForceIgnore
  ): SourceComponent {
    const tree = new VirtualTreeContainer(fs);
    return new SourceComponent(props, tree, forceIgnore);
  }

  /**
   * Traverse the content files of the component.
   *
   * If `content` is a file path, `content` is returned as the only file path.
   * If `content` is a directory, all of the files under the directory will be
   * returned. If the component's `xml` file is contained in the `content` directory,
   * it will be skipped.
   *
   * @returns An array of file paths, or an empty array if there is no content
   */
  public walkContent(): string[] {
    const sources: string[] = [];
    if (this.content) {
      for (const fsPath of this.walk(this.content)) {
        if (fsPath !== this.xml) {
          sources.push(fsPath);
        }
      }
    }
    return sources;
  }

  /**
   * Traverses the component's `content` directory for child components.
   *
   * @returns An array of child SourceComponents
   */
  public getChildren(): SourceComponent[] {
    return this.content && !this.parent && this.type.children
      ? this.getChildrenInternal(this.content)
      : [];
  }

  /**
   * Parses the XML file located at `xml` into an object.
   *
   * @returns An object containing the XML contents. Returns an empty object if no `xml` is set
   */
  public async parseXml(): Promise<JsonMap> {
    if (this.xml) {
      const contents = await this.tree.readFile(this.xml);
      return parse(contents.toString(), { ignoreAttributes: false });
    }
    return {};
  }

  /**
   * Converts a file path into a relative version that would be present in a metadata package.
   *
   * ```typescript
   * apexClass.content // => /path/to/MyClass.cls
   * apexClass.getPackageRelativePath(apexClass.content, 'metadata'); // => classes/MyClass.cls
   * ```
   *
   * @param fsPath - Path to create a relative package path for
   * @param format - File format of the package
   * @returns A relative metadata package version of the file path
   */
  public getPackageRelativePath(fsPath: string, format: SfdxFileFormat): string {
    const { directoryName, suffix, inFolder, folderType } = this.type;
    // if there isn't a suffix, assume this is a mixed content component that must
    // reside in the directoryName of its type. trimUntil maintains the folder structure
    // the file resides in for the new destination.
    let relativePath: string;
    if (!suffix) {
      relativePath = trimUntil(fsPath, directoryName);
    } else if (folderType || inFolder) {
      const folderName = this.fullName.split('/')[0];
      relativePath = join(directoryName, folderName, basename(fsPath));
    } else {
      relativePath = join(directoryName, basename(fsPath));
    }

    if (format === 'source') {
      return join(DEFAULT_PACKAGE_ROOT_SFDX, relativePath);
    }
    return relativePath;
  }

  private getChildrenInternal(dirPath: string): SourceComponent[] {
    const children: SourceComponent[] = [];
    for (const fsPath of this.walk(dirPath)) {
      const childXml = parseMetadataXml(fsPath);
      const fileIsRootXml = childXml?.suffix === this.type.suffix;
      if (childXml && !fileIsRootXml) {
        // TODO: Log warning if missing child type definition
        const childTypeId = this.type.children.suffixes[childXml.suffix];
        const childComponent = new SourceComponent(
          {
            name: baseName(fsPath),
            type: this.type.children.types[childTypeId],
            xml: fsPath,
            parent: this,
          },
          this._tree,
          this.forceIgnore
        );
        children.push(childComponent);
      }
    }
    return children;
  }

  private *walk(fsPath: string): IterableIterator<string> {
    if (!this._tree.isDirectory(fsPath)) {
      yield fsPath;
    } else {
      for (const child of this._tree.readDirectory(fsPath)) {
        const childPath = join(fsPath, child);
        if (this.forceIgnore.denies(childPath)) {
          continue;
        } else if (this._tree.isDirectory(childPath)) {
          yield* this.walk(childPath);
        } else {
          yield childPath;
        }
      }
    }
  }

  get fullName(): string {
    return `${this.parent ? `${this.parent.fullName}.` : ''}${this.name}`;
  }

  get tree(): TreeContainer {
    return this._tree;
  }
}
