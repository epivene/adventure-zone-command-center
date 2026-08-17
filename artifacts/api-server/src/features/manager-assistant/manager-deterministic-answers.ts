import type {
  ManagerAssistantAnswer,
  ManagerAssistantContextBundle,
} from "./manager-assistant-types";

function normalize(value: string) {
  return value.toLowerCase().replace(/[?!.,'’]/g, " ").replace(/\s+/g, " ").trim();
}

function answer(text: string, confidence: "high" | "medium" = "high"): ManagerAssistantAnswer {
  return {
    text,
    mode: "deterministic",
    confidence,
    sources: [],
    needsAdmin: false,
    escalationReason: null,
  };
}

function escalate(reason: string): ManagerAssistantAnswer {
  return {
    text: "I don't have enough saved operational information to answer that confidently. You can send this to an admin with the current event and leg context attached.",
    mode: "deterministic",
    confidence: "low",
    sources: [],
    needsAdmin: true,
    escalationReason: reason,
  };
}

export function answerManagerDeterministically(input: {
  question: string;
  context: ManagerAssistantContextBundle;
}): ManagerAssistantAnswer | null {
  const question = normalize(input.question);

  if (/forklift|loader|setup|tear ?down|power|electric|water|stake|ballast/.test(question)) {
    const relevant = input.context.operationalInstructions
      .map((item) => item.summary)
      .filter((summary) => {
        const text = normalize(summary);
        return (
          (question.includes("forklift") && text.includes("forklift")) ||
          (question.includes("loader") && text.includes("loader")) ||
          (question.includes("water") && text.includes("water")) ||
          ((question.includes("power") || question.includes("electric")) && (text.includes("power") || text.includes("electric"))) ||
          ((question.includes("stake") || question.includes("ballast")) && (text.includes("stake") || text.includes("ballast"))) ||
          (question.includes("setup") && text.includes("setup")) ||
          (question.includes("tear down") && text.includes("tear down"))
        );
      });
    if (relevant.length) return answer(relevant.slice(0, 3).join(" "));
    return escalate("The saved operational instructions do not contain the requested setup requirement.");
  }

  if (/meetup|handoff|swap|paintball/.test(question)) {
    const matches = input.context.handoffs
      .map((item) => item.summary)
      .filter((summary) => !question.includes("paintball") || normalize(summary).includes("paintball"));
    if (matches.length) return answer(matches.slice(0, 3).join(" "));
    if (question.includes("paintball")) {
      const eventWithPaintball = input.context.assignedEvents.find((event) =>
        event.resourceNames.some((resource) => normalize(resource).includes("paintball")),
      );
      if (eventWithPaintball) {
        return answer(`${eventWithPaintball.name} has paintball listed, but I don't have a confirmed meetup saved for it.`, "medium");
      }
    }
    return escalate("There is no approved equipment meetup in the saved manager context.");
  }

  if (/acknowledge|acknowledgment|what changed|new instruction/.test(question)) {
    if (input.context.acknowledgments.length) {
      return answer(input.context.acknowledgments.map((item) => item.summary).join(" "));
    }
    return answer("There are no pending acknowledgments in the saved manager context.");
  }

  if (/what.*next|next event|where.*next|schedule/.test(question)) {
    const event = input.context.assignedEvents[0];
    if (!event) return answer("There are no assigned upcoming events in the saved manager context.");
    return answer(
      `${event.name}${event.city || event.region ? ` in ${[event.city, event.region].filter(Boolean).join(", ")}` : ""}${event.startsAt ? ` starts ${event.startsAt}` : ""}.`,
    );
  }

  if (/package|equipment|what.*bringing|what.*taking/.test(question)) {
    const event = input.context.activeEvent ?? input.context.assignedEvents[0];
    if (!event) return escalate("No assigned event is available for an equipment answer.");
    const parts = [
      event.packageNames.length ? `Packages: ${event.packageNames.join(", ")}.` : null,
      event.resourceNames.length ? `Equipment: ${event.resourceNames.join(", ")}.` : null,
    ].filter(Boolean);
    if (parts.length) return answer(parts.join(" "));
    return escalate("The assigned event does not have package or equipment details saved.");
  }

  return escalate("The question is not supported by the deterministic saved operational facts.");
}
