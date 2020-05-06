/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root  or https://opensource.org/licenses/BSD-3-Clause
 */

import { TypeDefObj } from '../typeDefObj';
import { BundleMetadataType } from './bundleMetadataType';

/**
 * FunctionBundle isn't yet a bundle: currently is a single metadata file,
 * but will likely evolve to include other files.
 *
 * FunctionBundle isn't supported by describe.json as FunctionBundles
 * are organized by folder name and are a single metadata file.  describe.json does
 * support metadata files *not* organized in folders, eg CustomApplication.
 */
export class FunctionBundleMetadataType extends BundleMetadataType {
  constructor(typeDefObj: TypeDefObj) {
    super(typeDefObj);
  }
}
