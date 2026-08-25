import type { AssistantAnswer, AssistantAskResponse } from "./assistant-types";

export type ClientAssistantAnswer = Omit<AssistantAnswer, "mode"> & {
  mode: AssistantAnswer["mode"] | "on_device";
};

export type ClientAssistantAskResponse = Omit<AssistantAskResponse, "answer"> & {
  answer: ClientAssistantAnswer;
};
