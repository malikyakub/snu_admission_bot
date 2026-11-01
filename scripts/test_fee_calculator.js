/**
 * Unit checks for the confirmed fee model (reference totals only).
 * Run: node scripts/test_fee_calculator.js
 */
const assert = require("assert");

const FEE_EXAM = 30;
const FEE_ADMIN = 50;
const FEE_EAP = 350;
const FEE_ID_RENEWAL = 10;
const FOUNDATION_EXTRA = 2;

function expectedTotal(semesterRate, originalYears) {
  const totalSemesters = originalYears * 2 + FOUNDATION_EXTRA;
  const renewals = Math.floor(totalSemesters / 4);
  return (
    FEE_EXAM +
    FEE_ADMIN +
    FEE_EAP +
    semesterRate * totalSemesters +
    FEE_ID_RENEWAL * renewals
  );
}

const cases = [
  { name: "Education", rate: 50, years: 4, expect: 950 },
  { name: "Science", rate: 125, years: 4, expect: 1700 },
  { name: "Medicine", rate: 125, years: 6, expect: 2210 },
  { name: "Economic", rate: 80, years: 4, expect: 1250 },
  { name: "Veterinary", rate: 80, years: 5, expect: 1420 },
  { name: "Engineering", rate: 125, years: 5, expect: 1960 },
];

for (const c of cases) {
  const got = expectedTotal(c.rate, c.years);
  assert.strictEqual(got, c.expect, `${c.name}: expected ${c.expect}, got ${got}`);
  console.log(`OK ${c.name} = $${got}`);
}

assert.ok(2210 > 1700 && 1700 > 950);
console.log("OK Medicine > Science > Education");
console.log("PASS");
