import { MetadataTransformer } from '.';
import { MetadataComponent, SourcePath } from '../../types';
import * as fs from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { sep, join } from 'path';
import {
  ensureDirectoryExists,
  ensureFileExists
} from '../../utils/fileSystemHandler';

// const copy = promisify(fs.copyFile);
const pipelinePromise = promisify(pipeline);

export class SimpleTransformer implements MetadataTransformer {
  async toApiFormat(
    component: MetadataComponent,
    dest: SourcePath
  ): Promise<MetadataComponent> {
    const copyJobs = [];
    const { directoryName } = component.type;
    ensureDirectoryExists(join(dest, directoryName));
    try {
      let xmlDest = join(dest, this.trimUntil(component.xml, directoryName));
      if (component.sources.length === 0) {
        xmlDest = xmlDest.slice(0, xmlDest.lastIndexOf('-meta.xml'));
      }
      copyJobs.push(this.copy(component.xml, xmlDest));
      for (const source of component.sources) {
        const sourceDest = join(dest, this.trimUntil(source, directoryName));
        copyJobs.push(this.copy(source, sourceDest));
      }
      await Promise.all(copyJobs);
    } catch (e) {
      // throw a real error
      throw e;
    }
    return component; // wrong
  }

  toSourceFormat(
    component: MetadataComponent,
    dest: SourcePath
  ): MetadataComponent {
    throw new Error('Method not implemented.');
  }

  protected copy(src: string, dest: string): Promise<void> {
    ensureFileExists(dest);
    return pipelinePromise(
      fs.createReadStream(src),
      fs.createWriteStream(dest)
    );
    // return copy(src, dest, fs.constants.COPYFILE_FICLONE);
  }

  protected trimUntil(path: string, name: string): string {
    const parts = path.split(sep);
    const index = parts.findIndex(part => name === part);
    if (index !== -1) {
      return parts.slice(index).join(sep);
    }
    return path;
  }
}
