import { SourcePath, MetadataType } from '../types';
import { lstatSync, readdirSync, existsSync } from 'fs';
import { join, dirname, sep, basename } from 'path';
import { parseMetadataXml } from '../utils/registry';
import { baseName } from '../utils';
// @ts-ignore
import * as fetch from 'node-fetch';
import { spawnSync } from 'child_process';

export interface FileContainer {
  isDirectory(path: SourcePath): boolean;
  exists(path: SourcePath): boolean;
  findContent(dir: SourcePath, fullName: string): SourcePath | undefined;
  findMetadataXml(dir: SourcePath, fullName: string): SourcePath | undefined;
  findXmlFromContentPath(contentPath: SourcePath, type: MetadataType): SourcePath | undefined;
  readDir(path: SourcePath): string[];
  walk(dir: SourcePath, ignore?: Set<SourcePath>): SourcePath[];
}

abstract class BaseFileContainer implements FileContainer {
  public walk(dir: SourcePath, ignore?: Set<SourcePath>): SourcePath[] {
    const paths: SourcePath[] = [];
    for (const file of this.readDir(dir)) {
      const p = join(dir, file);
      if (this.isDirectory(p)) {
        paths.push(...this.walk(p, ignore));
      } else if (!ignore || !ignore.has(p)) {
        paths.push(p);
      }
    }
    return paths;
  }

  public findContent(dir: SourcePath, fullName: string): SourcePath | undefined {
    return this.find(dir, fullName, false);
  }

  public findMetadataXml(dir: SourcePath, fullName: string): SourcePath | undefined {
    return this.find(dir, fullName, true);
  }

  public findXmlFromContentPath(contentPath: SourcePath, type: MetadataType): SourcePath {
    const pathParts = contentPath.split(sep);
    const typeFolderIndex = pathParts.findIndex(part => part === type.directoryName);
    const offset = type.inFolder ? 3 : 2;
    const rootContentPath = pathParts.slice(0, typeFolderIndex + offset).join(sep);
    const rootTypeDirectory = dirname(rootContentPath);
    const contentFullName = baseName(rootContentPath);
    return this.findMetadataXml(rootTypeDirectory, contentFullName);
  }

  public abstract isDirectory(path: SourcePath): boolean;
  public abstract exists(path: SourcePath): boolean;
  public abstract readDir(path: SourcePath): string[];

  private find(
    dir: SourcePath,
    fullName: string,
    findMetadataXml: boolean
  ): SourcePath | undefined {
    const fileName = this.readDir(dir).find(f => {
      const parsed = parseMetadataXml(join(dir, f));
      const metaXmlCondition = findMetadataXml ? !!parsed : !parsed;
      return f.startsWith(fullName) && metaXmlCondition;
    });
    if (fileName) {
      return join(dir, fileName);
    }
  }
}

export class LocalFileContainer extends BaseFileContainer {
  public isDirectory(path: SourcePath): boolean {
    return lstatSync(path).isDirectory();
  }

  public exists(path: SourcePath): boolean {
    return existsSync(path);
  }

  public readDir(path: SourcePath): string[] {
    return readdirSync(path);
  }
}

type GitTreeOptions = {
  github: { repoOwner: string; repoName: string; treeRef: string };
  local: { treeRef: string };
};

type GitObject = {
  path: SourcePath;
  mode: string;
  type: 'tree' | 'blob';
  sha: string;
};

export class GitFileContainer extends BaseFileContainer {
  private tree = new Map<SourcePath, Set<SourcePath>>();

  public async initialize<T extends keyof GitTreeOptions>(
    treeSource: T,
    options: GitTreeOptions[T]
  ): Promise<void> {
    this.tree.clear();

    switch (treeSource) {
      case 'github':
        await this.fetchGithubTree(options as GitTreeOptions['github']);
        break;
      case 'local':
        this.fetchLocalTree(options);
        break;
    }
  }

  public isDirectory(path: string): boolean {
    const normalized = this.normalizePath(path);
    if (this.exists(normalized)) {
      return this.tree.has(normalized);
    }
    throw new Error(normalized + ' does not exist');
  }

  public exists(path: string): boolean {
    const normalized = this.normalizePath(path);
    return this.tree.get(dirname(normalized)).has(normalized) || this.tree.has(normalized);
  }

  public readDir(path: string): string[] {
    const normalized = this.normalizePath(path);
    return Array.from(this.tree.get(normalized)).map(p => basename(p));
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private async fetchGithubTree(options: GitTreeOptions['github']): Promise<void> {
    const { repoName, repoOwner, treeRef } = options;
    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${treeRef}?recursive=true`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` }
      }
    );
    const objects: GitObject[] = (await response.json()).tree;
    objects.forEach(object => {
      if (object.type === 'blob') {
        this.addObject(object);
      }
    });
  }

  private fetchLocalTree(options: GitTreeOptions['local'], path = ''): void {
    const lsResult = spawnSync('git', ['ls-tree', '-r', options.treeRef]).stdout.toString();
    for (const line of lsResult.split('\n')) {
      const matches = line.match(/(\d{6})\s(tree|blob)\s([a-z0-9]*)\t(.*)/);
      if (matches) {
        const object: GitObject = {
          mode: matches[1],
          type: matches[2] as 'blob',
          sha: matches[3],
          path: path === '' ? matches[4] : `${path}/${matches[4]}`
        };
        this.addObject(object);
        if (object.type === 'tree') {
          this.fetchLocalTree({ treeRef: object.sha }, object.path);
        }
      }
    }
  }

  private addObject(object: GitObject): void {
    const ensureTreeExists = (path: SourcePath): void => {
      if (!this.tree.has(path)) {
        this.tree.set(path, new Set<SourcePath>());
        const parent = dirname(path);
        ensureTreeExists(parent);
        this.tree.get(parent).add(path);
      }
    };
    const parent = dirname(object.path);
    ensureTreeExists(parent);
    this.tree.get(parent).add(object.path);
  }
}
