/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { dirname, join, sep } from 'path';
import { generateMetaXMLPath, trimMetaXmlSuffix } from '../utils';
import { ApexRecord, AuraRecord, LWCRecord, VFRecord, QueryResult } from './types';
import { SourceComponent } from '../resolve';
import { JsonMap } from '@salesforce/ts-types';
import { XML_NS_KEY, XML_NS_URL } from '../common';
import { JsToXml } from '../convert/streams';

export function buildQuery(mdComponent: SourceComponent, namespace = ''): string {
  let queryString = '';
  const typeName = mdComponent.type.name;
  const fullName = mdComponent.fullName;

  switch (typeName) {
    case 'ApexClass':
    case 'ApexTrigger':
      queryString = `Select Id, Name, NamespacePrefix, Body, Metadata from ${typeName} where Name = '${fullName}' and NamespacePrefix = '${namespace}'`;
      break;
    case 'ApexPage':
      queryString = `Select Id, Name, NamespacePrefix, Markup, Metadata from ${typeName} where Name = '${fullName}' and NamespacePrefix = '${namespace}'`;
      break;
    case 'AuraDefinitionBundle':
      queryString = 'Select Id, AuraDefinitionBundle.DeveloperName, ';
      queryString += `AuraDefinitionBundle.NamespacePrefix, DefType, Source, AuraDefinitionBundle.Metadata from AuraDefinition where AuraDefinitionBundle.DeveloperName = '${fullName}' and AuraDefinitionBundle.NamespacePrefix = '${namespace}'`;
      break;
    case 'LightningComponentBundle':
      queryString =
        'Select Id, LightningComponentBundle.DeveloperName, LightningComponentBundle.NamespacePrefix, FilePath, Source from LightningComponentResource ';
      queryString += `where LightningComponentBundle.DeveloperName = '${fullName}' and LightningComponentBundle.NamespacePrefix = '${namespace}'`;
      break;
    default:
      queryString = '';
  }

  return queryString;
}

function getAuraSourceName(componentPath: string, fileNamePrefix: string, defType: string): string {
  const cmpParentName = join(dirname(componentPath), fileNamePrefix);

  switch (defType) {
    case 'APPLICATION':
      return `${cmpParentName}.app`;
    case 'COMPONENT':
      return `${cmpParentName}.cmp`;
    case 'DOCUMENTATION':
      return `${cmpParentName}.auradoc`;
    case 'STYLE':
      return `${cmpParentName}.css`;
    case 'EVENT':
      return `${cmpParentName}.evt`;
    case 'DESIGN':
      return `${cmpParentName}.design`;
    case 'SVG':
      return `${cmpParentName}.svg`;
    case 'CONTROLLER':
      return `${cmpParentName}Controller.js`;
    case 'HELPER':
      return `${cmpParentName}Helper.js`;
    case 'RENDERER':
      return `${cmpParentName}Renderer.js`;
    case 'TOKENS':
      return `${cmpParentName}.tokens`;
    case 'INTERFACE':
      return `${cmpParentName}.intf`;
    default:
      return '';
  }
}

function createMetadataXml(typeName: string, metadata: JsonMap): string {
  const xml: JsonMap = {
    [typeName]: {
      [XML_NS_KEY]: XML_NS_URL,
    },
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'object' || key === 'packageVersions') {
      const entries = xml[typeName] as JsonMap;
      entries[key] = key === 'apiVersion' ? `${value}.0` : value;
    }
  }
  return new JsToXml(xml).read().toString();
}

export function queryToFileMap(
  queryResult: QueryResult,
  mdComponent: SourceComponent,
  overrideOutputPath?: string
): Map<string, string> {
  const typeName = mdComponent.type.name;
  let metadata: any;
  // If output is defined it overrides where the component will be stored
  const mdSourcePath = overrideOutputPath
    ? trimMetaXmlSuffix(overrideOutputPath)
    : mdComponent.walkContent()[0];
  const saveFilesMap = new Map();
  switch (typeName) {
    case 'ApexClass':
    case 'ApexTrigger':
      const apexRecord = queryResult.records[0] as ApexRecord;
      metadata = apexRecord.Metadata;
      saveFilesMap.set(mdSourcePath, apexRecord.Body);
      break;
    case 'ApexPage':
      const vfRecord = queryResult.records[0] as VFRecord;
      metadata = vfRecord.Metadata;
      saveFilesMap.set(mdSourcePath, vfRecord.Markup);
      break;
    case 'AuraDefinitionBundle':
      const auraRecord = queryResult.records as AuraRecord[];
      auraRecord.forEach((item) => {
        const cmpName = getAuraSourceName(mdSourcePath, mdComponent.name, item.DefType);
        saveFilesMap.set(cmpName, item.Source);
        if (!metadata) {
          metadata = item.AuraDefinitionBundle.Metadata;
        }
      });
      break;
    case 'LightningComponentBundle':
      const lwcRecord = queryResult.records as LWCRecord[];
      const bundleParentPath = mdSourcePath.substring(0, mdSourcePath.lastIndexOf(`${sep}lwc`));
      // NOTE: LightningComponentBundle query results returns the -meta.xml file
      lwcRecord.forEach((item) => {
        const cmpName = join(bundleParentPath, item.FilePath);
        saveFilesMap.set(cmpName, item.Source);
      });
      break;
    default:
  }

  if (metadata && mdComponent.xml) {
    // TODO: Respect overrideOutputPath
    saveFilesMap.set(mdComponent.xml, createMetadataXml(typeName, metadata));
  }

  return saveFilesMap;
}
