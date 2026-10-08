import { forwardRef, type ComponentProps } from "react";

// Keep the extracted component's link markup without navigating out of the preview.
export const Link = forwardRef<HTMLAnchorElement, ComponentProps<"a">>((props, ref) =>
  <a {...props} ref={ref} onClick={event => { props.onClick?.(event); event.preventDefault(); }} />
);
Link.displayName = "PreviewLink";
