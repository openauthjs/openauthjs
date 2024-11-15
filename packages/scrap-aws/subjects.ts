import { object, string } from "valibot";
import { createSubjects } from "../core/src";

export const subjects = createSubjects({
  user: object({
    email: string(),
  }),
  api: object({
    userID: string(),
    workspaceID: string(),
  }),
});
