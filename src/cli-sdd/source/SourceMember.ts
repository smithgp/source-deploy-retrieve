export interface SourceMember {
  attributes: {
    type: string;
    url: string;
  };
  MemberType: string;
  MemberName: string;
  IsNameObsolete: boolean;
  RevisionCounter: number;
}
