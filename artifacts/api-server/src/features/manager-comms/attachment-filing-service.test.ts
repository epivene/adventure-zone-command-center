import { describe, expect, it, vi } from "vitest";
import { fileMessageAttachment } from "./attachment-filing-service";

function stores() {
  const source = {
    getAttachment: vi.fn(async () => ({
      id: "att-1", conversationId: "conv-1", messageId: "msg-1", uploaderKind: "manager", uploaderLegId: "leg-a",
      uploaderName: "Kristy", fileName: "fuel.jpg", mimeType: "image/jpeg", objectKey: "manager-messages/conv-1/att-1", uploadStatus: "uploaded",
    })),
  };
  const filing = {
    findByMutation: vi.fn(async () => null),
    create: vi.fn(async (input:any) => ({ id: "filing-1", ...input })),
  };
  const destinations = {
    fileExpenseReceipt: vi.fn(async (input:any) => ({ destinationType: "expense_receipt", destinationId: input.receiptId, objectKey: input.objectKey })),
    fileIncidentPhoto: vi.fn(async (input:any) => ({ destinationType: "incident_photo", destinationId: input.attachmentId, objectKey: input.objectKey })),
    fileReference: vi.fn(async (input:any) => ({ destinationType: input.destination, destinationId: input.destinationId, objectKey: input.objectKey })),
  };
  const notifications = { create: vi.fn(async (input:any) => input) };
  return { source, filing, destinations, notifications };
}

describe("fileMessageAttachment", () => {
  it("reuses the original private object for an expense receipt and keeps provenance", async () => {
    const s = stores();
    const result = await fileMessageAttachment(s as any, {
      attachmentId: "att-1",
      destination: "expense_receipt",
      destinationMetadata: { legId: "leg-a", expenseId: "expense-1", receiptId: "receipt-1" },
      adminActor: "Admin",
      clientMutationId: "00000000-0000-4000-8000-000000000801",
    });
    expect(s.destinations.fileExpenseReceipt).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "manager-messages/conv-1/att-1", receiptId: "receipt-1", sourceAttachmentId: "att-1",
    }));
    expect(s.filing.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceConversationId: "conv-1", sourceMessageId: "msg-1", sourceAttachmentId: "att-1", senderLegId: "leg-a",
      destination: "expense_receipt", destinationId: "receipt-1", objectKey: "manager-messages/conv-1/att-1",
    }));
    expect(result.objectKey).toBe("manager-messages/conv-1/att-1");
    expect(s.source.getAttachment).toHaveBeenCalledTimes(1);
  });

  it("supports incident photos and reference-only handoff/general document filing without copying bytes", async () => {
    for (const destination of ["incident_photo", "equipment_handoff_photo", "general_leg_document"] as const) {
      const s = stores();
      await fileMessageAttachment(s as any, {
        attachmentId: "att-1", destination,
        destinationMetadata: destination === "incident_photo"
          ? { legId: "leg-a", incidentId: "incident-1", attachmentId: "incident-photo-1" }
          : { legId: "leg-a", destinationId: destination === "equipment_handoff_photo" ? "handoff-1" : "leg-a" },
        adminActor: "Admin", clientMutationId: crypto.randomUUID(),
      });
      const adapter = destination === "incident_photo" ? s.destinations.fileIncidentPhoto : s.destinations.fileReference;
      expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ objectKey: "manager-messages/conv-1/att-1" }));
    }
  });

  it("does not create provenance or notify the sender when destination filing fails", async () => {
    const s = stores();
    s.destinations.fileExpenseReceipt.mockRejectedValueOnce(new Error("destination failed"));
    await expect(fileMessageAttachment(s as any, {
      attachmentId: "att-1", destination: "expense_receipt",
      destinationMetadata: { legId: "leg-a", expenseId: "expense-1", receiptId: "receipt-1" },
      adminActor: "Admin", clientMutationId: "00000000-0000-4000-8000-000000000802",
    })).rejects.toThrow("destination failed");
    expect(s.filing.create).not.toHaveBeenCalled();
    expect(s.notifications.create).not.toHaveBeenCalled();
    expect(s.source.getAttachment).toHaveBeenCalledTimes(1);
  });

  it("sends the manager a plain FYI after successful filing and deduplicates retries", async () => {
    const s = stores();
    await fileMessageAttachment(s as any, {
      attachmentId: "att-1", destination: "expense_receipt",
      destinationMetadata: { legId: "leg-a", expenseId: "expense-1", receiptId: "receipt-1", label: "Expenses → Fuel" },
      adminActor: "Admin", clientMutationId: "00000000-0000-4000-8000-000000000803",
    });
    expect(s.notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      legId: "leg-a", kind: "attachment_filed", actionRequired: false, title: "Receipt filed",
    }));

    const existing = { id: "filing-existing", objectKey: "manager-messages/conv-1/att-1" };
    s.filing.findByMutation.mockResolvedValueOnce(existing);
    const retry = await fileMessageAttachment(s as any, {
      attachmentId: "att-1", destination: "expense_receipt",
      destinationMetadata: { legId: "leg-a", expenseId: "expense-1", receiptId: "receipt-1" },
      adminActor: "Admin", clientMutationId: "00000000-0000-4000-8000-000000000803",
    });
    expect(retry).toBe(existing);
    expect(s.destinations.fileExpenseReceipt).toHaveBeenCalledTimes(1);
  });
});
