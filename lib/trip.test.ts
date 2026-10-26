import { describe, expect, it } from "vitest";
import { addTodo, chooseSites, mergeTripPlan, proposeSites, removeTodo, saveSiteProfile, setCardSite, setTodoDone, siteForCard, siteSlug, TripInputError, tripFileName, type TripPlanInput } from "./trip";

const input = (over: Partial<TripPlanInput> = {}): TripPlanInput => ({
  id: "malta-27",
  name: " Malta 2027 ",
  destination: "Malta",
  startDate: "2027-05-08",
  dives: [
    { itemId: "b", title: "Um El Faroud", date: "2027-05-10", site: "Um El Faroud", maxDepthM: 36, gas: "EAN28", prepMarkdown: "## Wreck" },
    { itemId: "a", title: "", site: "Blue Hole", date: "2027-05-09", startTime: "09:00", center: "" },
    { itemId: "c", title: "Night dive" },
  ],
  ...over,
});

describe("mergeTripPlan", () => {
  it("stores the cards by date, with the preparation sent", () => {
    const plan = mergeTripPlan(undefined, { ...input(), summaryMarkdown: " Practise stops. " }, "T1");
    expect(plan).toMatchObject({ id: "malta-27", name: "Malta 2027", destination: "Malta", startDate: "2027-05-08", createdAt: "T1", updatedAt: "T1" });
    expect(plan.summary).toEqual({ markdown: "Practise stops.", savedAt: "T1" });
    expect(plan.dives.map((d) => d.itemId)).toEqual(["a", "b", "c"]);
    expect(plan.dives[0]).toEqual({ itemId: "a", title: "Blue Hole", site: "Blue Hole", date: "2027-05-09", startTime: "09:00", prep: null, loggedDiveIds: [] });
    expect(plan.dives[1].prep).toEqual({ markdown: "## Wreck", savedAt: "T1" });
    expect(plan.dives[2].title).toBe("Night dive");
  });

  it("follows TripDeck's cards and keeps what the dive log added", () => {
    const first = mergeTripPlan(undefined, { ...input(), summaryMarkdown: "Notes" }, "T1");
    first.dives[1].loggedDiveIds = ["d1"];
    const again = mergeTripPlan(
      first,
      {
        id: "malta-27",
        name: "Malta",
        dives: [
          { itemId: "b", title: "Um El Faroud", date: "2027-05-11" },
          { itemId: "a", title: "Blue Hole", prepMarkdown: "" , loggedDiveIds: ["d2", "d2"] },
        ],
      },
      "T2",
    );
    expect(again).toMatchObject({ createdAt: "T1", updatedAt: "T2", summary: { markdown: "Notes", savedAt: "T1" } });
    expect(again).not.toHaveProperty("destination");
    expect(again.dives.map((d) => [d.itemId, d.date, d.prep?.markdown ?? null, d.loggedDiveIds])).toEqual([
      ["b", "2027-05-11", "## Wreck", ["d1"]],
      ["a", undefined, null, ["d2"]],
    ]);
    expect(mergeTripPlan(again, { id: "malta-27", name: "Malta", summaryMarkdown: "", dives: [] }, "T3").summary).toBeNull();
  });

  it("keeps a card's verdict until a new one or \"\" is sent", () => {
    const first = mergeTripPlan(undefined, input({ dives: [{ itemId: "a", title: "A", verdict: "check", verdictSummary: " Ask the mix. " }] }), "T1");
    expect(first.dives[0].verdict).toEqual({ status: "check", summary: "Ask the mix.", savedAt: "T1" });
    const kept = mergeTripPlan(first, input({ dives: [{ itemId: "a", title: "A" }] }), "T2");
    expect(kept.dives[0].verdict).toEqual({ status: "check", summary: "Ask the mix.", savedAt: "T1" });
    expect(mergeTripPlan(kept, input({ dives: [{ itemId: "a", title: "A", verdict: "ready" }] }), "T3").dives[0].verdict).toEqual({
      status: "ready",
      summary: "",
      savedAt: "T3",
    });
    expect(mergeTripPlan(kept, input({ dives: [{ itemId: "a", title: "A", verdict: "" }] }), "T3").dives[0]).not.toHaveProperty("verdict");
  });

  it("keeps the flights in order until new ones or [] are sent", () => {
    const flights = [
      { date: "2027-05-15", time: "13:35", from: "MLA", to: "WAW", note: "" },
      { date: "2027-05-08", from: "WAW", to: "MLA" },
    ];
    const first = mergeTripPlan(undefined, input({ flights }), "T1");
    expect(first.flights).toEqual([
      { date: "2027-05-08", from: "WAW", to: "MLA" },
      { date: "2027-05-15", time: "13:35", from: "MLA", to: "WAW" },
    ]);
    expect(mergeTripPlan(first, input(), "T2").flights).toEqual(first.flights);
    expect(mergeTripPlan(first, input({ flights: [] }), "T2")).not.toHaveProperty("flights");
    expect(() => mergeTripPlan(undefined, input({ flights: [{ date: "2027-05-15", time: "1:35 pm" }] }), "T")).toThrow("HH:MM");
    expect(() => mergeTripPlan(undefined, input({ flights: [{ date: "15.05.2027" }] }), "T")).toThrow("YYYY-MM-DD");
  });

  it("refuses a bad id, a missing name, a wrong date and a card sent twice", () => {
    expect(() => mergeTripPlan(undefined, input({ id: "../x" }), "T")).toThrow(TripInputError);
    expect(() => mergeTripPlan(undefined, input({ name: " " }), "T")).toThrow("needs a name");
    expect(() => mergeTripPlan(undefined, input({ startDate: "8.5.2027" }), "T")).toThrow("YYYY-MM-DD");
    const twice = input();
    twice.dives.push({ itemId: "a", title: "Again" });
    expect(() => mergeTripPlan(undefined, twice, "T")).toThrow("The card a is sent twice.");
  });
});

