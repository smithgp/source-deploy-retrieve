/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection } from '@salesforce/core';
import { EventEmitter } from 'events';
import { DeployStatus } from '.';
import { MetadataComponent } from '../common';
import { ComponentCollection } from '../common/componentCollection';
import { DeployError } from '../errors';
import { SourceComponent } from '../metadata-registry';
import { DiagnosticUtil } from './diagnosticUtil';
import {
  ComponentDeployment,
  ComponentStatus,
  DeployMessage,
  DeployResult,
  MetadataRequestResult,
  RequestStatus,
  RetrieveResult,
  SourceApiResult,
  SourceDeployResult,
  SourceRetrieveResult,
} from './types';

abstract class OrgOperation extends EventEmitter {
  protected immediateCancel = false;
  protected id: string;
  protected connection: Connection;
  private shouldCancel = false;

  constructor(id: string, connection: Connection) {
    super();
    this.id = id;
    this.connection = connection;
  }

  public startPolling(interval = 100): void {
    this.pollStatus(interval);
  }

  public cancel(): void {
    this.shouldCancel = true;
  }

  private async pollStatus(interval: number): Promise<void> {
    let result: MetadataRequestResult;

    const wait = (interval: number): Promise<void> => {
      return new Promise((resolve) => {
        setTimeout(resolve, interval);
      });
    };

    let triedOnce = false;

    while (true) {
      if (this.shouldCancel) {
        const shouldBreak = this.doCancel();
        if (shouldBreak) {
          result.status = RequestStatus.Canceled;
          this.emit('finish', result);
          return;
        }
      }

      if (triedOnce) {
        await wait(interval);
      }

      try {
        result = await this.checkStatus();
        switch (result.status) {
          case RequestStatus.Succeeded:
          case RequestStatus.Failed:
          case RequestStatus.Canceled:
            this.emit('finish', this.formatResult(result));
            return;
        }
        this.emit('update', result);
        triedOnce = true;
      } catch (e) {
        throw new DeployError('md_request_fail', e);
      }
    }
  }

  protected abstract doCancel(): Promise<boolean>;
  protected abstract async checkStatus(): Promise<MetadataRequestResult>;
  protected abstract formatResult(result: MetadataRequestResult): SourceApiResult;
}

export class DeployOperation extends OrgOperation {
  protected components: SourceComponent[];

  constructor(deployId: string, connection: Connection, components: SourceComponent[]) {
    super(deployId, connection);
    this.components = components;
  }

  protected async doCancel(): Promise<boolean> {
    // @ts-ignore
    const { done } = this.connection.metadata._invoke('cancelDeploy', { id: this.id });
    return false;
  }

  protected checkStatus(): Promise<DeployResult> {
    // Recasting to use the library's DeployResult type
    return (this.connection.metadata.checkDeployStatus(this.id, true) as unknown) as Promise<
      DeployResult
    >;
  }

  protected formatResult(result: DeployResult): SourceDeployResult {
    const componentDeploymentMap = new Map<string, ComponentDeployment>();
    for (const component of this.components) {
      componentDeploymentMap.set(`${component.type.name}:${component.fullName}`, {
        status: ComponentStatus.Unchanged,
        component,
        diagnostics: [],
      });
    }
    const deployResult: SourceDeployResult = {
      id: result.id,
      status: result.status,
      success: result.success,
    };

    const messages = this.getDeployMessages(result);
    const diagnosticUtil = new DiagnosticUtil('metadata');

    if (messages.length > 0) {
      deployResult.components = [];
      for (let message of messages) {
        message = this.sanitizeDeployMessage(message);
        const componentKey = `${message.componentType}:${message.fullName}`;
        const componentDeployment = componentDeploymentMap.get(componentKey);

        if (componentDeployment) {
          if (message.created === 'true') {
            componentDeployment.status = ComponentStatus.Created;
          } else if (message.changed === 'true') {
            componentDeployment.status = ComponentStatus.Changed;
          } else if (message.deleted === 'true') {
            componentDeployment.status = ComponentStatus.Deleted;
          } else if (message.success === 'false') {
            componentDeployment.status = ComponentStatus.Failed;
          }

          if (message.problem) {
            diagnosticUtil.setDeployDiagnostic(componentDeployment, message);
          }
        }
      }
      deployResult.components = Array.from(componentDeploymentMap.values());
    }

    return deployResult;
  }

  private getDeployMessages(result: DeployResult): DeployMessage[] {
    const messages: DeployMessage[] = [];
    if (result.details) {
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

export class RetrieveOperation extends OrgOperation {
  protected async doCancel(): Promise<boolean> {
    return true;
  }

  protected checkStatus(): Promise<RetrieveResult> {
    return (this.connection.metadata.checkRetrieveStatus(this.id) as unknown) as Promise<
      RetrieveResult
    >;
  }

  protected formatResult(): SourceRetrieveResult {
    throw new Error('Method not implemented.');
  }
}
