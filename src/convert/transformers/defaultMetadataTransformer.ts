/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { META_XML_SUFFIX } from '../../utils';
import { BaseMetadataTransformer } from './baseMetadataTransformer';
import { SfdxFileFormat, WriterFormat } from '../types';
import { SourceComponent } from '../../metadata-registry';
import { trimUntil } from '../../utils/path';
import { basename, dirname, join } from 'path';
import { SourcePath } from '../../common';

/**
 * The default metadata transformer.
 *
 * If a metadata type doesn't have a transformer assigned to it, this one is used
 * during the conversion process. It leaves the component's metadata xml and source
 * files as-is.
 */
export class DefaultMetadataTransformer extends BaseMetadataTransformer {
  public async toMetadataFormat(component: SourceComponent): Promise<WriterFormat> {
    return this.getWriterFormat(component, 'metadata');
  }

  public async toSourceFormat(
    component: SourceComponent,
    mergeWith?: SourceComponent
  ): Promise<WriterFormat> {
    return this.getWriterFormat(component, 'source', mergeWith);
  }

  private getWriterFormat(
    component: SourceComponent,
    targetFormat: SfdxFileFormat,
    mergeWith?: SourceComponent
  ): WriterFormat {
    const result: WriterFormat = { component: component, writeInfos: [] };

    if (component.content) {
      for (const source of component.walkContent()) {
        result.writeInfos.push({
          source: component.tree.stream(source),
          output: this.getContentSourceDestination(source, targetFormat, component, mergeWith),
        });
      }
    }

    if (component.xml) {
      result.writeInfos.push({
        source: component.tree.stream(component.xml),
        output: this.getXmlDestination(targetFormat, component, mergeWith),
      });
    }

    return result;
  }

  private getContentSourceDestination(
    source: SourcePath,
    targetFormat: SfdxFileFormat,
    component: SourceComponent,
    mergeWith?: SourceComponent
  ): SourcePath {
    if (mergeWith) {
      if (component.tree.isDirectory(component.content)) {
        const relative = trimUntil(source, basename(component.content));
        return join(dirname(mergeWith.content), relative);
      } else {
        return mergeWith.content;
      }
    }
    return component.getPackageRelativePath(source, targetFormat);
  }

  private getXmlDestination(
    targetFormat: SfdxFileFormat,
    component: SourceComponent,
    mergeWith?: SourceComponent
  ): SourcePath {
    let xmlDestination =
      mergeWith?.xml || component.getPackageRelativePath(component.xml, targetFormat);
    if (!component.content) {
      xmlDestination =
        targetFormat === 'metadata'
          ? xmlDestination.slice(0, xmlDestination.lastIndexOf(META_XML_SUFFIX))
          : `${xmlDestination}${META_XML_SUFFIX}`;
    }
    return xmlDestination;
  }
}
