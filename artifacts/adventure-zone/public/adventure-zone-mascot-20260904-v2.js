(() => {
  const mascotUrl = "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-mascot.png";

  const styles = `
    :host { position: fixed; right: 0; bottom: 0; left: auto; display: block; width: 130px; height: 230px; overflow: visible; pointer-events: none; }
    *, *::before, *::after { box-sizing: border-box; }
    .mascot-shell { display: flex; align-items: flex-end; justify-content: center; width: 100%; height: 100%; overflow: visible; transform: translateY(3px); }
    .tube-man-sway, .tube-man-wobble, .tube-man-image { transform-origin: 50% 100%; will-change: transform; }
    .tube-man-sway { width: 100%; height: 100%; animation: mascot-wave 2.23s ease-in-out infinite; }
    .tube-man-wobble { width: 100%; height: 100%; animation: mascot-wobble 1.37s ease-in-out infinite; }
    .tube-man-image { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center bottom; }
    @keyframes mascot-wave {
      0%, 100% { transform: rotate(-4deg) skewX(-2deg) translateX(0); }
      18% { transform: rotate(5deg) skewX(4deg) translateX(2px); }
      37% { transform: rotate(9deg) skewX(7deg) translateX(4px); }
      55% { transform: rotate(-5deg) skewX(-5deg) translateX(-2px); }
      72% { transform: rotate(-8deg) skewX(-6deg) translateX(-3px); }
      88% { transform: rotate(3deg) skewX(3deg) translateX(1px); }
    }
    @keyframes mascot-wobble {
      0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
      28% { transform: translateY(-4px) scaleX(.965) scaleY(1.045) skewX(1deg); }
      51% { transform: translateY(2px) scaleX(1.035) scaleY(.975) skewX(-2deg); }
      77% { transform: translateY(-3px) scaleX(.98) scaleY(1.035) skewX(2deg); }
    }
    @media (max-width: 767px) { :host { display: none; } }
    @media (prefers-reduced-motion: reduce) {
      .tube-man-sway, .tube-man-wobble { animation: none; }
    }
  `;

  class AdventureZoneMascot extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      this.shadowRoot.innerHTML = `<style>${styles}</style><div class="mascot-shell"><div class="tube-man-sway"><div class="tube-man-wobble"><img class="tube-man-image" src="${mascotUrl}" alt="The Adventure Zone inflatable tube-man mascot"></div></div></div>`;
    }
  }

  if (!customElements.get("adventure-zone-mascot")) {
    customElements.define("adventure-zone-mascot", AdventureZoneMascot);
  }
})();