describe("tripFileName", () => {
  it("is readable and keeps the id", () => {
    expect(tripFileName({ id: "malta-27", name: "Malta: 2027 / wrecks?" })).toBe("Malta 2027 wrecks (malta-27).trip.json");
    expect(tripFileName({ id: "x", name: "???" })).toBe("(x).trip.json");
  });
});

describe("dive sites", () => {
  const plan = () => mergeTripPlan(undefined, input({ dives: [] }), "T1");
  const shop = { name: " Big Blue Diving ", lat: 10.095, lng: 99.827 };
  const proposals = [
    { id: "osm-node-1", name: "Chumphon Pinnacle", maxDepthM: 35, distanceKm: 7.2, source: "https://www.openstreetmap.org/node/1", why: " Your deepest dives were 30 m. " },
    { name: "Sail Rock", type: "", why: "A chimney swim-through; 12 m is enough." },
    { name: "Twins", why: "Easy reef for the first day." },
  ];

  it("proposes sites around the shop, an id from OpenStreetMap or from the name", () => {
    const p = plan();
    proposeSites(p, shop, proposals);
    expect(p.shop).toEqual({ name: "Big Blue Diving", lat: 10.095, lng: 99.827 });
    expect(p.sites!.map((s) => [s.id, s.status])).toEqual([
      ["osm-node-1", "proposed"],
      ["sail-rock", "proposed"],
      ["twins", "proposed"],
    ]);
    expect(p.sites![0]).toEqual({
      id: "osm-node-1",
      name: "Chumphon Pinnacle",
      maxDepthM: 35,
      distanceKm: 7.2,
      source: "https://www.openstreetmap.org/node/1",
      why: "Your deepest dives were 30 m.",
      status: "proposed",
      profile: null,
    });
    expect(p.sites![1]).not.toHaveProperty("type");
  });

  it("keeps the choices and profiles when proposing again, and never loses a chosen site", () => {
    const p = plan();
    proposeSites(p, shop, proposals);
    chooseSites(p, { chosen: ["osm-node-1", "sail-rock"], dropped: ["twins"] });
    saveSiteProfile(p, "sail-rock", "## Sail Rock\nSource: https://example.com", "T2");
    proposeSites(p, shop, [proposals[0], proposals[2], { name: "White Rock", why: "Close to the shop." }]);
    expect(p.sites!.map((s) => [s.id, s.status, !!s.profile])).toEqual([
      ["osm-node-1", "chosen", false],
      ["twins", "dropped", false],
      ["white-rock", "proposed", false],
      ["sail-rock", "chosen", true],
    ]);
  });

  it("writes a profile only for a chosen site; \"\" removes it", () => {
    const p = plan();
    proposeSites(p, shop, proposals);
    expect(() => saveSiteProfile(p, "twins", "## Twins", "T2")).toThrow("isn't chosen");
    chooseSites(p, { chosen: ["twins"] });
    expect(saveSiteProfile(p, "twins", " ## Twins ", "T2").profile).toEqual({ markdown: "## Twins", savedAt: "T2" });
    expect(saveSiteProfile(p, "twins", "", "T3").profile).toBeNull();
    chooseSites(p, { proposed: ["twins"] });
    expect(saveSiteProfile(p, "twins", "", "T4").profile).toBeNull();
    expect(() => saveSiteProfile(p, "nope", "x", "T2")).toThrow('no proposed site "nope"');
  });

  it("refuses an unknown site, a site proposed twice, a bad id and missing names", () => {
    const p = plan();
    expect(() => chooseSites(p, { chosen: ["x"] })).toThrow("Its sites: none yet");
    proposeSites(p, shop, proposals);
    expect(() => chooseSites(p, { chosen: ["chumphon"] })).toThrow(TripInputError);
    expect(() => proposeSites(p, shop, [proposals[1], proposals[1]])).toThrow("proposed twice");
    expect(() => proposeSites(p, shop, [{ id: "a b", name: "A", why: "x" }])).toThrow("Invalid site id");
    expect(() => proposeSites(p, shop, [{ name: " ", why: "x" }])).toThrow("needs a name");
    expect(() => proposeSites(p, { name: "" }, proposals)).toThrow("dive shop needs a name");
  });

  it("stay when TripDeck's cards are saved again", () => {
    const p = plan();
    proposeSites(p, shop, proposals, { markdown: "## The season", now: "T2" });
    const again = mergeTripPlan(p, input(), "T5");
    expect(again.shop).toEqual(p.shop);
    expect(again.sites).toHaveLength(3);
    expect(again.siteNotes).toEqual({ markdown: "## The season", savedAt: "T2" });
  });

  it("keeps the notes on the list until new ones or \"\" are sent", () => {
    const p = plan();
    proposeSites(p, shop, proposals, { markdown: " ## Big Blue's rotation ", now: "T2" });
    expect(p.siteNotes).toEqual({ markdown: "## Big Blue's rotation", savedAt: "T2" });
    proposeSites(p, shop, proposals);
    expect(p.siteNotes?.savedAt).toBe("T2");
    proposeSites(p, shop, proposals, { markdown: "", now: "T3" });
    expect(p).not.toHaveProperty("siteNotes");
  });

  it("slugs names, accents and all", () => {
    expect(siteSlug("Chumphon Pinnacle")).toBe("chumphon-pinnacle");
    expect(siteSlug("Cenote Dos Ojos – Bat Cave")).toBe("cenote-dos-ojos-bat-cave");
    expect(siteSlug("Ängelholm Récif")).toBe("angelholm-recif");
    expect(siteSlug("Hin Bai (หินใบ)")).toBe("hin-bai-หินใบ");
    expect(siteSlug("!!!")).toBe("site");
  });
});

