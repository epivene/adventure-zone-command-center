const labels: Record<string, { label: string; help: string }> = {
  "gpt-6-sol": {
    label: "GPT-6 Sol · Everyday",
    help: "A balanced choice for business work and multi-step tasks.",
  },
  "gpt-6-astra": {
    label: "GPT-6 Astra · Complex tasks",
    help: "Use for difficult planning, research and detailed decisions.",
  },
  "gpt-6-luna": {
    label: "GPT-6 Luna · Light",
    help: "A lighter choice for straightforward work.",
  },
  "gpt-5.4-mini": {
    label: "GPT-5.4 Mini · Lower cost",
    help: "A lower-cost option for everyday questions and email drafting. Supports screenshots.",
  },
  "gpt-5.4-nano": {
    label: "GPT-5.4 Nano · Small tasks",
    help: "Best for short rewrites and simple questions. Use Mini or Sol for tasks with several steps. Supports screenshots.",
  },
};
export function modelLabel(id: string) {
  return labels[id]?.label ?? id;
}
export function modelHelp(id: string) {
  return labels[id]?.help ?? "Choose a model for your next message.";
}
