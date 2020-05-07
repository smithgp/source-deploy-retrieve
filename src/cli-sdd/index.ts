import { SourceConvertApi } from './source/sourceConvertApi';
import OrgApi = require('./core/scratchOrgApi');
import { dirname } from 'path';
import { SfdxProject } from '@salesforce/core';

export async function convertSourceCli(root: string, output: string) {
  const start = new Date();

  const org = new OrgApi();
  org.setName('b.powell@devdevhub.com.demobox');
  const old = process.cwd();
  process.chdir(await SfdxProject.resolveProjectPath(root));
  const sourceConvert = new SourceConvertApi(org);
  await sourceConvert.doConvert({
    rootDir: root,
    outputDir: output,
    packagename: 'force-app'
  });
  process.chdir(old);

  //@ts-ignore
  const elapsed = new Date() - start;
  console.log('Elapsed: ' + elapsed + 'ms');
}
