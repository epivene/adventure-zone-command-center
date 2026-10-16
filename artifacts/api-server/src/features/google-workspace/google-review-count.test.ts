import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{}}));
import { PostgresGoogleValidationRepository } from "./google-validation-repository";
it("counts pending review groups exactly as the full queue without loading message payloads",async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`CREATE TABLE google_workspace_connections(id text,status text,role text,updated_at timestamptz);
      INSERT INTO google_workspace_connections VALUES('current','connected','workspace',now());
      CREATE TABLE google_workspace_validation_review_items(connection_id text,message_id text,thread_id text,subject text,from_header text,to_header text,review_state text,updated_at timestamptz);
      INSERT INTO google_workspace_validation_review_items VALUES
      ('current','1','t','Hello','Sender','Owner','pending',now()),
      ('current','2','t',' hello ',' sender ','Owner','pending',now()),
      ('current','3','t','Hello','Sender','Owner','resolved',now()),
      ('current','4','u','Other','Sender','Owner','ignored',now()),
      ('old','5','v','Old','Sender','Owner','pending',now()),
      ('current','6','w','New','Sender','Owner','pending',now());`);
    const repository=new PostgresGoogleValidationRepository(pg as any);
    expect(await repository.countPendingReviewItems()).toBe(2);
    await pg.exec("UPDATE google_workspace_validation_review_items SET review_state='resolved' WHERE message_id IN ('1','2')");
    expect(await repository.countPendingReviewItems()).toBe(1);
  }finally{await pg.close();}
});
