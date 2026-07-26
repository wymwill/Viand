import { describe, expect, it } from "vitest";
import { placeDetails, recommendations } from "@/domain/messages/copy";
import type { Candidate } from "@/domain/recommendations/select";
import { restaurant } from "../helpers/factories";

const attribution = { sourceLabel: "Live results from OpenStreetMap.", resolvedLocation: null };

function candidate(overrides: Parameters<typeof restaurant>[0] = {}): Candidate {
  return {
    restaurant: restaurant(overrides),
    score: {
      total: 0.5,
      weakestMember: 0.5,
      averageMember: 0.5,
      cuisineMatch: 0.5,
      distance: 0.5,
      rating: 0.5,
      priceMatch: 0.5,
    },
    explanation: "Solid all-round option.",
  };
}

describe("placeDetails", () => {
  it("includes the website and a Yelp lookup link", () => {
    const message = placeDetails(
      restaurant({
        name: "Gusto",
        address: "123 College Ave",
        website: "https://gusto.example",
        phone: "+1 510-555-0100",
      }),
    );

    expect(message).toContain("Website: https://gusto.example");
    expect(message).toContain("Phone: +1 510-555-0100");
    expect(message).toContain("Directions: ");
    expect(message).toContain("yelp.com/search");
    // The Yelp link searches by name and address rather than pretending to be
    // a canonical business page.
    expect(message).toContain("find_desc=Gusto");
  });

  it("omits fields the source did not publish", () => {
    const message = placeDetails(restaurant({ website: null, phone: null, rating: 0 }));

    expect(message).not.toContain("Website:");
    expect(message).not.toContain("Phone:");
    expect(message).not.toContain("★");
    // Directions and the Yelp lookup are always available.
    expect(message).toContain("Directions: ");
    expect(message).toContain("yelp.com/search");
  });

  it("lists dietary options in readable form", () => {
    const message = placeDetails(restaurant({ accommodates: ["gluten_free", "halal"] }));
    expect(message).toContain("Options for: gluten-free, halal");
  });
});

describe("recommendations copy", () => {
  it("shows a rating when one is known", () => {
    const message = recommendations([candidate({ rating: 4.5 })], false, attribution);
    expect(message).toContain("4.5★");
  });

  it("omits the rating rather than showing zero stars when none is known", () => {
    const message = recommendations([candidate({ rating: 0 })], false, attribution);
    expect(message).not.toContain("★");
    // The rest of the line still renders.
    expect(message).toMatch(/mi · \$/);
  });

  it("names the area when the provider resolved one", () => {
    const message = recommendations([candidate(), candidate(), candidate()], false, {
      ...attribution,
      resolvedLocation: "Downtown Berkeley",
    });
    expect(message).toContain("Three options near Downtown Berkeley");
  });

  it("counts and pluralises the options it actually found", () => {
    expect(recommendations([candidate()], false, attribution)).toContain("I found one option:");
    expect(
      recommendations([candidate(), candidate(), candidate(), candidate(), candidate()], false, {
        ...attribution,
        resolvedLocation: "Berkeley",
      }),
    ).toContain("Five options near Berkeley");
  });

  it("asks for a ballot matching the number of options", () => {
    expect(recommendations([candidate(), candidate(), candidate()], false, attribution)).toContain(
      "Reply 1, 2, or 3.",
    );
    expect(
      recommendations(
        [candidate(), candidate(), candidate(), candidate(), candidate()],
        false,
        attribution,
      ),
    ).toContain("Reply 1, 2, 3, 4, or 5.");
  });

  it("tells the group how to ask for more", () => {
    const message = recommendations([candidate(), candidate()], false, attribution);
    expect(message).toContain("details 2");
  });

  it("always credits the source", () => {
    const message = recommendations([candidate()], false, attribution);
    expect(message).toContain("Live results from OpenStreetMap.");
  });
});
