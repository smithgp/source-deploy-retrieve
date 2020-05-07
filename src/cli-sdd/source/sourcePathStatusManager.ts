/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'fs';
import { fs as fscore } from '@salesforce/core';
import * as path from 'path';

import * as _sourceState from './sourceState';
import MetadataRegistry = require('./metadataRegistry');
import { ForceIgnore } from './forceIgnore';
import srcDevUtil = require('../core/srcDevUtil');
import Messages = require('../messages');
const messages = Messages();

import * as _ from 'lodash';
import { Logger } from '@salesforce/core';
import { AsyncCreatable } from '@salesforce/kit';
import { PackageInfoCache } from './packageInfoCache';

const Package2ConfigFileNames = ['package2-descriptor.json', 'package2-manifest.json'];

interface SourcePathStatusManagerOptions {
  org: any;
  isStateless?: boolean;
}

interface Filter {
  changesOnly?: boolean;
  packageDirectory?: string;
  sourcePath?: string;
}

type WorkspacePath = string;
type PathInfos = Map<WorkspacePath, SourcePathInfo>;
type ArtifactPath = string;

interface InitializedValues {
  pathInfos: PathInfos;
  artifactRootPaths: ArtifactPath[];
}

interface WorkspaceOptions {
  org: any;
  metadataRegistry: MetadataRegistry;
  forceIgnore: ForceIgnore;
  isStateless: boolean;
}

interface SourcePathInfoOptions {
  deferContentHash?: boolean;
  sourcePath?: string;
  isDirectory?: boolean;
  size?: number;
  modifiedTime?: string;
  changeTime?: string;
  contentHash?: string;
  isMetadataFile?: boolean;
  state?: string;
  isWorkspace?: boolean;
  isArtifactRoot?: boolean;
  package?: string;
}

export class SourcePathInfo extends AsyncCreatable {
  public sourcePath: string;
  public isDirectory: boolean;
  public size: number;
  public modifiedTime: string;
  public changeTime: string;
  public contentHash: string;
  public isMetadataFile: boolean;
  public state: string;
  public isWorkspace: boolean;
  public isArtifactRoot: boolean;
  public package: string;
  public packageInfoCache: PackageInfoCache;
  public deferContentHash?: boolean;

  constructor(options: SourcePathInfoOptions) {
    super(options);
    Object.assign(this, options);
  }

  protected async init(): Promise<void> {
    if (!this.modifiedTime || !this.state) {
      await this.initFromPath(this.sourcePath, this.deferContentHash);
    }
  }

  /**
   * Initialize path info based on an object (used during deserialization)
   */
  public initFromObject(obj: SourcePathInfo) {
    this.sourcePath = obj.sourcePath;
    this.isDirectory = obj.isDirectory;
    this.size = obj.size;
    this.modifiedTime = obj.modifiedTime;
    this.changeTime = obj.changeTime;
    this.contentHash = obj.contentHash;
    this.isMetadataFile = obj.isMetadataFile;
    this.state = obj.state;
    this.isWorkspace = obj.isWorkspace;
    this.isArtifactRoot = obj.isArtifactRoot;
    this.package = obj.package;
  }

  /**
   * Initialize path info based on a path in the workspace
   */
  public async initFromPath(sourcePath: string, deferContentHash?: boolean) {
    const packageInfoCache = PackageInfoCache.getInstance();

    // If we are initializing from path then the path is new
    this.state = _sourceState.NEW;
    this.sourcePath = sourcePath;
    this.package = packageInfoCache.getPackageNameFromSourcePath(sourcePath);
    let filestat;
    try {
      filestat = await fscore.stat(sourcePath);
    } catch (e) {
      // If there is an error with filestat then the path is deleted
      this.state = _sourceState.DELETED;
      return;
    }
    this.isDirectory = filestat.isDirectory();
    this.isMetadataFile = !this.isDirectory && this.sourcePath.endsWith(MetadataRegistry.getMetadataFileExt());

    this.size = filestat.size;
    this.modifiedTime = filestat.mtime.getTime();
    this.changeTime = filestat.ctime.getTime();
    if (!deferContentHash) {
      this.computeContentHash();
    }
  }

