import { Logger } from '@salesforce/core';
import { AsyncCreatable, isEmpty } from '@salesforce/kit';
import { Nullable } from '@salesforce/ts-types';
import { MetadataType } from './metadataType';
import { MetadataTypeFactory } from './metadataTypeFactory';
import { SourcePathInfo } from './sourcePathStatusManager';
import { isString } from 'util';
import MetadataRegistry = require('./metadataRegistry');

interface SourceLocationsOptions {
  metadataRegistry: MetadataRegistry;
  sourcePathInfos: SourcePathInfo[];
  shouldBuildIndices: boolean;
}

export type MetadataPathsIndex = Map<string, string>;
export type FilePathsIndex = Map<string, string>;

export class SourceLocations extends AsyncCreatable<SourceLocationsOptions> {
  logger!: Logger;

  private static _metadataPathsIndex: MetadataPathsIndex = new Map();
  private static _filePathsIndex: FilePathsIndex = new Map();

  private metadataRegistry: MetadataRegistry;
  private sourcePathInfos: SourcePathInfo[];
  private shouldBuildIndices: boolean;

  constructor(options: SourceLocationsOptions) {
    super(options);
    this.metadataRegistry = options.metadataRegistry;
    this.sourcePathInfos = options.sourcePathInfos;
    this.shouldBuildIndices = options.shouldBuildIndices;
  }

  protected async init(): Promise<void> {
    this.logger = await Logger.child(this.constructor.name);

    // No need to build indices in some cases, e.g., mdapi:convert and source:convert
    if (this.shouldBuildIndices) {
      this.buildIndices();
    }
  }

  public getMetadataPath(metadataType: string, fullName: string): Nullable<string> {
    const key = SourceLocations.getMetadataPathKey(metadataType, fullName);
    const value = SourceLocations.metadataPathsIndex.get(key);
    if (value) return value;
    else this.logger.debug(`No metadata path found for ${key}`);
  }

  public addMetadataPath(metadataType: string, fullName: string, metadataPath: string) {
    const key = SourceLocations.getMetadataPathKey(metadataType, fullName);
    SourceLocations.metadataPathsIndex.set(key, metadataPath);
  }

  public getFilePath(metadataType: string, fullName: string): Nullable<string> {
    const key = SourceLocations.getFilePathKey(metadataType, fullName);
    const value = SourceLocations.filePathsIndex.get(key);
    if (value) return value;
    else this.logger.debug(`No file path found for ${key}`);
  }

  public addFilePath(pathMetadataType: MetadataType, sourcePath: string) {
    const aggregateMetadataType = pathMetadataType.getAggregateMetadataName();
    const fullName = decodeURIComponent(pathMetadataType.getFullNameFromFilePath(sourcePath));
    const key = SourceLocations.getFilePathKey(aggregateMetadataType, fullName);
    SourceLocations.filePathsIndex.set(key, sourcePath);
  }

  private buildIndices() {
    this.sourcePathInfos.forEach(sourcePathInfo => {
      if (sourcePathInfo.isMetadataFile) {
        const pathMetadataType = MetadataTypeFactory.getMetadataTypeFromSourcePath(
          sourcePathInfo.sourcePath,
          this.metadataRegistry
        );
        if (pathMetadataType) {
          const aggregateFullName = pathMetadataType.getAggregateFullNameFromFilePath(sourcePathInfo.sourcePath);
          if (isEmpty(sourcePathInfo.sourcePath) || !isString(sourcePathInfo.sourcePath)) {
            throw new Error(`Invalid source path for metadataType: ${pathMetadataType}`);
          } else {
            const aggregateMetadataPath = pathMetadataType.getAggregateMetadataFilePathFromWorkspacePath(
              sourcePathInfo.sourcePath
            );
            this.addMetadataPath(pathMetadataType.getMetadataName(), aggregateFullName, aggregateMetadataPath);
            this.addFilePath(pathMetadataType, sourcePathInfo.sourcePath);
          }
        }
      }
    });
  }

  public static getMetadataPathKey(metadataName: string, aggregateFullName: string): string {
    return `${metadataName}__${aggregateFullName}`;
  }

  public static getFilePathKey(aggregateMetadataType: string, fullName: string): string {
    return `${aggregateMetadataType}__${fullName}`;
  }

  public static get filePathsIndex(): FilePathsIndex {
    return this._filePathsIndex;
  }

  public static set filePathsIndex(newIndex: FilePathsIndex) {
    this._filePathsIndex = newIndex;
  }

  public static get metadataPathsIndex(): MetadataPathsIndex {
    return this._metadataPathsIndex;
  }

  public static set metadataPathsIndex(newIndex: MetadataPathsIndex) {
    this._metadataPathsIndex = newIndex;
  }
}
