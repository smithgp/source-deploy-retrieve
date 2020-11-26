/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SfdxFileFormat, WriteInfo, WriterFormat } from '../types';
import { ConvertTransaction } from '../convertTransaction';
import { RegistryAccess, SourceComponent } from '../../metadata-registry';

export abstract class MetadataTransformer {
  public copies: WriteInfo[] = [];
  protected registry: RegistryAccess;
  protected convertTransaction: ConvertTransaction;

  constructor(registry = new RegistryAccess(), convertTransaction = new ConvertTransaction()) {
    this.registry = registry;
    this.convertTransaction = convertTransaction;
  }

  public async createCopies(
    component: SourceComponent,
    targetFormat: SfdxFileFormat,
    mergeWith?: Iterable<SourceComponent>
  ): Promise<WriterFormat> {
    if (targetFormat === 'source') {
      if (mergeWith) {
        for (const mergeComponent of mergeWith) {
          this.toSourceFormat(component, mergeComponent);
        }
      } else {
        this.toSourceFormat(component);
      }
    } else {
      this.toMetadataFormat(component);
    }
    return { component, writeInfos: this.copies };
  }

  protected abstract toMetadataFormat(component: SourceComponent): Promise<WriterFormat>;
  protected abstract toSourceFormat(
    component: SourceComponent,
    mergeWith?: SourceComponent
  ): Promise<WriterFormat>;
}
