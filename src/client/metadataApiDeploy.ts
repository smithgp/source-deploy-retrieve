/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { MetadataConverter } from '../convert';
import { DiagnosticUtil } from './diagnosticUtil';
import {
  MetadataApiDeployStatus,
  DeployMessage,
  MetadataApiDeployOptions as ApiOptions,
  ComponentStatus,
  FileResponse,
} from './types';
import { MetadataTransfer, MetadataTransferOptions } from './metadataTransfer';
import { ComponentSet } from '../collections';
import { SourceComponent } from '../metadata-registry';

export class DeployResult {
  public readonly response: MetadataApiDeployStatus;
  public readonly components: ComponentSet;

  constructor(response: MetadataApiDeployStatus, components: ComponentSet) {
    this.response = response;
    this.components = components;
  }

  public getFileResponses(): FileResponse[] {
    const fileResponses: FileResponse[] = [];
    const diagnosticUtil = new DiagnosticUtil('metadata');

    for (const message of this.getDeployMessages(this.response)) {
      const { fullName, componentType } = message;
      const component: SourceComponent | undefined = this.components
        .getSourceComponents({ fullName, type: componentType })
        .next().value;

      if (component) {
        let response: Partial<FileResponse> = {
          fullName: component.fullName,
          type: component.type.name,
          state: this.getState(message),
        };

        if (response.state === ComponentStatus.Failed) {
          const diagnostic = diagnosticUtil.parseDeployDiagnostic(component, message);
          if (component.xml && !component.content) {
            response = Object.assign(diagnostic, {
              fullName: component.fullName,
              type: component.type.name,
              state: response.state,
              filePath: component.xml,
            });
          } else {
            response = Object.assign(response, diagnostic);
          }
          fileResponses.push(response as FileResponse);
        } else {
          // components with children are already taken care of through the messages,
          // so don't walk their content directories.
          if (component.content && !component.type.children) {
            for (const filePath of component.walkContent()) {
              const contentResponse = Object.assign({}, response, { filePath }) as FileResponse;
              fileResponses.push(contentResponse);
            }
          }

          if (component.xml) {
            const xmlResponse = Object.assign({}, response, {
              filePath: component.xml,
            }) as FileResponse;
            fileResponses.push(xmlResponse);
          }
        }
      }
    }

    return fileResponses;
  }

  private getState(message: DeployMessage): ComponentStatus {
    if (message.created === 'true') {
      return ComponentStatus.Created;
    } else if (message.changed === 'true') {
      return ComponentStatus.Changed;
    } else if (message.deleted === 'true') {
      return ComponentStatus.Deleted;
    } else if (message.success === 'false') {
      return ComponentStatus.Failed;
    }
    return ComponentStatus.Unchanged;
  }

  private getDeployMessages(result: MetadataApiDeployStatus): DeployMessage[] {
    const messages: DeployMessage[] = [];

    const failedComponents = new ComponentSet();
    const failureMessages = this.normalizeToArray(result.details.componentFailures);
    const successMessages = this.normalizeToArray(result.details.componentSuccesses);

    for (const failure of failureMessages) {
      const sanitized = this.sanitizeDeployMessage(failure);
      const { fullName, componentType: type } = sanitized;
      failedComponents.add({ fullName, type });
      messages.push(failure);
    }

    for (const success of successMessages) {
      const sanitized = this.sanitizeDeployMessage(success);
      const { fullName, componentType: type } = sanitized;
      // lwc will return failures and successes for the same component, which is wrong.
      // this will ensure successes aren't reported if there is a failure for a component
      if (!failedComponents.has({ fullName, type })) {
        messages.push(sanitized);
      }
    }

    return messages;
  }

  /**
   * Fix any issues with the deploy message returned by the api.
   * TODO: remove as fixes are made in the api.
   */
  private sanitizeDeployMessage(message: DeployMessage): DeployMessage {
    // lwc doesn't properly use the fullname property in the api.
    message.fullName = message.fullName.replace(/markup:\/\/c:/, '');
    return message;
  }

  private normalizeToArray(messages: DeployMessage | DeployMessage[] | undefined): DeployMessage[] {
    if (messages) {
      return Array.isArray(messages) ? messages : [messages];
    }
    return [];
  }
}

export interface MetadataApiDeployOptions extends MetadataTransferOptions {
  apiOptions?: ApiOptions;
}

