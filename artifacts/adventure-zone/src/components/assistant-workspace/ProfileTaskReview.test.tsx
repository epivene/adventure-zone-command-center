import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileTaskReview } from "./ProfileTaskReview";
const changes = Array.from({ length: 5 }, (_, i) => ({
  actionId: String(i),
  itemId: String(i),
  profileName: `Event ${i}`,
  revision: "r1",
  available: true,
  fields: [{ field: "phone", oldValue: null, newValue: "555-1234" }],
  sources: [],
}));
it("shows concrete profile changes and limits each approval to four", () => {
  render(
    <ProfileTaskReview
      taskId="task"
      changes={changes}
      onApprove={vi.fn()}
      onSkip={vi.fn()}
    />,
  );
  expect(screen.getByText("Event 0")).toBeInTheDocument();
  expect(screen.getAllByText(/555-1234/)).toHaveLength(5);
  const boxes = screen.getAllByRole("checkbox");
  for (const box of boxes.slice(0, 4)) fireEvent.click(box);
  expect(boxes[4]).toBeDisabled();
});
it("drops selections if the reviewed revision changes", () => {
  const props = {
    taskId: "task",
    changes,
    onApprove: vi.fn(),
    onSkip: vi.fn(),
  };
  const view = render(<ProfileTaskReview {...props} />);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  view.rerender(
    <ProfileTaskReview
      {...props}
      changes={[{ ...changes[0], revision: "r2" }]}
    />,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});
