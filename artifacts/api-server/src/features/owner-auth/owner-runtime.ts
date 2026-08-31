import { PostgresOwnerAccountRepository } from "./owner-account-repository";
import { createRequireOwnerMiddleware } from "./owner-middleware";

export const ownerAccountRepository = new PostgresOwnerAccountRepository();
export const requireOwnerMiddleware = createRequireOwnerMiddleware(ownerAccountRepository);
