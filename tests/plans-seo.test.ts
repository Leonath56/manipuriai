import test from "node:test";
import assert from "node:assert/strict";
import { PLANS_URL, plansApplicationSchema as schema } from "../src/lib/plans-seo.ts";

test("Plans describes the requested web communication application, not a Product", () => {
  assert.equal(schema["@type"], "SoftwareApplication");
  assert.equal(schema.name, "Manipuri AI");
  assert.equal(schema.applicationCategory, "CommunicationApplication");
  assert.equal(schema.operatingSystem, "Web");
});

test("Free, Pro and Max preserve the actual INR prices and monthly paid periods", () => {
  assert.deepEqual(schema.offers.map(({ name, price, priceCurrency }) => ({ name, price, priceCurrency })), [
    { name: "Free", price: "0", priceCurrency: "INR" },
    { name: "Pro", price: "99", priceCurrency: "INR" },
    { name: "Max", price: "399", priceCurrency: "INR" },
  ]);
  for (const offer of schema.offers.slice(1)) {
    assert.equal(offer.priceSpecification?.billingDuration, "P1M");
    assert.equal(offer.priceSpecification?.price, offer.price);
  }
});

test("Plans self-references its public URL and supplies a representative public image", () => {
  assert.equal(PLANS_URL, "https://manipuriai.online/plans");
  assert.equal(schema.image, "https://manipuriai.online/og-image.jpg?v=6");
  assert.ok(schema.offers.every((offer) => offer.url === PLANS_URL));
});

test("Digital plans do not claim shipping, return policies or unverified ratings", () => {
  const serialized = JSON.stringify(schema);
  for (const property of ["shippingDetails", "hasMerchantReturnPolicy", "aggregateRating", "review"]) {
    assert.equal(serialized.includes(`"${property}"`), false);
  }
});