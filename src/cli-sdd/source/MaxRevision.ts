import { SourceMember } from './SourceMember';
import {
  ConfigContents,
  ConfigFile,
  Connection,
  fs,
  Logger,
  Org,
  SfdxError
} from '@salesforce/core';
import { Dictionary } from '@salesforce/ts-types';
import * as path from 'path';
import { join as pathJoin } from 'path';

/**
 * This file is in charge of writing and reading to/from the .sfdx/orgs/<username>/maxRevision.json file for each scratch
 * org. This file is a json that keeps track of a SourceMember object and the serverMaxRevisionCounter, which is the
 * highest RevisionCounter field on the server. Each SourceMember object has 4 fields:
 *    serverRevisionCounter: the current RevisionCounter on the server for this object
 *    lastRetrievedFromServer: the RevisionCounter last retrieved from the server for this object
 *    memberType: the metadata name of the SourceMember
 *    isNameObsolete: wether or not this object has been deleted.
 *
 *    ex.
      serverMaxRevisionCounter: 2,
      sourceMembers: {
        test__c: {
          serverRevisionCounter: 2,
          lastRetrievedFromServer: 3,
          memberType: ApexClass,
          isNameObsolete: false
        },
        abc: {
          serverRevisionCounter: 2,
          lastRetrievedFromServer: 2,
          memberType: ApexClass,
          isNameObsolete: false
        }
      }
 * In this example, test__c has been changed because the serverRevisionCounter is different from the lastRetrievedFromServer
 * when a pull is performed, all of the pulled members will have their counters set to the corresponding RevisionCounter
 * coming from the SourceMember on the server.
 */

type MemberRevision = {
  serverRevisionCounter: number;
  lastRetrievedFromServer: number;
  memberType: string;
  isNameObsolete: boolean;
};

type MaxJson = ConfigContents & {
  serverMaxRevisionCounter: number;
  sourceMembers: Dictionary<MemberRevision>;
};

export namespace MaxRevision {
  // Constructor Options for MaxRevision.
  export interface Options extends ConfigFile.Options {
    username: string;
  }
}

const QUERY_MAX_REVISION_COUNTER =
  'SELECT MAX(RevisionCounter) MaxRev FROM SourceMember';

export class MaxRevision extends ConfigFile<MaxRevision.Options> {
  private logger: Logger;
  private org: Org;
  private readonly FIRST_REVISION_COUNTER_API_VERSION: string = '47.0';
  private conn: Connection;
  private currentApiVersion: string;
  private static maxRevision: Dictionary<MaxRevision> = {};
  private isSourceTrackedOrg: boolean = true;

  /**
   * follows packageInfoCache's architecture, where getInstance is the entry method to the class
   * @param {MaxRevision.Options} options that contain the org's username
   * @returns {Promise<MaxRevision>} the maxRevision object for the given username
   */
  public static async getInstance(
    options: MaxRevision.Options
  ): Promise<MaxRevision> {
    if (!this.maxRevision[options.username]) {
      this.maxRevision[options.username] = await MaxRevision.create(options);
    }
    return this.maxRevision[options.username];
  }

  public getFileName(): string {
    return 'maxRevision.json';
  }

