/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { ComponentLike, MetadataComponent } from '../common/types';
import { RegistryAccess, SourceComponent } from '../metadata-registry';
import { MetadataSet } from './types';

/**
 * A collection that contains no duplicate MetadataComponents. Components are hashed
 * by their FullName and metadata type id.
 */
export class ComponentSet<T extends MetadataComponent> implements MetadataSet, Iterable<T> {
  private map = new Map<string, T>();

  constructor(components?: Iterable<T>) {
    if (components) {
      for (const component of components) {
        this.map.set(this.key(component), component);
      }
    }
  }

  public add(component: T): void {
    this.map.set(this.key(component), component);
  }

  public get(component: MetadataComponent): T | undefined {
    return this.map.get(this.key(component));
  }

  public has(component: ComponentLike): boolean {
    return this.map.has(this.key(component));
  }

  public values(): IterableIterator<T> {
    return this.map.values();
  }

  public *[Symbol.iterator](): Iterator<T> {
    for (const component of this.map.values()) {
      yield component;
    }
  }

  get size(): number {
    return this.map.size;
  }

  private key(component: ComponentLike): string {
    const typeName =
      typeof component.type === 'string' ? component.type.toLowerCase().trim() : component.type.id;
    return `${typeName}.${component.fullName}`;
  }
}

interface CSetOptions {
  components?: Iterable<ComponentLike>;
  registry?: RegistryAccess;
}

export class CSet implements MetadataSet, Iterable<MetadataComponent> {
  private registry: RegistryAccess;
  private _components = new Map<string, Map<string, SourceComponent>>();

  constructor(options: CSetOptions = { components: [], registry: new RegistryAccess() }) {
    this.registry = options.registry;
    for (const component of options.components) {
      this.add(component);
    }
  }

  public add(component: ComponentLike): void {
    const key = this.simpleKey(component);
    if (!this._components.has(key)) {
      this._components.set(key, new Map<string, SourceComponent>());
    }
    if (component instanceof SourceComponent) {
      this._components.get(key).set(this.sourceKey(component), component);
    }
  }

  public has(component: ComponentLike): boolean {
    return this._components.has(this.simpleKey(component));
  }

  public get(component: ComponentLike): CSet {
    return new CSet({
      components: this._components.get(this.simpleKey(component))?.values(),
      registry: this.registry,
    });
  }

  public *[Symbol.iterator](): Iterator<MetadataComponent> {
    for (const [key, sourceComponents] of this._components.entries()) {
      if (sourceComponents.size === 0) {
        const [typeName, fullName] = key.split('.');
        yield {
          fullName,
          type: this.registry.getTypeByName(typeName),
        };
      } else {
        sourceComponents.size;
        for (const component of sourceComponents.values()) {
          yield component;
        }
      }
    }
  }

  public getComponents(): CSet {
    const set = new CSet();
    for (const component of this) {
      if (!(component instanceof SourceComponent)) {
        set.add(component);
      }
    }
    return set;
  }

  public getSourceComponents(filter?: ComponentLike): CSet {
    const set = new CSet();
    for (const component of this) {
      if (component instanceof SourceComponent) {
        if (filter) {
          const filterType =
            typeof filter.type === 'string'
              ? this.registry.getTypeByName(filter.type)
              : filter.type;
          if (filter.fullName === component.fullName && filterType.id === component.type.id) {
            set.add(component);
          }
        } else {
          set.add(component);
        }
      }
    }
    return set;
  }

  get size(): number {
    let size = 0;
    for (const _ of this) {
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
    return `${typeName}.${component.fullName}`;
  }
}