describe("siteForCard", () => {
  const site = (name: string, status: "proposed" | "chosen" | "dropped" = "proposed") => ({ id: siteSlug(name), name, why: "", status, profile: null });
  const sites = [site("Sail Rock", "chosen"), site("Twin Rocks (Twins)"), site("Green Rock", "dropped"), site("Chumphon Pinnacle")];

  it("finds the site by the card's site, its title or the site's other name", () => {
    expect(siteForCard(sites, { title: "Sail Rock full-day trip" })?.name).toBe("Sail Rock");
    expect(siteForCard(sites, { title: "Morning dive", site: "twins" })?.name).toBe("Twin Rocks (Twins)");
    expect(siteForCard(sites, { title: "Twin Rocks" })?.name).toBe("Twin Rocks (Twins)");
  });

  it("never gives a dropped site, prefers a chosen one, and doesn't match part of a word", () => {
    expect(siteForCard(sites, { title: "Green Rock" })).toBeNull();
    expect(siteForCard([site("Rock", "proposed"), site("Sail Rock", "chosen")], { title: "Sail Rock" })?.name).toBe("Sail Rock");
    expect(siteForCard(sites, { title: "Sail Rocks tour" })).toBeNull();
    expect(siteForCard(undefined, { title: "Sail Rock" })).toBeNull();
    expect(siteForCard(sites, { title: "Big Blue Best-Of – day 1/3" })).toBeNull();
  });
});

