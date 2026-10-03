The draft homepage loads `public/assets/bounce-house-ride-3d-20261003.js` as a classic script. It exports `AzBounceRide3D.createBounceRide3D` and draws one fictional inflatable scene with a continuous camera spline. No route or customer information appears in this scene.

Source: `bounce-house-ride-3d-20261003.js`. Bundle with Three.js 0.180.0 and esbuild 0.25.10, using `--bundle --minify --format=iife --global-name=AzBounceRide3D`. Install those dependencies beside the source or supply that node_modules directory through NODE_PATH. Output to the public asset path above. Keep Three.js's bundled license notice.

The camera ride lasts 7.4 seconds; the homepage reveal overlaps its last 1.15 seconds. Skip, Escape, and reduced-motion preferences bypass the ride. If WebGL fails, Enter still opens the homepage. The scene has no idle animation and cancels its frame callback when dismissed; the renderer and geometry are disposed when the Wix custom element disconnects.
