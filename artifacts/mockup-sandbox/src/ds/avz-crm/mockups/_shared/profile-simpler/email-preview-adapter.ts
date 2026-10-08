type ProfileEmailArchiveState = string; type ProfileEmailSourceState = string;
export type GoogleProfileEmailConversation = {
  conversationId?: string;
  threadId: string;
  savedCopy?: boolean;
  archiveState?: ProfileEmailArchiveState;
  sourceState?: ProfileEmailSourceState;
  subject: string;
  from: string;
  to: string;
  date: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
  contactId: string | null;
  evidenceCodes: string[];
  originalGmailUrl: string;
};

export type GoogleThreadAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  messageId: string;
};

export type GoogleThreadMessage = {
  id: string;
  internalDateMs: number | null;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  direction: "incoming" | "outgoing" | "unknown";
  bodyText: string;
  bodyHtml?: string;
  attachments: GoogleThreadAttachment[];
};

export type GoogleThreadDetail = {
  id: string;
  conversationId?: string;
  savedCopy?: boolean;
  archiveState?: ProfileEmailArchiveState;
  sourceState?: ProfileEmailSourceState;
  lastSyncedAt?: string | null;
  lastGmailErrorCode?: string | null;
  subject: string;
  originalGmailUrl: string;
  messages: GoogleThreadMessage[];
};

export type ProfileGoogleEmailState = {
  conversations: GoogleProfileEmailConversation[];
  current: GoogleProfileEmailConversation[];
  historical: GoogleProfileEmailConversation[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
};


const message: GoogleThreadMessage = {id:'preview-email-message',internalDateMs:Date.parse('2026-10-08T16:00:00Z'),from:'Jordan Avery <jordan@example.org>',to:'Adventure Zone <office@example.org>',cc:'',subject:'Booth layout and 2027 availability',date:'2026-10-08T16:00:00Z',direction:'incoming',bodyText:'Thanks for following up. Could you send your setup dimensions and availability for the two-day festival? We are reviewing the schedule with the committee this week.',attachments:[]};
export async function getGoogleProfileEmailThread(): Promise<GoogleThreadDetail> { return {id:'preview-email-thread',subject:message.subject,originalGmailUrl:'',messages:[message]}; }
export const demoEmails: ProfileGoogleEmailState = {conversations:[{threadId:'preview-email-thread',subject:message.subject,from:message.from,to:message.to,date:message.date,internalDateMs:message.internalDateMs,hasAttachments:false,contactId:'preview-contact',evidenceCodes:[],originalGmailUrl:''}],current:[],historical:[],loading:false,error:null,reload:async()=>{}};