  public async init() {
    this.options.filePath = pathJoin('.sfdx', 'orgs', this.options.username);
    this.options.filename = this.getFileName();
    this.org = await Org.create({ aliasOrUsername: this.options.username });
    this.logger = await Logger.child(this.constructor.name);
    this.conn = this.org.getConnection();
    this.currentApiVersion = this.conn.getApiVersion();

    try {
      await super.init();
    } catch (err) {
      if (err.name === 'JsonDataFormatError') {
        // this error is thrown when the old maxRevision.json is being read
        this.logger.debug(
          'old maxRevision.json detected, converting to new schema'
        );
        // transition from old maxRevision to new
        const filePath = path.join(
          process.cwd(),
          this.options.filePath,
          this.getFileName()
        );
        // read the old maxRevision to get the 'serverMaxRevisionCounter'
        const oldMaxRevision: string = await fs.readFile(filePath, 'utf-8');
        // transform and overwrite the old file into the new schema
        await fs.writeFile(
          filePath,
          JSON.stringify(
            {
              serverMaxRevisionCounter: parseInt(oldMaxRevision),
              sourceMembers: {}
            },
            null,
            4
          )
        );
        await super.init();
      } else {
        throw SfdxError.wrap(err);
      }
    }

    const contents = this.getContents();
    if (!contents.serverMaxRevisionCounter && !contents.sourceMembers) {
      try {
        // Initialize if file didn't exist
        // to transition from RevisionNum to RevisionCounter correctly we need to get the max RevisionCounter
        // based on current SourceMembers that may be present in the org
        const result = await this.query(QUERY_MAX_REVISION_COUNTER);
        let maxRevisionCounter = 0;

        if (result[0] && result[0].MaxRev) {
          maxRevisionCounter = result[0].MaxRev;
        }

        this.logger.debug(
          `setting serverMaxRevisionCounter to ${maxRevisionCounter} on creation of the file`
        );

        contents.serverMaxRevisionCounter = maxRevisionCounter;
        contents.sourceMembers = {};
        await this.write();
      } catch (e) {
        // srcDevUtil.isSourceTrackedOrg() queries for Source Members on the org and if it errors it is determined to
        // be a non-source-tracked org. We're doing the same thing here and it saves us one extra query
        if (
          e.name === 'INVALID_TYPE' &&
          e.message.includes("sObject type 'SourceMember' is not supported")
        ) {
          // non-source-tracked org E.G. DevHub or trailhead playground
          this.isSourceTrackedOrg = false;
        }
      }
    }
  }

  public getContents(): MaxJson {
    // override getContents and cast here to avoid casting every getContents() is called
    return this['contents'] as MaxJson;
  }

  public hasSourceMember(key: string): boolean {
    // key will be 'test__c' for the example in the top comment
    return !!this.getContents().sourceMembers[key];
  }

  public getServerMaxRevision(): number {
    return this.getContents().serverMaxRevisionCounter;
  }

  public getSourceMembers(): Dictionary<MemberRevision> {
    return this.getContents().sourceMembers;
  }

  public getSourceMember(key: string): MemberRevision {
    // key will be 'test__c' for the example in the top comment
    return this.getSourceMembers()[key];
  }

  /**
   * will insert or update a source member in the maxrevision json
   * @param change a single changed element to be inserted or updated
   * @private
   */
  private upsertToJson(change: SourceMember) {
    // try accessing the sourceMembers object at the index of the change's name
    // if it exists, we'll update the fields - if it doesn't, we'll create and insert it
    let sourceMember = this.getContents().sourceMembers[change.MemberName];
    if (sourceMember) {
      // the sourceMember already existed so we'll be updating it
      this.logger.debug(`updating ${sourceMember} to ${change}`);
      sourceMember.serverRevisionCounter = change.RevisionCounter;
      // set metadata type and isNameObsolete field
      sourceMember.memberType = change.MemberType;
      sourceMember.isNameObsolete = change.IsNameObsolete;
    } else if (!!change.MemberName) {
      // insert record
      this.logger.debug(`inserting ${change}`);
      sourceMember = {
        serverRevisionCounter: change.RevisionCounter,
        lastRetrievedFromServer: null,
        memberType: change.MemberType,
        isNameObsolete: change.IsNameObsolete
      };
    }
    // set the contents of the config file to our new/updated sourcemember
    this.getContents().sourceMembers[change.MemberName] = sourceMember;
  }

  private upsertSourceMembers(sourceMembers: SourceMember[]) {
    sourceMembers.forEach(sourceMember => {
      this.upsertToJson(sourceMember);
    });
  }

  private async syncRevisionCounter(sourceMembers: SourceMember[]) {
    // we query for RevisionCounter because that's the only place RevisionCounter is stored for new objects
    sourceMembers.forEach(member => {
      const memberName = member.MemberName;
      if (this.hasSourceMember(memberName)) {
        this.getSourceMember(
          memberName
        ).lastRetrievedFromServer = this.getSourceMember(
          memberName
        ).serverRevisionCounter;
      }
    });
  }