  public computeContentHash() {
    const contents = this.isDirectory ? fs.readdirSync(this.sourcePath).toString() : fs.readFileSync(this.sourcePath);
    this.contentHash = srcDevUtil.getContentHash(contents);
  }

  /**
   * If the source has been modified, return the path info for the change
   */
  public async getPendingPathInfo() {
    const pendingPathInfo = await SourcePathInfo.create({
      sourcePath: this.sourcePath,
      deferContentHash: true
    });
    // Defer computing content hash until we know we need to check it
    pendingPathInfo.isWorkspace = this.isWorkspace;
    // See if the referenced path has been deleted
    if (pendingPathInfo.isDeleted()) {
      // Force setting isDirectory and isMetadataFile for deleted paths
      pendingPathInfo.isDirectory = this.isDirectory;
      pendingPathInfo.isMetadataFile = this.isMetadataFile;
      return pendingPathInfo;
    }
    // Unless deleted, new paths always return true. no need for further checks
    if (this.state === _sourceState.NEW) {
      return this;
    }
    // Next we'll check if the path infos are different
    if (
      pendingPathInfo.isDirectory || // Always need to compare the hash on directories
      pendingPathInfo.size !== this.size ||
      pendingPathInfo.modifiedTime !== this.modifiedTime ||
      pendingPathInfo.changeTime !== this.changeTime
    ) {
      // Now we will compare the content hashes
      pendingPathInfo.computeContentHash();
      if (pendingPathInfo.contentHash !== this.contentHash) {
        pendingPathInfo.state = _sourceState.CHANGED;
        return pendingPathInfo;
      } else {
        // The hashes are the same, so the file hasn't really changed. Update our info.
        //   These will automatically get saved when other pending changes are committed
        this.size = pendingPathInfo.size;
        this.modifiedTime = pendingPathInfo.modifiedTime;
        this.changeTime = pendingPathInfo.changeTime;
      }
    }
    return null;
  }

  public isDeleted() {
    return this.state === _sourceState.DELETED;
  }

  public getState() {
    return _sourceState.toString(this.state);
  }
}

class Workspace extends AsyncCreatable<WorkspaceOptions> {
  private org: any;
  private metadataRegistry: MetadataRegistry;
  private forceIgnore: ForceIgnore;
  private isStateless: boolean;
  private logger!: Logger;
  public pathInfos: PathInfos;
  public artifactRootPaths: ArtifactPath[];
  public workspacePath: ArtifactPath;

  constructor(options: WorkspaceOptions) {
    super(options);
    this.org = options.org;
    this.metadataRegistry = options.metadataRegistry;
    this.forceIgnore = options.forceIgnore;
    this.isStateless = options.isStateless;
    this.workspacePath = options.org.config.getProjectPath();
  }

  protected async init(): Promise<void> {
    this.logger = await Logger.child(this.constructor.name);
    if (!this.isStateless) {
      const { pathInfos, artifactRootPaths } = await this.initializeCached();
      this.pathInfos = pathInfos;
      this.artifactRootPaths = artifactRootPaths;

      if (_.isNil(this.pathInfos)) {
        // If not found, initialize from workspace
        const { pathInfos, artifactRootPaths } = await this.initializeStateFull();
        this.pathInfos = pathInfos;
        this.artifactRootPaths = artifactRootPaths;
      }
    } else {
      const { pathInfos, artifactRootPaths } = this.initializeStateless();
      this.pathInfos = pathInfos;
      this.artifactRootPaths = artifactRootPaths;
    }
  }

