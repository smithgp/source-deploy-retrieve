import { SourceConvertApi } from './source/sourceConvertApi';
import OrgApi = require('./core/scratchOrgApi');
import { dirname } from 'path';
import { SfdxProject } from '@salesforce/core';

export async function convertSourceCli(root: string, output: string) {
  // we need to create an org object and give it a username.
  // this username needs to have a .sfdx entry in the workspace
  // we're converting from.
  const org = new OrgApi();
  org.setName('b.powell@devdevhub.com.demobox');

  // CLI code requires the cwd to be in an SFDX project, so we
  // do this workaround.
  const old = process.cwd();
  process.chdir(await SfdxProject.resolveProjectPath(root));

  const sourceConvert = new SourceConvertApi(org);
  await sourceConvert.doConvert({
    rootDir: root,
    outputDir: output,
    packagename: 'force-app'
  });

  process.chdir(old);
}
