/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { parse as parseXml, j2xParser } from 'fast-xml-parser';
import {
  MetadataApiDeploy,
  MetadataApiDeployOptions,
  MetadataApiRetrieve,
  MetadataApiRetrieveOptions,
} from '../client';
import { MetadataComponent, XML_DECL, XML_NS_KEY, XML_NS_URL } from '../common';
import { ComponentSetError } from '../errors';
import {
  MetadataResolver,
  NodeFSTreeContainer,
  RegistryAccess,
  SourceComponent,
} from '../metadata-registry';
import {
  PackageTypeMembers,
  FromSourceOptions,
  FromManifestOptions,
  PackageManifestObject,
  ResolveOptions,
} from './types';
import { ComponentLike } from '../common/types';
import { LazyCollection } from './lazyCollection';

export type DeploySetOptions = Omit<MetadataApiDeployOptions, 'components'>;
export type RetrieveSetOptions = Omit<MetadataApiRetrieveOptions, 'components'>;

export class ComponentSet<T extends MetadataComponent = MetadataComponent> extends LazyCollection<
  T
> {
  public static readonly WILDCARD = '*';
  private static readonly KEY_DELIMITER = '#';
  public apiVersion: string;
  private registry: RegistryAccess;
  private components = new Map<string, Map<string, SourceComponent>>();
  private flush: Iterator<ComponentLike>;

  public constructor(components: Iterable<ComponentLike> = [], registry = new RegistryAccess()) {
    super();
    this.registry = registry;
    this.apiVersion = this.registry.apiVersion;
    this.flush = components[Symbol.iterator]();
  }

  /**
   * Create a set by resolving components from source.
   *
   * @param fsPath Path to resolve components from
   * @param options
   */
  public static fromSource(fsPath: string, options: FromSourceOptions = {}): ComponentSet {
    const ws = new ComponentSet(undefined, options.registry);
    ws.resolveSourceComponents(fsPath, options);
    return ws;
  }

  /**
   * Create a set by reading a manifest file in xml format. Optionally, specify a file path
   * with the `resolve` option to resolve source files for the components.
   *
   * ```
   * WorkingSet.fromManifestFile('/path/to/package.xml', {
   *  resolve: '/path/to/force-app'
   * });
   * ```
   *
   * @param fsPath Path to xml file
   * @param options
   */
  public static async fromManifestFile(
    fsPath: string,
    options: FromManifestOptions = {}
  ): Promise<ComponentSet> {
    const registry = options.registry ?? new RegistryAccess();
    const tree = options.tree ?? new NodeFSTreeContainer();
    const shouldResolve = !!options.resolve;

    const ws = new ComponentSet(undefined, registry);
    const filterSet = new ComponentSet(undefined, registry);
    const file = await tree.readFile(fsPath);
    const manifestObj: PackageManifestObject = parseXml(file.toString(), {
      stopNodes: ['version'],
    });

    ws.apiVersion = manifestObj.Package.version;

    for (const component of ComponentSet.getComponentsFromManifestObject(manifestObj, registry)) {
      if (shouldResolve) {
        filterSet.add(component);
      }
      const memberIsWildcard = component.fullName === ComponentSet.WILDCARD;
      if (!memberIsWildcard || options?.literalWildcard || !shouldResolve) {
        ws.add(component);
      }
    }

    if (shouldResolve) {
      // if it's a string, don't iterate over the characters
      const toResolve = typeof options.resolve === 'string' ? [options.resolve] : options.resolve;
      for (const fsPath of toResolve) {
        ws.resolveSourceComponents(fsPath, {
          tree,
          filter: filterSet,
        });
      }
    }

    return ws;
  }

  private static *getComponentsFromManifestObject(
    obj: PackageManifestObject,
    registry: RegistryAccess
  ): IterableIterator<MetadataComponent> {
    const { types } = obj.Package;
    const typeMembers = Array.isArray(types) ? types : [types];
    for (const { name: typeName, members } of typeMembers) {
      const fullNames = Array.isArray(members) ? members : [members];
      for (const fullName of fullNames) {
        let type = registry.getTypeByName(typeName);
        // if there is no / delimiter and it's a type in folders, infer folder component
        if (type.folderType && !fullName.includes('/')) {
          type = registry.getTypeByName(type.folderType);
        }
        yield {
          fullName,
          type,
        };
      }
    }
  }

  /**
   * Constructs a deploy operation using the components in the set. There must be at least
   * one source-backed component in the set to create an operation.
   *
   * @param options
   */
  public deploy(options: DeploySetOptions): MetadataApiDeploy {
    const toDeploy = Array.from(this.getSourceComponents());

    if (toDeploy.length === 0) {
      throw new ComponentSetError('error_no_source_to_deploy');
    }

    const operationOptions = Object.assign({}, options, {
      components: this,
      registry: this.registry,
      apiVersion: this.apiVersion,
    });

    return new MetadataApiDeploy(operationOptions);
  }

  /**
   * Constructs a retrieve operation using the components in the set.
   *
   * @param options
   */
  public retrieve(options: RetrieveSetOptions): MetadataApiRetrieve {
    const operationOptions = Object.assign({}, options, {
      components: this,
      registry: this.registry,
      apiVersion: this.apiVersion,
    });

    return new MetadataApiRetrieve(operationOptions);
  }

  /**
   * Get an object representation of a package manifest based on the set components.
   */
  public getObject(): PackageManifestObject {
    this.flushNoYield();

    const typeMap = new Map<string, string[]>();

    for (const component of this) {
      const type = component.type.folderContentType
        ? this.registry.getTypeByName(component.type.folderContentType)
        : component.type;

      if (!typeMap.has(type.name)) {
        typeMap.set(type.name, []);
      }

      typeMap.get(type.name).push(component.fullName);
    }

    const typeMembers: PackageTypeMembers[] = [];
    for (const [typeName, members] of typeMap.entries()) {
      typeMembers.push({ members, name: typeName });
    }

    return {
      Package: {
        types: typeMembers,
        version: this.apiVersion,
      },
    };
  }

  /**
   * Resolve source backed components and add them to the set.
   *
   * @param fsPath: File path to resolve
   * @param options
   */
  public resolveSourceComponents(fsPath: string, options: ResolveOptions = {}): ComponentSet {
    let filterSet: ComponentSet;

    if (options?.filter) {
      const { filter } = options;
      filterSet = filter instanceof ComponentSet ? filter : new ComponentSet(filter, this.registry);
    }

    const resolver = new MetadataResolver(this.registry, options?.tree);
    const resolved = resolver.resolveSource(fsPath, filterSet);
    const sourceComponents = new ComponentSet();

    for (const component of resolved) {
      this.add(component);
      sourceComponents.add(component);
    }

    return sourceComponents;
  }

  /**
   * Create a manifest in xml format (package.xml) based on the set components.
   *
   * @param indentation Number of spaces to indent lines by.
   */
  public getPackageXml(indentation = 4): string {
    const j2x = new j2xParser({
      format: true,
      indentBy: new Array(indentation + 1).join(' '),
      ignoreAttributes: false,
    });
    const toParse = this.getObject() as any;
    toParse.Package[XML_NS_KEY] = XML_NS_URL;
    return XML_DECL.concat(j2x.parse(toParse));
  }

  public getSourceComponents(member?: ComponentLike): LazyCollection<SourceComponent> {
    let iter: Iterable<MetadataComponent>;

    this.flushNoYield();

    if (member) {
      // filter optimization
      const memberCollection = this.components.get(this.simpleKey(member));
      iter = memberCollection?.size > 0 ? memberCollection.values() : [];
    } else {
      iter = this;
    }

    return new LazyCollection(iter).filter((c) => c instanceof SourceComponent) as LazyCollection<
      SourceComponent
    >;
  }

  public add(component: ComponentLike): boolean {
    let added = false;
    const key = this.simpleKey(component);
    if (!this.components.has(key)) {
      this.components.set(key, new Map<string, SourceComponent>());
      added = true;
    }
    if (component instanceof SourceComponent) {
      const sourceKey = this.sourceKey(component);
      added = !this.components.get(key).has(sourceKey);
      this.components.get(key).set(sourceKey, component);
    }
    return added;
  }

  public has(component: ComponentLike): boolean {
    this.flushNoYield();

    const isDirectlyInSet = this.components.has(this.simpleKey(component));
    if (isDirectlyInSet) {
      return true;
    }

    const wildcardMember: ComponentLike = {
      fullName: ComponentSet.WILDCARD,
      type: typeof component.type === 'object' ? component.type.name : component.type,
    };
    const isIncludedInWildcard = this.components.has(this.simpleKey(wildcardMember));
    if (isIncludedInWildcard) {
      return true;
    }

    if (typeof component.type === 'object') {
      const { parent } = component as MetadataComponent;
      if (parent) {
        const parentDirectlyInSet = this.components.has(this.simpleKey(parent));
        if (parentDirectlyInSet) {
          return true;
        }

        const wildcardKey = this.simpleKey({
          fullName: ComponentSet.WILDCARD,
          type: parent.type,
        });
        const parentInWildcard = this.components.has(wildcardKey);
        if (parentInWildcard) {
          return true;
        }
      }
    }

    return false;
  }

  public *[Symbol.iterator](): Iterator<T> {
    for (const [key, sourceComponents] of this.components.entries()) {
      if (sourceComponents.size === 0) {
        const [type, fullName] = key.split(ComponentSet.KEY_DELIMITER);
        yield this.normalize({ fullName, type });
      } else {
        for (const component of sourceComponents.values()) {
          yield this.normalize(component);
        }
      }
    }

    yield* this.flushComponents();
  }

  get size(): number {
    let size = 0;

    for (const component of this) {
      size += 1;
    }

    return size;
  }

  private sourceKey(component: SourceComponent): string {
    const { fullName, type, xml, content } = component;
    return `${type.name}${fullName}${xml ?? ''}${content ?? ''}`;
  }

  private simpleKey(component: ComponentLike): string {
    const typeName =
      typeof component.type === 'string' ? component.type.toLowerCase().trim() : component.type.id;
    return `${typeName}${ComponentSet.KEY_DELIMITER}${component.fullName}`;
  }

  private flushNoYield(): void {
    [...this.flushComponents()];
  }

  private *flushComponents(): IterableIterator<T> {
    let next = this.flush.next();
    while (!next.done && next.value) {
      if (this.add(next.value)) {
        yield this.normalize(next.value);
      }
      next = this.flush.next();
    }
  }

  private normalize(component: ComponentLike): T {
    return typeof component.type === 'object'
      ? (component as T)
      : ({
          fullName: component.fullName,
          type: this.registry.getTypeByName(component.type),
        } as T);
  }
}
