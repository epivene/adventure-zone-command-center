import {
  emptySelection,
  selectionSchema,
  type Queryable,
  type Selection,
  type Turn,
} from "./contracts";
export type Message = Turn & {
  id: string;
  sequence: number;
  createdAt: string;
};
export type Conversation = {
  id: string;
  title: string;
  selection: Selection;
  summary: unknown;
  version: number;
  updatedAt: string;
  messages: Message[];
};
const message = (r: any): Message => ({
  id: r.id,
  role: r.role,
  text: r.body,
  sequence: Number(r.sequence),
  createdAt: new Date(r.created_at).toISOString(),
});
const conversation = (r: any): Conversation => ({
  id: r.id,
  title: r.title,
  selection: selectionSchema.parse(r.selection),
  summary: r.summary,
  version: r.version,
  updatedAt: new Date(r.updated_at).toISOString(),
  messages: [],
});
export class ConversationStore {
  constructor(private readonly db: Queryable) {}
  async create(actorId: string, title: string): Promise<Conversation> {
    const rows = await this.db.query(
      `insert into assistant_workspace_conversations(actor_id,title,selection) values($1,$2,$3::jsonb) returning *`,
      [
        actorId,
        title.trim().slice(0, 160) || "New conversation",
        JSON.stringify(emptySelection()),
      ],
    );
    return conversation(rows.rows[0]);
  }
  async list(actorId: string): Promise<Conversation[]> {
    const r = await this.db.query(
      `select * from assistant_workspace_conversations where actor_id=$1 order by updated_at desc,id desc limit 100`,
      [actorId],
    );
    return r.rows.map(conversation);
  }
  async get(actorId: string, id: string): Promise<Conversation | null> {
    const r = await this.db.query(
      `select * from assistant_workspace_conversations where id=$1 and actor_id=$2`,
      [id, actorId],
    );
    if (!r.rows[0]) return null;
    const messages = await this.db.query(
      `select * from assistant_workspace_messages where conversation_id=$1 and actor_id=$2 order by sequence`,
      [id, actorId],
    );
    return { ...conversation(r.rows[0]), messages: messages.rows.map(message) };
  }
  async append(
    actorId: string,
    id: string,
    requestKey: string,
    turn: Turn,
  ): Promise<Message> {
    if (
      !["user", "assistant"].includes(turn.role) ||
      !turn.text.trim() ||
      turn.text.length > 20000 ||
      !requestKey ||
      requestKey.length > 128
    )
      throw new Error("ASSISTANT_MESSAGE_INVALID");
    const r = await this.db.query(
      `with inserted as (
      insert into assistant_workspace_messages(conversation_id,actor_id,request_key,role,body)
      select id,actor_id,$3,$4,$5 from assistant_workspace_conversations where id=$1 and actor_id=$2
      on conflict(conversation_id,request_key,role) do nothing returning *
    ), touched as (
      update assistant_workspace_conversations set updated_at=now() where id=$1 and actor_id=$2 and exists(select 1 from inserted)
    ) select * from inserted`,
      [id, actorId, requestKey, turn.role, turn.text],
    );
    if (r.rows[0]) return message(r.rows[0]);
    const prior = await this.db.query(
      `select * from assistant_workspace_messages where conversation_id=$1 and actor_id=$2 and request_key=$3 and role=$4`,
      [id, actorId, requestKey, turn.role],
    );
    if (!prior.rows[0]) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
    if (prior.rows[0].body !== turn.text)
      throw new Error("ASSISTANT_REQUEST_CONFLICT");
    return message(prior.rows[0]);
  }
  async setSelection(
    actorId: string,
    id: string,
    expectedVersion: number,
    selection: Selection,
  ): Promise<Conversation> {
    const parsed = selectionSchema.parse(selection);
    const r = await this.db.query(
      `update assistant_workspace_conversations set selection=$4::jsonb,version=version+1,updated_at=now() where id=$1 and actor_id=$2 and version=$3 returning *`,
      [id, actorId, expectedVersion, JSON.stringify(parsed)],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_VERSION_CONFLICT");
    return conversation(r.rows[0]);
  }
}