  public async initializeCached(): Promise<InitializedValues> {
    this.logger.debug('Reading workspace from cache');
    let sourcePathInfos: PathInfos;
    let workspacePathChanged: boolean;
    const artifactRootPaths = [];
    try {
      const oldSourcePathInfos = new Map(this.org.getSourcePathInfos().read()) as PathInfos;
      const packageInfoCache = PackageInfoCache.getInstance();
      let oldWorkspacePath: string;
      for (const sourcePathInfoObj of oldSourcePathInfos.values()) {
        if (!sourcePathInfoObj.package) {
          sourcePathInfoObj.package = packageInfoCache.getPackageNameFromSourcePath(sourcePathInfoObj.sourcePath);
        }
        if (sourcePathInfoObj.isWorkspace) {
          oldWorkspacePath = sourcePathInfoObj.sourcePath;
        }
        if (sourcePathInfoObj.isArtifactRoot) {
          artifactRootPaths.push(sourcePathInfoObj.sourcePath);
        }
      }

      workspacePathChanged = !_.isNil(oldWorkspacePath) && this.workspacePath !== oldWorkspacePath;

      // Wrap parsed objects in SourcePathInfos
      sourcePathInfos = new Map() as PathInfos;
      const promises = Array.from(oldSourcePathInfos.values()).map(async sourcePathInfoObj => {
        const sourcePathInfo = await SourcePathInfo.create(sourcePathInfoObj);
        if (workspacePathChanged) {
          sourcePathInfo.sourcePath = path.join(
            this.workspacePath,
            path.relative(oldWorkspacePath, sourcePathInfo.sourcePath)
          );
        }
        sourcePathInfos.set(sourcePathInfo.sourcePath, sourcePathInfo);
      });

      await Promise.all(promises);
    } catch (e) {
      // Do nothing if the file can't be read, which will cause the workspace to be initialized
    }

    if (workspacePathChanged) {
      await this.writeSourcePathInfos(this.workspacePath, sourcePathInfos);
    }

    return { pathInfos: sourcePathInfos, artifactRootPaths };
  }

  public async initializeStateFull(): Promise<InitializedValues> {
    this.logger.debug('Initializing statefull workspace');
    const workspacePathInfos = new Map() as PathInfos;
    this.pathInfos = workspacePathInfos;
    const artifactRootPaths = this.org.config.getAppConfig().packageDirectoryPaths as string[];
    await this.addRoots(artifactRootPaths);
    await this.writeSourcePathInfos(this.workspacePath);
    return { pathInfos: workspacePathInfos, artifactRootPaths };
  }

  public initializeStateless(): InitializedValues {
    this.logger.debug('Initializing stateless workspace');
    return {
      pathInfos: new Map(),
      artifactRootPaths: this.org.config.getAppConfig().packageDirectoryPaths || []
    };
  }

  /**
   * Write the data model out to the workspace
   */
  public async writeSourcePathInfos(
    workspacePath: WorkspacePath,
    sourcePathInfos?: PathInfos
  ): Promise<SourcePathInfo[]> {
    const pathInfos = sourcePathInfos || this.pathInfos;
    // The workspace home directory should always be included in the workspacePathInfos
    if (_.isNil(pathInfos.get(workspacePath))) {
      const workspaceSourcePathInfo = await this.createSourcePathInfoFromPath(workspacePath, true, false);
      pathInfos.set(workspacePath, workspaceSourcePathInfo);
    }
    return this.org.getSourcePathInfos().write([...pathInfos]);
  }

  /**
   * Adds the SourcePathInfos of a new artifact to the data model
   */
  public async addNewRoot(artifactPath: ArtifactPath): Promise<void> {
    const isWorkspace = false;
    const isArtifactRoot = true;
    await this.updateRecursively(artifactPath, isWorkspace, isArtifactRoot);
  }

  public async addRoots(artifactRootPaths: ArtifactPath[]): Promise<void> {
    const promises = artifactRootPaths.map(async artifactPath => {
      if (!srcDevUtil.pathExistsSync(artifactPath)) {
        const error = new Error(messages.getMessage('InvalidPackageDirectory', artifactPath));
        error['name'] = 'InvalidProjectWorkspace';
        throw error;
      }
      await this.addNewRoot(artifactPath);
    });
    await Promise.all(promises);
  }

