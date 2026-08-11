const fs = require("fs");
const chunks = JSON.parse(fs.readFileSync("kb_chunks.json", "utf8"));

const idx = chunks.findIndex(
  (c) => c.topic === "fees" && c.content.includes("known conflict")
);
if (idx === -1) { console.error("Chunk not found"); process.exit(1); }

chunks[idx].content =
  "SNU undergraduate fee breakdown — use ONLY these three fee items, no others:\n" +
  "1. Registration & ID Card Fee: $50 (one-time, applies to all faculties)\n" +
  "2. Foundation Programme (EAP, 5 levels): $350 (one-time, all students)\n" +
  "3. Faculty administrative charge (one-time): Agriculture & Environmental Science $80, " +
  "Economic & Management Science $80, Education $50, Engineering $125, " +
  "Health Sciences & Tropical Medicine $100, Languages $80, Law $80, " +
  "Medicine & Surgery $125, Science $125, Sharia & Islamic Studies $50, " +
  "Social Science $80, Veterinary Medicine & Animal Husbandry $80\n" +
  "Tuition is FREE for all undergraduate programmes.\n" +
  "Pre-calculated one-time totals (Registration + Foundation + admin charge):\n" +
  "Agriculture & Environmental Science $480 | Economic & Management Science $480 | " +
  "Education $450 | Engineering $525 | Health Sciences & Tropical Medicine $500 | " +
  "Languages $480 | Law $480 | Medicine & Surgery $525 | Science $525 | " +
  "Sharia & Islamic Studies $450 | Social Science $480 | " +
  "Veterinary Medicine & Animal Husbandry $480\n" +
  "CRITICAL: Never add any fee item not listed above. " +
  "Do NOT mention $55, $30, $20, $1,000, or any other figure. " +
  "The total for Science (including Computer Science) is $525.";

fs.writeFileSync("kb_chunks.json", JSON.stringify(chunks, null, 2));
console.log("Done. New content:\n" + chunks[idx].content);
