import { MetadataComponent, SourcePath } from '../../types';

export interface MetadataTransformer {
  toApiFormat(
    component: MetadataComponent,
    dest: SourcePath
  ): Promise<MetadataComponent>;
  toSourceFormat(
    component: MetadataComponent,
    dest: SourcePath
  ): MetadataComponent;
}
