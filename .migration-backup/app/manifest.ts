import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Adventure Zone Command Center",
    short_name: "AZ Command",
    description: "Private booking and route-planning tools.",
    start_url: "/today",
    display: "standalone",
    background_color: "#F4F7FB",
    theme_color: "#20345B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