export class MetadataApiDeploy extends MetadataTransfer<MetadataApiDeployStatus, DeployResult> {
  public static readonly DEFAULT_OPTIONS: Partial<MetadataApiDeployOptions> = {
    apiOptions: {
      rollbackOnError: true,
      ignoreWarnings: false,
      checkOnly: false,
      singlePackage: true,
    },
  };
  private options: MetadataApiDeployOptions;
  private deployId: string | undefined;

  constructor(options: MetadataApiDeployOptions) {
    super(options);
    this.options = Object.assign({}, MetadataApiDeploy.DEFAULT_OPTIONS, options);
  }

  protected async pre(): Promise<{ id: string }> {
    const converter = new MetadataConverter();
    const { zipBuffer } = await converter.convert(
      Array.from(this.components.getSourceComponents()),
      'metadata',
      { type: 'zip' }
    );
    const connection = await this.getConnection();
    const result = await connection.metadata.deploy(zipBuffer, this.options.apiOptions);
    this.deployId = result.id;
    return result;
  }

  protected async checkStatus(id: string): Promise<MetadataApiDeployStatus> {
    const connection = await this.getConnection();
    // Recasting to use the project's DeployResult type
    return (connection.metadata.checkDeployStatus(id, true) as unknown) as MetadataApiDeployStatus;
  }

  protected async post(result: MetadataApiDeployStatus): Promise<DeployResult> {
    const r = new DeployResult(result, this.components);
    return r;
    // const diagnosticUtil = new DiagnosticUtil('metadata');
    // const componentDeploymentMap = new Map<string, ComponentDeployment>();
    // const deployResult: SourceDeployResult = {
    //   id: result.id,
    //   status: result.status,
    //   success: result.success,
    // };

    // for (const component of this.components.getSourceComponents()) {
    //   componentDeploymentMap.set(`${component.type.name}:${component.fullName}`, {
    //     status: ComponentStatus.Unchanged,
    //     component,
    //     diagnostics: [],
    //   });
    // }

    // for (let message of this.getDeployMessages(result)) {
    //   message = this.sanitizeDeployMessage(message);
    //   const componentKey = `${message.componentType}:${message.fullName}`;
    //   const componentDeployment = componentDeploymentMap.get(componentKey);

    //   if (componentDeployment) {
    //     if (message.created === 'true') {
    //       componentDeployment.status = ComponentStatus.Created;
    //     } else if (message.changed === 'true') {
    //       componentDeployment.status = ComponentStatus.Changed;
    //     } else if (message.deleted === 'true') {
    //       componentDeployment.status = ComponentStatus.Deleted;
    //     } else if (message.success === 'false') {
    //       componentDeployment.status = ComponentStatus.Failed;
    //     } else {
    //       componentDeployment.status = ComponentStatus.Unchanged;
    //     }

    //     if (message.problem) {
    //       diagnosticUtil.setDeployDiagnostic(componentDeployment, message);
    //     }
    //   }
    // }

    // deployResult.components = Array.from(componentDeploymentMap.values());

    // return deployResult;
  }

  protected async doCancel(): Promise<boolean> {
    let done = true;
    if (this.deployId) {
      const connection = await this.getConnection();
      // @ts-ignore _invoke is private on the jsforce metadata object, and cancelDeploy is not an exposed method
      done = connection.metadata._invoke('cancelDeploy', { id: this.deployId }).done;
    }
    return done;
  }

  private getDeployMessages(result: MetadataApiDeployStatus): DeployMessage[] {
    const messages: DeployMessage[] = [];
    const { componentSuccesses, componentFailures } = result.details;
    if (componentSuccesses) {
      if (Array.isArray(componentSuccesses)) {
        messages.push(...componentSuccesses);
      } else {
        messages.push(componentSuccesses);
      }
    }
    if (componentFailures) {
      if (Array.isArray(componentFailures)) {
        messages.push(...componentFailures);
      } else {
        messages.push(componentFailures);
      }
    }
    return messages;
  }

  /**
   * Fix any issues with the deploy message returned by the api.
   * TODO: remove as fixes are made in the api.
   */
  private sanitizeDeployMessage(message: DeployMessage): DeployMessage {
    // lwc doesn't properly use the fullname property in the api.
    message.fullName = message.fullName.replace(/markup:\/\/c:/, '');
    return message;
  }
}