  /**
   * Update the data model for a given path
   */
  public async updateRecursively(
    artifactPath: ArtifactPath,
    isWorkspace: boolean,
    isArtifactRoot: boolean
  ): Promise<void> {
    const sourcePathInfo = await this.createSourcePathInfoFromPath(artifactPath, isWorkspace, isArtifactRoot);
    this.setPathInfo(artifactPath, sourcePathInfo);

    if (sourcePathInfo.isDirectory) {
      const dirfiles = fs.readdirSync(artifactPath);
      const promises = dirfiles
        .map(file => path.join(artifactPath, file))
        .map(async file => await this.createSourcePathInfoFromPath(file, isWorkspace, isArtifactRoot));

      const res = await Promise.all(promises);
      const filtered = res.filter(f => this.isValidSourcePath(f));
      const morePromises = filtered.map(async file => await this.updateRecursively(file.sourcePath, false, false));
      await Promise.all(morePromises);
    }
  }

  public setPathInfo(sourcePath: string, sourcePathInfo: SourcePathInfo): void {
    this.pathInfos.set(sourcePath, sourcePathInfo);
  }

  public getPathInfo(sourcePath: string): SourcePathInfo {
    return this.pathInfos.get(sourcePath);
  }

  public deletePathInfo(sourcePath: string): void {
    this.pathInfos.delete(sourcePath);
  }

  public hasPathInfo(sourcePath: string): boolean {
    return this.pathInfos.has(sourcePath);
  }

  public getPathInfos() {
    return Array.from(this.pathInfos.values());
  }

  /**
   * Check if the given sourcePath should be ignored
   */
  public isValidSourcePath(sourcePathInfo: SourcePathInfo): boolean {
    const sourcePath = sourcePathInfo.sourcePath;

    let isValid = this.forceIgnore.accepts(sourcePath);

    const basename = path.basename(sourcePath);

    const isPackage2ConfigFile = Package2ConfigFileNames.includes(basename);

    isValid = !basename.startsWith('.') && !basename.endsWith('.dup') && isValid && !isPackage2ConfigFile;

    if (isValid && !_.isNil(this.metadataRegistry)) {
      if (!sourcePathInfo.isDirectory) {
        if (!this.metadataRegistry.isValidSourceFilePath(sourcePath)) {
          const error = new Error(`Unexpected file found in package directory: ${sourcePath}`);
          error['name'] = 'UnexpectedFileFound';
          throw error;
        }
      }
    }

    // Skip directories/files beginning with '.', end with .dup, and that should be ignored
    return isValid;
  }

  /**
   * Create a new SourcePathInfo from the given sourcePath
   */
  private async createSourcePathInfoFromPath(
    sourcePath: ArtifactPath,
    isWorkspace: boolean,
    isArtifactRoot: boolean
  ): Promise<SourcePathInfo> {
    const sourcePathInfo = await SourcePathInfo.create({
      sourcePath,
      deferContentHash: false
    });
    sourcePathInfo.isWorkspace = isWorkspace;
    sourcePathInfo.isArtifactRoot = isArtifactRoot;
    return sourcePathInfo;
  }
}

/**
 * Manages a data model for tracking changes to local workspace paths
 */
export class SourcePathStatusManager extends AsyncCreatable<SourcePathStatusManagerOptions> {
  public logger!: Logger;
  public org: any;
  public isStateless: boolean = false;
  public workspacePath: WorkspacePath;
  public metadataRegistry: MetadataRegistry;
  public forceIgnore: ForceIgnore;
  public workspace: Workspace;