  /**
   * return the elements in the maxrevision.json whose lastRetrieved and serverRevision number are different
   */
  public async getChangedElements(): Promise<SourceMember[]> {
    const returnElements: SourceMember[] = [];
    const sourceMembers = this.getSourceMembers();
    Object.keys(sourceMembers).forEach(sourceMemberName => {
      const sm = this.getSourceMember(sourceMemberName);
      // if the numbers are different than there is a change
      if (sm.serverRevisionCounter !== sm.lastRetrievedFromServer) {
        // mimic the old results from the srcStatusApi.getRemoteChanges query
        returnElements.push({
          attributes: {
            url: '',
            type: ''
          },
          MemberType: sm.memberType,
          MemberName: sourceMemberName,
          RevisionCounter: sm.serverRevisionCounter,
          IsNameObsolete: sm.isNameObsolete
        });
      }
    });
    this.logger.debug('getChangedElements:', returnElements);
    return returnElements;
  }

  /**
   * reads and writes maxJson and handles serverMaxRevisionCounter
   * @param sourceMembers
   */
  public async writeSourceMembers(sourceMembers: SourceMember[]) {
    if (sourceMembers.length > 0) {
      this.upsertSourceMembers(sourceMembers);
      await this.write();
    }
  }

  /**
   * Writes SourceMembers to maxRevision.json and sets the
   * lastRetrievedFromServer to the serverRevisionCounter.
   * This should be called after a successful push or pull.
   */
  public async updateSourceTracking(sourceMembers: SourceMember[]) {
    if (sourceMembers.length > 0) {
      this.upsertSourceMembers(sourceMembers);
      await this.syncRevisionCounter(sourceMembers);
      await this.write();
    }
  }

  /**
   * will set ServerMaxRevisionCounter to rev, if rev is higher than the current
   * @param rev new max revision number
   */
  public async setServerMaxRevision(rev: number) {
    if (this.getContents().serverMaxRevisionCounter < rev) {
      this.logger.debug(`new serverMaxRevisionCounter = ${rev}`);
      this.getContents().serverMaxRevisionCounter = rev;
      await this.write();
    }
  }

  public async setMaxRevisionCounterFromQuery() {
    const result = await this.query(QUERY_MAX_REVISION_COUNTER);
    const newMaxRev = result[0].MaxRev;

    return await this.setServerMaxRevision(newMaxRev);
  }

  public async querySourceMembersFrom(
    fromRevision: number
  ): Promise<SourceMember[]> {
    // because `serverMaxRevisionCounter` is always updated, we need to select > to catch the most recent change
    const query = `SELECT MemberType, MemberName, IsNameObsolete, RevisionCounter FROM SourceMember WHERE RevisionCounter > ${fromRevision}`;

    return await this.query(query);
  }

  public async queryAllSourceMembers(): Promise<SourceMember[]> {
    const query = `SELECT MemberName, MemberType, RevisionCounter from SourceMember`;

    return await this.query(query);
  }

  private async query<T>(query: string) {
    // to switch to using RevisionCounter - apiVersion > 46.0
    // set the api version of the connection to 47.0, query, revert api version
    if (!this.isSourceTrackedOrg) {
      throw SfdxError.create(
        '@salesforce/source-deploy-retrieve',
        'source',
        'NonSourceTrackedOrgError'
      );
    }

    let results;
    if (
      parseFloat(this.currentApiVersion) <
      parseFloat(this.FIRST_REVISION_COUNTER_API_VERSION)
    ) {
      this.conn.setApiVersion(this.FIRST_REVISION_COUNTER_API_VERSION);
      results = await this.conn.tooling.query<T>(query);
      this.conn.setApiVersion(this.currentApiVersion);
    } else {
      results = await this.conn.tooling.query<T>(query);
    }
    return results.records;
  }
}
