(() => {
  "use strict";

  const INQUIRY_API_URL =
    "https://adventure-zone-command-center.onrender.com/api/public/website-inquiries";
  const INQUIRY_TIMEOUT_MS = 12000;

  const IMAGE = Object.freeze({
    logo: "https://static.wixstatic.com/media/0e6e2c_1517bd8d12f94f3194787c7f4f972079~mv2.png",
    hero: "https://static.wixstatic.com/media/0e6e2c_75b98554c5144f7b92b240e09b4ec936~mv2.jpg",
    heroVideo: "https://video.wixstatic.com/video/0e6e2c_6a14af0e46c242a5b8899f03b1b6f38f/1080p/mp4/file.mp4",
    mascot: "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-mascot.png",
    rmaf: "https://adventure-zone-command-center-1.onrender.com/assets/rmaf-logo.png",
    waf: "https://adventure-zone-command-center-1.onrender.com/assets/waf-logo.png",
    adventure: "https://static.wixstatic.com/media/0e6e2c_d18d32eac9704b44a2dc9a1c28f9158b~mv2.jpg",
    pirate: "https://adventure-zone-command-center-1.onrender.com/assets/pirates-rebellion-paddle-boats.jpg",
    warrior: "https://static.wixstatic.com/media/0e6e2c_a25608d697b146ac981ab5b6f074664c~mv2.jpg",
    spectacle01: "https://static.wixstatic.com/media/0e6e2c_2581795bc5464c6aabcb11f1ef326fd6~mv2.jpg",
    spectacle02: "https://static.wixstatic.com/media/0e6e2c_e5c8e9a8fde248a5a4d6be992aa40b6d~mv2.jpg",
    spectacle03: "https://static.wixstatic.com/media/0e6e2c_b043a1e76f0449ada6829f2ad2746a2a~mv2.jpg",
    spectacle04: "https://static.wixstatic.com/media/0e6e2c_a3454f2fd40e42b6935c600f3ad660af~mv2.jpg",
    spectacle05: "https://static.wixstatic.com/media/0e6e2c_df1aa969892145f2ace402d43748fe09~mv2.jpg",
    spectacle06: "https://static.wixstatic.com/media/0e6e2c_925ff0aa7b6b490395c1a29ccf3088f5~mv2.webp",
    spectacle07: "https://static.wixstatic.com/media/0e6e2c_5f5d4ead992f4c96b78b956d49125bee~mv2.webp",
    spectacle08: "https://static.wixstatic.com/media/0e6e2c_f52f77327033491ba1bf4d891b30b815~mv2.jpg",
    spectacle09: "https://static.wixstatic.com/media/0e6e2c_abe97aa8af7d49659a6f4fc9670496fd~mv2.png",
    spectacle10: "https://static.wixstatic.com/media/0e6e2c_b7ac73deca70498ca998c007fcda96b7~mv2.png",
    spectacle11: "https://static.wixstatic.com/media/0e6e2c_30f8504527164df69482d7116b904e39~mv2.png",
    spectacle12: "https://static.wixstatic.com/media/0e6e2c_24c32d54c5234d269b728142992633e9~mv2.jpg",
    galleryFamilyPlay: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-family-play-zone.jpg",
    galleryRules: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-adventure-rules.jpg",
    galleryPurpleObstacle: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-purple-obstacle-course.jpg",
    galleryPirateFlag: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-pirate-flag.jpg",
    galleryRedYellowSlide: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-red-yellow-obstacle-slide.jpg",
    galleryWreckingBall: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-wrecking-ball-obstacle.jpg",
    galleryActionArena: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-action-arena.jpg",
    galleryRainbowSlide: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-rainbow-slide.jpg",
    galleryBungeeRun: "https://adventure-zone-command-center-1.onrender.com/assets/gallery-bungee-run.jpg",
    desiree: "https://static.wixstatic.com/media/0e6e2c_572447e3c82b41de9a3b2c6506085740~mv2.jpg",
    dave: "https://static.wixstatic.com/media/0e6e2c_0dfe30764eb14fbb901bcced2d089f8e~mv2.jpg",
    amy: "https://static.wixstatic.com/media/0e6e2c_8e5ec8576eef4d7eb8866eb3b49f0ee2~mv2.jpg",
    queenLala: "https://static.wixstatic.com/media/0e6e2c_c3f0afdc069b4ec886b5c968cfbf56eb~mv2.png",
    spaz: "https://static.wixstatic.com/media/0e6e2c_8677840383b947b8b69c8965841ac7cd~mv2.jpg",
    hulk: "https://static.wixstatic.com/media/0e6e2c_e55c382346ce4bf09daafc9646cdf6ae~mv2.jpg",
    junior: "https://static.wixstatic.com/media/0e6e2c_7c15e2496dc04e0486c36673344f3bc5~mv2.jpg",
    sheera: "https://static.wixstatic.com/media/0e6e2c_20ef636d06e0480ca7892a834cd375cb~mv2.jpg",
    mikey: "https://static.wixstatic.com/media/0e6e2c_8544608661c54992a9cd5db53bfa23c9~mv2.jpg",
    angelo: "https://static.wixstatic.com/media/0e6e2c_486799f00e654296a69db9fbf340ac16~mv2.png",
    mouth: "https://static.wixstatic.com/media/0e6e2c_d1234865996b4a5497e981a8500d3d00~mv2.jpg",
  });

  const heroSlides = [
    [IMAGE.hero, "Inflatable action attraction with colorful slides and players at an outdoor event"],
    [IMAGE.adventure, "Adventure Zone inflatable attractions"],
    [IMAGE.pirate, "Pirate-themed inflatable water attractions"],
    [IMAGE.warrior, "Warrior's Playground action attraction"],
  ];

  const galleryImages = [
    [IMAGE.spectacle01, "Children playing inside a colorful inflatable attraction"],
    [IMAGE.spectacle02, "Child sliding down a colorful inflatable slide"],
    [IMAGE.spectacle03, "Players competing inside a bright inflatable challenge course"],
    [IMAGE.spectacle04, "Aerial view of large animal-themed inflatable slides"],
    [IMAGE.spectacle05, "Families enjoying colorful inflatable attractions at an event"],
    [IMAGE.spectacle06, "Guests playing on a large inflatable attraction"],
    [IMAGE.spectacle07, "Colorful inflatable slide and event crowd"],
    [IMAGE.spectacle08, "Large inflatable attraction at a community event"],
    [IMAGE.spectacle09, "Adventure Zone attraction in an outdoor setting"],
    [IMAGE.spectacle10, "Guests enjoying a vibrant inflatable attraction"],
    [IMAGE.spectacle11, "Large-scale inflatable entertainment setup"],
    [IMAGE.spectacle12, "Colorful inflatable attractions filling an event space"],
    [IMAGE.hero, "Adventure Zone attractions filling a large outdoor event"],
    [IMAGE.adventure, "Adventure Zone inflatable carnival package"],
    [IMAGE.pirate, "Pirate's Rebellion paddle boats and event display"],
    [IMAGE.warrior, "Warrior's Playground action attraction"],
    [IMAGE.galleryFamilyPlay, "Families enjoying a colorful play zone and inflatable attractions"],
    [IMAGE.galleryRules, "Adventure Zone safety rules display beside the attractions"],
    [IMAGE.galleryPurpleObstacle, "Child playing on a purple inflatable obstacle course"],
    [IMAGE.galleryPirateFlag, "Pirate flag and skeleton decorating the paddle boat attraction"],
    [IMAGE.galleryRedYellowSlide, "Red and yellow inflatable obstacle slide"],
    [IMAGE.galleryWreckingBall, "Guests navigating the inflatable wrecking ball obstacle course"],
    [IMAGE.galleryActionArena, "Players competing in the colorful action arena"],
    [IMAGE.galleryRainbowSlide, "Child sliding down a rainbow-themed inflatable"],
    [IMAGE.galleryBungeeRun, "Guests playing inside the red and yellow bungee run"],
  ];

  const teamMembers = [
    ["Dave", "Big Boss Team Lead", IMAGE.dave, "Dave and Tonya from The Adventure Zone", "left: clamp(22px, 3vw, 36px); right: auto; top: 2%;"],
    ["Amy", "Office Manager & Booking Agent", IMAGE.amy, "Amy from The Adventure Zone", "left: auto; right: clamp(34px, 5vw, 64px); top: 11%;"],
    ["Mr. Nine & Lady Love", "Cotton Candy Team Leaders", IMAGE.queenLala, "Mr. Nine and Lady Love from The Adventure Zone", "left: clamp(32px, 5vw, 58px); right: auto; top: 19%;"],
    ["Spaz", "Team Leader", IMAGE.spaz, "Spaz from The Adventure Zone", "left: auto; right: clamp(22px, 4vw, 48px); top: 27.7%;"],
    ["Hulk", "Team Leader", IMAGE.hulk, "Hulk from The Adventure Zone", "left: clamp(44px, 6vw, 72px); right: auto; top: 36%;"],
    ["Junior", "Team Leader", IMAGE.junior, "Junior from The Adventure Zone", "left: auto; right: clamp(42px, 7vw, 86px); top: 44.5%;"],
    ["Sheera", "Team Leader", IMAGE.sheera, "Sheera from The Adventure Zone", "left: clamp(26px, 4vw, 48px); right: auto; top: 53%;"],
    ["Mikey", "Team Leader", IMAGE.mikey, "Mikey from The Adventure Zone", "left: auto; right: clamp(28px, 5vw, 58px); top: 61.5%;"],
    ["Angelo", "Team Leader", IMAGE.angelo, "Angelo from The Adventure Zone", "left: clamp(38px, 7vw, 82px); right: auto; top: 70%;"],
    ["Mouth", "Team Leader", IMAGE.mouth, "Mouth from The Adventure Zone", "left: auto; right: clamp(36px, 6vw, 72px); top: 78.5%;"],
    ["Desiree", "Marketing & Booking", IMAGE.desiree, "Desiree from The Adventure Zone", "left: clamp(30px, 5vw, 62px); right: auto; top: 87%;"],
  ];

  const teamContentSelector = [
    "h1", "h2", "h3", "h4", "p", "a", "button", "summary", "li", "label",
    "input", "select", "textarea", ".eyebrow", ".marquee-item", ".stat-number", ".stat-label",
    ".member-label", ".fleet-label", ".package-flag", ".ammo", ".price-label", ".price",
    ".price-days", ".step-number", ".faq-answer", ".attraction-chip-list span",
  ].join(",");
  const teamTextClearance = 48;
  const teamSearchStep = 16;

  const adventureAttractionCategories = [
    ["Bounce Houses & Combos", "Perfect for smaller kids, with jump-and-slide combos that keep the fun moving.", ["Princess Palace", "Castle Fortress", "SpongeBob Ahoy", "Under the Sea Grotto"]],
    ["Slides", "Fun-size 10 ft, Super-size 18 ft, and Awesome-size 24 ft+ slides.", ["Blue Wave", "Island Tropics", "Athletes & Sports", "Polar Bear", "Jungle Tiger", "Mountain Top", "Dual & Single Lane", "1/2 Pipe", "Take Me Out to the Ball Game", "Screamer"]],
    ["Intense Interactives", "Exhilarating to play and compelling to watch.", ["Boulder Dash", "Jousting Arena", "Gladiator Pit", "The Gauntlet"]],
    ["Obstacle Courses", "Challenge yourself, your friends, or a whole group.", ["Adrenaline Rush", "Super Obstacle Course", "Everest", "Radical Run", "Boot Camp Challenge", "Jungle Trek Xtreme"]],
    ["Pure Adrenaline", "Race, jump, duck, and hang on.", ["Bungee Run", "Eliminator", "Wrecking Ball"]],
    ["Carnival-Style Games", "At least 3 pay-for-play games, including a guaranteed winner for younger players.", ["Balloon Darts", "Ring Toss", "Basket Toss", "Bean Bag Toss", "Fish Pond", "Mystery Bag"]],
  ];

  const pirateAttractionCategories = [
    ["Interactive · Bumper Boats · 2/2", "Water Pool", "Battleship on a Personal Level", "A great place for your inner pirate to attack opponents on the high seas. Armed with sponges and squirt guns, you must take them down before they take you out.", ["2,500 sq ft Pool", "6 Pedal-Style Bumper Boats", "Hundreds of Sponges"]],
    ["Wet · Single Super Screamer · 2/4", "Super Slide", "Slippery Wet Fun", "Climb to new heights, then slide down. Plan to get wet!", ["Over 25' Tall"]],
    ["Combo · Pirate 1 + Pirate 2 · 2/2", "Bouncy Combo", "Pirate Themed Bouncers with Slide", "Fun for every age: climb in to bounce and splash, then slide out and start again.", ["Bounce House with Attached Slide"]],
  ];

  const warriorAttractionCategories = [
    ["", "Obstacle Courses", "Challenge Yourself & Your Friends", "Challenge yourself, your friend, or a group of friends. Everyone wins, but you can come in first!", ["Adrenaline Rush", "Super Obstacle Course", "Everest", "Radical Run", "Boot Camp Challenge", "Jungle Trek Xtreme"]],
    ["Adrenaline · Eliminator · 2/20", "Pure Adrenaline", "You're in Control", "Tantalizing fun as you race, jump, duck, and get knocked off your feet!", ["Bungee Run", "Eliminator", "Wrecking Ball"]],
    ["Games · Ring Toss · 2/10", "Carnival-Style Games", "Exciting Games for Great Prizes", "We bring at least 3 carnival-style games operated on a pay-for-play basis. Keep playing to win even bigger prizes. Our games are geared toward younger children, with one game that guarantees every player is a winner!", ["Balloon Darts", "Ring Toss", "Basket Toss", "Bean Bag Toss", "Fish Pond", "Mystery Bag"]],
  ];

  const faqItems = [
    ["Are you a drop-off inflatable rental company?", "No. The Adventure Zone is a staffed event company. Our packages are priced for the event and dates, and our team operates the attractions instead of simply delivering individual inflatables."],
    ["How much space should we plan for?", "Plan for an area about 100 feet by 100 feet—roughly 10,000 square feet—for the Adventure Zone package. It can sometimes fit in approximately 7,000 square feet. Pirate's Rebellion prefers about 7,000 square feet and can sometimes fit in approximately 5,000. Warrior's Playground prefers about 15,000 square feet and can sometimes fit in approximately 12,000. The booking team will confirm the final footprint for your event."],
    ["What electrical access is needed?", "Adventure Zone needs either three 50-amp/220-volt outlets, eighteen 110-volt outlets, or a 50 KW generator within 75 feet of the area. Pirate's Rebellion needs either one 50-amp/220-volt outlet, six 15-amp/110-volt outlets, or a 50 KW generator. Warrior's Playground needs either two 50-amp/220-volt outlets, twelve 15-amp/110-volt outlets, or a 25 KW generator. For Idaho events, an electrician may also hardwire the required breakers with approval."],
    ["Do the water attractions need a water hookup?", "Water is optional for Adventure Zone, but a faucet or hose within 75 feet is needed for wet attractions. Pirate's Rebellion uses a pool and needs water to fill and refresh it, with a closer dedicated supply helping the setup move faster. Warrior's Playground does not need water for the rides, but a faucet or hose within 75 feet is preferred for daily cleaning."],
    ["How early do you set up and when do you tear down?", "The team needs permission to set up two days before the event and one day after the event for tear-down. The event holder provides a forklift or loader for loading the equipment back onto the trailer. If one is not available, the current FAQ lists a $500 equipment-rental fee."],
    ["How are the attractions secured?", "The team provides the standard 3-foot stakes where the ground allows them. When stakes are not possible, the event organizer must provide approved alternatives such as heavy cement barricades or water barrels. The booking team will confirm the quantity and method for the selected unit and venue."],
    ["Who can participate?", "The commercial-grade attractions are designed for a wide range of ages, including adults. Bounce houses and jump-and-slide combos are generally aimed at ages 2–12, while obstacle courses and action attractions tend to appeal to older children, teens, and adults. Giant slides and water games can work across age groups."],
    ["Can we choose individual rides a la carte?", "Packages are planned as complete units rather than individual ride rentals. That keeps the traveling inventory and logistics workable across the western states. Submit the form with your event details and the team can recommend the best unit."],
    ["What is included in each package?", "Adventure Zone includes 10 attractions. Pirate's Rebellion is the water-and-pirate package. Warrior's Playground includes the Action Pursuit Gaming Arena with Paintball, AirSoft, or Orbeez, four additional attractions, and carnival games. The package cards above show the current pricing and core identities."],
    ["What does pricing look like?", "For 1–4 days, Adventure Zone is $9,000 and Pirate's Rebellion or Warrior's Playground is $7,500. Longer events are available at higher rates; contact our booking team for extended-event pricing. Final booking details depend on the event, site, dates, and selected package."],
    ["Is a contract required?", "Yes. The current booking policy requires a signed contract for each engagement, including returning customers."],
    ["What if our question is not listed?", "Use the inquiry form below and include your event date, location, and questions. The booking team can confirm the site-specific requirements before anything is finalized."],
  ];

  const iconPaths = {
    star: '<path d="m12 2 2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.2 6.1 20.3l1.2-6.6-4.8-4.7 6.6-.9L12 2Z"/>',
    anchor: '<path d="M12 6V2m0 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v16m-5-4a7 7 0 0 0 10 0M5 10H2m20 0h-3M4 10a8 8 0 0 0 16 0"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.4 8.9-8 10-4.6-1.1-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    zap: '<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="1"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    ticket: '<path d="M4 5h16v4a2 2 0 0 0 0 6v4H4v-4a2 2 0 0 0 0-6V5Z"/><path d="M12 8v8"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    hardhat: '<path d="M3 18h18M5 18v-2a7 7 0 0 1 14 0v2M8 11V8a4 4 0 0 1 8 0v3M12 4v4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>',
  };

  function icon(name, className = "") {
    return `<svg class="az-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ""}</svg>`;
  }

  const styles = `
    :host {
      --az-cream: #f8f6f1;
      --az-navy: #0f1729;
      --az-yellow: #ffcc00;
      --az-pink: #ff0a95;
      --az-white: #ffffff;
      --az-muted: #525e7a;
      --az-soft: #ebe8e0;
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
      color: var(--az-navy);
      background: var(--az-cream);
      font-family: "Plus Jakarta Sans", "Avenir Next", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    *, *::before, *::after { box-sizing: border-box; }
    .az-site { position: relative; width: 100%; overflow: hidden; background: var(--az-cream); }
    .az-icon { display: inline-block; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; }
    .display { font-family: "Bricolage Grotesque", Impact, "Arial Black", sans-serif; letter-spacing: -.045em; }
    .uppercase { text-transform: uppercase; }
    .container { width: min(1400px, calc(100% - 32px)); margin: 0 auto; }
    .shadow { box-shadow: 8px 8px 0 var(--az-navy); }
    .shadow-white { box-shadow: 8px 8px 0 var(--az-white); }
    .border { border: 4px solid var(--az-navy); }
    a { color: inherit; }
    a, button { -webkit-tap-highlight-color: transparent; }
    button, input, select, textarea { font: inherit; }
    button, a { cursor: pointer; }
    a { text-decoration: none; }
    :focus-visible { outline: 4px solid var(--az-pink); outline-offset: 3px; }

    .site-header {
      position: fixed; inset: 0 0 auto; z-index: 50;
      border-bottom: 4px solid var(--az-navy);
      background: var(--az-cream);
      transition: padding .2s ease, background .2s ease, backdrop-filter .2s ease;
      padding: 12px 0 20px;
    }
    .site-header.scrolled { padding: 8px 0 12px; background: rgba(248,246,241,.95); backdrop-filter: blur(10px); }
    .header-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .logo-link { display: flex; align-items: center; }
    .logo { display: block; width: 160px; height: auto; max-height: 56px; object-fit: contain; transition: transform .3s ease; }
    .logo-link:hover .logo { transform: scale(1.03); }
    .desktop-nav { display: none; align-items: center; gap: 32px; font-size: 14px; font-weight: 800; letter-spacing: .04em; }
    .desktop-nav a { transition: color .2s ease, transform .2s ease; }
    .desktop-nav a:hover { color: var(--az-pink); transform: translateY(-2px); }
    .desktop-book { display: none; }
    .button {
      display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      border: 4px solid var(--az-navy); padding: 14px 24px;
      background: var(--az-yellow); color: var(--az-navy);
      font-weight: 900; letter-spacing: .14em; font-size: 14px;
      text-transform: uppercase; box-shadow: 8px 8px 0 var(--az-navy);
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease, color .2s ease;
    }
    .button:hover { transform: translate(2px, 2px); box-shadow: 6px 6px 0 var(--az-navy); }
    .button:active { transform: translate(8px, 8px); box-shadow: 0 0 transparent; }
    .menu-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border: 4px solid var(--az-navy);
      background: var(--az-yellow); color: var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy);
    }
    .mobile-nav {
      position: absolute; top: 100%; left: 0; right: 0;
      display: none; flex-direction: column; background: var(--az-cream);
      border-bottom: 4px solid var(--az-navy); box-shadow: 0 16px 28px rgba(15,23,41,.18);
    }
    .mobile-nav.open { display: flex; }
    .mobile-nav a {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; padding: 18px 24px; border-bottom: 2px solid rgba(15,23,41,.1);
      font-size: 18px; font-weight: 900; letter-spacing: .12em;
    }
    .mobile-nav a:last-child { border-top: 4px solid var(--az-navy); border-bottom: 0; background: var(--az-yellow); }
    .mobile-nav a:hover { background: var(--az-yellow); }

    .team-float { display: block; pointer-events: none; position: absolute; top: 760px; right: 0; bottom: 760px; left: 0; z-index: 35; }
    .team-bubble { position: absolute; width: 32px; opacity: 0; transform: scale(0); transition: opacity .7s cubic-bezier(.34,1.56,.64,1), transform .7s cubic-bezier(.34,1.56,.64,1); }
    .team-bubble.visible { opacity: .9; transform: scale(1); }
    .team-bubble-inner { position: relative; animation: bubble-float 3.8s ease-in-out infinite; }
    .team-photo { width: 32px; height: 32px; object-fit: cover; border: 3px solid rgba(255,255,255,.8); border-radius: 50%; opacity: .8; filter: saturate(.85); background: rgba(255,255,255,.2); box-shadow: 0 10px 32px rgba(13,20,42,.28); outline: 2px solid rgba(15,23,41,.7); }
    .team-label { position: absolute; left: 50%; bottom: -16px; display: block; width: 72px; transform: translateX(-50%); padding: 3px 4px; text-align: center; color: var(--az-navy); background: rgba(248,246,241,.75); border: 2px solid rgba(255,255,255,.8); border-radius: 16px; outline: 2px solid rgba(15,23,41,.7); box-shadow: 0 8px 24px rgba(15,23,41,.22); backdrop-filter: blur(10px); }
    .team-name { display: block; font-family: "Bricolage Grotesque", Impact, sans-serif; font-size: 7px; font-weight: 900; line-height: 1; text-transform: uppercase; }
    .team-role { display: block; margin-top: 2px; font-size: 5px; font-weight: 900; line-height: 1.1; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }

    .tube-man-position { position: fixed; right: 6px; bottom: -12px; z-index: 50; width: 82px; pointer-events: none; }
    .tube-man-sway, .tube-man-wobble, .tube-man-image { transform-origin: 50% 100%; will-change: transform; }
    .tube-man-sway { animation: tube-man-wave 2.23s ease-in-out infinite; }
    .tube-man-wobble { animation: tube-man-wobble 1.37s ease-in-out infinite; }
    .tube-man-image { display: block; width: 100%; height: auto; }

    .hero {
      position: relative; display: flex; align-items: center; min-height: clamp(700px, 92vw, 900px);
      padding: 80px 16px 48px; overflow: hidden; color: var(--az-cream);
      background: var(--az-navy); border-bottom: 8px solid var(--az-navy);
    }
    .hero-backdrop, .hero-overlay, .hero-grid { position: absolute; inset: 0; }
    .hero-backdrop { z-index: 0; }
    .hero-video, .hero-slide { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
    .hero-video { opacity: .6; mix-blend-mode: luminosity; }
    .hero-slide { opacity: 0; mix-blend-mode: luminosity; transform: scale(1.05); transition: opacity 1.4s ease-in-out; }
    .hero-slide.active { opacity: .6; }
    .hero-overlay { z-index: 1; background: linear-gradient(to top, var(--az-navy), rgba(15,23,41,.5), transparent); }
    .hero-grid { z-index: 1; opacity: .3; background-size: 40px 40px; background-image: linear-gradient(to right, rgba(255,255,255,.08) 2px, transparent 2px), linear-gradient(to bottom, rgba(255,255,255,.08) 2px, transparent 2px); }
    .hero-content { position: relative; z-index: 2; width: min(1400px, 100%); margin: 0 auto; display: flex; flex-direction: column; align-items: center; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px; margin-bottom: 24px; padding: 6px 12px;
      color: var(--az-white); background: var(--az-pink); border: 4px solid var(--az-navy);
      box-shadow: 8px 8px 0 var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .12em;
      transform: rotate(-2deg); text-transform: uppercase; animation: soft-bounce 3.8s ease-in-out infinite;
    }
    .eyebrow .az-icon { width: 16px; height: 16px; fill: currentColor; }
    .hero h1 { margin: 0 0 16px; width: 100%; color: var(--az-cream); font-size: clamp(3.2rem, 14vw, 5rem); line-height: .85; text-align: center; text-transform: uppercase; filter: drop-shadow(0 12px 18px rgba(0,0,0,.35)); }
    .hero h1 .yellow { position: relative; display: block; margin-top: 4px; color: var(--az-yellow); }
    .hero h1 .yellow::after { display: none; content: ""; position: absolute; left: 0; right: 0; bottom: -16px; height: 8px; border-radius: 50%; border-bottom: 8px solid var(--az-pink); }
    .hero-copy { max-width: 760px; margin: 0 0 32px; color: rgba(248,246,241,.95); font-size: 18px; font-weight: 800; line-height: 1.35; text-align: center; }
    .hero-actions { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
    .hero-actions .button { width: 100%; }
    .button.outline { color: var(--az-white); background: transparent; border-color: var(--az-white); box-shadow: 8px 8px 0 rgba(255,255,255,.9); }
    .button.outline:hover { color: var(--az-navy); background: var(--az-white); box-shadow: 6px 6px 0 rgba(255,255,255,.9); }

    .marquee { position: relative; z-index: 3; display: flex; align-items: center; overflow: hidden; padding: 16px 0; color: var(--az-white); background: var(--az-pink); border-bottom: 4px solid var(--az-navy); }
    .marquee-track { display: flex; flex-shrink: 0; min-width: 100%; animation: marquee 25s linear infinite; }
    .marquee-item { display: flex; align-items: center; gap: 16px; margin: 0 32px; white-space: nowrap; font-size: 18px; font-weight: 900; letter-spacing: .15em; text-transform: uppercase; }
    .marquee-dot { color: rgba(15,23,41,.3); }

    .section { padding: 64px 16px; border-bottom: 8px solid var(--az-navy); }
    .about { background: var(--az-cream); }
    .about-layout, .experience-layout { display: grid; gap: 40px; align-items: center; }
    .tag { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 24px; padding: 8px 16px; color: var(--az-white); background: var(--az-pink); font-size: 14px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    .tag .az-icon { width: 16px; height: 16px; fill: currentColor; }
    .section h2 { margin: 0 0 24px; font-size: clamp(2.5rem, 10vw, 4.5rem); line-height: .92; text-transform: uppercase; }
    .section h2 .pink { color: var(--az-pink); }
    .body-large { color: var(--az-muted); font-size: 19px; font-weight: 800; line-height: 1.42; }
    .body-large p { margin: 0 0 16px; }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
    .stat-card { min-height: 132px; padding: 16px; border: 4px solid var(--az-navy); background: var(--az-white); }
    .stat-card.yellow { background: var(--az-yellow); }
    .stat-card.navy { color: var(--az-white); background: var(--az-navy); box-shadow: 8px 8px 0 var(--az-white); }
    .stat-number { font-size: 40px; line-height: 1; }
    .stat-label { margin-top: 8px; font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .stat-card .az-icon { width: 34px; height: 34px; margin-bottom: 12px; color: var(--az-pink); }
    .about-bottom { display: flex; flex-direction: column; gap: 20px; margin-top: 32px; padding-top: 24px; border-top: 4px solid var(--az-navy); }
    .about-bottom p { max-width: 760px; margin: 0; color: var(--az-muted); font-size: 16px; font-weight: 800; }
    .member-badge { align-self: flex-start; min-width: 248px; padding: 12px; color: var(--az-navy); background: var(--az-white); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .member-logos { display: flex; align-items: center; justify-content: center; gap: 12px; }
    .member-logo.rmaf { width: 144px; height: 78px; object-fit: contain; }
    .member-logo.waf { width: 80px; height: 80px; object-fit: contain; }
    .member-label { margin-top: 8px; color: var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-align: center; text-transform: uppercase; }

    .experience { background-size: 40px 40px; background-image: linear-gradient(to right, rgba(15,23,41,.08) 2px, transparent 2px), linear-gradient(to bottom, rgba(15,23,41,.08) 2px, transparent 2px); }
    .scale-wrap { position: relative; }
    .scale-wrap::before { display: none; content: ""; position: absolute; inset: -16px; background: var(--az-yellow); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); transform: rotate(-1deg); }
    .scale-card { position: relative; z-index: 1; padding: 24px; color: var(--az-white); background: var(--az-navy); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .scale-card .az-icon { width: 48px; height: 48px; margin-bottom: 24px; color: var(--az-yellow); fill: currentColor; }
    .scale-card h2 { margin-bottom: 20px; }
    .scale-card p { margin: 0; color: rgba(255,255,255,.8); font-size: 19px; font-weight: 500; }
    .experience-copy h3 { margin: 0 0 24px; font-size: clamp(2rem, 7vw, 3.2rem); line-height: .95; text-transform: uppercase; }
    .experience-copy > p { margin: 0 0 32px; color: var(--az-muted); font-size: 16px; font-weight: 600; }
    .feature-grid { display: grid; gap: 24px; }
    .feature { display: flex; gap: 16px; }
    .feature-icon { display: flex; align-items: center; justify-content: center; flex: 0 0 48px; width: 48px; height: 48px; border: 4px solid var(--az-navy); border-radius: 50%; }
    .feature-icon.pink { color: var(--az-white); background: var(--az-pink); }
    .feature-icon.yellow { background: var(--az-yellow); }
    .feature h4 { margin: 0 0 8px; font-size: 20px; line-height: 1; text-transform: uppercase; }
    .feature p { margin: 0; color: var(--az-muted); font-size: 15px; font-weight: 600; }

    .packages { position: relative; color: var(--az-white); background: var(--az-navy); }
    .packages::before { position: absolute; inset: 0; content: ""; pointer-events: none; opacity: .2; background-size: 24px 24px; background-image: radial-gradient(rgba(255,255,255,.35) 2px, transparent 2px); }
    .packages > .container { position: relative; z-index: 1; }
    .fleet-label { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 20px; color: var(--az-yellow); font-weight: 900; letter-spacing: .2em; text-transform: uppercase; }
    .fleet-label::before, .fleet-label::after { width: 32px; height: 4px; content: ""; background: var(--az-yellow); }
    .packages-intro { max-width: 760px; margin: 0 auto 48px; color: rgba(255,255,255,.7); font-size: 19px; font-weight: 600; text-align: center; }
    .package-grid { display: grid; align-items: start; gap: 40px; }
    .package-card { position: relative; display: flex; flex-direction: column; color: var(--az-navy); background: var(--az-cream); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-white); transition: transform .24s cubic-bezier(.22,1,.36,1), box-shadow .24s ease; }
    .package-card:hover { transform: translateY(-8px) rotate(-.6deg); box-shadow: 10px 12px 0 var(--az-white); }
    .package-card:nth-child(2):hover { transform: translateY(-8px) rotate(.6deg); }
    .package-card:nth-child(3):hover { transform: translateY(-8px) rotate(-.4deg); }
    .package-flag { position: absolute; top: -24px; left: 50%; z-index: 2; transform: translateX(-50%); padding: 8px 24px; color: var(--az-navy); background: var(--az-yellow); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .12em; white-space: nowrap; text-transform: uppercase; }
    .package-image { width: 100%; height: 224px; overflow: hidden; border-bottom: 4px solid var(--az-navy); background: var(--az-navy); }
    .package-image img { width: 100%; height: 100%; object-fit: cover; opacity: .9; transition: transform .7s ease, opacity .7s ease; }
    .package-card:hover .package-image img { opacity: 1; transform: scale(1.1) rotate(-1deg); }
    .package-card:nth-child(2):hover .package-image img { transform: scale(1.1) rotate(1deg); }
    .package-content { display: flex; flex: 1; flex-direction: column; padding: 24px; }
    .package-title { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .package-title .az-icon { width: 32px; height: 32px; color: var(--az-pink); }
    .package-title:first-child .az-icon { color: var(--az-yellow); fill: currentColor; }
    .package-title h3 { margin: 0; font-size: 31px; line-height: .95; text-transform: uppercase; }
    .package-copy { flex: 1; margin: 0 0 28px; color: var(--az-muted); font-size: 16px; font-weight: 800; }
    .package-features { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; font-size: 16px; font-weight: 800; }
    .package-features li { display: flex; align-items: flex-start; gap: 12px; }
    .package-features .az-icon { width: 22px; height: 22px; flex: 0 0 22px; color: var(--az-pink); }
    .package-title-copy { min-width: 0; }
    .package-title-copy p { margin: 4px 0 0; color: var(--az-muted); font-size: 13px; font-weight: 800; line-height: 1.2; }
    .attraction-lineup { position: relative; margin-top: 24px; border-top: 2px solid rgba(15,23,41,.2); }
    .package-card:has(.attraction-lineup[open]), .attraction-lineup[open] { z-index: 60; }
    .attraction-lineup summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 12px 0; color: var(--az-pink); cursor: pointer; font-size: 13px; font-weight: 900; letter-spacing: .12em; list-style: none; text-transform: uppercase; }
    .attraction-lineup summary::-webkit-details-marker { display: none; }
    .attraction-lineup summary::after { content: "+"; color: var(--az-navy); font-size: 20px; line-height: 1; }
    .attraction-lineup[open] summary::after { content: "−"; }
    .attraction-lineup-content {
      position: absolute; top: 100%; right: -12px; left: -12px; z-index: 70;
      max-height: min(62vh, 520px); overflow-y: auto; overscroll-behavior: contain;
      padding: 16px; background: var(--az-cream); border: 4px solid var(--az-navy);
      box-shadow: 8px 8px 0 var(--az-navy);
    }
    .attraction-lineup-intro { margin: 0 0 16px; color: var(--az-muted); font-size: 13px; font-weight: 800; }
    .attraction-lineup-grid { display: grid; gap: 16px; }
    .attraction-lineup-category { padding-top: 12px; border-top: 2px solid rgba(15,23,41,.12); }
    .attraction-lineup-category h4 { margin: 0 0 6px; font-size: 16px; line-height: 1; text-transform: uppercase; }
    .attraction-lineup-kicker { margin-bottom: 7px; color: var(--az-pink); font-size: 10px; font-weight: 900; letter-spacing: .1em; line-height: 1.2; text-transform: uppercase; }
    .attraction-lineup-category > p { margin: 0 0 10px; color: var(--az-muted); font-size: 12px; font-weight: 700; line-height: 1.35; }
    .attraction-lineup-category > .attraction-lineup-detail { margin-bottom: 12px; color: var(--az-muted); font-size: 11px; font-weight: 600; line-height: 1.4; }
    .attraction-chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .attraction-chip-list span { padding: 4px 7px; color: var(--az-navy); background: rgba(15,23,41,.08); font-size: 11px; font-weight: 800; line-height: 1.2; }
    .ammo { display: inline-block; margin-top: 20px; padding: 4px 12px; color: var(--az-pink); background: rgba(255,10,149,.1); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .package-price { margin: 24px -24px -24px; padding: 24px; border-top: 4px dashed var(--az-navy); background-size: 40px 40px; background-image: linear-gradient(to right, rgba(15,23,41,.08) 2px, transparent 2px), linear-gradient(to bottom, rgba(15,23,41,.08) 2px, transparent 2px); }
    .price-label { margin-bottom: 8px; color: var(--az-pink); font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    .price { margin-bottom: 4px; font-size: 48px; line-height: .95; }
    .price-days { color: var(--az-muted); font-size: 14px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .extended-rate { display: inline-block; margin-top: 12px; padding: 7px 10px; color: var(--az-navy); background: var(--az-yellow); border: 2px solid var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .06em; line-height: 1.2; text-transform: uppercase; }

    .how { background: var(--az-yellow); }
    .how-layout { display: grid; gap: 40px; }
    .how-copy p { margin: 0 0 32px; font-size: 19px; font-weight: 800; }
    .how-copy .button { background: var(--az-cream); }
    .step-grid { display: grid; gap: 24px; }
    .step-card { padding: 24px; background: var(--az-cream); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); transition: transform .24s ease, box-shadow .24s ease; }
    .step-card:hover { transform: translateY(-6px) rotate(-.35deg); box-shadow: 10px 12px 0 var(--az-navy); }
    .step-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
    .step-top .az-icon { width: 40px; height: 40px; color: var(--az-pink); }
    .step-number { color: rgba(15,23,41,.2); font-size: 40px; line-height: 1; }
    .step-card h4 { margin: 0 0 12px; font-size: 27px; line-height: 1; text-transform: uppercase; }
    .step-card p { margin: 0; color: var(--az-muted); font-size: 15px; font-weight: 800; }

    .safety { background: var(--az-cream); text-align: center; }
    .safety > .container > .az-icon { width: 56px; height: 56px; margin-bottom: 24px; color: var(--az-pink); }
    .safety-copy { max-width: 760px; margin: 0 auto; color: var(--az-muted); font-size: 19px; font-weight: 800; }
    .safety-copy p { margin: 0 0 20px; }
    .safety-highlight { padding: 2px 8px; color: var(--az-navy); background: rgba(255,204,0,.45); }
    .safety-grid { display: grid; gap: 20px; margin-top: 40px; text-align: left; }
    .safety-card { padding: 20px; background: var(--az-white); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .safety-card .number { margin-bottom: 12px; color: var(--az-pink); font-size: 40px; line-height: 1; }
    .safety-card .az-icon { width: 34px; height: 34px; margin-bottom: 12px; color: var(--az-pink); }
    .safety-card h3 { margin: 0 0 8px; font-size: 19px; line-height: 1.05; text-transform: uppercase; }
    .safety-card p { margin: 0; color: var(--az-muted); font-size: 15px; font-weight: 800; }

    .partnerships { color: var(--az-white); background: var(--az-navy); }
    .partnerships .section-heading { text-align: center; }
    .booking-grid { display: grid; gap: 24px; }
    .booking-card { position: relative; overflow: hidden; padding: 24px; color: var(--az-navy); background: var(--az-cream); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-white); }
    .booking-card.pink { color: var(--az-white); background: var(--az-pink); }
    .booking-card::after { position: absolute; top: -40px; right: -40px; width: 128px; height: 128px; content: ""; border-radius: 50%; background: rgba(255,204,0,.18); filter: blur(18px); }
    .booking-card .az-icon { position: relative; z-index: 1; width: 48px; height: 48px; margin-bottom: 24px; color: var(--az-yellow); }
    .booking-card.pink .az-icon { color: var(--az-white); }
    .booking-card h3 { position: relative; z-index: 1; margin: 0 0 20px; font-size: 32px; line-height: 1; text-transform: uppercase; }
    .booking-card p { position: relative; z-index: 1; margin: 0 0 24px; color: var(--az-muted); font-size: 17px; font-weight: 800; }
    .booking-card.pink p { color: rgba(255,255,255,.9); }
    .booking-list { position: relative; z-index: 1; display: grid; gap: 12px; margin: 0; padding: 20px 0 0; border-top: 4px solid rgba(15,23,41,.1); list-style: none; font-size: 15px; font-weight: 800; }
    .booking-card.pink .booking-list { border-color: rgba(255,255,255,.2); }
    .booking-list li { display: flex; align-items: flex-start; gap: 12px; }
    .booking-list .az-icon { width: 22px; height: 22px; margin: 0; color: var(--az-yellow); }
    .booking-card.pink .booking-list .az-icon { color: var(--az-navy); }
    .fundraising-highlight { position: relative; z-index: 1; display: inline-flex; width: fit-content; margin: -4px 0 20px; padding: 8px 12px; color: var(--az-navy); background: var(--az-yellow); border: 3px solid var(--az-navy); box-shadow: 5px 5px 0 var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .08em; line-height: 1.1; text-transform: uppercase; }

    .gallery { background-size: 40px 40px; background-image: linear-gradient(to right, rgba(15,23,41,.08) 2px, transparent 2px), linear-gradient(to bottom, rgba(15,23,41,.08) 2px, transparent 2px); }
    .gallery-grid { display: grid; gap: 16px; }
    .gallery-frame { position: relative; aspect-ratio: 4 / 5; overflow: hidden; background: var(--az-navy); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .gallery-frame:nth-child(2) { transform: none; }
    .gallery-frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 1; transition: opacity 1s ease; }
    .gallery-frame img.fading { opacity: 0; }
    .gallery-frame::after { position: absolute; inset: 0; content: ""; pointer-events: none; opacity: 0; background: linear-gradient(to top, rgba(15,23,41,.8), transparent 60%); transition: opacity .3s ease; }
    .gallery-frame:hover::after { opacity: 1; }

    .faq { color: var(--az-white); background: var(--az-navy); }
    .faq-heading { text-align: center; }
    .faq-heading .tag { color: var(--az-navy); background: var(--az-yellow); }
    .faq-intro { max-width: 760px; margin: 0 auto 40px; color: rgba(255,255,255,.75); font-size: 19px; font-weight: 800; text-align: center; }
    .faq-list { display: grid; gap: 16px; max-width: 1100px; margin: 0 auto; }
    .faq-item { position: relative; color: var(--az-navy); background: var(--az-cream); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .faq-item[open] { z-index: 60; }
    .faq-item summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; cursor: pointer; list-style: none; font-size: 18px; line-height: 1.15; text-transform: uppercase; }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item summary .plus { flex: 0 0 auto; color: var(--az-pink); font-family: Arial, sans-serif; font-size: 32px; line-height: 1; transition: transform .2s ease; }
    .faq-item[open] summary .plus { transform: rotate(45deg); }
    .faq-answer {
      position: absolute; top: 100%; right: -4px; left: -4px; z-index: 70;
      max-height: min(52vh, 360px); overflow-y: auto; overscroll-behavior: contain;
      padding: 20px 16px; color: var(--az-muted); background: var(--az-cream);
      border: 4px solid var(--az-navy); border-top: 0; box-shadow: 8px 8px 0 var(--az-navy);
      font-size: 15px; font-weight: 800; line-height: 1.6;
    }

    .contact { position: relative; overflow: hidden; background: var(--az-yellow); }
    .contact::before { position: absolute; inset: 0; content: ""; pointer-events: none; opacity: .1; background: repeating-linear-gradient(45deg, var(--az-yellow), var(--az-yellow) 20px, var(--az-pink) 20px, var(--az-pink) 40px); }
    .contact-panel { position: relative; z-index: 1; max-width: 1000px; margin: 0 auto; padding: 20px; background: var(--az-cream); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .contact-heading { text-align: center; }
    .contact-heading .tag { color: var(--az-cream); background: var(--az-navy); }
    .contact-intro { margin: 0 auto 32px; color: var(--az-muted); font-size: 19px; font-weight: 800; }
    .contact-form { padding: 20px; background: var(--az-white); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); }
    .form-grid { display: grid; gap: 24px; }
    .field { display: flex; flex-direction: column; }
    .field.full { grid-column: 1 / -1; }
    .field label { margin-bottom: 8px; color: var(--az-navy); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .field input, .field select, .field textarea { width: 100%; border: 4px solid var(--az-navy); border-radius: 0; padding: 12px; color: var(--az-navy); background: var(--az-white); font-size: 15px; font-weight: 800; }
    .field textarea { min-height: 150px; resize: vertical; }
    .field input::placeholder, .field textarea::placeholder { color: var(--az-muted); opacity: .8; }
    .field input:focus, .field select:focus, .field textarea:focus { outline: 4px solid var(--az-pink); outline-offset: 0; }
    .honeypot { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    .form-bottom { display: flex; flex-direction: column; align-items: flex-start; gap: 20px; margin-top: 28px; }
    .form-helper { max-width: 520px; margin: 0; color: var(--az-muted); font-size: 13px; font-weight: 800; }
    .form-bottom .button { width: 100%; }
    .form-status { display: flex; align-items: flex-start; gap: 12px; margin-top: 24px; padding: 16px; color: var(--az-navy); background: var(--az-yellow); border: 4px solid var(--az-navy); font-weight: 800; }
    .form-status .az-icon { margin-top: 2px; }
    .success-state { padding: 24px; color: var(--az-navy); background: var(--az-white); border: 4px solid var(--az-navy); box-shadow: 8px 8px 0 var(--az-navy); text-align: center; }
    .success-state .az-icon { width: 48px; height: 48px; margin-bottom: 16px; color: var(--az-pink); }
    .success-state h3 { margin: 0 0 12px; font-size: 36px; line-height: 1; text-transform: uppercase; }
    .success-state p { max-width: 620px; margin: 0 auto; color: var(--az-muted); font-size: 17px; font-weight: 800; }
    .success-state .button { margin-top: 24px; }

    .footer { padding: 64px 16px; color: var(--az-cream); background: var(--az-navy); border-top: 8px solid var(--az-pink); }
    .footer-inner { display: flex; flex-direction: column; align-items: center; gap: 32px; }
    .footer .logo { width: 208px; max-height: 80px; }

    @keyframes soft-bounce { 0%,100% { transform: rotate(-2deg) translateY(0); } 50% { transform: rotate(-2deg) translateY(-5px); } }
    @keyframes bubble-float { 0%,100% { transform: rotate(-2deg) translateY(0); } 50% { transform: rotate(-2deg) translateY(-5px); } }
    @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-100%); } }
    @keyframes tube-man-wave {
      0%, 100% { transform: rotate(-4deg) skewX(-2deg) translateX(0); }
      18% { transform: rotate(5deg) skewX(4deg) translateX(2px); }
      37% { transform: rotate(9deg) skewX(7deg) translateX(4px); }
      55% { transform: rotate(-5deg) skewX(-5deg) translateX(-2px); }
      74% { transform: rotate(-9deg) skewX(-7deg) translateX(-4px); }
      88% { transform: rotate(3deg) skewX(3deg) translateX(1px); }
    }
    @keyframes tube-man-wobble {
      0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
      28% { transform: translateY(-4px) scaleX(.965) scaleY(1.045) skewX(1deg); }
      51% { transform: translateY(2px) scaleX(1.035) scaleY(.975) skewX(-2deg); }
      77% { transform: translateY(-3px) scaleX(.98) scaleY(1.035) skewX(2deg); }
    }

    @media (min-width: 640px) {
      .container { width: min(1400px, calc(100% - 64px)); }
      .team-bubble { width: 44px; }
      .team-photo { width: 44px; height: 44px; }
      .team-label { bottom: -19px; width: 82px; padding: 4px 6px; }
      .team-name { font-size: 8px; }
      .team-role { margin-top: 3px; font-size: 5.5px; }
      .tube-man-position { display: none; right: 12px; bottom: -14px; width: 116px; }
      .hero-actions { flex-direction: row; justify-content: flex-start; width: auto; }
      .hero-actions .button { width: auto; }
      .stats { gap: 20px; }
      .stat-card { padding: 24px; }
      .package-content { padding: 32px; }
      .package-price { margin: 24px -32px -32px; padding: 32px; }
      .contact-panel { padding: 32px; }
      .contact-form { padding: 24px; }
      .form-bottom { flex-direction: row; align-items: center; justify-content: space-between; }
      .form-bottom .button { width: auto; }
    }

    @media (min-width: 768px) {
      .logo { width: 256px; max-height: 64px; }
      .site-header { padding: 20px 0; }
      .site-header.scrolled { padding: 12px 0; }
      .menu-toggle { width: 48px; height: 48px; }
      .hero { min-height: clamp(560px, 58vw, 640px); padding: 140px 32px 32px; }
      .hero-content { align-items: flex-start; }
      .eyebrow { margin-bottom: 24px; padding: 8px 20px; font-size: 14px; }
      .eyebrow .az-icon { width: 20px; height: 20px; }
      .hero h1 { font-size: clamp(3.5rem, 8vw, 5.75rem); text-align: left; }
      .hero h1 .yellow { margin-top: 12px; }
      .hero h1 .yellow::after { display: block; }
      .hero-copy { margin-bottom: 28px; font-size: 20px; text-align: left; }
      .section { padding: 72px 32px; }
      .section h2 { font-size: clamp(3rem, 6vw, 5.25rem); }
      .body-large { font-size: 20px; }
      .about-layout { grid-template-columns: 1.1fr .9fr; gap: 48px; }
      .about-bottom { flex-direction: row; align-items: center; justify-content: space-between; margin-top: 36px; padding-top: 24px; }
      .about-bottom p { font-size: 18px; }
      .scale-card { padding: 36px; }
      .scale-card .az-icon { width: 52px; height: 52px; }
      .experience-layout { grid-template-columns: 1fr 1.2fr; gap: 48px; }
      .experience-copy h3 { font-size: 40px; }
      .experience-copy > p { font-size: 18px; }
      .feature-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .packages { padding-top: 96px; padding-bottom: 96px; }
      .packages-intro { margin-bottom: 60px; font-size: 20px; }
      .package-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .package-image { height: 240px; }
      .attraction-lineup-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .how-layout { grid-template-columns: 1fr 2fr; gap: 48px; }
      .how-copy p { font-size: 20px; }
      .step-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .safety-copy { font-size: 20px; }
      .safety-grid { grid-template-columns: repeat(3, minmax(0,1fr)); margin-top: 42px; }
      .safety-card { padding: 28px; }
      .booking-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 36px; }
      .booking-card { padding: 42px; }
      .gallery-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 24px; }
      .gallery-frame:nth-child(2) { transform: translateY(48px); }
      .faq-item summary { padding: 18px 22px; font-size: 20px; }
      .faq-answer { padding: 24px; font-size: 18px; }
      .contact { padding-top: 96px; padding-bottom: 96px; }
      .contact-panel { padding: 48px; }
      .contact-form { padding: 32px; }
      .form-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .footer-inner { flex-direction: row; justify-content: space-between; }
    }

    @media (min-width: 960px) {
      .logo { width: 180px; max-height: 56px; }
      .desktop-book { display: flex; }
      .desktop-book .button { padding: 10px 14px; font-size: 11px; box-shadow: 5px 5px 0 var(--az-navy); }
      .package-grid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 32px; }
      .gallery-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
      .gallery-frame:nth-child(2) { transform: none; }
    }

    @media (min-width: 1180px) {
      .logo { width: 224px; max-height: 64px; }
      .desktop-nav { display: flex; gap: 20px; font-size: 13px; letter-spacing: .04em; }
      .desktop-book .button { padding: 14px 20px; font-size: 13px; box-shadow: 8px 8px 0 var(--az-navy); }
      .menu-toggle { display: none; }
      .mobile-nav { display: none !important; }
    }

    @media (min-width: 1280px) {
      .logo { width: 256px; }
      .desktop-nav { gap: 32px; font-size: 14px; }
      .desktop-book .button { padding: 14px 24px; font-size: 14px; }
      .team-bubble { width: 68px; }
      .team-bubble.visible { opacity: .95; }
      .team-photo { width: 68px; height: 68px; }
      .team-label { bottom: -23px; width: 88px; }
      .team-name { font-size: 9px; }
      .team-role { font-size: 6px; }
      .tube-man-position { right: 20px; bottom: -16px; width: 150px; }
    }

    @media (max-width: 767px) {
      :host { font-size: 13px; }
      .container { width: calc(100% - 24px); }
      .site-header, .site-header.scrolled { padding: 8px 0; }
      .header-row { gap: 10px; }
      .logo { width: 84px; max-height: 44px; }
      .desktop-book { display: flex; margin-left: auto; }
      .desktop-book .button { min-height: 40px; padding: 7px 10px; border-width: 3px; box-shadow: 4px 4px 0 var(--az-navy); font-size: 8px; letter-spacing: .1em; }
      .menu-toggle { width: 40px; height: 40px; border-width: 3px; box-shadow: 4px 4px 0 var(--az-navy); }
      .button { min-height: 40px; padding: 9px 12px; border-width: 3px; box-shadow: 5px 5px 0 var(--az-navy); font-size: 10px; letter-spacing: .1em; }
      .hero { min-height: 400px; padding: 60px 14px 16px; }
      .hero-video { transform: none; }
      .hero-content { align-items: flex-start; }
      .eyebrow { margin-bottom: 12px; padding: 4px 8px; border-width: 3px; box-shadow: 5px 5px 0 var(--az-navy); font-size: 8px; }
      .eyebrow .az-icon { width: 12px; height: 12px; }
      .hero h1 { max-width: 560px; margin-bottom: 10px; font-size: clamp(2.35rem, 10vw, 3.5rem); line-height: .88; text-align: left; }
      .hero h1 .yellow::after { display: block; bottom: -8px; height: 4px; border-bottom-width: 4px; }
      .hero-copy { max-width: 560px; margin-bottom: 16px; font-size: 12px; line-height: 1.3; text-align: left; }
      .hero-actions { flex-direction: row; align-items: stretch; gap: 10px; width: auto; }
      .hero-actions .button { width: auto; min-height: 36px; padding: 7px 10px; font-size: 9px; }
      .marquee { padding: 10px 0; }
      .marquee-item { gap: 10px; margin: 0 18px; font-size: 11px; }
      .section { padding: 36px 14px; }
      .about-layout { grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 16px; align-items: start; }
      .section h2 { margin-bottom: 14px; font-size: clamp(1.75rem, 7.5vw, 2.65rem); }
      .tag { gap: 5px; margin-bottom: 14px; padding: 5px 9px; font-size: 9px; letter-spacing: .1em; }
      .tag .az-icon { width: 12px; height: 12px; }
      .body-large { font-size: 12px; line-height: 1.4; }
      .body-large p { margin-bottom: 10px; }
      .stats { gap: 8px; }
      .stat-card { min-height: 96px; padding: 10px; border-width: 3px; }
      .stat-number { font-size: 28px; }
      .stat-label { margin-top: 5px; font-size: 8px; letter-spacing: .08em; }
      .stat-card .az-icon { width: 24px; height: 24px; margin-bottom: 7px; }
      .about-bottom { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-top: 20px; padding-top: 16px; }
      .about-bottom p { font-size: 11px; }
      .member-badge { min-width: 0; width: 138px; padding: 7px; border-width: 3px; box-shadow: 5px 5px 0 var(--az-navy); }
      .member-logos { gap: 6px; }
      .member-logo.rmaf { width: 74px; height: 42px; }
      .member-logo.waf { width: 40px; height: 40px; }
      .member-label { margin-top: 4px; font-size: 8px; }
      .experience-layout { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 18px; align-items: center; }
      .scale-card { padding: 16px; border-width: 3px; box-shadow: 5px 5px 0 var(--az-navy); }
      .scale-card .az-icon { width: 32px; height: 32px; margin-bottom: 12px; }
      .scale-card h2 { margin-bottom: 12px; }
      .scale-card p { font-size: 11px; }
      .experience-copy h3 { margin-bottom: 14px; font-size: clamp(1.35rem, 5.8vw, 2rem); }
      .experience-copy > p { margin-bottom: 18px; font-size: 11px; }
      .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .feature { gap: 7px; }
      .feature-icon { flex-basis: 30px; width: 30px; height: 30px; border-width: 3px; }
      .feature-icon .az-icon { width: 14px; height: 14px; }
      .feature h4 { margin-bottom: 4px; font-size: 11px; }
      .feature p { font-size: 9px; }
      .packages-intro { margin-bottom: 34px; font-size: 13px; }
      .package-grid { gap: 24px; }
      .package-card { border-width: 3px; box-shadow: 5px 5px 0 var(--az-white); }
      .package-flag { top: -17px; padding: 5px 12px; border-width: 3px; box-shadow: 5px 5px 0 var(--az-navy); font-size: 8px; }
      .package-image { height: 160px; border-bottom-width: 3px; }
      .package-content { padding: 16px; }
      .package-title { gap: 8px; margin-bottom: 12px; }
      .package-title .az-icon { width: 24px; height: 24px; }
      .package-title h3 { font-size: 23px; }
      .package-copy, .package-features { font-size: 12px; }
      .package-copy { margin-bottom: 16px; }
      .package-price { margin: 16px -16px -16px; padding: 16px; }
      .price { font-size: 34px; }
      .how { overflow-x: hidden; }
      .how-layout { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 18px; }
      .how-copy p, .safety-copy { font-size: 12px; }
      .step-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .step-card, .safety-card, .booking-card { padding: 16px; }
      .step-number { font-size: 32px; }
      .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .gallery-frame:nth-child(2) { transform: translateY(18px); }
      .faq-item summary { padding: 13px 15px; font-size: 14px; }
      .faq-answer { padding: 16px; font-size: 13px; }
      .contact-panel, .contact-form { padding: 18px; }
      .footer-inner { gap: 14px; }
    }

    @media (max-width: 479px) {
      .about-layout { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 12px; }
      .stat-card { padding: 8px; overflow: hidden; }
      .stat-number { font-size: 18px; letter-spacing: -.04em; }
      .stat-label { font-size: 7px; line-height: 1.15; letter-spacing: 0; overflow-wrap: anywhere; }
      .stat-card .az-icon { width: 20px; height: 20px; }
      .experience-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .scale-card { padding: 12px; overflow: hidden; }
      .scale-card h2 { font-size: 22px; overflow-wrap: anywhere; }
      .how-layout { grid-template-columns: minmax(0, 1fr); gap: 22px; }
      .how-copy p { max-width: 220px; }
      .step-card { min-width: 0; padding: 12px; overflow: hidden; }
      .step-card h4 { font-size: 16px; overflow-wrap: anywhere; }
      .step-card p { font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
    }

    @media (min-width: 480px) and (max-width: 767px) {
      .package-grid, .booking-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
      .package-title h3 { font-size: 18px; }
      .package-image { height: 138px; }
      .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    .az-site.wix-preview-frame .tube-man-position { display: none; }

    @media (max-width: 639px) {
      .az-site.wix-preview-frame .tube-man-position {
        display: block;
        position: absolute;
        top: auto;
        right: 6px;
        bottom: 0;
        width: 82px;
      }
    }

    @media (min-width: 960px) {
      .az-site.wix-preview-frame .site-header .container { width: calc(100% - 144px); margin-left: 32px; margin-right: auto; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
      .marquee-track { animation: none; }
      .tube-man-sway, .tube-man-wobble { animation: none; }
    }
  `;

  function feature(iconName, title, copy, color) {
    return `<div class="feature"><div class="feature-icon ${color}">${icon(iconName)}</div><div><h4 class="display">${title}</h4><p>${copy}</p></div></div>`;
  }

  function attractionLineupMarkup(categories) {
    return `<details class="attraction-lineup"><summary>View Attraction Lineup</summary><div class="attraction-lineup-content"><p class="attraction-lineup-intro">Here are our possible attractions. Packages include a curated selection; attractions are not available a la carte.</p><div class="attraction-lineup-grid">${categories.map((category) => {
      const [kicker, title, description, detail, items] = category.length === 3
        ? ["", category[0], category[1], "", category[2]]
        : category;
      return `<div class="attraction-lineup-category">${kicker ? `<div class="attraction-lineup-kicker">${kicker}</div>` : ""}<h4 class="display">${title}</h4>${description ? `<p>${description}</p>` : ""}${detail ? `<p class="attraction-lineup-detail">${detail}</p>` : ""}<div class="attraction-chip-list">${items.map((item) => `<span>${item}</span>`).join("")}</div></div>`;
    }).join("")}</div></div></details>`;
  }

  function packageCard({ flag, image, alt, iconName, title, subtitle, copy, features, price, ammo, lineup }) {
    return `<article class="package-card">
      ${flag ? `<div class="package-flag">${flag}</div>` : ""}
      <div class="package-image"><img src="${image}" alt="${alt}" loading="lazy"></div>
      <div class="package-content">
        <div class="package-title">${icon(iconName)}<div class="package-title-copy"><h3 class="display">${title}</h3>${subtitle ? `<p>${subtitle}</p>` : ""}</div></div>
        <p class="package-copy">${copy}</p>
        <ul class="package-features">${features.map((item) => `<li>${icon("check")}${item}</li>`).join("")}</ul>
        ${ammo ? `<span class="ammo">${ammo}</span>` : ""}
        ${lineup || ""}
        <div class="package-price"><div class="price-label">Flat Rate</div><div class="price display">${price}</div><div class="price-days">For 1–4 Days</div><div class="extended-rate">Extended events: additional pricing applies</div></div>
      </div>
    </article>`;
  }

  function bookingCard(className, iconName, title, copy, items, highlight = "") {
    return `<article class="booking-card ${className}">${icon(iconName)}<h3 class="display">${title}</h3>${highlight ? `<div class="fundraising-highlight">${highlight}</div>` : ""}<p>${copy}</p><ul class="booking-list">${items.map((item) => `<li>${icon("check")}${item}</li>`).join("")}</ul></article>`;
  }

  function stepCard(number, iconName, title, copy) {
    return `<article class="step-card"><div class="step-top">${icon(iconName)}<span class="step-number display">${number}</span></div><h4 class="display">${title}</h4><p>${copy}</p></article>`;
  }

  function teamMarkup() {
    return teamMembers.map(([name, role, image, alt, position], index) => {
      const targetTop = /top:\s*([^;]+)/.exec(position)?.[1] || "0%";
      return `<div class="team-bubble" data-team-index="${index}" data-team-target-top="${targetTop}" style="${position}; transition-delay:${index * 45}ms"><div class="team-bubble-inner" style="animation-delay:${index * 180}ms"><img class="team-photo" src="${image}" alt="${alt}" loading="lazy"><span class="team-label"><span class="team-name">${name}</span><span class="team-role">${role}</span></span></div></div>`;
    }).join("");
  }

  function galleryMarkup() {
    return [0, 1, 2].map((slot) => `<figure class="gallery-frame"><img data-gallery-slot="${slot}" src="${galleryImages[slot][0]}" alt="${galleryImages[slot][1]}" loading="lazy"></figure>`).join("");
  }

  function faqMarkup() {
    return faqItems.map(([question, answer]) => `<details class="faq-item"><summary><span>${question}</span><span class="plus" aria-hidden="true">+</span></summary><div class="faq-answer">${answer}</div></details>`).join("");
  }

  function formMarkup() {
    return `<form class="contact-form" novalidate>
      <div class="form-grid">
        <div class="field"><label for="az-name">Your Name *</label><input id="az-name" name="name" required maxlength="120" placeholder="Jane Smith"></div>
        <div class="field"><label for="az-email">Email Address *</label><input id="az-email" name="email" type="email" required maxlength="254" placeholder="jane@example.com"></div>
        <div class="field"><label for="az-event">Event or Organization *</label><input id="az-event" name="eventName" required maxlength="160" placeholder="Fall Festival"></div>
        <div class="field"><label for="az-date">Event Date</label><input id="az-date" name="eventDate" type="date"></div>
        <div class="field"><label for="az-location">Event Location</label><input id="az-location" name="eventLocation" maxlength="200" placeholder="City, State"></div>
        <div class="field"><label for="az-package">Package Interest</label><select id="az-package" name="packageInterest"><option value="">Not sure yet</option><option>Adventure Zone</option><option>Pirate's Rebellion</option><option>Warrior's Playground</option></select></div>
        <div class="honeypot" aria-hidden="true"><label for="az-website">Website</label><input id="az-website" name="website" tabindex="-1" autocomplete="off"></div>
        <div class="field full"><label for="az-message">Tell Us About Your Event *</label><textarea id="az-message" name="message" required minlength="10" maxlength="4000" rows="6" placeholder="Tell us about your event, expected crowd, and what you are looking for."></textarea></div>
      </div>
      <div class="form-bottom"><p class="form-helper">Your message goes directly to our booking team. We'll follow up using the email address you provide.</p><button class="button" type="submit">Send Inquiry ${icon("send")}</button></div>
      <div class="status-slot"></div>
    </form>`;
  }

  function pageMarkup() {
    return `<div class="az-site">
      <header class="site-header">
        <div class="container header-row">
          <a class="logo-link" href="#hero" aria-label="The Adventure Zone home"><img class="logo" src="${IMAGE.logo}" alt="The Adventure Zone"></a>
          <nav class="desktop-nav" aria-label="Primary navigation">
            <a href="#about">About</a><a href="#packages">Packages</a><a href="#experience">The Experience</a><a href="#safety">Safety</a><a href="#partnerships">Booking Structures</a><a href="#faq">FAQ</a>
          </nav>
          <div class="desktop-book"><a class="button" href="#contact">Contact ${icon("arrow")}</a></div>
          <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="az-mobile-nav" aria-label="Open menu">${icon("menu")}</button>
        </div>
        <nav class="mobile-nav" id="az-mobile-nav" aria-label="Mobile navigation">
          <a href="#about">About ${icon("chevron")}</a><a href="#packages">Packages ${icon("chevron")}</a><a href="#experience">The Experience ${icon("chevron")}</a><a href="#safety">Safety &amp; Trust ${icon("chevron")}</a><a href="#partnerships">Booking Structures ${icon("chevron")}</a><a href="#gallery">Gallery ${icon("chevron")}</a><a href="#faq">FAQ ${icon("chevron")}</a><a href="#contact">Contact ${icon("chevron")}</a>
        </nav>
      </header>

      <aside class="team-float" aria-label="Meet the Adventure Zone team">${teamMarkup()}</aside>

      <section class="hero" id="hero">
        <div class="hero-backdrop"><video class="hero-video" src="${IMAGE.heroVideo}" poster="${IMAGE.hero}" autoplay loop muted playsinline preload="metadata" aria-hidden="true"></video></div>
        <div class="hero-overlay"></div><div class="hero-grid"></div>
        <div class="hero-content">
          <div class="eyebrow">${icon("star")}<span>America's Best Bounce House Carnival!</span>${icon("star")}</div>
          <h1 class="display">We Bring <br><span class="yellow">The Action</span></h1>
          <p class="hero-copy">Professional, fully staffed traveling inflatable carnival packages for fairs, festivals &amp; major community events.</p>
          <div class="hero-actions"><a class="button" href="#packages">See Packages</a><a class="button outline" href="#contact">Contact</a></div>
        </div>
      </section>

      <section class="marquee" aria-label="Adventure Zone benefits"><div class="marquee-track">
        <span class="marquee-item">${icon("check")}Fully Staffed</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("hardhat")}Setup &amp; Tear-Down</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("shield")}Fully Insured</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("star")}25+ Years of Fun</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("check")}Fully Staffed</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("hardhat")}Setup &amp; Tear-Down</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("shield")}Fully Insured</span><span class="marquee-item marquee-dot">•</span>
        <span class="marquee-item">${icon("star")}25+ Years of Fun</span>
      </div></section>

      <section class="section about" id="about"><div class="container">
        <div class="about-layout">
          <div><div class="tag">${icon("star")}About The Adventure Zone</div><h2 class="display">Built For The<br><span class="pink">Big Day.</span></h2><div class="body-large"><p>The Adventure Zone is a traveling inflatable carnival built for fairs, festivals, rodeos, and community events across the West.</p><p>With nearly three decades in the amusement business and experience at more than 500 events, our crew knows how to bring a full attraction footprint to the field and run it with care.</p><p>Family owned and operated, The Adventure Zone combines personal service with professional standards, experienced staffing, and reliable execution to help make your event safe, successful, and unforgettable.</p></div></div>
          <div class="stats">
            <div class="stat-card yellow shadow"><div class="stat-number display">25+</div><div class="stat-label">Years Of Fun</div></div>
            <div class="stat-card navy shadow-white"><div class="stat-number display">500+</div><div class="stat-label">Events Attended</div></div>
            <div class="stat-card shadow">${icon("shield")}<div class="stat-label">NAARSO-Certified Inspector On Staff</div></div>
            <div class="stat-card shadow">${icon("pin")}<div class="stat-label">Regional Inspection Experience</div></div>
          </div>
        </div>
        <div class="about-bottom"><p>The team works with commercial inflatable operating standards, ASTM practices, and inspection programs in Colorado, New Mexico, and Arizona.</p><div class="member-badge" aria-label="Proud members of RMAF and WAF"><div class="member-logos"><img class="member-logo rmaf" src="${IMAGE.rmaf}" alt="Rocky Mountain Association of Fairs logo"><img class="member-logo waf" src="${IMAGE.waf}" alt="Western Fairs Association logo"></div><div class="member-label">Proud Members</div></div></div>
      </div></section>

      <section class="section experience" id="experience"><div class="container experience-layout">
        <div class="scale-wrap"><div class="scale-card">${icon("star")}<h2 class="display">Scale<br>Matters.</h2><p>We are an event company, not a backyard rental drop-off.</p></div></div>
        <div class="experience-copy"><h3 class="display">Commercial-Grade Attractions. Professional Execution.</h3><p>When you book The Adventure Zone, you're securing a massive, high-throughput footprint designed to process lines safely and deliver an unforgettable spectacle. We bring the crew, the gear, and the experience so you can focus on the rest of your event.</p><div class="feature-grid">${feature("shield", "Inspection Ready", "Rigorous safety protocols and commercial-grade units built for crowds.", "pink")}${feature("zap", "Turnkey Operation", "We handle the heavy lifting. You don't have to provide volunteers to watch the slides.", "yellow")}</div></div>
      </div></section>

      <section class="section packages" id="packages"><div class="container">
        <div class="section-heading"><div class="fleet-label">The Fleet</div><h2 class="display">Epic Packages</h2><p class="packages-intro">Choose the footprint that fits your event.</p></div>
        <div class="package-grid">
          ${packageCard({ image: IMAGE.pirate, alt: "Pirate's Rebellion", iconName: "anchor", title: "Pirate's Rebellion", copy: "A swashbuckling water/pirate themed adventure perfect for beating the summer heat.", features: ["Fully immersive pirate theme", "Giant water slides &amp; wet attractions"], price: "$7,500", lineup: attractionLineupMarkup(pirateAttractionCategories) })}
          ${packageCard({ flag: "Flagship Experience", image: IMAGE.adventure, alt: "Adventure Zone", iconName: "star", title: "Adventure Zone", subtitle: "Something for everyone.", copy: "Our massive inflatable carnival built for max capacity and towering visual impact.", features: ["10 Premium Attractions", "Giant slides, obstacle courses &amp; bounces"], price: "$9,000", lineup: attractionLineupMarkup(adventureAttractionCategories) })}
          ${packageCard({ image: IMAGE.warrior, alt: "Warrior's Playground", iconName: "target", title: "Warrior's Playground", copy: "High-adrenaline action pursuit and competitive games for older kids and teens.", features: ["Action Pursuit Gaming Arena <small>(Paintball, AirSoft, or Orbeez)*</small>", "4 additional attractions &amp; carnival games"], price: "$7,500", ammo: "*Ammo sold separately", lineup: attractionLineupMarkup(warriorAttractionCategories) })}
        </div>
      </div></section>

      <section class="section how"><div class="container how-layout">
        <div class="how-copy"><h2 class="display">How It Works</h2><p>You provide the space and the crowd. We handle the rest.</p><a class="button" href="#contact">Check Dates</a></div>
        <div class="step-grid">${stepCard("01", "pin", "Setup", "Our professional crew arrives early, handles all rigging, power routing, and safety checks before the gates open.")}${stepCard("02", "hardhat", "Staffing", "Every attraction is manned by our trained team. We don't rely on your volunteers to keep things safe.")}${stepCard("03", "zap", "Operation", "We manage the lines, enforce the rules, and ensure high throughput so more kids have more fun.")}${stepCard("04", "clock", "Teardown", "When the event ends, we pack it all up efficiently, leaving your grounds exactly as we found them.")}</div>
      </div></section>

      <section class="section safety" id="safety"><div class="container">
        ${icon("shield")}<h2 class="display">Safety Isn't A Feature.<br>It's Our Foundation.</h2>
        <div class="safety-copy"><p>When you organize a major event, liability is your biggest concern. We operate with the strict protocols of a professional traveling carnival.</p><p><span class="safety-highlight">Fully insured</span> with nearly 30 years of operational experience, our team brings established procedures to every setup. A certificate of insurance is available upon request.</p></div>
        <div class="safety-grid">
          <article class="safety-card"><div class="number display">500+</div><h3 class="display">Events Across the West</h3><p>Experience supporting fairs, festivals, rodeos, and community events across multiple states.</p></article>
          <article class="safety-card">${icon("shield")}<h3 class="display">Certified Know-How</h3><p>A NAARSO-certified inspector is part of the Adventure Zone team.</p></article>
          <article class="safety-card">${icon("pin")}<h3 class="display">Route-Ready Experience</h3><p>Familiarity with regional inspections and commercial inflatable operating standards.</p></article>
        </div>
      </div></section>

      <section class="section partnerships" id="partnerships"><div class="container">
        <div class="section-heading"><h2 class="display">Booking Structures</h2></div>
        <div class="booking-grid">${bookingCard("", "ticket", "Event-Paid", "You pay the flat daily rate. The attractions run completely free for your attendees, serving as a massive draw and value-add for your ticketed festival or community day.", ["Package reserved for your event dates", "Attractions included for attendees"])}${bookingCard("pink", "target", "Pay-For-Play", "Subject to approval. We offer percentage-of-sales or guaranteed-payment arrangements. With percentage-of-sales events, attractions come at no upfront cost, guests pay to play, and the event receives a share of ticket sales. Guaranteed arrangements are customized to the event, location, attendance, and package.", ["May be available for qualifying events", "Percentage of ticket box sales paid to the event"], "A Fun Fundraising Opportunity")}</div>
      </div></section>

      <section class="section gallery" id="gallery"><div class="container"><h2 class="display">The Spectacle</h2><div class="gallery-grid">${galleryMarkup()}</div></div></section>

      <section class="section faq" id="faq"><div class="container">
        <div class="faq-heading"><div class="tag">${icon("check")}Plan With Confidence</div><h2 class="display">FAQ</h2><p class="faq-intro">The practical details organizers ask about space, power, water, setup, safety, and booking.</p></div>
        <div class="faq-list">${faqMarkup()}</div>
      </div></section>

      <section class="section contact" id="contact"><div class="container"><div class="contact-panel">
        <div class="contact-heading"><div class="tag">${icon("calendar")}Book For Your Season</div><h2 class="display">Secure Your Dates</h2><p class="contact-intro">Tell us about your event and the booking team will follow up with the next steps.</p></div>
        ${formMarkup()}
      </div></div></section>

      <footer class="footer"><div class="container footer-inner"><img class="logo" src="${IMAGE.logo}" alt="The Adventure Zone"></div></footer>
      <div class="tube-man-position" aria-hidden="true"><div class="tube-man-sway"><div class="tube-man-wobble"><img class="tube-man-image" src="${IMAGE.mascot}" alt=""></div></div></div>
    </div>`;
  }

  class AdventureZoneSite extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.heroIndex = 0;
      this.galleryIndex = 0;
      this.menuOpen = false;
      this.timers = [];
      this.abortController = null;
      this.inquiryAbortController = null;
      this.pendingSubmissionId = null;
      this.resizeObserver = null;
      this.teamLayoutTimer = null;
    }

    connectedCallback() {
      this.shadowRoot.innerHTML = `<style>${styles}</style>${pageMarkup()}`;
      this.isWixPreviewFrame = /CustomElementPreviewIframe/i.test(window.location.pathname);
      this.shadowRoot.querySelector(".az-site").classList.toggle("wix-preview-frame", this.isWixPreviewFrame);
      this.abortController = new AbortController();
      this.bindInteractions();
      this.updateScrollState();
      this.setupResizeEvents();
      this.teamLayoutTimer = window.setTimeout(() => {
        this.layoutTeamBubbles();
        this.emitResize();
      }, 800);
      this.startRotations();
      const hash = window.location.hash.slice(1);
      const redirectedSection = new URLSearchParams(window.location.search).get("section") || "";
      const initialSection = hash || redirectedSection;
      if (initialSection) window.requestAnimationFrame(() => this.scrollToId(initialSection));
    }

    disconnectedCallback() {
      this.timers.forEach((timer) => window.clearInterval(timer));
      this.timers = [];
      this.abortController?.abort();
      this.inquiryAbortController?.abort();
      this.resizeObserver?.disconnect();
      window.clearTimeout(this.teamLayoutTimer);
    }

    bindInteractions() {
      const signal = this.abortController.signal;
      const root = this.shadowRoot;
      const menuButton = root.querySelector(".menu-toggle");
      menuButton.addEventListener("click", () => this.toggleMenu(), { signal });
      root.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.closeMenu();
          this.scrollToId(link.getAttribute("href").slice(1));
        }, { signal });
      });
      window.addEventListener("scroll", () => this.updateScrollState(), { signal, passive: true });
      window.addEventListener("resize", () => this.updateResizeLayout(), { signal, passive: true });
      root.querySelector(".contact-form").addEventListener("submit", (event) => this.submitInquiry(event), { signal });
      root.querySelector(".contact-form").addEventListener("input", () => this.emitResize(), { signal, passive: true });
      root.querySelectorAll(".faq-item, .attraction-lineup").forEach((item) => item.addEventListener("toggle", () => {
        window.requestAnimationFrame(() => {
          this.layoutTeamBubbles();
          this.emitResize();
        });
      }, { signal }));
    }

    setupResizeEvents() {
      const shell = this.shadowRoot.querySelector(".az-site");
      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => {
          this.layoutTeamBubbles();
          this.emitResize();
        });
        this.resizeObserver.observe(shell);
      }
      window.requestAnimationFrame(() => {
        this.layoutTeamBubbles();
        this.emitResize();
      });
    }

    emitResize() {
      const shell = this.shadowRoot?.querySelector(".az-site");
      if (!shell) return;
      const height = Math.ceil(shell.getBoundingClientRect().height);
      this.style.height = `${height}px`;
      this.dispatchEvent(new CustomEvent("adventure-zone-resize", {
        bubbles: true,
        composed: true,
        detail: { height },
      }));
    }

    toggleMenu() {
      this.menuOpen = !this.menuOpen;
      const button = this.shadowRoot.querySelector(".menu-toggle");
      const nav = this.shadowRoot.querySelector(".mobile-nav");
      button.setAttribute("aria-expanded", String(this.menuOpen));
      button.setAttribute("aria-label", this.menuOpen ? "Close menu" : "Open menu");
      button.innerHTML = icon(this.menuOpen ? "close" : "menu");
      nav.classList.toggle("open", this.menuOpen);
      this.emitResize();
    }

    closeMenu() {
      if (!this.menuOpen) return;
      this.menuOpen = false;
      const button = this.shadowRoot.querySelector(".menu-toggle");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
      button.innerHTML = icon("menu");
      this.shadowRoot.querySelector(".mobile-nav").classList.remove("open");
    }

    scrollToId(id) {
      const target = this.shadowRoot.getElementById(id);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    updateResizeLayout() {
      if (window.innerWidth >= 1024) this.closeMenu();
      this.layoutTeamBubbles();
      this.emitResize();
    }

    layoutTeamBubbles() {
      const root = this.shadowRoot;
      const layer = root?.querySelector(".team-float");
      if (!layer) return;
      const layerRect = layer.getBoundingClientRect();
      if (layerRect.width <= 0 || layerRect.height <= 0) return;

      const overlaps = (first, second) => first.left < second.right
        && first.right > second.left
        && first.top < second.bottom
        && first.bottom > second.top;
      const obstacles = Array.from(root.querySelectorAll(teamContentSelector)).flatMap((node) => {
        if (node.closest(".team-float")) return [];
        const closedDetails = node.closest("details:not([open])");
        if (closedDetails && node !== closedDetails.querySelector("summary")) return [];
        const style = getComputedStyle(node);
        const hasContent = /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName) || node.textContent.trim();
        if (!hasContent || style.display === "none" || style.visibility === "hidden") return [];
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? [rect] : [];
      });
      const placed = [];

      root.querySelectorAll(".team-bubble").forEach((bubble) => {
        const targetValue = bubble.dataset.teamTargetTop || bubble.style.top || "0%";
        const targetTop = targetValue.endsWith("%")
          ? layerRect.height * Number.parseFloat(targetValue) / 100
          : Number.parseFloat(targetValue);
        const visualRects = [bubble.querySelector(".team-photo"), bubble.querySelector(".team-label")]
          .filter(Boolean)
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        if (!visualRects.length || !Number.isFinite(targetTop)) return;

        const visualLeft = Math.min(...visualRects.map((rect) => rect.left));
        const visualRight = Math.max(...visualRects.map((rect) => rect.right));
        const visualTop = Math.min(...visualRects.map((rect) => rect.top));
        const visualBottom = Math.max(...visualRects.map((rect) => rect.bottom));
        const visualTopOffset = visualTop - (layerRect.top + bubble.offsetTop);
        const visualHeight = visualBottom - visualTop;
        const minTop = Math.max(0, -visualTopOffset);
        const maxTop = Math.max(minTop, layerRect.height - visualTopOffset - visualHeight);
        const boundedTarget = Math.min(maxTop, Math.max(minTop, targetTop));
        const rectAt = (top) => ({
          left: visualLeft - teamTextClearance,
          right: visualRight + teamTextClearance,
          top: layerRect.top + top + visualTopOffset - teamTextClearance,
          bottom: layerRect.top + top + visualTopOffset + visualHeight + teamTextClearance,
        });
        const isClear = (top) => {
          const candidate = rectAt(top);
          return !obstacles.some((obstacle) => overlaps(candidate, obstacle))
            && !placed.some((otherBubble) => overlaps(candidate, otherBubble));
        };

        let selectedTop = boundedTarget;
        const checked = new Set();
        const maximumSteps = Math.ceil((maxTop - minTop) / teamSearchStep);
        for (let step = 0; step <= maximumSteps; step += 1) {
          const distance = step * teamSearchStep;
          const candidates = step === 0 ? [boundedTarget] : [boundedTarget + distance, boundedTarget - distance];
          const clearTop = candidates.find((candidate) => {
            const bounded = Math.min(maxTop, Math.max(minTop, candidate));
            const key = Math.round(bounded * 100) / 100;
            if (checked.has(key)) return false;
            checked.add(key);
            return isClear(bounded);
          });
          if (clearTop !== undefined) {
            selectedTop = Math.min(maxTop, Math.max(minTop, clearTop));
            break;
          }
        }

        bubble.style.top = `${Math.round(selectedTop)}px`;
        placed.push(rectAt(selectedTop));
      });
    }

    updateScrollState() {
      const header = this.shadowRoot?.querySelector(".site-header");
      if (!header) return;
      header.classList.toggle("scrolled", window.scrollY > 20);
      this.updateTeamVisibility();
    }

    updateTeamVisibility() {
      this.shadowRoot.querySelectorAll(".team-bubble").forEach((bubble) => {
        bubble.classList.add("visible");
      });
    }

    startRotations() {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduced) return;
      this.timers.push(window.setInterval(() => this.rotateHero(), 6500));
      this.timers.push(window.setInterval(() => this.rotateGallery(), 5000));
    }

    rotateHero() {
      const slides = this.shadowRoot.querySelectorAll(".hero-slide");
      if (!slides.length) return;
      slides[this.heroIndex].classList.remove("active");
      this.heroIndex = (this.heroIndex + 1) % slides.length;
      slides[this.heroIndex].classList.add("active");
    }

    rotateGallery() {
      const frames = this.shadowRoot.querySelectorAll("[data-gallery-slot]");
      if (!frames.length) return;
      this.galleryIndex = (this.galleryIndex + 1) % galleryImages.length;
      frames.forEach((image, slot) => {
        const next = galleryImages[(this.galleryIndex + slot) % galleryImages.length];
        image.classList.add("fading");
        window.setTimeout(() => {
          image.src = next[0];
          image.alt = next[1];
          image.onload = () => image.classList.remove("fading");
          window.setTimeout(() => image.classList.remove("fading"), 80);
        }, 120);
      });
    }

    collectFormValues(form) {
      const data = new FormData(form);
      return {
        name: String(data.get("name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        eventName: String(data.get("eventName") || "").trim(),
        eventDate: String(data.get("eventDate") || "").trim(),
        eventLocation: String(data.get("eventLocation") || "").trim(),
        packageInterest: String(data.get("packageInterest") || "").trim(),
        message: String(data.get("message") || "").trim(),
      };
    }

    async submitInquiry(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const honeypot = form.querySelector('[name="website"]').value;
      if (honeypot) return;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const values = this.collectFormValues(form);
      const submitButton = form.querySelector('button[type="submit"]');
      const originalButtonMarkup = submitButton.innerHTML;
      if (!this.pendingSubmissionId) this.pendingSubmissionId = crypto.randomUUID();
      const payload = {
        submissionId: this.pendingSubmissionId,
        ...values,
        website: honeypot,
        pageUrl: window.location.href,
      };
      if (!payload.eventDate) delete payload.eventDate;
      if (!payload.eventLocation) delete payload.eventLocation;
      if (!payload.packageInterest) delete payload.packageInterest;

      this.inquiryAbortController?.abort();
      const requestController = new AbortController();
      this.inquiryAbortController = requestController;
      const timeout = window.setTimeout(() => requestController.abort(), INQUIRY_TIMEOUT_MS);
      submitButton.disabled = true;
      submitButton.textContent = "Sending…";
      this.showFormStatus("Sending your inquiry securely…");

      try {
        const response = await fetch(INQUIRY_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`Inquiry request failed (${response.status})`);
        const receipt = await response.json();
        form.reset();
        this.pendingSubmissionId = null;
        const confirmation = [receipt.message || "Your inquiry was received.", receipt.referenceCode ? `Reference: ${receipt.referenceCode}` : ""]
          .filter(Boolean)
          .join(" ");
        this.showFormStatus(confirmation);
        this.dispatchEvent(new CustomEvent("adventure-zone-inquiry", {
          bubbles: true,
          cancelable: false,
          composed: true,
          detail: { ...values, referenceCode: receipt.referenceCode || null },
        }));
      } catch {
        this.showFormStatus(
          "We could not save your inquiry right now. Your entries are still here. Please try again or email our booking team.",
          true,
        );
      } finally {
        window.clearTimeout(timeout);
        if (this.inquiryAbortController === requestController) this.inquiryAbortController = null;
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonMarkup;
      }
    }

    showFormStatus(message, emailFallback = false) {
      const slot = this.shadowRoot.querySelector(".status-slot");
      slot.innerHTML = `<div class="form-status" role="status">${icon("alert")}</div>`;
      const status = slot.querySelector(".form-status");
      const text = document.createElement("span");
      text.textContent = message;
      status.append(text);
      if (emailFallback) {
        const link = document.createElement("a");
        link.href = "mailto:TheAdventureZone12@gmail.com";
        link.textContent = "Email The Adventure Zone";
        link.style.textDecoration = "underline";
        link.style.fontWeight = "900";
        status.append(link);
      }
      this.emitResize();
    }
  }

  const mascotStyles = `
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
      74% { transform: rotate(-9deg) skewX(-7deg) translateX(-4px); }
      88% { transform: rotate(3deg) skewX(3deg) translateX(1px); }
    }
    @keyframes mascot-wobble {
      0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
      28% { transform: translateY(-4px) scaleX(.965) scaleY(1.045) skewX(1deg); }
      51% { transform: translateY(2px) scaleX(1.035) scaleY(.975) skewX(-2deg); }
      77% { transform: translateY(-3px) scaleX(.98) scaleY(1.035) skewX(2deg); }
    }
    @media (max-width: 767px) {
      :host { right: 0; bottom: 0; left: 0; width: 100%; height: 100%; }
    }
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
      this.shadowRoot.innerHTML = `<style>${mascotStyles}</style><div class="mascot-shell"><div class="tube-man-sway"><div class="tube-man-wobble"><img class="tube-man-image" src="${IMAGE.mascot}" alt="The Adventure Zone inflatable tube-man mascot"></div></div></div>`;
    }
  }

  if (!customElements.get("adventure-zone-site")) {
    customElements.define("adventure-zone-site", AdventureZoneSite);
  }
  if (!customElements.get("adventure-zone-mascot")) {
    customElements.define("adventure-zone-mascot", AdventureZoneMascot);
  }
})();