  constructor(options: SourcePathStatusManagerOptions) {
    super(options);
    this.org = options.org;
    this.isStateless = options.isStateless || false;
    this.workspacePath = options.org.config.getProjectPath();
    this.metadataRegistry = new MetadataRegistry(this.org);
    this.forceIgnore = new ForceIgnore();
  }

  protected async init(): Promise<void> {
    this.logger = await Logger.child(this.constructor.name);
    const workspaceOpts = {
      org: this.org,
      metadataRegistry: this.metadataRegistry,
      forceIgnore: this.forceIgnore,
      isStateless: this.isStateless
    };
    this.workspace = await Workspace.create(workspaceOpts);
  }

  /**
   * Get path infos for the source workspace, applying any filters specified.
   */
  public async getSourcePathInfos(filter: Filter = {}): Promise<any[]> {
    const { packageDirectory, changesOnly, sourcePath } = filter;
    const oldArtifactPaths = this.workspace.artifactRootPaths.map(p => normalizeDirectoryPath(p));
    const currentArtifactPaths = this.org.config
      .getAppConfig()
      .packageDirectoryPaths.map(p => normalizeDirectoryPath(p)) as ArtifactPath[];
    const untrackedArtifactPaths = currentArtifactPaths.filter(rootDir => !oldArtifactPaths.includes(rootDir));

    // normalize packageDirectory (if defined) to end with a path separator
    const packageDirPath = normalizeDirectoryPath(packageDirectory);

    // if a root directory is specified, make sure it is a project source directory
    if (_rootDirNotSourceDir(packageDirPath, currentArtifactPaths)) {
      throw new Error(messages.getMessage('rootDirectoryNotASourceDirectory', [], 'sourceConvertCommand'));
    }

    // If a sourcePath was passed in and we are in stateless mode (e.g., changesets)
    // add only the specified source path to workspacePathInfos.
    if (this.isStateless && sourcePath) {
      await this.workspace.addNewRoot(sourcePath);
    } else {
      if (untrackedArtifactPaths.length > 0) {
        await this.workspace.addRoots(untrackedArtifactPaths);
      }
    }

    const promises = this.workspace.getPathInfos().map(async sourcePathInfo => {
      // default to including this sourcePathInfo
      let shouldIncludeSourcePathInfo = true;

      // Filter out first by packageDirPath, then sourcePath, then .forceignore
      if (packageDirPath) {
        shouldIncludeSourcePathInfo = sourcePathInfo.sourcePath.includes(packageDirPath);
      }
      if (shouldIncludeSourcePathInfo && sourcePath) {
        shouldIncludeSourcePathInfo = sourcePathInfo.sourcePath.includes(sourcePath);
      }
      if (this.forceIgnore.denies(sourcePathInfo.sourcePath)) {
        shouldIncludeSourcePathInfo = false;
      }

      const pendingSourcePathInfo = await sourcePathInfo.getPendingPathInfo();

      if (_.isNil(pendingSourcePathInfo)) {
        // Null pendingSourcePathInfo means the sourcePathInfo has not changed
        if (!changesOnly) {
          // If the path didn't change and we aren't limiting to changes then add it
          if (shouldIncludeSourcePathInfo) return [sourcePathInfo];
        }
      } else {
        if (shouldIncludeSourcePathInfo) {
          // The path has changed so add it
          if (
            pendingSourcePathInfo.isDirectory &&
            !pendingSourcePathInfo.isDeleted() &&
            !pendingSourcePathInfo.isWorkspace
          ) {
            // If it's a directory and it isn't deleted then process the directory change
            const processed = await this.processChangedDirectory(pendingSourcePathInfo.sourcePath);
            return [pendingSourcePathInfo, ...processed];
          } else {
            return [pendingSourcePathInfo];
          }
        }
      }
    });

    const sourcePathInfos = await Promise.all(promises);
    return sourcePathInfos.reduce((x, y) => x.concat(y), []).filter(x => !!x);
  }