describe("a card's site set by hand", () => {
  const withSites = () => {
    const p = mergeTripPlan(undefined, input(), "T1");
    proposeSites(p, { name: "Shop" }, [
      { name: "Blue Hole", why: "x" },
      { name: "Canyon", why: "y" },
    ]);
    return p;
  };

  it("wins over the name, can say no site, and goes back to the name", () => {
    const p = withSites();
    const night = p.dives.find((d) => d.itemId === "c")!;
    expect(siteForCard(p.sites, night)).toBeNull();
    setCardSite(p, "c", "canyon");
    expect(siteForCard(p.sites, night)?.name).toBe("Canyon");
    const blue = p.dives.find((d) => d.itemId === "a")!;
    expect(siteForCard(p.sites, blue)?.name).toBe("Blue Hole");
    setCardSite(p, "a", "none");
    expect(siteForCard(p.sites, blue)).toBeNull();
    setCardSite(p, "a", null);
    expect(blue).not.toHaveProperty("siteId");
    expect(() => setCardSite(p, "zz", "canyon")).toThrow("no dive card zz");
    expect(() => setCardSite(p, "a", "nope")).toThrow('no proposed site "nope"');
  });

  it("stays when the cards are saved again, unless a new one or \"\" is sent", () => {
    const p = withSites();
    setCardSite(p, "c", "canyon");
    const again = mergeTripPlan(p, input(), "T2");
    expect(again.dives.find((d) => d.itemId === "c")?.siteId).toBe("canyon");
    const cleared = mergeTripPlan(again, input({ dives: [{ itemId: "c", title: "Night dive", siteId: "" }] }), "T3");
    expect(cleared.dives[0]).not.toHaveProperty("siteId");
    const set = mergeTripPlan(cleared, input({ dives: [{ itemId: "c", title: "Night dive", siteId: "blue-hole" }] }), "T4");
    expect(set.dives[0].siteId).toBe("blue-hole");
  });
});

describe("to-dos", () => {
  it("replaces the companion's list, keeping what was ticked off and the diver's own", () => {
    const p = mergeTripPlan(undefined, input({ todos: [{ text: "Ask which tanks", itemId: "b" }, { text: "Buy an SMB" }] }), "T1");
    expect(p.todos).toEqual([
      { id: "t1", text: "Ask which tanks", done: false, by: "companion", createdAt: "T1", itemId: "b" },
      { id: "t2", text: "Buy an SMB", done: false, by: "companion", createdAt: "T1" },
    ]);
    setTodoDone(p, "t1", true, "T2");
    addTodo(p, " Book a refresher ", undefined, "T2");
    const again = mergeTripPlan(p, input({ todos: [{ text: "ask WHICH tanks" }, { text: "Confirm the meeting time", itemId: "a" }] }), "T3");
    expect(again.todos!.map((t) => [t.id, t.text, t.done, t.by, t.itemId])).toEqual([
      ["t3", "Book a refresher", false, "diver", undefined],
      ["t1", "ask WHICH tanks", true, "companion", undefined],
      ["t4", "Confirm the meeting time", false, "companion", "a"],
    ]);
    expect(mergeTripPlan(again, input(), "T4").todos).toHaveLength(3);
    expect(mergeTripPlan(again, input({ todos: [] }), "T4").todos!.map((t) => t.by)).toEqual(["diver"]);
  });

  it("ticks off, unticks and removes, refusing what isn't there", () => {
    const p = mergeTripPlan(undefined, input(), "T1");
    expect(p).not.toHaveProperty("todos");
    const t = addTodo(p, "Pack the camera", "a", "T1");
    expect(t).toEqual({ id: "t1", text: "Pack the camera", done: false, by: "diver", createdAt: "T1", itemId: "a" });
    expect(setTodoDone(p, "t1", true, "T2")).toMatchObject({ done: true, doneAt: "T2" });
    expect(setTodoDone(p, "t1", false, "T3")).not.toHaveProperty("doneAt");
    removeTodo(p, "t1");
    expect(p).not.toHaveProperty("todos");
    expect(() => setTodoDone(p, "t9", true, "T")).toThrow("no to-do t9");
    expect(() => removeTodo(p, "t9")).toThrow("no to-do t9");
    expect(() => addTodo(p, " ", undefined, "T")).toThrow("needs a text");
    expect(() => addTodo(p, "x", "zz", "T")).toThrow("no dive card zz");
    expect(() => mergeTripPlan(undefined, input({ todos: [{ text: "" }] }), "T")).toThrow("needs a text");
    expect(() => mergeTripPlan(undefined, input({ todos: [{ text: "x".repeat(301) }] }), "T")).toThrow("one line");
  });
});
