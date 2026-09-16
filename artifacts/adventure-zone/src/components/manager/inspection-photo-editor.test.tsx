import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemoryManagerMutationStore } from "@/lib/manager-sync-queue";
import { MemoryManagerBlobStore } from "@/lib/manager-blob-queue";
import { InspectionPhotoEditorContent } from "./inspection-photo-editor";

describe("InspectionPhotoEditorContent", () => {
  it("queues photo metadata and the original image while offline", async () => {
    const user = userEvent.setup();
    const mutationStore = new MemoryManagerMutationStore();
    const blobStore = new MemoryManagerBlobStore();
    const onSaved = vi.fn();
    render(
      <InspectionPhotoEditorContent
        blobStore={blobStore}
        entryId="20000000-0000-4000-8000-000000000001"
        inspectionId="10000000-0000-4000-8000-000000000001"
        legId="30000000-0000-4000-8000-000000000001"
        managerApi={vi.fn()}
        mutationStore={mutationStore}
        onSaved={onSaved}
      />,
    );
    const file = new File([new Uint8Array([1, 2, 3])], "seam.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Choose inspection photo from gallery"), file);
    await user.type(screen.getByLabelText("Photo description"), "Circle shows the worn seam");
    await user.click(screen.getByRole("button", { name: "Save photo" }));

    const [mutation] = await mutationStore.list();
    const [blob] = await blobStore.list();
    expect(mutation).toMatchObject({
      method: "POST",
      path: "/manager/year-end-inspections/10000000-0000-4000-8000-000000000001/photos",
      body: expect.objectContaining({
        entryId: "20000000-0000-4000-8000-000000000001",
        description: "Circle shows the worn seam",
      }),
    });
    expect(blob).toMatchObject({
      kind: "year_end_inspection_photo",
      inspectionId: "10000000-0000-4000-8000-000000000001",
      entryId: "20000000-0000-4000-8000-000000000001",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("keeps the description directly associated with the selected photo", async () => {
    const user = userEvent.setup();
    render(
      <InspectionPhotoEditorContent
        blobStore={new MemoryManagerBlobStore()}
        entryId="20000000-0000-4000-8000-000000000001"
        inspectionId="10000000-0000-4000-8000-000000000001"
        legId="30000000-0000-4000-8000-000000000001"
        managerApi={vi.fn()}
        mutationStore={new MemoryManagerMutationStore()}
      />,
    );
    await user.upload(
      screen.getByLabelText("Choose inspection photo from gallery"),
      new File([new Uint8Array([1])], "part.jpg", { type: "image/jpeg" }),
    );
    const description = screen.getByLabelText("Photo description");
    expect(description.compareDocumentPosition(screen.getByRole("button", { name: "Save photo" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers separate camera and gallery inputs without forcing the camera for gallery photos", () => {
    render(
      <InspectionPhotoEditorContent
        blobStore={new MemoryManagerBlobStore()}
        entryId="20000000-0000-4000-8000-000000000001"
        inspectionId="10000000-0000-4000-8000-000000000001"
        legId="30000000-0000-4000-8000-000000000001"
        managerApi={vi.fn()}
        mutationStore={new MemoryManagerMutationStore()}
      />,
    );

    expect(screen.getByLabelText("Take inspection photo")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Choose inspection photo from gallery")).not.toHaveAttribute("capture");
    expect(screen.getByRole("button", { name: "Take Photo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose From Gallery" })).toBeVisible();
  });

  it("draws a circle from a traced loop and previews it before the finger lifts", async () => {
    const user = userEvent.setup();
    render(
      <InspectionPhotoEditorContent
        blobStore={new MemoryManagerBlobStore()}
        entryId="20000000-0000-4000-8000-000000000001"
        inspectionId="10000000-0000-4000-8000-000000000001"
        legId="30000000-0000-4000-8000-000000000001"
        managerApi={vi.fn()}
        mutationStore={new MemoryManagerMutationStore()}
      />,
    );
    await user.upload(
      screen.getByLabelText("Choose inspection photo from gallery"),
      new File([new Uint8Array([1])], "part.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Circle an area" }));

    const canvas = screen.getByLabelText("Photo annotation canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      width: 400,
      height: 200,
      right: 410,
      bottom: 210,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(canvas, { pointerId: 7, clientX: 110, clientY: 70 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 210, clientY: 70 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 210, clientY: 130 });
    expect(screen.getByLabelText("Circle preview")).toBeVisible();
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 110, clientY: 130 });
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 110, clientY: 70 });

    expect(screen.queryByLabelText("Circle preview")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Marked photo area")).toBeVisible();
  });
});