  /**
   * Update the data model with changes
   */
  public async commitChangedPathInfos(sourcePathInfos: SourcePathInfo[]): Promise<void> {
    for (const sourcePathInfo of sourcePathInfos) {
      if (sourcePathInfo.state !== _sourceState.UNCHANGED) {
        if (sourcePathInfo.isDeleted()) {
          this.workspace.deletePathInfo(sourcePathInfo.sourcePath);
        } else {
          sourcePathInfo.state = _sourceState.UNCHANGED;
          this.workspace.setPathInfo(sourcePathInfo.sourcePath, sourcePathInfo);
        }
      }
    }
    await this.workspace.writeSourcePathInfos(this.workspacePath);
  }

  /**
   * Update data model for the given paths
   */
  public async updateInfosForPaths(updatedPaths: ArtifactPath[], deletedPaths: ArtifactPath[]): Promise<void> {
    // check if the parent paths of updated paths need to be added to workspacePathInfos too
    for (const updatedPath of updatedPaths.slice()) {
      if (!this.workspace.hasPathInfo(updatedPath)) {
        const sourcePath = updatedPath.split(path.sep);
        while (sourcePath.length > 1) {
          sourcePath.pop();
          const parentPath = sourcePath.join(path.sep);
          updatedPaths.push(parentPath);
          if (this.workspace.hasPathInfo(parentPath)) break;
        }
      }
    }

    for (const deletedPath of deletedPaths) {
      this.workspace.deletePathInfo(deletedPath);
    }

    const promises = updatedPaths.map(async updatedPath => {
      const sourcePathInfo = await SourcePathInfo.create({ sourcePath: updatedPath });
      sourcePathInfo.state = _sourceState.UNCHANGED;
      this.workspace.setPathInfo(updatedPath, sourcePathInfo);
    });

    await Promise.all(promises);

    await this.workspace.writeSourcePathInfos(this.workspacePath);
  }

  public backup() {
    this.org.getSourcePathInfos().backup();
  }

  public revert() {
    this.org.getSourcePathInfos().revert();
  }

  /**
   * Get the path infos for source that has been updated in the given directory
   */
  private async processChangedDirectory(directoryPath: ArtifactPath): Promise<SourcePathInfo[]> {
    // If the path is a directory and wasn't deleted then we want to process the contents for changes
    const files = fs
      .readdirSync(directoryPath)
      .map(file => path.join(directoryPath, file))
      // We only need to process additions to the directory, any existing ones will get dealt with on their own
      .filter(file => !this.workspace.hasPathInfo(file));
    const promises = files.map(async file => await this.getNewPathInfos(file));
    const updatedPathInfos = await Promise.all(promises);
    return updatedPathInfos.reduce((x, y) => x.concat(y), []);
  }

  /**
   * Get the path infos for newly added source
   */
  private async getNewPathInfos(sourcePath: ArtifactPath): Promise<SourcePathInfo[]> {
    let newPathInfos = [];
    const newPathInfo = await SourcePathInfo.create({
      sourcePath,
      deferContentHash: false
    });

    if (this.workspace.isValidSourcePath(newPathInfo)) {
      newPathInfos.push(newPathInfo);
      if (newPathInfo.isDirectory) {
        const files = fs.readdirSync(sourcePath);
        const promises = files.map(async file => await this.getNewPathInfos(path.join(sourcePath, file)));
        const infos = await Promise.all(promises);
        newPathInfos = newPathInfos.concat(infos.reduce((x, y) => x.concat(y), []));
      }
    }
    return newPathInfos;
  }
}

function _rootDirNotSourceDir(packageDirPath: string, artifactRootPaths: ArtifactPath[]): boolean {
  return !_.isNil(packageDirPath) && _.isNil(artifactRootPaths.find(rootDir => packageDirPath.startsWith(rootDir)));
}

// Return a directory path that ends with a path separator
function normalizeDirectoryPath(dirPath: string): string {
  return dirPath && !dirPath.endsWith(path.sep) ? `${dirPath}${path.sep}` : dirPath;
}
