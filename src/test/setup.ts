import "@testing-library/jest-dom/vitest";
import { initI18n } from "../i18n";

// English strings are the test fixture: init i18n once so every component and
// t()-backed helper renders the same text the assertions were written against.
initI18n("en");
